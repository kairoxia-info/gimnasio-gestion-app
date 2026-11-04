import supabase from '@/lib/supabaseClient';

// Registro de errores del navegador en la tabla errores_cliente (migración
// 0066). Hasta el 21/09/2026 solo escribía ahí ErrorBoundary.jsx (crash de
// React = pantalla "Algo no cargó bien"). Pedido de Nalux al arrancar la
// semana de prueba con el primer cliente real: guardar TODO lo que rompa,
// también lo que no llega a tirar la pantalla -- un error de JavaScript
// suelto o una promesa que falla sin catch (por ejemplo, una llamada a
// Supabase que nadie atrapó). De eso se ocupa instalarCapturaGlobalDeErrores(),
// y este archivo es el único camino hacia la RPC, así ErrorBoundary y los
// listeners globales aplican las mismas reglas:
//
// - Solo en producción. Local apunta a la MISMA base que producción (hay un
//   solo proyecto de Supabase), y cada error de desarrollo escrito ahí
//   ensuciaría justo la tabla que se va a revisar al final de la semana. En
//   desarrollo se avisa por consola y no se guarda.
// - Con sesión, o en el portal del alumno. registrar_error_cliente es solo para
//   `authenticated` (decisión 2 de la 0066); el alumno no tiene sesión y va por
//   registrar_error_alumno (0096), que exige su código de acceso. Sin ninguna de
//   las dos cosas (pantallas de ingreso) no vale ni el viaje de red. getSession()
//   lee del storage local, no consulta nada.
// - En el portal no se reportan las fallas de conexión: en el gimnasio suele no
//   haber señal, no es un error de la app y le llenaría el teléfono a Nalux.
// - Tope por pestaña + repetidos. La RPC ya corta en 20 por usuario cada 5
//   minutos, pero un error en bucle (un setInterval que falla cada segundo)
//   dispararía igual esas 20 llamadas de red: acá se frena antes, y el mismo
//   mensaje seguido no se manda dos veces en 10 segundos. En desarrollo
//   React 18 relanza al window el error que atrapa un boundary, así que sin
//   esto se guardaría por duplicado.
// - Reportar nunca rompe nada: todo dentro de try/catch, sin await del lado
//   de quien llama.
const MAX_POR_PESTANA = 20;
const VENTANA_REPETIDO_MS = 10_000;
const RUTA_PORTAL = /^\/mi-plan\/([^/?#]+)/;
const ES_CONEXION = /Failed to fetch|NetworkError|Load failed|Network request failed/i;
// Respuestas normales de la base, no errores: código dado de baja, cuenta vencida, topes y datos mal cargados.
const ES_ESPERADO_PORTAL = /SUSCRIPCION_|c[oó]digo de acceso inv|demasiadas (acciones|consultas)|peso inv|d[ií]a inv|no hay una rutina activa/i;
let enviados = 0;
let ultimoMensaje = '';
let ultimoEn = 0;

const detalleDe = (razon) => {
    if (!razon) return null;
    if (razon.stack) return String(razon.stack);
    if (typeof razon === 'object') {
        // Errores de Supabase (PostgrestError/AuthError) no traen stack pero
        // sí message/details/hint/code, que es lo que sirve para entender.
        try {
            return JSON.stringify(razon);
        } catch (_) {
            return null;
        }
    }
    return String(razon);
};

export const reportarErrorCliente = async ({ mensaje, detalle }) => {
    try {
        const msg = String(mensaje || 'Error sin mensaje');
        if (!import.meta.env.PROD) {
            console.warn('[errores_cliente] en desarrollo no se guarda:', msg);
            return;
        }
        const ahora = Date.now();
        if (enviados >= MAX_POR_PESTANA) return;
        if (msg === ultimoMensaje && ahora - ultimoEn < VENTANA_REPETIDO_MS) return;
        ultimoMensaje = msg;
        ultimoEn = ahora;

        const { data } = await supabase.auth.getSession();
        const codigo = data?.session ? null : window.location.pathname.match(RUTA_PORTAL)?.[1];
        if (!data?.session && !codigo) return;
        if (codigo && (navigator.onLine === false || ES_CONEXION.test(msg))) return;

        enviados += 1;
        const error = {
            p_mensaje: msg,
            p_detalle: detalle || null,
            // La ruta del portal lleva el código de acceso del alumno: nunca se guarda.
            p_ruta: `${window.location.pathname.replace(RUTA_PORTAL, '/mi-plan/(código)')}${window.location.search}`,
            p_user_agent: navigator.userAgent,
        };
        await supabase.rpc(
            codigo ? 'registrar_error_alumno' : 'registrar_error_cliente',
            codigo ? { p_codigo: codigo, ...error } : error,
        );
    } catch (_) {
        // ni siquiera se pudo reportar: la pantalla sigue igual
    }
};

// Fallos que el portal atrapa y le muestra al alumno ("No se pudo guardar"): la pantalla no se rompe, así que
// los listeners de abajo no los ven. `accion` completa la frase "No se pudo ...".
export const reportarFalloPortal = (accion, error) => {
    const texto = String(error?.message || error || 'sin mensaje');
    if (ES_ESPERADO_PORTAL.test(texto)) return;
    reportarErrorCliente({ mensaje: `No se pudo ${accion}: ${texto}`, detalle: detalleDe(error) });
};

// Se llama una sola vez desde main.jsx, antes de montar React.
export const instalarCapturaGlobalDeErrores = () => {
    // Sin `capture`: llegan solo los errores de JavaScript. Los fallos de carga
    // de <img>/<script> (que también disparan "error" pero no burbujean)
    // quedan afuera a propósito -- una foto de ejercicio que no carga no es
    // un error de la app.
    window.addEventListener('error', (ev) => {
        const err = ev.error;
        reportarErrorCliente({
            mensaje: `Error global: ${err?.message || ev.message || 'sin mensaje'}`,
            detalle: [
                detalleDe(err),
                ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : null,
            ]
                .filter(Boolean)
                .join('\n---\n'),
        });
    });

    window.addEventListener('unhandledrejection', (ev) => {
        const razon = ev.reason;
        const msg = razon?.message || (typeof razon === 'string' ? razon : null) || 'sin mensaje';
        reportarErrorCliente({
            mensaje: `Promesa sin catch: ${msg}`,
            detalle: detalleDe(razon),
        });
    });
};
