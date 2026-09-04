import { EncabezadoPDF, fmtFechaCorta } from './RutinaPDF';
import { armarTextoAlimentos } from '@/lib/format';

// Diseño de PDF de plan de alimentación, con la marca del gimnasio (logo,
// nombre, color) -- mismo tratamiento que ya tiene la rutina en
// components/RutinaPDF.jsx (pedido de Nalux, 04/09/2026: "lo mismo que
// hicimos con rutinas pero aplicarlo a alimentación"). Se usa desde
// PlanesAlimentacionPage.jsx (PDF de la biblioteca, con el modal "alumno
// registrado / nombre libre", igual que RutinasPage.jsx), AlumnoPage.jsx
// (PDF del plan YA asignado a ese alumno) y MiPlanPage.jsx (el alumno mismo,
// sin login).
//
// items = comidas [{ key, nombre, alimentos: [{nombre, cantidad, grupo,
// opcional}] }] -- mismo shape que planes_alimentacion_biblioteca.items
// (migración 0025). armarTextoAlimentos (lib/format.js) arma una sola línea
// de texto prolijo por comida, agrupando alternativas ("elegí uno: X o Y")
// y marcando lo opcional -- no hace falta repetir esa lógica de armado acá.
export const PlanAlimentacionImprimiblePDF = ({
    nombre,
    items,
    notas,
    color,
    logoUrl,
    alumnoNombre,
    fechaInicio,
    fechaFin,
}) => {
    const colorFinal = color || '#E10600';
    const comidas = items || [];
    const observaciones = (notas || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

    // Mismo criterio que RutinaImprimiblePDF: si hay fechaFin puesta a mano
    // se usa ésa; si no, sin inventar una -- a diferencia de una rutina, acá
    // no hay "duración en semanas" de la que calcular un vencimiento
    // implícito, un plan de comidas no tiene ese concepto.
    const rango = (() => {
        if (!fechaInicio) return null;
        const inicio = fmtFechaCorta(fechaInicio);
        const fin = fechaFin ? fmtFechaCorta(fechaFin) : null;
        return fin ? `${inicio} – ${fin}` : inicio;
    })();

    // "Alumno · rango" en una sola línea si hay las dos cosas; si solo hay
    // una, esa sola (sin el " · " colgando).
    const subtitulo = [alumnoNombre, rango].filter(Boolean).join(' · ') || null;

    return (
        <div className="alimentacion-pdf-hoja">
            <EncabezadoPDF logoUrl={logoUrl} titulo={nombre} subtitulo={subtitulo} />

            {comidas.map((comida, i) => (
                <div key={comida.key || i} style={{ marginTop: '12pt', pageBreakInside: 'avoid' }}>
                    <div
                        style={{
                            background: colorFinal,
                            color: '#fff',
                            padding: '5pt 8pt',
                            fontSize: '11pt',
                            fontWeight: 700,
                        }}
                    >
                        {comida.nombre || `Comida N.º ${i + 1}`}
                    </div>
                    <p style={{ margin: '4pt 0 0', fontSize: '10pt' }}>{armarTextoAlimentos(comida.alimentos)}</p>
                </div>
            ))}

            {observaciones.length > 0 && (
                <div style={{ marginTop: '16pt', pageBreakInside: 'avoid' }}>
                    <p
                        style={{
                            margin: '0 0 4pt',
                            fontSize: '12pt',
                            fontWeight: 700,
                            color: colorFinal,
                        }}
                    >
                        Observaciones generales
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '14pt', fontSize: '10pt' }}>
                        {observaciones.map((linea, i) => (
                            <li key={i} style={{ margin: '2pt 0' }}>
                                {linea}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

// Mismo truco de visibility + print-color-adjust: exact que
// ESTILOS_IMPRESION_RUTINA (RutinaPDF.jsx) -- ver los comentarios ahí para
// el porqué de cada regla. Duplicado a propósito (no importado desde
// RutinaPDF.jsx) porque cada hoja usa su propia clase (.alimentacion-pdf-hoja
// vs .rutina-pdf-hoja): si compartieran una sola clase, imprimir una
// dejaría la otra oculta también cuando conviven montadas en la misma
// pantalla (como en AlumnoPage.jsx, que tiene ambas pestañas).
export const ESTILOS_IMPRESION_ALIMENTACION = `
.alimentacion-pdf-hoja { display: none; }
@media print {
  body * { visibility: hidden !important; }
  .alimentacion-pdf-hoja, .alimentacion-pdf-hoja * {
    visibility: visible !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .alimentacion-pdf-hoja {
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
