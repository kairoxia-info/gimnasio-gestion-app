import { Printer } from 'lucide-react';
import { Btn, Empty, Field, Input, Modal, Select } from '@/components/ui-kit';

// Modal "Datos para el PDF" (biblioteca -> PDF), mismo patrón que el de
// RutinasPage.jsx: pdfModalPlan es el plan que se está por imprimir (o
// null si el modal está cerrado). Pedido de Nalux (04/09/2026): "que
// cuando habrá descarga salte un cartel para poner fecha inicio y
// finalización, y agregar el alumno asignado".
const GenerarPdfPlanModal = ({
    pdfModalPlan,
    onClose,
    pdfModo,
    setPdfModo,
    setPdfError,
    pdfConflicto,
    setPdfConflicto,
    alumnosActivos,
    pdfAlumnoId,
    setPdfAlumnoId,
    pdfAlumnoNombre,
    setPdfAlumnoNombre,
    pdfFechaInicio,
    setPdfFechaInicio,
    pdfFechaFin,
    setPdfFechaFin,
    pdfAsignando,
    pdfError,
    planImprimiendo,
    confirmarPdf,
}) => (
    <Modal open={!!pdfModalPlan} onClose={onClose} title={pdfModalPlan ? `PDF de "${pdfModalPlan.nombre}"` : 'PDF'}>
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                {[
                    { valor: 'alumno', label: 'Alumno registrado' },
                    { valor: 'libre', label: 'Nombre libre' },
                ].map((op) => (
                    <button
                        key={op.valor}
                        type="button"
                        onClick={() => {
                            setPdfModo(op.valor);
                            setPdfError('');
                            setPdfConflicto(null);
                        }}
                        aria-pressed={pdfModo === op.valor}
                        className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                            pdfModo === op.valor
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {op.label}
                    </button>
                ))}
            </div>

            {pdfModo === 'alumno' ? (
                alumnosActivos.length === 0 ? (
                    <Empty>No hay alumnos activos cargados. Usar "Nombre libre" para esta copia.</Empty>
                ) : (
                    <Field label="Alumno">
                        <Select
                            value={pdfAlumnoId}
                            onChange={(e) => {
                                const id = e.target.value;
                                setPdfAlumnoId(id);
                                setPdfAlumnoNombre(alumnosActivos.find((a) => a.id === id)?.nombre || '');
                                setPdfConflicto(null);
                            }}
                        >
                            <option value="">Elegir un alumno...</option>
                            {alumnosActivos.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.nombre}
                                </option>
                            ))}
                        </Select>
                    </Field>
                )
            ) : (
                <Field label="Nombre del alumno (opcional)">
                    <Input
                        value={pdfAlumnoNombre}
                        onChange={(e) => setPdfAlumnoNombre(e.target.value)}
                        placeholder="Para quién es esta copia"
                    />
                </Field>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Fecha de inicio">
                    <Input
                        type="date"
                        value={pdfFechaInicio}
                        onChange={(e) => setPdfFechaInicio(e.target.value)}
                    />
                </Field>
                <Field label="Fecha de fin (opcional)">
                    <Input
                        type="date"
                        value={pdfFechaFin}
                        onChange={(e) => setPdfFechaFin(e.target.value)}
                    />
                </Field>
            </div>

            {!pdfConflicto && (
                <span className="block text-xs text-muted-foreground">
                    {pdfModo === 'alumno'
                        ? 'Al generar el PDF, el plan queda asignado a ese alumno con estas fechas (si ya tenía uno, se reemplaza).'
                        : 'Nombre libre: el PDF sale con ese nombre, pero no queda asignado a nadie ni con seguimiento.'}
                </span>
            )}

            {pdfConflicto && (
                <div className="space-y-3 rounded-xl border border-warn bg-warn/10 p-4">
                    <p className="text-sm font-semibold">
                        {pdfAlumnoNombre || 'Este alumno'} ya tiene un plan asignado: &ldquo;
                        {pdfConflicto.nombre}&rdquo;.
                    </p>
                    <p className="text-xs text-muted-foreground">
                        ¿Le dejamos el que tiene, o se lo reemplazamos por &ldquo;{pdfModalPlan?.nombre}&rdquo;?
                    </p>
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                        <Btn variant="ghost" disabled={pdfAsignando} onClick={() => setPdfConflicto(null)}>
                            Dejarle el que tiene
                        </Btn>
                        <Btn disabled={pdfAsignando} onClick={confirmarPdf}>
                            {pdfAsignando ? 'Reemplazando...' : 'Reemplazar y generar PDF'}
                        </Btn>
                    </div>
                </div>
            )}

            {pdfError && <p className="text-sm text-destructive">{pdfError}</p>}

            <div className="flex justify-end gap-2 pt-2">
                <Btn variant="ghost" onClick={onClose}>
                    Cancelar
                </Btn>
                {!pdfConflicto && (
                    <Btn
                        onClick={confirmarPdf}
                        disabled={
                            pdfAsignando ||
                            !!planImprimiendo ||
                            (pdfModo === 'alumno' && !pdfAlumnoId)
                        }
                    >
                        <Printer className="h-4 w-4" />{' '}
                        {pdfAsignando
                            ? 'Asignando...'
                            : planImprimiendo
                              ? 'Generando...'
                              : 'Generar PDF'}
                    </Btn>
                )}
            </div>
        </div>
    </Modal>
);

export default GenerarPdfPlanModal;
