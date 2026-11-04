// Pantalla abierta con una versión vieja (03/11/2026): los únicos 2 errores guardados en errores_cliente
// eran justo esto -- después de subir una versión nueva, una pestaña que seguía abierta pide un archivo
// de la versión anterior que Vercel ya no tiene ("Failed to fetch dynamically imported module"). La
// solución es recargar: la página vuelve a pedir todo de la versión actual.
//
// Se recarga UNA sola vez cada 30 segundos (sessionStorage), así un archivo que de verdad no existe no
// deja la página recargándose en bucle: la segunda vez se deja ver la pantalla de error de siempre.
const CLAVE = 'rutnail:recargaPorVersion';
const ESPERA_MS = 30_000;

export const esErrorDeVersionVieja = (error) =>
    /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
        String(error?.message || error || ''),
    );

// Devuelve true si recargó. Sin sessionStorage (modo privado estricto) no recarga sola: no habría forma
// de cortar un bucle.
export const recargarUnaVez = () => {
    try {
        const ultima = Number(sessionStorage.getItem(CLAVE) || 0);
        if (Date.now() - ultima < ESPERA_MS) return false;
        sessionStorage.setItem(CLAVE, String(Date.now()));
    } catch (_) {
        return false;
    }
    window.location.reload();
    return true;
};
