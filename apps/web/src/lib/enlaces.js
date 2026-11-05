// Enlaces que se arman con datos escritos por el staff o por usuarios
// (auditoría del 05/11/2026). Un href con "javascript:" o "data:" se ejecuta
// al tocarlo, así que todo enlace que venga de la base pasa por acá antes de
// llegar a un href, un src o un window.open.

// Devuelve la URL solo si es http:// o https://; si no (o si no se puede
// interpretar), cadena vacía. Devuelve la URL ya normalizada por URL(): lo que
// se validó es exactamente lo que se pinta (los espacios o caracteres de
// control del principio, que el navegador ignora, no sirven para esconder el
// protocolo).
export const enlaceSeguro = (url) => {
    if (typeof url !== 'string') return '';
    const limpio = url.trim();
    if (!limpio) return '';
    try {
        const u = new URL(limpio);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch (_) {
        return '';
    }
};

// Para validar lo que escribe el staff antes de guardar: la base lo rechaza con
// un CHECK si no empieza con http:// o https://.
export const empiezaConHttp = (texto) => /^https?:\/\//i.test(String(texto ?? '').trim());

const CORREO = /^[^\s@<>()[\]\,;:"'?&=%#/]+@[^\s@<>()[\]\,;:"'?&=%#/]+\.[^\s@<>()[\]\,;:"'?&=%#/]+$/;

// mailto: solo con un correo válido. CORREO no admite ? & = , ni %, así que no puede traer
// parámetros extra ni otro destinatario. La @ va tal cual: codificada, algunos clientes no la entienden.
export const mailtoSeguro = (correo) => {
    const c = String(correo ?? '').trim();
    return CORREO.test(c) ? `mailto:${c}` : '';
};

// wa.me exige el número solo con dígitos y con código de país (8 a 15 dígitos).
export const whatsappSeguro = (numero) => {
    const digitos = String(numero ?? '').replace(/\D/g, '');
    return digitos.length >= 8 && digitos.length <= 15 ? `https://wa.me/${digitos}` : '';
};
