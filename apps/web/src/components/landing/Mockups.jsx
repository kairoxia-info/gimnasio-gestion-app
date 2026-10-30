import React from 'react';

// Marcos para las capturas de la app y las ilustraciones del "problema de hoy". Las capturas están en
// public/capturas y se sacaron con datos genéricos (Alumno Juan, 123456789...): nunca nombres, teléfonos
// ni correos reales de ningún alumno.

// Marco de celular con una captura adentro.
export const CapturaCelular = ({ src, alt, className = '' }) => (
    <div
        className={`relative mx-auto aspect-[9/18] w-full max-w-[220px] overflow-hidden rounded-[2rem] border-[6px] border-foreground/80 bg-background shadow-2xl ${className}`}
    >
        <span className="absolute left-1/2 top-1.5 z-10 h-1 w-10 -translate-x-1/2 rounded-full bg-foreground/40" />
        <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover object-top" />
    </div>
);

// Marco de ventana (navegador) con una captura del panel adentro.
export const CapturaPanel = ({ src, alt, className = '' }) => (
    <div className={`mx-auto w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl ${className}`}>
        <div className="flex items-center gap-1.5 border-b border-border bg-secondary px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
        </div>
        <img src={src} alt={alt} loading="lazy" className="block w-full" />
    </div>
);

// ---------------------------------------------------------------------------------------------------
// El "problema de hoy": el cuaderno y la planilla con los que muchos gimnasios llevan todo. Colores
// fijos a propósito (papel y hoja de cálculo no cambian con el tema claro/oscuro).
// ---------------------------------------------------------------------------------------------------

const tinta = { fontFamily: "'Caveat', 'Comic Sans MS', cursive" };

export const CuadernoRayado = ({ className = '' }) => (
    <div
        aria-hidden="true"
        className={`relative mx-auto w-full max-w-sm -rotate-2 overflow-hidden rounded-md shadow-2xl ${className}`}
        style={{
            background:
                'repeating-linear-gradient(to bottom, #f6f1e1 0, #f6f1e1 27px, #9db8d6 27px, #9db8d6 28px)',
            color: '#1d3a8a',
            ...tinta,
        }}
    >
        {/* Margen rojo y agujeros */}
        <span className="absolute inset-y-0 left-10 w-px bg-[#d9534f]/70" />
        <span className="absolute left-2 top-6 h-3 w-3 rounded-full bg-[#2b2b2b]/70" />
        <span className="absolute left-2 top-1/2 h-3 w-3 rounded-full bg-[#2b2b2b]/70" />
        <span className="absolute bottom-6 left-2 h-3 w-3 rounded-full bg-[#2b2b2b]/70" />
        {/* Mancha de café */}
        <span className="absolute -right-6 bottom-10 h-24 w-24 rounded-full border-[6px] border-[#8b5a2b]/25" />

        <div className="relative space-y-0 py-3 pl-14 pr-4 text-[19px] leading-[28px]">
            <p className="text-[22px] font-bold underline decoration-wavy">CUOTAS OCTUBRE (!!)</p>
            <p>Lucía — pagó? <span className="text-[#d9534f]">✗</span> ✓ <span className="line-through">✗</span></p>
            <p className="line-through opacity-70">Tomás — 15.000</p>
            <p>Tomás debe $15.000 <span className="text-[#d9534f]">(???)</span></p>
            <p>Camila vence el 3 → 10 → <span className="text-[#d9534f]">17</span></p>
            <p className="line-through opacity-70">Agus — mensual</p>
            <p>Agus trimestral?? <span className="text-[#d9534f]">preguntar</span></p>
            <p>rutina de Mati: ver foto del cel</p>
            <p className="text-[#d9534f]">NO SE QUIÉN PAGÓ EL LUNES</p>
            <p>Vale — transf. sin comprobante</p>
            <p className="line-through opacity-70">Fran — falta?</p>
        </div>
    </div>
);

