import { esperarImagenesCargadas } from '@/components/RutinaPDF';

// Descarga directa del PDF, sin pasar por el diálogo de impresión del
// navegador. Pedido de Nalux (07/09/2026): "yo solo quisiera que se baje en
// pdf más práctico" -- antes había que tocar Imprimir y ahí elegir "Guardar
// como PDF", un paso extra que en el celular no es nada obvio.
//
// jspdf y html2canvas se cargan con import() dinámico A PROPÓSITO: entre las
// dos pesan más de medio mega, y son para una acción puntual que la mayoría
// de las pantallas nunca usa. Así Vite las deja en un archivo aparte que
// recién se baja cuando alguien toca "Descargar en PDF" -- la app abre igual
// de rápido que antes para todos los demás.
//
// Se fotografía la MISMA hoja que ya se usaba para imprimir (components/
// RutinaPDF.jsx y PlanAlimentacionPDF.jsx), así el PDF sale exactamente con
// el diseño que Nalux ya aprobó (logo, colores, tablas), sin rehacerlo.

// Ancho de una hoja A4 en píxeles de pantalla (210 mm a 96 dpi). La hoja se
// mide con este ancho antes de la foto para que lo que entra a lo ancho en
// el PDF sea lo mismo sin importar el tamaño del celular o del monitor.
const ANCHO_A4_PX = 794;
const ANCHO_A4_MM = 210;
const ALTO_A4_MM = 297;

// Windows y Android no aceptan estos caracteres en un nombre de archivo.
const limpiarNombre = (texto) =>
    (texto || 'documento')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'documento';

// La hoja la monta React recién cuando se pide el PDF, así que puede no
// estar todavía en el DOM en el momento del clic. Se espera a que aparezca
// en vez de usar requestAnimationFrame: rAF NO corre si la pestaña está en
// segundo plano, y ahí el botón se quedaba en "Generando..." para siempre.
const esperarNodo = async (selector, intentos = 60) => {
    for (let i = 0; i < intentos; i += 1) {
        const nodo = document.querySelector(selector);
        if (nodo) return nodo;
        await new Promise((r) => setTimeout(r, 50));
    }
    return null;
};

// Alto de una página A4 en los mismos píxeles CSS en que se mide la hoja
// antes de fotografiarla (ANCHO_A4_PX corresponde a los 210mm de ancho).
const ALTO_PAGINA_PX = ANCHO_A4_PX * (ALTO_A4_MM / ANCHO_A4_MM);

// Reportado por Nalux (15/09/2026): "se cortan los renglones en el pdf".
// Causa real: el PDF no es una impresión de verdad -- es una FOTO
// (html2canvas) de toda la hoja como una sola imagen larga, que después
// lib/descargarPdf.js reparte en páginas cortando cada 297mm sin ninguna
// idea de dónde termina cada fila. `page-break-inside: avoid` (que sí tiene
// puesto la fila de la tabla, por ejemplo) es una propiedad de IMPRESIÓN de
// verdad -- html2canvas no la lee, así que no hacía nada acá.
//
// Esto imita el mismo efecto a mano: antes de sacar la foto, mide cada
// elemento marcado con data-pdf-fila (una fila de tabla, una comida del
// plan de alimentación, una observación) y, si el próximo corte de página
// caería en el medio de una, inserta un separador invisible arriba que la
// empuja entera a la página siguiente -- exactamente lo que el navegador
// haría con page-break-inside: avoid en una impresión real. Los separadores
// se sacan del DOM apenas termina de sacarse la foto (ver el finally en
// descargarComoPdf): son un truco de último momento, no algo que tenga que
// sobrevivir en la app.
function insertarSaltosDePagina(nodo, altoPaginaPx) {
    const insertados = [];
    const nodoTop = nodo.getBoundingClientRect().top;
    let corte = altoPaginaPx;
    const filas = Array.from(nodo.querySelectorAll('[data-pdf-fila]'));
    for (const el of filas) {
        const r = el.getBoundingClientRect();
        const top = r.top - nodoTop;
        const bottom = r.bottom - nodoTop;
        // Si ya quedó más allá del corte actual (por un separador anterior,
        // o porque el contenido de arriba ya alcanzaba para eso), avanzar
        // el corte hasta el próximo múltiplo que la deje del lado de
        // "antes" -- así no se inserta un salto de más donde no hace falta.
        while (top >= corte) corte += altoPaginaPx;
        if (bottom > corte) {
            const espacio = document.createElement('div');
            espacio.setAttribute('data-pdf-espaciador', 'true');
            espacio.style.height = `${corte - top}px`;
            el.parentNode.insertBefore(espacio, el);
            insertados.push(espacio);
            corte += altoPaginaPx;
        }
    }
    return insertados;
}

