// Lógica compartida para decidir si el media_url de un ejercicio se puede
// mostrar adentro de la app (imagen o video embebido) o si hay que abrirlo
// como link externo. Vivía duplicada en EjerciciosPage.jsx; se separó acá
// (03/09/2026) para poder reusarla también en RutinasPage.jsx (preview al
// pasar el mouse por la lista de ejercicios al armar una rutina).

// Un ejercicio puede tener media_url apuntando a un archivo propio (bucket
// ejercicios-media) o a un link externo (YouTube, Vimeo, etc.). Solo tiene
// sentido borrar de Storage en el primer caso — para el segundo no hay nada
// nuestro que limpiar. El path dentro del bucket es siempre lo que viene
// después de ".../object/public/ejercicios-media/".
export const pathEnBucket = (mediaUrl) => {
    const marca = '/object/public/ejercicios-media/';
    const i = mediaUrl?.indexOf(marca) ?? -1;
    return i === -1 ? null : mediaUrl.slice(i + marca.length);
};

// Reportado por Nalux: "Ver demostración" abría el archivo en otra pestaña y
// en el celular no se entendía cómo volver a la app. Para un archivo propio
// (subido a nuestro bucket, mismas extensiones que ya valida onMediaChange)
// alcanza con mostrarlo adentro, en un modal — nunca hay "pestaña" de la que
// volver porque nunca se sale de la app. Para un link externo tipo YouTube/
// Vimeo no hay nada que embeber de forma simple y confiable, así que ese
// caso sigue abriendo en pestaña nueva como antes.
//
// Excepción agregada al importar la biblioteca base (03/09/2026, mismo
// pedido: "que halla una vuelta atras para volver a la app"): esos
// ejercicios traen `media_url` externa (foto real, no nuestro bucket) pero
// es una IMAGEN suelta (.jpg), no una página de video de terceros -- un
// <img src> la muestra perfecto adentro del modal sin depender de que esté
// en nuestro Storage. Por eso la extensión ahora alcanza sola para decidir
// "imagen" sin importar el host; solo el video sigue exigiendo que sea
// nuestro propio archivo (ahí sí hace falta ser dueños del bucket para
// confiar en que el link no es una página con reproductor, sino el archivo
// posta).
export const EXTENSIONES_VIDEO = ['mp4', 'webm', 'mov'];
export const EXTENSIONES_IMAGEN = ['png', 'jpg', 'jpeg', 'webp'];

export const extensionDe = (url) => {
    const limpio = (url || '').split('?')[0].split('#')[0];
    const m = limpio.match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : null;
};

// null = no hay preview posible acá (usar el link externo tal cual).
export const tipoDePreview = (mediaUrl) => {
    const ext = extensionDe(mediaUrl);
    if (EXTENSIONES_IMAGEN.includes(ext)) return 'imagen'; // cualquier host: es un archivo de imagen posta
    if (!pathEnBucket(mediaUrl)) return null; // video externo: solo confiamos si es nuestro propio archivo
    if (EXTENSIONES_VIDEO.includes(ext)) return 'video';
    return null;
};