const COLUMNAS = ['A', 'B', 'C', 'D', 'E'];
const FILAS = [
    ['Alumno', 'Plan', 'Vence', 'Pagó', 'Obs.'],
    ['Lucía M.', 'Mensual', '03/10', 'SI', ''],
    ['Tomás R.', 'Trim.', '#¡REF!', 'no?', 'llamar'],
    ['Camila S.', 'Mensual', '17/10', 'SI', ''],
    ['Agustín P.', 'Mens', '', '#N/A', 'ver cuaderno'],
    ['Valentina G.', 'Semestral', '12/03', 'SI', '¿rutina?'],
    ['Mateo R.', 'Mensual', 'vencido', 'NO', 'NO TOCAR!!'],
];

export const PlanillaExcel = ({ className = '' }) => (
    <div
        aria-hidden="true"
        className={`relative mx-auto w-full max-w-md rotate-1 overflow-hidden rounded-md border border-[#c9ccd1] bg-white text-[11px] shadow-2xl ${className}`}
        style={{ color: '#1f2328', fontFamily: 'Calibri, Arial, sans-serif' }}
    >
        <div className="flex items-center gap-2 bg-[#217346] px-3 py-1.5 text-[11px] font-semibold text-white">
            <span className="h-2.5 w-2.5 rounded-sm bg-white/90" />
            FINAL_cuotas_v3_AHORA_SI(2).xlsx
        </div>
        <div className="flex items-center gap-2 border-b border-[#d0d3d8] bg-[#f3f4f6] px-2 py-1 text-[10px] text-[#555]">
            <span className="rounded border border-[#c9ccd1] bg-white px-1.5 py-0.5">C3</span>
            <span className="italic">=SI(D3="SI";"";BUSCARV(A3;Hoja2!A:C;3;0))</span>
        </div>
        <table className="w-full table-fixed border-collapse">
            <thead>
                <tr className="bg-[#f3f4f6] text-[#555]">
                    <th className="w-6 border border-[#d0d3d8]" />
                    {COLUMNAS.map((c) => (
                        <th key={c} className="border border-[#d0d3d8] py-0.5 font-medium">{c}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {FILAS.map((fila, i) => (
                    <tr key={i}>
                        <td className="border border-[#d0d3d8] bg-[#f3f4f6] text-center text-[#555]">{i + 1}</td>
                        {fila.map((celda, j) => {
                            const error = celda.startsWith('#');
                            const rojo = celda === 'NO' || celda === 'vencido' || celda === 'no?';
                            const amarillo = i === 4 || celda === 'NO TOCAR!!';
                            return (
                                <td
                                    key={j}
                                    className={`truncate border border-[#d0d3d8] px-1.5 py-1 ${
                                        i === 0 ? 'bg-[#e8eaed] font-bold' : ''
                                    } ${rojo ? 'bg-[#f8c9c9] font-semibold text-[#9c1c1c]' : ''} ${
                                        error ? 'bg-[#fde2e2] text-[#c62828]' : ''
                                    } ${amarillo && !rojo && !error && i !== 0 ? 'bg-[#fff3b0]' : ''}`}
                                >
                                    {celda}
                                </td>
                            );
                        })}
                    </tr>
                ))}
                {[8, 9].map((n) => (
                    <tr key={n}>
                        <td className="border border-[#d0d3d8] bg-[#f3f4f6] text-center text-[#555]">{n}</td>
                        {COLUMNAS.map((c) => (
                            <td key={c} className="h-5 border border-[#d0d3d8]" />
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
        <div className="flex gap-1 border-t border-[#d0d3d8] bg-[#f3f4f6] px-2 py-1 text-[10px] text-[#555]">
            <span className="rounded-t border border-b-0 border-[#c9ccd1] bg-white px-2">Hoja1</span>
            <span className="px-2">Hoja2</span>
            <span className="px-2">Hoja1 (copia)</span>
            <span className="px-2">VIEJO</span>
        </div>
    </div>
);
