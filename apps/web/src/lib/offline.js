import supabase from '@/lib/supabaseClient';
import { getCurrentGimnasioId } from '@/lib/currentGimnasio';

// Módulo central de "el panel sigue andando sin wifi" (pedido de Nalux,
// 04/09/2026: "es raro, pero mejor prevenir"). Dos cosas separadas:
//
// 1. Cache de lectura: listAll() (lib/data.js) guarda acá cada resultado
//    que trae con éxito, y si la próxima vez falla por error de RED (no por
//    RLS/permiso), devuelve lo último guardado en vez de romper la
//    pantalla. Sirve para VER datos ya cargados sin conexión.
//
// 2. Cola de escritura: asistencia y pagos (los dos casos que pidió Nalux)
//    encolan acá cuando createRec/updateRec falla por red, y se mandan
//    solos apenas vuelve la conexión (evento 'online' del navegador).
//
// Todo en localStorage, con prefijo propio y separado por gimnasio_id --
// así en el mismo celular/navegador, un profesor no ve nunca cache ni cola
// de otro gimnasio. limpiarTodoOffline() se llama al cerrar sesión
// (AuthContext.jsx) para que tampoco quede nada de un profesor para el
// siguiente que se loguee ahí.
const PREFIJO_CACHE = 'kairox_cache_';
const CLAVE_COLA = 'kairox_cola_pendiente';
// Bug real encontrado en la auditoría final del proyecto (15/09/2026, agente
// frontend-architect): cuando sincronizarCola() fallaba por un error que NO
// era de red (validación, RLS, columna inválida) simplemente descartaba el
// ítem con un console.error -- el contador de "pendientes" que ve el
// profesor en AppLayout.jsx bajaba a 0 igual, como si se hubiera guardado
// todo. Un pago cargado sin wifi podía perderse para siempre sin que nadie
// se enterara: parecía cobrado y no había quedado ningún registro. Ahora esos
// ítems se mueven a esta SEGUNDA cola en vez de tirarse -- ver
// sincronizarCola() más abajo.
const CLAVE_COLA_FALLIDA = 'kairox_cola_fallida';

/* ---------------- Cache de lectura ---------------- */

const claveCache = (tabla, opciones) => {
    const gimnasioId = getCurrentGimnasioId() || 'sin-gimnasio';
    const filtros = JSON.stringify(opciones?.filters || {});
    const sort = opciones?.sort || '';
    return `${PREFIJO_CACHE}${gimnasioId}::${tabla}::${sort}::${filtros}`;
};

export const guardarEnCache = (tabla, opciones, datos) => {
    try {
        localStorage.setItem(claveCache(tabla, opciones), JSON.stringify({ datos, guardadoEn: Date.now() }));
    } catch (_) {
        // localStorage lleno o bloqueado (modo privado estricto, etc.): no
        // hay cache, pero no hay nada que romper por esto.
    }
};

export const leerDeCache = (tabla, opciones) => {
    try {
        const crudo = localStorage.getItem(claveCache(tabla, opciones));
        if (!crudo) return null;
        return JSON.parse(crudo).datos ?? null;
    } catch (_) {
        return null;
    }
};

// fetch() rechaza con TypeError ("Failed to fetch" en Chrome,
// "NetworkError..." en Firefox/Safari) cuando no hay conexión -- muy
// distinto de un error que SÍ llegó a responder (RLS, validación, etc.,
// que vienen como PostgrestError con código propio). Solo en el primer
// caso tiene sentido caer al cache/encolar: el segundo es un error real
// que hay que mostrar tal cual, no esconder atrás de "estás sin conexión".
export const esErrorDeRed = (err) => {
    if (err instanceof TypeError) return true;
    const msg = String(err?.message || '');
    return /failed to fetch|networkerror|network request failed|load failed/i.test(msg);
};

/* ---------------- Cola de escrituras pendientes ---------------- */

const leerCola = () => {
    try {
        return JSON.parse(localStorage.getItem(CLAVE_COLA) || '[]');
    } catch (_) {
        return [];
    }
};

const guardarCola = (cola) => {
    try {
        localStorage.setItem(CLAVE_COLA, JSON.stringify(cola));
    } catch (_) {
        // sin espacio/bloqueado: la acción ya se aplicó de forma optimista
        // en la pantalla, simplemente no va a quedar en cola para reintentar
    }
};

const listeners = new Set();
const avisar = () => listeners.forEach((fn) => fn(leerCola()));

// Se suscribe a cambios en la cola (se agrega algo, se saca algo después de
// sincronizar). Devuelve la función para des-suscribirse.
export const onCambioCola = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

export const verCola = () => leerCola();

