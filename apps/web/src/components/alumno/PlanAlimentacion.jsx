import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { Btn, Card, Empty, Field, Input, Loading, Modal, Select } from '@/components/ui-kit';
import { ESTILOS_IMPRESION_ALIMENTACION, PlanAlimentacionImprimiblePDF } from '@/components/PlanAlimentacionPDF';
import { descargarComoPdf } from '@/lib/descargarPdf';
import { useAuth } from '@/contexts/AuthContext';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { armarTextoAlimentos, fmtFecha, hoy } from '@/lib/format';

/* ---------------- Plan de alimentación ---------------- */

// Armar el contenido de un plan (comidas, alternativas, opcionales) vive
// únicamente en PlanesAlimentacionPage ("Planes de alimentación") -- acá,
// mismo criterio que PlanEntrenamiento con las rutinas, solo se elige un
// plan YA armado de esa biblioteca y se le pone fecha de inicio/fin. A
// diferencia de rutinas_asignadas, planes_alimentacion es 1-a-1 con el
// alumno (alumno_id NOT NULL, sin tabla de asignación aparte ni columna
// `activa`) -- por eso "cambiar" plan es directamente un update/create sobre
// esa única fila, y "quitar" es un removeRec, no una desactivación.
//
// Pedido explícito de Nalux (04/09/2026): si el alumno ya tiene un plan
// asignado y se elige otro, no reemplazar en silencio -- mostrar antes un
// cartel de conflicto ("ya tiene un plan asignado") para confirmar. Rutinas
// no tiene ese cartel (reemplaza directo), pero acá sí se pidió a propósito.
const PlanAlimentacion = ({ alumnoId, alumnoNombre, plan, onSaved }) => {
    const { gimnasio } = useAuth();
    const [cambiando, setCambiando] = useState(false);
    const [planesDisponibles, setPlanesDisponibles] = useState([]);
    const [cargandoPlanes, setCargandoPlanes] = useState(false);
    const [planElegido, setPlanElegido] = useState('');
    const [fechaInicioNueva, setFechaInicioNueva] = useState(hoy());
    const [fechaFinNueva, setFechaFinNueva] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    // Cartel de conflicto: solo aparece al confirmar, si ya había un plan.
    const [conflicto, setConflicto] = useState(false);
    // Fecha de fin del plan YA asignado, editable sin reasignar todo.
    const [fechaFinEdit, setFechaFinEdit] = useState(plan?.fecha_fin || '');
    const [guardandoFechaFin, setGuardandoFechaFin] = useState(false);
    // Igual que en PlanEntrenamiento: aviso mientras se arma el PDF.
    const [generandoPdf, setGenerandoPdf] = useState(false);
    const [errorPdf, setErrorPdf] = useState('');

    useEffect(() => {
        setFechaFinEdit(plan?.fecha_fin || '');
    }, [plan]);

    const abrirSelector = () => {
        setMsg('');
        setConflicto(false);
        setCambiando(true);
        setCargandoPlanes(true);
        setFechaInicioNueva(hoy());
        setFechaFinNueva('');
        listAll('planes_alimentacion_biblioteca', { sort: 'nombre' })
            .then((r) => {
                setPlanesDisponibles(r);
                setPlanElegido(r[0]?.id || '');
            })
            .catch(() => setMsg('No se pudieron cargar los planes de la biblioteca.'))
            .finally(() => setCargandoPlanes(false));
    };

    // Primer click en "Asignar": si ya hay un plan asignado, corta acá y
    // muestra el cartel de conflicto en vez de reemplazar directo.
    const intentarAsignar = () => {
        if (!planElegido) return;
        if (plan?.id && !conflicto) {
            setConflicto(true);
            return;
        }
        confirmarAsignacion();
    };

    // Copia (no referencia) el nombre/items/notas del plan de biblioteca
    // elegido -- igual que agregarOpcion() copiaba texto plano antes, así
    // después una edición en la biblioteca no cambia lo que ya se le asignó
    // a este alumno.
    const confirmarAsignacion = async () => {
        const elegido = planesDisponibles.find((p) => p.id === planElegido);
        if (!elegido) return;
        setSaving(true);
        setMsg('');
        try {
            const payload = {
                alumno_id: alumnoId,
                origen_id: elegido.id,
                nombre: elegido.nombre,
                items: JSON.parse(JSON.stringify(elegido.items || [])),
                notas: elegido.notas || null,
                fecha_inicio: fechaInicioNueva || hoy(),
                fecha_fin: fechaFinNueva || null,
            };
            if (plan?.id) await updateRec('planes_alimentacion', plan.id, payload);
            else await createRec('planes_alimentacion', payload);
            setCambiando(false);
            setConflicto(false);
            onSaved();
        } catch (_) {
            setMsg('No se pudo asignar el plan.');
        } finally {
            setSaving(false);
        }
    };

    const quitar = async () => {
        if (!plan?.id) return;
        setSaving(true);
        setMsg('');
        try {
            await removeRec('planes_alimentacion', plan.id);
            onSaved();
        } catch (_) {
            setMsg('No se pudo quitar el plan.');
        } finally {
            setSaving(false);
        }
    };

    const guardarFechaFin = async () => {
        if (!plan?.id) return;
        setGuardandoFechaFin(true);
        try {
            await updateRec('planes_alimentacion', plan.id, { fecha_fin: fechaFinEdit || null });
            onSaved();
        } catch (_) {
            setMsg('No se pudo guardar la fecha de fin.');
        } finally {
            setGuardandoFechaFin(false);
        }
    };

    const descargarPdf = async () => {
        setGenerandoPdf(true);
        setErrorPdf('');
        try {
            await descargarComoPdf(
                '.alimentacion-pdf-hoja',
                `Plan de alimentación - ${alumnoNombre || 'alumno'}`,
            );
        } catch (_) {
            setErrorPdf('No se pudo generar el PDF. Probar de nuevo.');
        } finally {
            setGenerandoPdf(false);
        }
    };

    // Mismo modal para "asignar por primera vez" y "cambiar" -- solo cambia
    // el título y si aparece el cartel de conflicto en vez del selector.
    const modalPlan = (
        <Modal
            open={cambiando}
            onClose={() => setCambiando(false)}
            title={plan ? 'Cambiar plan asignado' : 'Asignar plan de alimentación'}
        >
            <div className="space-y-4">
                {cargandoPlanes ? (
                    <Loading rows={2} />
                ) : planesDisponibles.length === 0 ? (
                    <Empty>
                        No hay planes en la biblioteca todavía. Armar uno desde{' '}
                        <Link to="/planes-alimentacion" className="font-semibold text-primary">
                            Planes de alimentación
                        </Link>
                        .
                    </Empty>
                ) : conflicto ? (
                    <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
                        <p className="text-sm font-semibold">
                            {alumnoNombre || 'Este alumno'} ya tiene un plan asignado: &ldquo;{plan?.nombre}&rdquo;.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            ¿Le dejamos el que tiene, o se lo reemplazamos por &ldquo;
                            {planesDisponibles.find((p) => p.id === planElegido)?.nombre}&rdquo;?
                        </p>
                        <div className="flex flex-wrap justify-end gap-2 pt-1">
                            <Btn variant="ghost" disabled={saving} onClick={() => setConflicto(false)}>
                                Dejarle el que tiene
                            </Btn>
                            <Btn disabled={saving} onClick={confirmarAsignacion}>
                                {saving ? 'Reemplazando...' : 'Reemplazar por este'}
                            </Btn>
                        </div>
                    </div>
                ) : (
                    <>
                        <Field label="Plan de la biblioteca">
                            <Select value={planElegido} onChange={(e) => setPlanElegido(e.target.value)}>
                                {planesDisponibles.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.nombre}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Fecha de inicio">
                                <Input
                                    type="date"
                                    value={fechaInicioNueva}
                                    onChange={(e) => setFechaInicioNueva(e.target.value)}
                                />
                            </Field>
                            <Field label="Fecha de fin (opcional)">
                                <Input
                                    type="date"
                                    value={fechaFinNueva}
                                    onChange={(e) => setFechaFinNueva(e.target.value)}
                                />
                            </Field>
                        </div>
                    </>
                )}
                {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
                {!conflicto && (
                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setCambiando(false)}>
                            Cancelar
                        </Btn>
                        <Btn
                            onClick={intentarAsignar}
                            disabled={saving || !planElegido || planesDisponibles.length === 0}
                        >
                            {saving ? 'Guardando...' : 'Asignar'}
                        </Btn>
                    </div>
                )}
            </div>
        </Modal>
    );

    if (!plan) {
        return (
            <div className="space-y-5">
                <Empty>
                    Este alumno todavía no tiene un plan de alimentación asignado.{' '}
                    <button type="button" onClick={abrirSelector} className="font-semibold text-primary">
                        Asignarle uno, con su fecha de inicio y de fin
                    </button>
                    , o armar uno nuevo desde{' '}
                    <Link to="/planes-alimentacion" className="font-semibold text-primary">
                        Planes de alimentación
                    </Link>
                    .
                </Empty>
                {modalPlan}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Plan asignado
                        </p>
                        <h3 className="mt-1 font-display text-xl font-bold">{plan.nombre}</h3>
                        {plan.fecha_inicio && (
                            <p className="mt-2 text-xs text-muted-foreground">
                                Desde el {fmtFecha(plan.fecha_inicio)}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Btn
                            variant="ghost"
                            className="px-3 py-2 text-xs"
                            onClick={descargarPdf}
                            disabled={generandoPdf}
                        >
                            <Printer className="h-3.5 w-3.5" />{' '}
                            {generandoPdf ? 'Generando...' : 'Descargar PDF'}
                        </Btn>
                        <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={abrirSelector}>
                            Cambiar plan
                        </Btn>
                        <Btn variant="danger" className="px-3 py-2 text-xs" onClick={quitar} disabled={saving}>
                            Quitar plan
                        </Btn>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
                    <Field label="Fecha de fin (opcional)" className="w-full max-w-[220px]">
                        <Input
                            type="date"
                            value={fechaFinEdit}
                            onChange={(e) => setFechaFinEdit(e.target.value)}
                        />
                    </Field>
                    <Btn
                        variant="ghost"
                        className="px-3 py-2.5 text-xs"
                        onClick={guardarFechaFin}
                        disabled={guardandoFechaFin || fechaFinEdit === (plan.fecha_fin || '')}
                    >
                        {guardandoFechaFin ? 'Guardando...' : 'Guardar fecha'}
                    </Btn>
                    <span className="text-xs text-muted-foreground">
                        Con fecha de fin, aparece en el panel general cuando se acerca o se pasa.
                    </span>
                </div>

                {msg && !cambiando && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
                {errorPdf && <p className="mt-3 text-sm font-semibold text-destructive">{errorPdf}</p>}
            </Card>

            {(plan.items || []).length === 0 ? (
                <Empty>Este plan todavía no tiene comidas cargadas.</Empty>
            ) : (
                <div className="space-y-4">
                    {(plan.items || []).map((c, i) => (
                        <Card key={c.key || i}>
                            <h3 className="mb-2 font-display text-lg font-bold uppercase text-primary">
                                {c.nombre || `Comida N.º ${i + 1}`}
                            </h3>
                            <p className="text-sm">{armarTextoAlimentos(c.alimentos)}</p>
                        </Card>
                    ))}
                </div>
            )}

            {plan.notas && (
                <Card>
                    <h3 className="mb-2 font-display text-lg font-bold">Observaciones generales</h3>
                    <ul className="space-y-1 text-sm">
                        {plan.notas
                            .split('\n')
                            .map((l) => l.trim())
                            .filter(Boolean)
                            .map((linea, i) => (
                                <li key={i}>• {linea}</li>
                            ))}
                    </ul>
                </Card>
            )}

            <style>{ESTILOS_IMPRESION_ALIMENTACION}</style>
            <PlanAlimentacionImprimiblePDF
                nombre={plan.nombre}
                items={plan.items}
                notas={plan.notas}
                color={gimnasio?.color_principal}
                logoUrl={gimnasio?.logo_url}
                alumnoNombre={alumnoNombre}
                fechaInicio={plan.fecha_inicio}
                fechaFin={plan.fecha_fin}
            />

            {modalPlan}
        </div>
    );
};

export default PlanAlimentacion;
