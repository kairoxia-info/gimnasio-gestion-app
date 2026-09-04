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
const CACHE_NAME = 'kairox-v1';
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
                }
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
