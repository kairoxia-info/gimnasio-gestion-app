// El color que el profesor elige en Configuración (gimnasios.color_principal)
// tiene que reflejarse en TODA la app -- no alcanzaba con guardarlo en la
// base. Bug real reportado por Nalux (03/09/2026): "recién cambié a un color
// morado pero la app no cambió de color". Causa: --primary/--accent/--ring
// están hardcodeados en index.css al rojo de Kairox (2 100% 44%) y NADA en
// el código los sobreescribía -- el color guardado solo se usaba, suelto, en
// el PDF del comprobante (PagosPage) y en los PDF de MiPlanPage. El picker
// de color de ConfiguracionPage.jsx guardaba el valor perfectamente; nunca
// se leía de vuelta para pintar nada en pantalla.
//
// Esta función convierte el HEX guardado a HSL (el formato que usan acá las
// custom properties, "H S% L%", para no tener que tocar ningún className:
// Tailwind sigue leyendo hsl(var(--primary)) en todos lados) y la inyecta en
// <html> vía JS -- se llama una vez que se sabe el color del gimnasio
// (AuthContext, para toda la app del profesor; MiPlanPage, para la pantalla
// pública del alumno).
//
// --destructive queda A PROPÓSITO sin tocar, aunque hoy comparta el mismo
// rojo hardcodeado que --primary en index.css: los botones "Eliminar" son
// más seguros si el rojo de peligro es siempre el mismo, independiente de
// la marca de cada gimnasio -- si mañana alguien elige un morado o un verde
// como color principal, un "Eliminar" en ese mismo tono se distingue peor
// que uno que sigue siendo rojo.

const normalizarHex = (hex) => {
    const limpio = (hex || '').trim().replace('#', '');
    return /^[0-9a-fA-F]{6}$/.test(limpio) ? limpio : null;
};

const hexARgb = (hexLimpio) => ({
    r: parseInt(hexLimpio.slice(0, 2), 16),
    g: parseInt(hexLimpio.slice(2, 4), 16),
    b: parseInt(hexLimpio.slice(4, 6), 16),
});

const rgbAHsl = ({ r, g, b }) => {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    const d = max - min;
    if (d !== 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) h = ((gn - bn) / d) % 6;
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
};

// Luminancia relativa WCAG -- decide si el texto de encima de este color
// tiene que ser blanco o casi negro para leerse bien. Sin esto, un color
// pastel (ej. un amarillo claro) con el texto blanco fijo de siempre
// quedaría prácticamente invisible.
const luminanciaRelativa = ({ r, g, b }) => {
    const canal = (c) => {
        const cn = c / 255;
        return cn <= 0.03928 ? cn / 12.92 : ((cn + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};

// Sin color válido (todavía no cargó el gimnasio, o el campo está vacío/mal
// cargado) vuelve al rojo de fábrica quitando el override -- nunca deja la
// interfaz sin ningún --primary definido.
export const aplicarColorGimnasio = (hexColor) => {
    if (typeof document === 'undefined') return; // guarda por las dudas en SSR/tests
    const raiz = document.documentElement;
    const hexLimpio = normalizarHex(hexColor);

    if (!hexLimpio) {
        raiz.style.removeProperty('--primary');
        raiz.style.removeProperty('--primary-foreground');
        raiz.style.removeProperty('--accent');
        raiz.style.removeProperty('--accent-foreground');
        raiz.style.removeProperty('--ring');
        return;
    }

    const rgb = hexARgb(hexLimpio);
    const { h, s, l } = rgbAHsl(rgb);
    const hsl = `${h} ${s}% ${l}%`;
    const foreground = luminanciaRelativa(rgb) > 0.5 ? '0 0% 8%' : '0 0% 100%';

    raiz.style.setProperty('--primary', hsl);
    raiz.style.setProperty('--primary-foreground', foreground);
    raiz.style.setProperty('--accent', hsl);
    raiz.style.setProperty('--accent-foreground', foreground);
    raiz.style.setProperty('--ring', hsl);
};
