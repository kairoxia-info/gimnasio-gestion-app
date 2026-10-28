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

// La caché de lectura guarda alumnos con contacto, observaciones de salud y
// notas (dato sensible, Ley 25.326) en claro en localStorage. Auditoría del
// 28/10/2026: si se la deja para siempre, un celular robado o una compu
// compartida conserva esos datos mucho después de que la sesión terminó. Como
// la caché solo sirve de red de seguridad cuando falla la conexión, y se
// reescribe en cada lectura exitosa (quien usa la app a diario la renueva
// sola), pasadas 24 horas sin renovarse se descarta: quedarse un día entero
// sin señal y necesitar justo esos datos viejos es mucho más raro que un
// dispositivo perdido.
const MAX_EDAD_CACHE_MS = 24 * 60 * 60 * 1000;

export const leerDeCache = (tabla, opciones) => {
    try {
        const clave = claveCache(tabla, opciones);
        const crudo = localStorage.getItem(clave);
        if (!crudo) return null;
        const { datos, guardadoEn } = JSON.parse(crudo);
        if (!guardadoEn || Date.now() - guardadoEn > MAX_EDAD_CACHE_MS) {
            localStorage.removeItem(clave);
            return null;
        }
        return datos ?? null;
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

// Solo la caché de LECTURA (datos de alumnos, pagos, etc. ya vistos). NO toca la
// cola de pagos/asistencia pendientes de mandar: se usa cuando la sesión se
// termina SOLA (vencida, revocada, cerrada desde otra pestaña), y ahí borrar la
// cola haría desaparecer cobros sin avisar -- limpiarTodoOffline() puede
// hacerlo porque "Cerrar sesión" a mano avisa antes si hay pendientes.
export const limpiarCacheDeLectura = () => {
    Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIJO_CACHE))
        .forEach((k) => localStorage.removeItem(k));
};

// Portal del alumno: el service worker (public/sw.js) guarda la respuesta de
// ver_plan_por_codigo de cada alumno que entra en ese dispositivo (nombre,
// fecha de nacimiento, rutina, plan de comida, estado de cuota). "Cerrar
// sesión" del alumno solo navegaba al login y esas copias quedaban en un
// celular o tablet compartidos. Se borran SOLO las respuestas del plan, no el
// resto de la caché (los archivos de la app siguen guardados para abrir sin
// señal). Mejor esfuerzo: si el navegador no soporta Cache API, no pasa nada.
export const limpiarPlanesDelAlumnoGuardados = async () => {
    try {
        if (typeof caches === 'undefined') return;
        const nombres = (await caches.keys()).filter((n) => n.startsWith('kairox-'));
        for (const nombre of nombres) {
            const cache = await caches.open(nombre);
            const pedidos = await cache.keys();
            await Promise.all(
                pedidos.filter((p) => p.url.includes('ver_plan_por_codigo')).map((p) => cache.delete(p)),
            );
        }
    } catch (_) {
        // sin Cache API o bloqueada: no hay nada que limpiar ni que romper
    }
};

/* ---------------- Aviso de "se guardó algo" ---------------- */

// Reportado por Nalux (28/10/2026): el profesor corrige un plan por vencer y
// el aviso de la campanita queda ahí aunque ya se resolvió. La campanita
// (NotificacionesCampana.jsx) vive en AppLayout y pide sus datos al montarse,
// al llegar un alumno nuevo y al volver a la pestaña -- pero NO cuando el
// profesor guarda algo en la misma pantalla (corregir la fecha de un plan en
// la ficha, cargar un pago): hasta cambiar de pantalla seguía mostrando datos
// viejos. Esto es el aviso interno: cada escritura exitosa sobre una tabla
// que la campanita mira dispara este evento en window y ella vuelve a
// preguntar. Solo cuenta el navegador de ESTE profesor; los cambios hechos
// desde otro dispositivo los cubre el "volver a la pestaña" de la campanita.
export const EVENTO_DATOS_CAMBIARON = 'kairox:datos-cambiaron';
const TABLAS_QUE_MIRA_LA_CAMPANA = new Set(['alumnos', 'pagos', 'rutinas_asignadas', 'planes_alimentacion']);

export const avisarCambioDeDatos = (tabla) => {
    if (typeof window === 'undefined' || !TABLAS_QUE_MIRA_LA_CAMPANA.has(tabla)) return;
    window.dispatchEvent(new Event(EVENTO_DATOS_CAMBIARON));
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
                    avisarCambioDeDatos('pagos');
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
