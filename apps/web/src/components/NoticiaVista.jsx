import React from 'react';

// Cómo se ve UNA noticia, en cualquier lado (portal del alumno, lista del
// profesor). Migración 0069: dos tipos.
//
//   * 'imagen': solo la foto, COMPLETA siempre -- object-contain y nada de
//     recortar para que encaje en un rectángulo fijo (pedido de Nalux,
//     21/09/2026: "que se vea la imagen completa siempre, sea cual sea su
//     tamaño o proporción"). El tope de alto es para que una foto vertical
//     no se coma toda la pantalla del celular; adentro de ese tope la imagen
//     se achica entera, no se corta.
//   * 'cartel': título + texto sobre un color de fondo de la paleta fija, con
//     imagen opcional arriba. Sin editor visual: es una plantilla con esos
//     campos, se renderiza siempre igual de prolija.
//
// La paleta vive acá y NO en la base (noticias.color_fondo guarda solo la
// clave): cambiar un tono es tocar este archivo, no una migración. Los seis
// son lo bastante oscuros para que el texto blanco lea bien encima.
export const PALETA_CARTEL = [
    { clave: 'azul', nombre: 'Azul', fondo: '#1D4ED8' },
    { clave: 'verde', nombre: 'Verde', fondo: '#047857' },
    { clave: 'violeta', nombre: 'Violeta', fondo: '#6D28D9' },
    { clave: 'naranja', nombre: 'Naranja', fondo: '#C2410C' },
    { clave: 'rojo', nombre: 'Rojo', fondo: '#B91C1C' },
    { clave: 'gris', nombre: 'Gris', fondo: '#1F2937' },
];

export const colorDeCartel = (clave) =>
    (PALETA_CARTEL.find((c) => c.clave === clave) || PALETA_CARTEL[0]).fondo;

// compacto: la lista del profesor muestra cada noticia chica, en una grilla
// de tres; ahí el título/texto van más chicos que en el portal del alumno.
const NoticiaVista = ({ noticia, compacto = false }) => {
    if (!noticia) return null;

    if (noticia.tipo === 'cartel') {
        return (
            // h-full: en el carrusel el alto lo fija la noticia más alta (ver
            // NoticiasCarrusel); el cartel se estira y llena ese alto con su
            // color en vez de quedar flotando chico en medio de un hueco.
            <div
                className={`flex h-full w-full flex-col justify-center gap-3 rounded-2xl text-white ${
                    compacto ? 'min-h-[180px] p-4' : 'min-h-[220px] p-6 sm:p-8'
                }`}
                style={{ background: colorDeCartel(noticia.color_fondo) }}
            >
                {noticia.imagen_url && (
                    <img
                        src={noticia.imagen_url}
                        alt=""
                        className={`mx-auto w-auto max-w-full rounded-xl object-contain ${
                            compacto ? 'max-h-24' : 'max-h-56 sm:max-h-72'
                        }`}
                    />
                )}
                {noticia.titulo && (
                    <p
                        className={`font-display break-words font-extrabold leading-tight ${
                            compacto ? 'text-lg' : 'text-2xl sm:text-3xl'
                        }`}
                    >
                        {noticia.titulo}
                    </p>
                )}
                {noticia.texto && (
                    <p className={`whitespace-pre-line break-words ${compacto ? 'text-sm' : 'text-base sm:text-lg'}`}>
                        {noticia.texto}
                    </p>
                )}
            </div>
        );
    }

    if (!noticia.imagen_url) return null;
    // self-center: dentro del carrusel (items-stretch) la imagen no se estira,
    // se centra. El tope de alto es más bajo en escritorio: a lo ancho de una
    // computadora una foto cuadrada o vertical a 70vh se hace enorme.
    return (
        <img
            src={noticia.imagen_url}
            alt="Noticia del gimnasio"
            className={`mx-auto w-auto max-w-full self-center rounded-2xl object-contain ${
                compacto ? 'max-h-48' : 'max-h-[60vh] sm:max-h-[440px]'
            }`}
        />
    );
};

export default NoticiaVista;