// gimnasioId se guarda junto con cada item -- por si el profesor cierra
// sesión y otro entra en el mismo celular ANTES de que se llegue a
// sincronizar (poco probable, pero limpiarTodoOffline ya cubre el caso
// normal de logout; esto es una segunda red de seguridad).
export const agregarACola = (item) => {
    const cola = leerCola();
    const conId = {
        id: crypto.randomUUID(),
        creadoEn: Date.now(),
        gimnasioId: getCurrentGimnasioId(),
        ...item,
    };
    cola.push(conId);
    guardarCola(cola);
    avisar();
    return conId;
};

const quitarDeCola = (id) => {
    guardarCola(leerCola().filter((x) => x.id !== id));
    avisar();
};

/* ---------------- Cola de escrituras que fallaron de verdad ---------------- */
// Separada de la cola pendiente a propósito: esta es plata/asistencia que
// YA NO se va a mandar sola (no es un problema de red que se arregle
// reintentando), así que necesita que el profesor la vea y decida algo --
// cargarla de nuevo a mano, o confirmar que no hacía falta.

const leerColaFallida = () => {
    try {
        return JSON.parse(localStorage.getItem(CLAVE_COLA_FALLIDA) || '[]');
    } catch (_) {
        return [];
    }
};

const guardarColaFallida = (cola) => {
    try {
        localStorage.setItem(CLAVE_COLA_FALLIDA, JSON.stringify(cola));
    } catch (_) {
        // sin espacio/bloqueado -- ver mismo comentario en guardarCola()
    }
};

const listenersFallida = new Set();
const avisarFallida = () => listenersFallida.forEach((fn) => fn(leerColaFallida()));

export const onCambioColaFallida = (fn) => {
    listenersFallida.add(fn);
    return () => listenersFallida.delete(fn);
};

export const verColaFallida = () => leerColaFallida();

const moverAFallida = (item, err) => {
    const cola = leerColaFallida();
    cola.push({ ...item, error: String(err?.message || err || 'Error desconocido'), falloEn: Date.now() });
    guardarColaFallida(cola);
    avisarFallida();
};

// El profesor tocó "Ya lo resolví" después de revisar un ítem fallido (lo
// cargó de nuevo a mano, o confirmó que no hacía falta) -- recién ahí se
// saca de la lista. Nunca se saca solo.
export const descartarFallido = (id) => {
    guardarColaFallida(leerColaFallida().filter((x) => x.id !== id));
    avisarFallida();
};

// Se llama al cerrar sesión (AuthContext.jsx). OJO: si hay algo pendiente
// de sincronizar todavía, se pierde -- por eso "Cerrar sesión" avisa antes
// si hay cola sin mandar (ver AppLayout.jsx).
export const limpiarTodoOffline = () => {
    Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIJO_CACHE))
        .forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem(CLAVE_COLA);
    localStorage.removeItem(CLAVE_COLA_FALLIDA);
    avisar();
    avisarFallida();
};

/* ---------------- Sincronización ---------------- */

// En orden, uno por uno (no en paralelo): para pagos importa que se manden
// en el mismo orden en que se cargaron, porque el número de comprobante de
// cada uno se asigna recién al mandarse de verdad -- mandarlos todos juntos
// podría numerarlos en un orden distinto al que el profesor los cobró.
let sincronizando = false;
export const sincronizarCola = async () => {
    if (sincronizando) return;
    sincronizando = true;
    try {
        for (const item of leerCola()) {
            try {
                if (item.tipo === 'pago') {
                    const { error } = await supabase
                        .from('pagos')
                        .upsert(
                            { ...item.payload, gimnasio_id: item.gimnasioId, client_id: item.id },
                            { onConflict: 'client_id', ignoreDuplicates: true },
                        );
                    if (error) throw error;
                } else if (item.tipo === 'asistencia') {
                    const { error } = await supabase
                        .from('asistencias')
                        .upsert(
                            { ...item.payload, gimnasio_id: item.gimnasioId },
                            { onConflict: 'alumno_id,fecha' },
                        );
                    if (error) throw error;
                }
                quitarDeCola(item.id);
            } catch (err) {
                if (esErrorDeRed(err)) {
                    // Se cortó la conexión de nuevo a mitad de la sincronización
                    // -- para acá, el resto de la cola queda para el próximo
                    // evento 'online'.
                    break;
                }
                // Error real (no de red): no hay forma de que un reintento lo
                // arregle solo. Se saca de ESTA cola para no trabarse
                // reintentando algo que nunca va a funcionar, pero YA NO se
                // tira -- se mueve a la cola de fallidos (bug real corregido
                // 15/09/2026, ver comentario de CLAVE_COLA_FALLIDA arriba) para
                // que el profesor lo vea en AppLayout.jsx y decida qué hacer.
                console.error('No se pudo sincronizar (movido a fallidos):', item, err);
                moverAFallida(item, err);
                quitarDeCola(item.id);
            }
        }
    } finally {
        sincronizando = false;
    }
};

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        sincronizarCola();
    });
}
