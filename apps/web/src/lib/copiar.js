// Copiar texto al portapapeles, con respaldo.
//
// Bug reportado por Nalux (09/09/2026) sobre el botón de copiar el link del
// alumno: "aprieto pero no se copia, ni me dice nada". La causa fue usar
// navigator.clipboard.writeText() a secas dentro de un try/catch que se
// tragaba el error en silencio -- si el navegador bloquea esa API (pasa por
// permisos, por una política del sitio, o cuando el documento no está
// enfocado), el botón no hacía absolutamente nada y no había forma de
// enterarse.
//
// Ahora: se intenta la API moderna y, si falla o no existe, se cae al método
// viejo (textarea temporal + execCommand('copy')), que no pide permisos y
// funciona en prácticamente cualquier navegador. Devuelve true/false para que
// quien llama pueda avisar en pantalla en vez de fallar mudo.
export const copiarAlPortapapeles = async (texto) => {
    if (!texto) return false;

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(texto);
            return true;
        } catch (_) {
            // Sigue al respaldo de abajo en vez de darse por vencido acá.
        }
    }

    try {
        const area = document.createElement('textarea');
        area.value = texto;
        // Fuera de la vista pero enfocable: si estuviera con display:none o
        // visibility:hidden, la selección no funciona y execCommand falla.
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
    } catch (_) {
        return false;
    }
};
