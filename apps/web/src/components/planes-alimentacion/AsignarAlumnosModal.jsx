import { Trash2 } from 'lucide-react';
import { Btn, ConfirmInlineActions, Empty, Field, Input, Modal } from '@/components/ui-kit';
import { fmtFecha } from '@/lib/format';

// Modal "Asignar a alumnos" (asignación masiva), calcado del de
// RutinasPage.jsx -- pedido de Nalux (04/09/2026): además de descargar,
// poder asignarle la nutrición a varios alumnos desde este mismo módulo.
const AsignarAlumnosModal = ({
    asignarOpen,
    onClose,
    planAsignando,
    alumnosActivos,
    planesAlumnos,
    esEstePlan,
    seleccionados,
    toggleAlumno,
    confirmandoQuitarId,
    setConfirmandoQuitarId,
    quitandoId,
    quitarAsignacion,
    fechaInicioAsig,
    setFechaInicioAsig,
    fechaFinAsig,
    setFechaFinAsig,
    conflictoAlumnos,
    omitirConflictos,
    reemplazarConflictos,
    asignarMsg,
    asignando,
    iniciarAsignacion,
}) => (
    <Modal
        open={asignarOpen}
        onClose={onClose}
        title={planAsignando ? `Asignar "${planAsignando.nombre}" a alumnos` : 'Asignar a alumnos'}
    >
        <div className="space-y-4">
            {alumnosActivos.length === 0 ? (
                <Empty>No hay alumnos activos para asignar.</Empty>
            ) : (
                <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
                    <ul className="divide-y divide-border">
                        {alumnosActivos.map((a) => {
                            const asignado = planesAlumnos.find(
                                (x) => x.alumno_id === a.id && esEstePlan(x, planAsignando),
                            );
                            // Otro plan asignado -- no bloquea el tilde, solo avisa: el
                            // cartel de "reemplazar o dejar" recién sale al confirmar.
                            const otro = !asignado
                                ? planesAlumnos.find((x) => x.alumno_id === a.id)
                                : null;
                            return (
                                <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                                    <input
                                        type="checkbox"
                                        id={`asignar-plan-alumno-${a.id}`}
                                        checked={seleccionados.has(a.id)}
                                        disabled={!!asignado}
                                        onChange={() => toggleAlumno(a.id)}
                                        className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))] disabled:opacity-40"
                                    />
                                    <label
                                        htmlFor={`asignar-plan-alumno-${a.id}`}
                                        className={`flex-1 text-sm ${asignado ? 'text-muted-foreground' : 'cursor-pointer'}`}
                                    >
                                        {a.nombre}
                                        {asignado && (
                                            <span className="ml-2 text-xs">
                                                (ya lo tiene
                                                {asignado.fecha_inicio
                                                    ? `, desde el ${fmtFecha(asignado.fecha_inicio)}`
                                                    : ''}
                                                {asignado.fecha_fin ? ` hasta el ${fmtFecha(asignado.fecha_fin)}` : ''})
                                            </span>
                                        )}
                                        {otro && (
                                            <span className="ml-2 text-xs text-warn">
                                                (ya tiene: {otro.nombre})
                                            </span>
                                        )}
                                    </label>
                                    {asignado && confirmandoQuitarId === asignado.id ? (
                                        <div className="flex shrink-0 items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">¿Seguro?</span>
                                            <ConfirmInlineActions
                                                className="px-2 py-1.5 text-xs"
                                                confirmLabel="Sí, quitar"
                                                ejecutandoLabel="Quitando..."
                                                ejecutando={quitandoId === asignado.id}
                                                onConfirmar={() => quitarAsignacion(asignado.id)}
                                                onCancelar={() => setConfirmandoQuitarId(null)}
                                            />
                                        </div>
                                    ) : (
                                        asignado && (
                                            <Btn
                                                type="button"
                                                variant="ghost"
                                                className="shrink-0 px-2 py-1.5 text-xs text-primary"
                                                onClick={() => setConfirmandoQuitarId(asignado.id)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Quitar
                                            </Btn>
                                        )
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {seleccionados.size > 0 && !conflictoAlumnos && (
                <div className="space-y-3 border-t border-border pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Para {seleccionados.size} alumno{seleccionados.size === 1 ? '' : 's'} elegido
                        {seleccionados.size === 1 ? '' : 's'}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Fecha de inicio">
                            <Input
                                type="date"
                                value={fechaInicioAsig}
                                onChange={(e) => setFechaInicioAsig(e.target.value)}
                            />
                        </Field>
                        <Field label="Fecha de fin (opcional)">
                            <Input
                                type="date"
                                value={fechaFinAsig}
                                onChange={(e) => setFechaFinAsig(e.target.value)}
                            />
                        </Field>
                    </div>
                    <span className="block text-xs text-muted-foreground">
                        Con fecha de fin, van a aparecer en el panel general cuando se les esté por
                        vencer o se les venza el plan. Sin fecha de fin, no hay aviso.
                    </span>
                </div>
            )}

            {conflictoAlumnos && (
                <div className="space-y-3 rounded-xl border border-warn bg-warn/10 p-4">
                    <p className="text-sm font-semibold">
                        {conflictoAlumnos.length === 1
                            ? `${conflictoAlumnos[0].nombreAlumno} ya tiene un plan asignado: "${conflictoAlumnos[0].nombrePlan}".`
                            : `${conflictoAlumnos.length} alumnos ya tienen otro plan asignado:`}
                    </p>
                    {conflictoAlumnos.length > 1 && (
                        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                            {conflictoAlumnos.map((c) => (
                                <li key={c.alumnoId}>
                                    {c.nombreAlumno} — <span className="italic">{c.nombrePlan}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-xs text-muted-foreground">
                        ¿Les dejamos el plan que ya tienen, o se lo reemplazamos por &ldquo;
                        {planAsignando?.nombre}&rdquo;?
                    </p>
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                        <Btn variant="ghost" disabled={asignando} onClick={omitirConflictos}>
                            Dejarles el que tienen
                        </Btn>
                        <Btn disabled={asignando} onClick={reemplazarConflictos}>
                            {asignando ? 'Reemplazando...' : 'Reemplazar por este'}
                        </Btn>
                    </div>
                </div>
            )}

            {asignarMsg && <p className="text-sm text-muted-foreground">{asignarMsg}</p>}

            <div className="flex justify-end gap-2 pt-2">
                <Btn variant="ghost" onClick={onClose}>
                    Cerrar
                </Btn>
                {!conflictoAlumnos && (
                    <Btn onClick={iniciarAsignacion} disabled={asignando || seleccionados.size === 0}>
                        {asignando
                            ? 'Asignando...'
                            : `Asignar${seleccionados.size > 0 ? ` a ${seleccionados.size} alumno${seleccionados.size === 1 ? '' : 's'}` : ''}`}
                    </Btn>
                )}
            </div>
        </div>
    </Modal>
);

export default AsignarAlumnosModal;
