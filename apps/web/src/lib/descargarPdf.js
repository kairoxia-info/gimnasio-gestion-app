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

    try {
        // Mismo cuidado que ya se tenía al imprimir: si el logo del gimnasio
        // todavía no terminó de bajar, sale en blanco en la foto.
        await esperarImagenesCargadas(`${selector} img`);

        const canvas = await html2canvas(nodo, {
            scale: 2, // el doble de resolución, para que el texto no salga borroso
            backgroundColor: '#ffffff',
            useCORS: true, // el logo se sirve desde Storage, otro dominio
            logging: false,
            windowWidth: ANCHO_A4_PX,
        });

        const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const imagen = canvas.toDataURL('image/jpeg', 0.95);
        const altoTotalMm = (canvas.height * ANCHO_A4_MM) / canvas.width;

        // Si la hoja es más alta que una A4 se reparte en varias páginas: la
        // misma imagen se pega corrida hacia arriba en cada página, y cada
        // una termina mostrando su pedazo.
        pdf.addImage(imagen, 'JPEG', 0, 0, ANCHO_A4_MM, altoTotalMm);
        let sobrante = altoTotalMm - ALTO_A4_MM;
        let desplazamiento = 0;
        while (sobrante > 1) {
            desplazamiento -= ALTO_A4_MM;
            pdf.addPage();
            pdf.addImage(imagen, 'JPEG', 0, desplazamiento, ANCHO_A4_MM, altoTotalMm);
            sobrante -= ALTO_A4_MM;
        }

        pdf.save(`${limpiarNombre(nombreArchivo)}.pdf`);
    } finally {
        // Se deja la hoja como estaba, oculta, pase lo que pase.
        if (estiloPrevio === null) nodo.removeAttribute('style');
        else nodo.setAttribute('style', estiloPrevio);
    }
}
