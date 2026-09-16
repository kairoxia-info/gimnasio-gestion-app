import { Trash2 } from 'lucide-react';
import { Btn, ConfirmInlineActions, Empty, Field, Input, Modal } from '@/components/ui-kit';
import { fmtFecha } from '@/lib/format';

// Modal "Asignar a alumnos" de RutinasPage.jsx. Es un componente puramente
// presentacional (16/09/2026, extracción mecánica) -- todo el estado
// (seleccionados, conflictoAlumnos, etc.) y los handlers (toggleAlumno,
// ejecutarAsignacion, etc.) se quedan en RutinasPage.jsx a propósito, porque
// abrirAsignar() -- llamado desde el botón "Asignar a alumnos" de cada
// tarjeta, fuera de este modal -- inicializa varios de esos estados de una.
// Todas las props llevan el mismo nombre que las variables originales en
// RutinasPage.jsx.
const AsignarAlumnosModal = ({
    asignarOpen,
    onClose,
    rutinaAsignando,
    alumnosActivos,
    asignadasActivas,
    seleccionados,
    toggleAlumno,
    confirmandoQuitarId,
    setConfirmandoQuitarId,
    quitandoId,
    quitarAsignacion,
    conflictoAlumnos,
    fechaInicioAsig,
    setFechaInicioAsig,
    fechaFinAsig,
    setFechaFinAsig,
    asignando,
    asignarMsg,
    omitirConflictos,
    reemplazarConflictos,
    iniciarAsignacion,
}) => (
    <Modal
        open={asignarOpen}
        onClose={onClose}
        title={rutinaAsignando ? `Asignar "${rutinaAsignando.nombre}" a alumnos` : 'Asignar a alumnos'}
    >
        <div className="space-y-4">
            {/* Reportado por Nalux (03/09/2026): las fechas arriba de todo,
                antes de elegir a quién, confundían a los profes -- no quedaba
                claro que esas fechas eran "para el/los que tildes abajo". Ahora
                primero se elige alumno(s) y recién ahí (una vez tildado al
                menos uno) se abren los campos de fecha, justo antes de guardar
                todo junto con "Asignar". */}
            {alumnosActivos.length === 0 ? (
                <Empty>No hay alumnos activos para asignar.</Empty>
            ) : (
                <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
                    <ul className="divide-y divide-border">
                        {alumnosActivos.map((a) => {
                            const asignacion = asignadasActivas.find(
                                (x) => x.rutina_id === rutinaAsignando?.id && x.alumno_id === a.id,
                            );
                            // Otra rutina activa (distinta a esta) -- no bloquea el
                            // tilde, solo avisa antes de que el profe lo elija: el
                            // cartel de "reemplazar o dejar" recién sale al confirmar.
                            const otra = !asignacion
                                ? asignadasActivas.find(
                                      (x) => x.alumno_id === a.id && x.rutina_id !== rutinaAsignando?.id,
                                  )
                                : null;
                            const nombreOtra = otra ? otra.rutina_nombre : null;
                            return (
                                <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                                    <input
                                        type="checkbox"
                                        id={`asignar-alumno-${a.id}`}
                                        checked={seleccionados.has(a.id)}
                                        disabled={!!asignacion}
                                        onChange={() => toggleAlumno(a.id)}
                                        className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))] disabled:opacity-40"
                                    />
                                    <label
                                        htmlFor={`asignar-alumno-${a.id}`}
                                        className={`flex-1 text-sm ${asignacion ? 'text-muted-foreground' : 'cursor-pointer'}`}
                                    >
                                        {a.nombre}
                                        {asignacion && (
                                            <span className="ml-2 text-xs">
                                                (ya la tiene, desde el {fmtFecha(asignacion.fecha_inicio)}
                                                {asignacion.fecha_fin ? ` hasta el ${fmtFecha(asignacion.fecha_fin)}` : ''})
                                            </span>
                                        )}
                                        {nombreOtra && (
                                            <span className="ml-2 text-xs text-warn">
                                                (ya tiene: {nombreOtra})
                                            </span>
                                        )}
                                    </label>
                                    {asignacion && confirmandoQuitarId === asignacion.id ? (
                                        <div className="flex shrink-0 items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">¿Seguro?</span>
                                            <ConfirmInlineActions
                                                className="px-2 py-1.5 text-xs"
                                                confirmLabel="Sí, quitar"
                                                ejecutandoLabel="Quitando..."
                                                ejecutando={quitandoId === asignacion.id}
                                                onConfirmar={() => quitarAsignacion(asignacion.id)}
                                                onCancelar={() => setConfirmandoQuitarId(null)}
                                            />
                                        </div>
                                    ) : (
                                        asignacion && (
                                            <Btn
                                                type="button"
                                                variant="ghost"
                                                className="shrink-0 px-2 py-1.5 text-xs text-primary"
                                                onClick={() => setConfirmandoQuitarId(asignacion.id)}
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
                        vencer o se les venza la rutina. Sin fecha de fin, no hay aviso.
                    </span>
                </div>
            )}

            {/* Cartel de conflicto: pedido de Nalux (03/09/2026) -- si algún
                tildado ya tiene otra rutina activa, no se pisa en silencio. */}
            {conflictoAlumnos && (
                <div className="space-y-3 rounded-xl border border-warn bg-warn/10 p-4">
                    <p className="text-sm font-semibold">
                        {conflictoAlumnos.length === 1
                            ? `${conflictoAlumnos[0].nombreAlumno} ya tiene una rutina asignada: "${conflictoAlumnos[0].nombreRutina}".`
                            : `${conflictoAlumnos.length} alumnos ya tienen otra rutina asignada:`}
                    </p>
                    {conflictoAlumnos.length > 1 && (
                        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                            {conflictoAlumnos.map((c) => (
                                <li key={c.alumnoId}>
                                    {c.nombreAlumno} — <span className="italic">{c.nombreRutina}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-xs text-muted-foreground">
                        ¿Les dejamos la rutina que ya tienen, o se la reemplazamos por "
                        {rutinaAsignando?.nombre}"?
                    </p>
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                        <Btn variant="ghost" disabled={asignando} onClick={omitirConflictos}>
                            Dejarles la que tienen
                        </Btn>
                        <Btn disabled={asignando} onClick={reemplazarConflictos}>
                            {asignando ? 'Reemplazando...' : 'Reemplazar por esta'}
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
