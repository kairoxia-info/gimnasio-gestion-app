import { agruparCombos, agruparItemsRutina, agruparPorBloque } from '@/lib/format';

// Diseño de PDF de rutina, con la marca del gimnasio (logo, nombre, color) y
// el rango de fechas del plan -- el mismo que ya se armó para MiPlanPage.jsx
// (Nalux trajo un ejemplo propio y pidió que se vea así: tablas compactas
// por bloque, "Series x Reps" combinado, encabezado de día con el color de
// marca). Se separó a un archivo compartido (03/09/2026) para poder
// reusarlo también desde RutinasPage.jsx (PDF de la plantilla, sin alumno
// ni fechas) y AlumnoPage.jsx (PDF de la asignación real, con fecha de
// inicio y de vencimiento de ESE alumno) -- antes solo existía acá, y
// RutinasPage.jsx tenía su propia versión vieja, sin ningún diseño.

// "11/08" en vez de "11/08/2026" — el año no aporta nada en un rango corto
// de semanas. Exportada (04/09/2026) para que components/PlanAlimentacionPDF.jsx
// arme el mismo formato de rango de fechas sin duplicar la función.
export const fmtFechaCorta = (v) => {
    if (!v) return '';
    const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
};

const sumarDias = (v, dias) => {
    const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
};

