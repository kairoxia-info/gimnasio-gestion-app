import { Empty, Modal } from '@/components/ui-kit';
import {
    DIAS,
    agruparPorBloque,
    resumenSeries,
    resumenTipoGrupo,
    semanaDeItem,
    tieneSeriesDetalle,
} from '@/lib/format';

// diasUsados/agruparPorCombo están duplicados acá y en RutinasPage.jsx
// (16/09/2026, extracción del modal "Ver" a este archivo): RutinasPage.jsx
// también los necesita para su propio armador (abrirEditar y las
// superseries del modal "Nueva/Editar rutina"), que se quedó ahí por ser
// demasiado riesgoso de separar. Reexportarlos desde RutinasPage.jsx
// generaría un import circular (este archivo se importa DESDE
// RutinasPage.jsx), así que se copian tal cual en vez de compartirse.

// Días que ya usa una rutina, en el orden de DIAS. Si algún item tuviera un
// día fuera de la lista (no debería, siempre salen del selector), igual se
// respeta y va al final en vez de desaparecer.
const diasUsados = (items) => {
    const enItems = [...new Set((items || []).map((it) => it.dia).filter(Boolean))];
    const ordenados = [
        ...DIAS.filter((d) => enItems.includes(d)),
        ...enItems.filter((d) => !DIAS.includes(d)),
    ];
    return ordenados.length > 0 ? ordenados : [DIAS[0]];
};

// Agrupa una lista (ya filtrada a un mismo bloque) por comboId consecutivo,
// SIN fusionar los valores de cada ejercicio -- es solo para dibujar una
// caja visual alrededor de los que van juntos en el armador, que sigue
// editando cada ejercicio por separado (series/reps/peso propios). Distinto
// de agruparCombos() en format.js, que sí fusiona los valores para mostrar
// una sola tarjeta combinada en las pantallas de solo lectura.
const agruparPorCombo = (lista) => {
    const grupos = [];
    lista.forEach((it) => {
        const ultimo = grupos[grupos.length - 1];
        if (it.comboId && ultimo?.length && ultimo[0].comboId === it.comboId) ultimo.push(it);
        else grupos.push([it]);
    });
    return grupos;
};

// Vista de solo lectura de una rutina ya armada (botón "Ver" de cada
// tarjeta, pedido de Nalux el 07/09/2026). Respeta el mismo agrupamiento que
// el armador -- semana, día, bloque y superseries -- para que sea la misma
// rutina que el profesor tiene en la cabeza, nada más que sin campos
// editables.
const DetalleRutina = ({ rutina }) => {
    const items = rutina.items || [];
    if (items.length === 0) return <Empty>Esta rutina todavía no tiene ejercicios cargados.</Empty>;

    const semanas = [...new Set(items.map(semanaDeItem))].sort((a, b) => a - b);

    return (
        <div className="space-y-6">
            {rutina.descripcion && <p className="text-sm text-muted-foreground">{rutina.descripcion}</p>}

            {semanas.map((sem) => {
                const deLaSemana = items.filter((it) => semanaDeItem(it) === sem);
                return (
                    <div key={sem} className="space-y-4">
                        {semanas.length > 1 && (
                            <p className="font-display text-sm font-bold uppercase text-primary">
                                Semana {sem}
                            </p>
                        )}
                        {diasUsados(deLaSemana).map((d) => {
                            const delDia = deLaSemana.filter((it) => it.dia === d);
                            if (delDia.length === 0) return null;
                            return (
                                <div key={d} className="rounded-2xl border border-border p-4">
                                    <p className="font-display text-base font-bold">{d}</p>
                                    <div className="mt-3 space-y-3">
                                        {agruparPorBloque(delDia).map(([bloque, delBloque]) => (
                                            <div key={bloque || 'sin-bloque'}>
                                                {bloque && (
                                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                        {bloque}
                                                        {resumenTipoGrupo(delBloque) && (
                                                            <span className="ml-2 normal-case text-primary">
                                                                · {resumenTipoGrupo(delBloque)}
                                                            </span>
                                                        )}
                                                    </p>
                                                )}
                                                <div className="space-y-2">
                                                    {agruparPorCombo(delBloque).map((combo, i) => (
                                                        <div
                                                            key={combo[0].key || `${combo[0].nombre}-${i}`}
                                                            className={
                                                                combo.length > 1
                                                                    ? 'rounded-xl border border-primary/30 bg-primary/5 p-3'
                                                                    : ''
                                                            }
                                                        >
                                                            {combo.length > 1 && (
                                                                <p className="mb-2 text-xs font-bold uppercase text-primary">
                                                                    Superserie
                                                                </p>
                                                            )}
                                                            {combo.map((it, j) => (
                                                                <div
                                                                    key={it.key || `${it.nombre}-${j}`}
                                                                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1"
                                                                >
                                                                    <span className="min-w-0 text-sm font-semibold">
                                                                        {it.nombre}
                                                                        {it.grupo && (
                                                                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                                                {it.grupo}
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    <span className="text-xs text-muted-foreground">
                                                                        {resumenSeries(it)}
                                                                        {!tieneSeriesDetalle(it) && it.peso ? ` · ${it.peso}` : ''}
                                                                        {it.descanso ? ` · ${it.descanso}` : ''}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            {combo[0].intensidad && (
                                                                <p className="mt-1 text-xs text-muted-foreground">
                                                                    Intensidad: {combo[0].intensidad}
                                                                </p>
                                                            )}
                                                            {combo[0].comentario && (
                                                                <p className="mt-1 text-xs text-muted-foreground">
                                                                    {combo[0].comentario}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
};

// Modal "Ver" (solo lectura). Pedido de Nalux (07/09/2026): abrir una
// rutina ya armada para mirarla sin el riesgo de tocar algo sin querer, que
// es lo que pasaba usando "Editar" para eso. `rutina` es la rutinaViendo de
// RutinasPage.jsx (null = modal cerrado).
const VerRutinaModal = ({ rutina, onClose }) => (
    <Modal open={!!rutina} onClose={onClose} title={rutina?.nombre || 'Rutina'} wide>
        {rutina && <DetalleRutina rutina={rutina} />}
    </Modal>
);

export default VerRutinaModal;
