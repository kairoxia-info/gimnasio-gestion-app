import { Printer } from 'lucide-react';
import { Btn, Empty, Field, Input, Modal, Select } from '@/components/ui-kit';

// Modal "Datos para el PDF" de RutinasPage.jsx. Es un componente puramente
// presentacional (16/09/2026, extracción mecánica) -- el estado
// (pdfModalRutina, pdfModo, etc.) y los handlers (abrirPdfModal,
// confirmarPdf) se quedan en RutinasPage.jsx a propósito, porque
// pdfAlumnoNombre/pdfFechaInicio/pdfFechaFin/rutinaImprimiendo también los
// usa <RutinaImprimiblePDF> fuera de este modal (la hoja que arma el PDF de
// verdad) -- moverlos acá hubiera duplicado esa data o forzado a leerla por
// fuera del componente. Todas las props llevan el mismo nombre que las
// variables originales en RutinasPage.jsx.
const PdfRutinaModal = ({
    pdfModalRutina,
    alumnosActivos,
    pdfModo,
    setPdfModo,
    pdfAlumnoId,
    setPdfAlumnoId,
    pdfAlumnoNombre,
    setPdfAlumnoNombre,
    pdfFechaInicio,
    setPdfFechaInicio,
    pdfFechaFin,
    setPdfFechaFin,
    pdfConflicto,
    setPdfConflicto,
    pdfError,
    setPdfError,
    pdfAsignando,
    rutinaImprimiendo,
    onClose,
    onConfirmar,
}) => (
    <Modal
        open={!!pdfModalRutina}
        onClose={onClose}
        title={pdfModalRutina ? `PDF de "${pdfModalRutina.nombre}"` : 'PDF'}
    >
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
                        ? 'Al generar el PDF, la rutina queda asignada a ese alumno con estas fechas (si ya la tenía asignada, no se duplica).'
                        : 'Nombre libre: el PDF sale con ese nombre, pero no queda asignado a nadie ni con seguimiento.'}
                </span>
            )}

            {/* Mismo cartel de conflicto que "Asignar a alumnos", para un solo
                alumno: pedido de Nalux (03/09/2026). */}
            {pdfConflicto && (
                <div className="space-y-3 rounded-xl border border-warn bg-warn/10 p-4">
                    <p className="text-sm font-semibold">
                        {pdfAlumnoNombre || 'Este alumno'} ya tiene una rutina asignada: "
                        {pdfConflicto.nombreRutina}".
                    </p>
                    <p className="text-xs text-muted-foreground">
                        ¿Le dejamos la que tiene, o se la reemplazamos por "{pdfModalRutina?.nombre}"?
                    </p>
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                        <Btn variant="ghost" disabled={pdfAsignando} onClick={() => setPdfConflicto(null)}>
                            Dejarle la que tiene
                        </Btn>
                        <Btn disabled={pdfAsignando} onClick={onConfirmar}>
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
                        onClick={onConfirmar}
                        disabled={
                            pdfAsignando ||
                            !!rutinaImprimiendo ||
                            (pdfModo === 'alumno' && !pdfAlumnoId)
                        }
                    >
                        <Printer className="h-4 w-4" />{' '}
                        {pdfAsignando
                            ? 'Asignando...'
                            : rutinaImprimiendo
                              ? 'Generando...'
                              : 'Generar PDF'}
                    </Btn>
                )}
            </div>
        </div>
    </Modal>
);

export default PdfRutinaModal;