// Reportado por Nalux (03/09/2026): el logo del gimnasio no salía en el PDF
// de la biblioteca (RutinasPage.jsx). Causa: la hoja imprimible (con el
// <img> del logo) recién se monta en el DOM justo antes de window.print(),
// y requestAnimationFrame solo espera al próximo repintado -- NO a que la
// imagen termine de bajar de la red. El navegador imprime igual, sin
// esperar, y el logo sale en blanco. Acá se espera de verdad a que cargue
// (o falle) antes de imprimir, con un timeout de seguridad por si la URL
// del logo está rota y nunca dispara ni load ni error.
export function esperarImagenesCargadas(selector, timeoutMs = 3000) {
    const imgs = Array.from(document.querySelectorAll(selector)).filter((img) => !img.complete);
    if (imgs.length === 0) return Promise.resolve();
    return Promise.race([
        Promise.all(
            imgs.map(
                (img) =>
                    new Promise((resolve) => {
                        img.addEventListener('load', resolve, { once: true });
                        img.addEventListener('error', resolve, { once: true });
                    }),
            ),
        ),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
}

// "Series x Reps" combinado ("3x12+10" en una superserie). agruparCombos()
// ya no fusiona esto para la pantalla (queda por ejercicio) -- acá, solo
// para el PDF, sí se arma el texto combinado: series una vez si coinciden
// entre los ejercicios del combo, reps de cada uno unidas con "+".
const nombreItem = (it) => (it.esCombo ? it.comboItems.map((x) => x.nombre).join(' + ') : it.nombre);

const seriesXReps = (it) => {
    if (!it.esCombo) return `${it.series}x${it.reps}`;
    const series = it.comboItems.map((x) => String(x.series));
    const seriesTexto = series.every((s) => s === series[0]) ? series[0] : series.join('/');
    const repsTexto = it.comboItems.map((x) => x.reps).join('+');
    return `${seriesTexto}x${repsTexto}`;
};

// Sin fallback con ícono de pesa como en pantalla: en un PDF impreso, si no
// hay logo cargado simplemente no se muestra nada, no aporta mostrar un
// ícono genérico en papel.
export const EncabezadoPDF = ({ logoUrl, titulo, subtitulo }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10pt', marginBottom: '10pt' }}>
        {logoUrl && (
            <img
                src={logoUrl}
                alt=""
                style={{ height: '40pt', width: '40pt', objectFit: 'contain', borderRadius: '4pt' }}
            />
        )}
        <div>
            <h1 style={{ fontSize: '22pt', fontWeight: 800, margin: 0 }}>{titulo}</h1>
            {subtitulo && <p style={{ margin: '4pt 0 0', fontSize: '11pt', color: '#555' }}>{subtitulo}</p>}
        </div>
    </div>
);

// fechaInicio/fechaFin/duracionSemanas son todos opcionales -- el mismo
// componente sirve tanto para la plantilla sola (RutinasPage.jsx, sin
// ningún alumno todavía, sin fechas) como para la asignación real de un
// alumno puntual (AlumnoPage.jsx, con las dos fechas) o un PDF suelto para
// alguien puntual que el profesor tipea a mano (RutinasPage.jsx, ver el
// modal "Datos para el PDF"). Si hay fechaFin puesta a mano, se usa ésa (es
// el vencimiento real que cargó el profesor); si no, se calcula a partir de
// la duración, para no dejar el rango vacío cuando el plan no tiene fecha de
// fin explícita.
export const RutinaImprimiblePDF = ({
    nombre,
    items,
    color,
    logoUrl,
    alumnoNombre,
    fechaInicio,
    fechaFin,
    duracionSemanas,
}) => {
    const colorFinal = color || '#E10600';
    const grupos = agruparItemsRutina(items || []);
    const variasSemanas = grupos.length > 1;

    const rango = (() => {
        if (!fechaInicio) return null;
        const inicio = fmtFechaCorta(fechaInicio);
        const fin = fechaFin
            ? fmtFechaCorta(fechaFin)
            : duracionSemanas
              ? fmtFechaCorta(sumarDias(fechaInicio, duracionSemanas * 7))
              : null;
        return fin ? `${inicio} – ${fin}` : inicio;
    })();

    // "Alumno · rango" en una sola línea si hay las dos cosas; si solo hay
    // una, esa sola (sin el " · " colgando).
    const subtitulo = [alumnoNombre, rango].filter(Boolean).join(' · ') || null;

    return (
        <div className="rutina-pdf-hoja">
            <EncabezadoPDF logoUrl={logoUrl} titulo={nombre} subtitulo={subtitulo} />

            {grupos.map(([nroSemana, dias]) => (
                <div key={nroSemana}>
                    {variasSemanas && (
                        <h2 style={{ fontSize: '13pt', margin: '14pt 0 4pt' }}>Semana {nroSemana}</h2>
                    )}
                    {dias.map(([dia, itemsDia]) => (
                        <div key={`${nroSemana}-${dia}`} style={{ marginTop: '10pt', pageBreakInside: 'avoid' }}>
                            <div
                                style={{
                                    background: colorFinal,
                                    color: '#fff',
                                    padding: '5pt 8pt',
                                    fontSize: '12pt',
                                    fontWeight: 700,
                                }}
                            >
                                {dia}
                            </div>
                            {agruparPorBloque(agruparCombos(itemsDia)).map(([bloque, delBloque], i) => (
                                <div key={`${bloque}-${i}`} style={{ marginTop: '4pt' }}>
                                    {bloque && (
                                        <p
                                            style={{
                                                margin: '6pt 0 2pt',
                                                fontSize: '10.5pt',
                                                fontWeight: 700,
                                                color: colorFinal,
                                            }}
                                        >
                                            {bloque}
                                        </p>
                                    )}
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
                                        <thead>
                                            <tr style={{ background: '#111', color: '#fff' }}>
                                                <th style={{ textAlign: 'left', padding: '3pt 6pt' }}>Ejercicio</th>
                                                <th style={{ textAlign: 'right', padding: '3pt 6pt' }}>
                                                    Series x Reps
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {delBloque.map((it, iRow) => (
                                                <tr
                                                    key={it.key}
                                                    style={{ background: iRow % 2 === 1 ? '#f2f2f2' : 'transparent' }}
                                                >
                                                    <td style={{ padding: '3pt 6pt' }}>
                                                        {nombreItem(it)}
                                                        {it.comentario && (
                                                            <div style={{ fontSize: '8.5pt', color: '#666' }}>
                                                                {it.comentario}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '3pt 6pt', textAlign: 'right' }}>
                                                        {seriesXReps(it)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

// Mismo truco de visibility en vez de display:none en el body en las tres
// pantallas que imprimen esto: display:none rompería el layout del resto de
// la página mientras la hoja está montada pero no imprimiendo.
//
// print-color-adjust: exact (+ el prefijo -webkit) en TODA la hoja: reportado
// por Nalux (03/09/2026) que el PDF salía sin ningún color -- el nombre del
// día y el encabezado de la tabla, con su color de fondo puesto por inline
// style, salían en blanco. La causa: Chrome (y la mayoría de navegadores) por
// default NO imprime fondos de color salvo que el usuario tilde "Gráficos de
// fondo" en el diálogo de impresión -- algo que nadie tildaría sin saber que
// existe. print-color-adjust: exact fuerza a imprimir los fondos tal cual se
// ven en pantalla, sin depender de ese tilde.
export const ESTILOS_IMPRESION_RUTINA = `
.rutina-pdf-hoja { display: none; }
@media print {
  body * { visibility: hidden !important; }
  .rutina-pdf-hoja, .rutina-pdf-hoja * {
    visibility: visible !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .rutina-pdf-hoja {
    display: block !important;
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 0;
    color: #000;
    background: #fff;
  }
}
`;
