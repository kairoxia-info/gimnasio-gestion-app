// Service worker manual, sin depender de ningún plugin de build (el
// vite.config.js de este proyecto ya tiene mucha lógica propia de la
// plataforma de despliegue -- se evita tocarlo). Pedido de Nalux
// (04/09/2026): "que el login del alumno se muestre por más que no tenga
// wifi... muchos van sin señal o wifi [al gimnasio]".
//
// Estrategia "red primero, y si no hay red, lo último que se guardó":
// - Archivos propios del sitio (HTML/JS/CSS, mismo origen): así la propia
//   app carga aunque no haya señal, en vez de la pantalla de error del
//   navegador.
// - La consulta pública del plan del alumno (ver_plan_por_codigo, migración
//   0006): así un alumno que ya entró antes sigue viendo su rutina y su
//   plan de comida aunque en el gimnasio no haya wifi ni señal en ese
//   momento -- son datos que casi nunca cambian de un día para el otro.
//
// A propósito NO toca nada más: ni el login (iniciar_sesion_alumno -- la
// primera vez que un alumno entra SÍ necesita señal, no se puede validar
// una contraseña sin preguntarle al servidor), ni ninguna llamada del
// panel del profesor (alumnos, pagos, rutinas, etc. -- datos que cambian
// todo el tiempo y donde mostrar algo viejo sin avisar sería peor que no
// mostrar nada).
// Reportado por Nalux (07/09/2026): pantalla en negro al entrar/cambiar de
// módulo en el celular, hay que recargar a mano. Causa real encontrada:
// justo después de subir una versión nueva del sitio, Vercel deja de servir
// los archivos JS/CSS de la versión ANTERIOR (cambian de nombre en cada
// build). Si este service worker todavía tenía guardado un HTML de una
// versión vieja (por ejemplo por haberse servido desde acá una vez por
// algún corte de red momentáneo) y lo devuelve, ese HTML apunta a un
// archivo .js que YA NO EXISTE en el servidor: la red responde con un 404
// real (no es un error de conexión, así que antes esto NO caía al bloque
// catch de más abajo) y la app nunca llega a arrancar. Subiendo v2 para que
// cualquier celular con la v1 vieja todavía guardada la descarte entera en
// vez de mezclar archivos de las dos versiones.
//
// v3 (28/10/2026): bug de seguridad reportado por Nalux -- un alumno que el
// profesor borra (o da de baja) seguía viendo su rutina. El servidor lo
// rechaza bien (ver_plan_por_codigo lanza "Codigo de acceso invalido"), pero
// este service worker trataba CUALQUIER respuesta de error de la red como "usá
// la copia guardada" y devolvía el último plan del alumno borrado. Ver el
// bloque de esConsultaDelPlan más abajo. Subir la versión además descarta de
// una vez todo lo guardado antes del arreglo (planes de alumnos que ya no
// existen incluidos) en cada dispositivo que vuelva a abrir el sitio con señal.
const CACHE_NAME = 'kairox-v3';
const MARCADOR_PLAN = '/rest/v1/rpc/ver_plan_por_codigo';
// Key fija donde queda guardada una copia del documento HTML de la SPA
// (siempre el mismo, sea cual sea la ruta -- React Router decide qué
// mostrar del lado del cliente). Sirve de red de seguridad para cuando el
// alumno abre una URL que en ESTE celular nunca cargó con conexión (por
// ej. /mi-plan/<código> directo, sin haber pasado antes por /alumno) y
// justo no hay señal -- sin esto, esa navegación puntual fallaría aunque
// el resto del sitio sí esté guardado.
const APP_SHELL_KEY = new Request(`${self.location.origin}/__app-shell__`);

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
            .then(() => self.clients.claim()),
    );
});

// Cache API por sí sola no distingue dos POST al mismo endpoint por su
// contenido (solo mira la URL) -- sin esto, el plan del último alumno
// consultado en ESTE navegador pisaría el de cualquier otro. Se arma una
// key sintética (GET, con el body de la consulta codificado en el hash)
// para que cada código de acceso guarde y encuentre SU PROPIA respuesta.
async function keyParaConsultaDelPlan(request) {
    const body = await request.clone().text();
    return new Request(`${request.url}#body=${encodeURIComponent(body)}`, { method: 'GET' });
}

// ¿La respuesta de error es el rechazo explícito del código de acceso? La RPC
// lo devuelve como HTTP 400 con message "Codigo de acceso invalido" (se
// compara sin depender de acentos ni mayúsculas). Se lee de un clone() para
// no consumir el cuerpo que va a recibir la página.
async function esCodigoRechazado(respuesta) {
    if (respuesta.status !== 400) return false;
    try {
        const cuerpo = await respuesta.clone().json();
        return /digo de acceso inv/i.test(String(cuerpo?.message || ''));
    } catch (_) {
        return false;
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' && request.method !== 'POST') return;

    const esConsultaDelPlan = request.method === 'POST' && request.url.includes(MARCADOR_PLAN);
    const esArchivoPropio = request.method === 'GET' && request.url.startsWith(self.location.origin);

    // Deja pasar todo lo demás sin intervenir -- login, pagos, y el resto de
    // las llamadas del panel del profesor no pasan por acá.
    if (!esConsultaDelPlan && !esArchivoPropio) return;

    const esNavegacion = request.mode === 'navigate';

    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            const cacheKey = esConsultaDelPlan ? await keyParaConsultaDelPlan(request) : request;

            try {
                const respuestaRed = await fetch(request.clone());
                if (respuestaRed && respuestaRed.ok) {
                    cache.put(cacheKey, respuestaRed.clone());
                    // Cualquier navegación que haya andado bien sirve de "foto"
                    // genérica de la SPA -- todas devuelven el mismo index.html,
                    // React Router arma la pantalla del lado del cliente.
                    if (esNavegacion) cache.put(APP_SHELL_KEY, respuestaRed.clone());
                    return respuestaRed;
                }
                // El servidor RESPONDIÓ que ese código no sirve (alumno
                // borrado, dado de baja, o código regenerado): esa es la
                // respuesta definitiva, no una falla de conexión. Se borra la
                // copia guardada -- si no, al quedarse sin señal después, el
                // plan de alguien sin acceso volvería a aparecer -- y se
                // devuelve el error tal cual para que la pantalla lo muestre.
                // Cualquier otro error de la RPC (límite de consultas, caída
                // momentánea del servidor, 5xx) sigue cayendo a la copia, que
                // es justo para lo que existe este caché.
                if (esConsultaDelPlan && (await esCodigoRechazado(respuestaRed))) {
                    await cache.delete(cacheKey);
                    return respuestaRed;
                }
                // La red respondió (no es un error de conexión) pero con un
                // error -- típicamente un 404 de un archivo .js/.css que ya no
                // existe porque se subió una versión nueva del sitio mientras
                // este celular tenía guardada una HTML de la vieja. Cae al
                // último bueno guardado en vez de dejar ese error tal cual (que
                // rompía la carga de la app entera, pantalla negra sin aviso).
                const cacheadaPorError = await cache.match(cacheKey);
                if (cacheadaPorError) return cacheadaPorError;
                return respuestaRed;
            } catch (_) {
                const cacheada = await cache.match(cacheKey);
                if (cacheada) return cacheada;
                if (esNavegacion) {
                    const shell = await cache.match(APP_SHELL_KEY);
                    if (shell) return shell;
                }
                throw new Error('offline-sin-cache');
            }
        })(),
    );
});