// Logo chico de RutNail para la esquina de cada página (pedido de Nalux,
// 15/09/2026: "en una esquina de cada hoja, sin que las letras lo pisen,
// el logo de rutnail"). Se dibuja con la API de jsPDF directamente sobre
// cada página del PDF -- NO adentro de la hoja fotografiada: esa es una
// sola imagen larga que después se reparte en N páginas recién al armar el
// PDF, así que un logo puesto ahí solo aparecería una vez, no en cada hoja.
// Dibujado en el margen que ahora tienen las hojas (ver ESTILOS_IMPRESION_*
// en RutinaPDF.jsx/PlanAlimentacionPDF.jsx) -- por eso no pisa ninguna
// letra, cae siempre en el espacio en blanco del borde.
//
// Se cachea en el módulo (no por PDF) porque el archivo no cambia entre una
// descarga y la siguiente -- evita pedirlo de nuevo cada vez.
let logoMarcaAgua = null;
async function obtenerLogoMarcaAgua() {
    if (logoMarcaAgua !== undefined && logoMarcaAgua !== null) return logoMarcaAgua;
    try {
        const res = await fetch('/logo-rutnail.png');
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
            const lector = new FileReader();
            lector.onload = () => resolve(lector.result);
            lector.onerror = reject;
            lector.readAsDataURL(blob);
        });
        // Proporción real del archivo recortado (1117x870, ver el commit del
        // 14/09/2026 que le sacó el margen transparente de sobra) -- para no
        // depender de leer las dimensiones de la imagen en el momento.
        logoMarcaAgua = { dataUrl, anchoAlto: 1117 / 870 };
    } catch (_) {
        // Sin logo no se dibuja marca de agua -- nunca por eso falla la
        // descarga del PDF en sí, que es lo que de verdad importa.
        logoMarcaAgua = null;
    }
    return logoMarcaAgua;
}

// Tamaño y posición del logo en cada página: chico (16mm de ancho), esquina
// inferior derecha, con aire hasta el borde de la hoja.
const MARCA_AGUA_ANCHO_MM = 16;
const MARCA_AGUA_MARGEN_MM = 6;

function dibujarMarcaAgua(pdf, logo) {
    if (!logo) return;
    const alto = MARCA_AGUA_ANCHO_MM / logo.anchoAlto;
    const x = ANCHO_A4_MM - MARCA_AGUA_ANCHO_MM - MARCA_AGUA_MARGEN_MM;
    const y = ALTO_A4_MM - alto - MARCA_AGUA_MARGEN_MM;
    // GState (opacidad) es soporte opcional según la versión de jsPDF --
    // si no está disponible, se dibuja el logo igual, a opacidad completa:
    // sigue sin pisar texto (vive en el margen), solo se nota un poco más.
    let restaurar = null;
    try {
        const estado = pdf.GState && new pdf.GState({ opacity: 0.55 });
        if (estado) {
            pdf.setGState(estado);
            restaurar = () => pdf.setGState(new pdf.GState({ opacity: 1 }));
        }
    } catch (_) {
        restaurar = null;
    }
    pdf.addImage(logo.dataUrl, 'PNG', x, y, MARCA_AGUA_ANCHO_MM, alto);
    if (restaurar) restaurar();
}

export async function descargarComoPdf(selector, nombreArchivo) {
    const nodo = await esperarNodo(selector);
    if (!nodo) throw new Error('No se encontró la hoja para generar el PDF.');

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
    ]);

    // La hoja vive oculta (display:none, solo se mostraba dentro de @media
    // print). Para poder fotografiarla hay que mostrarla de verdad, así que
    // se la manda fuera de la pantalla: el usuario no ve nada raro aparecer.
    const estiloPrevio = nodo.getAttribute('style');
    Object.assign(nodo.style, {
        display: 'block',
        position: 'fixed',
        left: '-10000px',
        top: '0',
        width: `${ANCHO_A4_PX}px`,
        background: '#ffffff',
        color: '#000000',
    });

    let espaciadores = [];
    try {
        // Mismo cuidado que ya se tenía al imprimir: si el logo del gimnasio
        // todavía no terminó de bajar, sale en blanco en la foto.
        await esperarImagenesCargadas(`${selector} img`);

        // Recién con las imágenes ya cargadas (pueden cambiar la altura de
        // la hoja) tiene sentido medir dónde caería cada corte de página.
        espaciadores = insertarSaltosDePagina(nodo, ALTO_PAGINA_PX);

        const [canvas, logo] = await Promise.all([
            html2canvas(nodo, {
                scale: 2, // el doble de resolución, para que el texto no salga borroso
                backgroundColor: '#ffffff',
                useCORS: true, // el logo se sirve desde Storage, otro dominio
                logging: false,
                windowWidth: ANCHO_A4_PX,
            }),
            obtenerLogoMarcaAgua(),
        ]);

        const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const imagen = canvas.toDataURL('image/jpeg', 0.95);
        const altoTotalMm = (canvas.height * ANCHO_A4_MM) / canvas.width;

        // Si la hoja es más alta que una A4 se reparte en varias páginas: la
        // misma imagen se pega corrida hacia arriba en cada página, y cada
        // una termina mostrando su pedazo. Con los separadores ya insertados
        // arriba, cada corte de ALTO_A4_MM cae justo antes de una fila
        // protegida (data-pdf-fila), nunca en el medio.
        pdf.addImage(imagen, 'JPEG', 0, 0, ANCHO_A4_MM, altoTotalMm);
        dibujarMarcaAgua(pdf, logo);
        let sobrante = altoTotalMm - ALTO_A4_MM;
        let desplazamiento = 0;
        while (sobrante > 1) {
            desplazamiento -= ALTO_A4_MM;
            pdf.addPage();
            pdf.addImage(imagen, 'JPEG', 0, desplazamiento, ANCHO_A4_MM, altoTotalMm);
            dibujarMarcaAgua(pdf, logo);
            sobrante -= ALTO_A4_MM;
        }

        pdf.save(`${limpiarNombre(nombreArchivo)}.pdf`);
    } finally {
        // Los separadores son un truco de último momento para la foto -- se
        // sacan del DOM apenas se usan, no tienen que sobrevivir en la app
        // (y si quedaran, la próxima descarga los volvería a contar de más).
        espaciadores.forEach((el) => el.remove());
        // Se deja la hoja como estaba, oculta, pase lo que pase.
        if (estiloPrevio === null) nodo.removeAttribute('style');
        else nodo.setAttribute('style', estiloPrevio);
    }
}
