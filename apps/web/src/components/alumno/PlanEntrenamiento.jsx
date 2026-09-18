import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Printer } from 'lucide-react';
import { Badge, Btn, Card, Empty, Field, Input, Loading, Modal, Select } from '@/components/ui-kit';
import { ESTILOS_IMPRESION_RUTINA, RutinaImprimiblePDF } from '@/components/RutinaPDF';
import { descargarComoPdf } from '@/lib/descargarPdf';
import { useAuth } from '@/contexts/AuthContext';
import { createRec, listAll, snapshotRutina, updateRec } from '@/lib/data';
import {
    agruparCombos,
    agruparItemsRutina,
    agruparPorBloque,
    esRepsPorTiempo,
    fmtFecha,
    hoy,
    resumenSeries,
    resumenTipoGrupo,
} from '@/lib/format';
import HistorialRutinas from '@/components/alumno/HistorialRutinas';

/* ---------------- Plan de entrenamiento ---------------- */

// Desde el Bloque G, las rutinas son plantillas de la biblioteca compartidas
// por varios alumnos (rutinas + rutinas_asignadas) — este componente ya NO
// edita la plantilla en línea (eso pisaría la rutina de todos los demás
// alumnos que también la tienen asignada). Acá solo se lee en modo
// solo-lectura y se reasigna: cambiar de rutina desactiva la asignación
// vieja (no la borra, queda como historial) y crea una nueva. Armar o editar
// el contenido de una rutina vive únicamente en RutinasPage.
const PlanEntrenamiento = ({ alumnoId, alumnoNombre, plan, historial, onSaved }) => {
    const { gimnasio } = useAuth();
    const [cambiando, setCambiando] = useState(false);
    const [rutinasDisponibles, setRutinasDisponibles] = useState([]);
    const [cargandoRutinas, setCargandoRutinas] = useState(false);
    const [rutinaElegida, setRutinaElegida] = useState('');
    const [fechaInicioNueva, setFechaInicioNueva] = useState(hoy());
    const [fechaFinNueva, setFechaFinNueva] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    // Fecha de fin de la asignación YA activa, editable sin tener que
    // reasignar toda la rutina (el caso común: "extendele una semana más").
    const [fechaFinEdit, setFechaFinEdit] = useState(plan?.fechaFin || '');
    const [guardandoFechaFin, setGuardandoFechaFin] = useState(false);
    // Generación del PDF (lib/descargarPdf.js): tarda un par de segundos, así
    // que el botón avisa mientras trabaja en vez de parecer que no hizo nada.
    const [generandoPdf, setGenerandoPdf] = useState(false);
    const [errorPdf, setErrorPdf] = useState('');

    useEffect(() => {
        setFechaFinEdit(plan?.fechaFin || '');
    }, [plan]);

    // Fase 2.6 (13/09/2026): lo que el alumno marcó "hecho" HOY desde
    // /mi-plan (migración 0050, entrenamientos_completados) -- mismo
    // criterio de "hoy" que ve el propio alumno en su pantalla, para que acá
    // el profesor vea exactamente lo mismo. Si mañana el alumno no marca
    // nada, el badge desaparece solo -- no es un progreso acumulado de la
    // rutina entera, es un check del día.
    const [diasHechosHoy, setDiasHechosHoy] = useState(() => new Set());
    useEffect(() => {
        if (!plan?.asignacionId) {
            setDiasHechosHoy(new Set());
            return;
        }
        listAll('entrenamientos_completados', {
            filters: { alumno_id: alumnoId, rutina_asignada_id: plan.asignacionId, fecha: hoy() },
        })
            .then((filas) => {
                setDiasHechosHoy(new Set(filas.map((f) => `${f.semana}|${f.dia}`)));
            })
            .catch(() => setDiasHechosHoy(new Set()));
    }, [alumnoId, plan?.asignacionId]);

    const abrirSelector = () => {
        setMsg('');
        setCambiando(true);
        setCargandoRutinas(true);
        setFechaInicioNueva(hoy());
        setFechaFinNueva('');
        listAll('rutinas', { sort: 'nombre' })
            .then((r) => {
                setRutinasDisponibles(r);
                setRutinaElegida(r.find((x) => x.id !== plan?.rutinaId)?.id || r[0]?.id || '');
            })
            .catch(() => setMsg('No se pudieron cargar las rutinas de la biblioteca.'))
            .finally(() => setCargandoRutinas(false));
    };

    const confirmarCambio = async () => {
        if (!rutinaElegida) return;
        const elegida = rutinasDisponibles.find((r) => r.id === rutinaElegida);
        if (!elegida) return;
        setSaving(true);
        setMsg('');
        try {
            if (plan?.asignacionId) {
                // No se borra: queda desactivada como historial.
                await updateRec('rutinas_asignadas', plan.asignacionId, { activa: false });
            }
            await createRec('rutinas_asignadas', snapshotRutina(elegida, {
                alumno_id: alumnoId,
                fecha_inicio: fechaInicioNueva || hoy(),
                fecha_fin: fechaFinNueva || null,
            }));
            setCambiando(false);
            onSaved();
        } catch (_) {
            setMsg('No se pudo asignar la rutina.');
        } finally {
            setSaving(false);
        }
    };

    const quitar = async () => {
        if (!plan?.asignacionId) return;
        setSaving(true);
        setMsg('');
        try {
            await updateRec('rutinas_asignadas', plan.asignacionId, { activa: false });
            onSaved();
        } catch (_) {
            setMsg('No se pudo quitar la rutina.');
        } finally {
            setSaving(false);
        }
    };

    // Guarda SOLO la fecha de fin de la asignación ya activa -- para
    // extender (o sacarle) el vencimiento sin tener que reasignar toda la
    // rutina de nuevo (que además crearía una entrada de más en el
    // historial por algo que no cambió de verdad).
    const guardarFechaFin = async () => {
        if (!plan?.asignacionId) return;
        setGuardandoFechaFin(true);
        try {
            await updateRec('rutinas_asignadas', plan.asignacionId, { fecha_fin: fechaFinEdit || null });
            onSaved();
        } catch (_) {
            setMsg('No se pudo guardar la fecha de fin.');
        } finally {
            setGuardandoFechaFin(false);
        }
    };

    // La hoja del PDF (RutinaImprimiblePDF) queda siempre montada, oculta por
    // CSS mientras hay plan. Antes esto abría el diálogo de impresión y había
    // que elegir "Guardar como PDF" a mano; pedido de Nalux (07/09/2026) que
    // baje el archivo directo. descargarComoPdf ya espera a que el logo del
    // gimnasio termine de cargar antes de sacarle la foto a la hoja.
    const descargarPdf = async () => {
        setGenerandoPdf(true);
        setErrorPdf('');
        try {
            await descargarComoPdf('.rutina-pdf-hoja', `Rutina - ${alumnoNombre || 'alumno'}`);
        } catch (_) {
            setErrorPdf('No se pudo generar el PDF. Probar de nuevo.');
        } finally {
            setGenerandoPdf(false);
        }
    };

    const grupos = useMemo(() => agruparItemsRutina(plan?.items || []), [plan]);
    const variasSemanas = grupos.length > 1;

    // Mismo modal para "asignar por primera vez" y "cambiar la que ya tiene"
    // -- confirmarCambio() ya contempla los dos casos (si no hay
    // asignacionId previo, no desactiva nada, solo crea la nueva). Se arma
    // una sola vez acá para no duplicarlo entre los dos `return` de abajo
    // (con plan y sin plan todavía).
    const modalRutina = (
        <Modal
            open={cambiando}
            onClose={() => setCambiando(false)}
            title={plan ? 'Cambiar rutina asignada' : 'Asignar rutina'}
        >
            <div className="space-y-4">
                {cargandoRutinas ? (
                    <Loading rows={2} />
                ) : rutinasDisponibles.length === 0 ? (
                    <Empty>
                        No hay rutinas en la biblioteca todavía. Crear una desde{' '}
                        <Link to="/rutinas" className="font-semibold text-primary">
                            Rutinas
                        </Link>
                        .
                    </Empty>
                ) : (
                    <>
                        <Field label="Rutina de la biblioteca">
                            <Select value={rutinaElegida} onChange={(e) => setRutinaElegida(e.target.value)}>
                                {rutinasDisponibles.map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.nombre}
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
                <div className="flex justify-end gap-2 pt-2">
                    <Btn variant="ghost" onClick={() => setCambiando(false)}>
                        Cancelar
                    </Btn>
                    <Btn onClick={confirmarCambio} disabled={saving || !rutinaElegida}>
                        {saving ? 'Guardando...' : 'Asignar'}
                    </Btn>
                </div>
            </div>
        </Modal>
    );

    if (!plan) {
        return (
            <div className="space-y-5">
                <Empty>
                    Este alumno todavía no tiene una rutina asignada.{' '}
                    <button type="button" onClick={abrirSelector} className="font-semibold text-primary">
                        Asignarle una, con su fecha de inicio y de fin
                    </button>
                    , o crear una rutina nueva desde{' '}
                    <Link to="/rutinas" className="font-semibold text-primary">
                        Rutinas
                    </Link>
                    .
                </Empty>
                <HistorialRutinas historial={historial} />
                {modalRutina}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Rutina asignada
                        </p>
                        <h3 className="mt-1 font-display text-xl font-bold">{plan.nombre}</h3>
                        {plan.descripcion && <p className="mt-1 text-sm text-muted-foreground">{plan.descripcion}</p>}
                        <p className="mt-2 text-xs text-muted-foreground">
                            {plan.duracionSemanas
                                ? `${plan.duracionSemanas} semana${plan.duracionSemanas === 1 ? '' : 's'}`
                                : 'Duración libre'}
                            {plan.fechaInicio ? ` · desde el ${fmtFecha(plan.fechaInicio)}` : ''}
                        </p>
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
                            Cambiar rutina
                        </Btn>
                        <Btn variant="danger" className="px-3 py-2 text-xs" onClick={quitar} disabled={saving}>
                            Quitar rutina
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
                        disabled={guardandoFechaFin || fechaFinEdit === (plan.fechaFin || '')}
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
                <Empty>Esta rutina todavía no tiene ejercicios agregados.</Empty>
            ) : (
                <div className="space-y-5">
                    {grupos.map(([nroSemana, dias]) => (
                        <div key={nroSemana} className="space-y-4">
                            {variasSemanas && (
                                <h3 className="font-display text-sm font-bold uppercase tracking-wide text-primary">
                                    Semana {nroSemana}
                                </h3>
                            )}
                            {dias.map(([d, lista]) => (
                                <Card key={`${nroSemana}-${d}`}>
                                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                        <h3 className="font-display text-lg font-bold uppercase">{d}</h3>
                                        <div className="flex items-center gap-2">
                                            {diasHechosHoy.has(`${nroSemana}|${d}`) && (
                                                <Badge className="gap-1 border-ok/40 bg-ok/10 text-ok">
                                                    <CheckCircle2 className="h-3 w-3" /> El alumno lo marcó hoy
                                                </Badge>
                                            )}
                                            <Badge className="border-border text-muted-foreground">
                                                {lista.length} ejercicio{lista.length === 1 ? '' : 's'}
                                            </Badge>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        {agruparPorBloque(agruparCombos(lista)).map(([nombreBloque, delBloque], iBloque) => (
                                            <div key={`${nombreBloque}-${iBloque}`} className="space-y-2">
                                                {nombreBloque && (
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                        {nombreBloque}
                                                        {resumenTipoGrupo(delBloque) && (
                                                            <span className="ml-2 normal-case text-primary">
                                                                · {resumenTipoGrupo(delBloque)}
                                                            </span>
                                                        )}
                                                    </p>
                                                )}
                                                {delBloque.map((it) =>
                                                    it.esCombo ? (
                                                        // Superserie -- rediseñado 16/09/2026 (pedido de Nalux:
                                                        // "saca las cajas pon como texto normal... si sacás las
                                                        // cajas se vería más como una hoja de entrenamiento y eso
                                                        // es lo que quiero"). Mismo formato compacto que ya usa
                                                        // resumenSeries() en el PDF y en el "Ver" de RutinasPage.jsx
                                                        // (components/rutinas/VerRutinaModal.jsx) -- "4x10" en vez
                                                        // de repetir "Series 4 · Reps 10" con etiquetas.
                                                        <div key={it.key} className="rounded-xl border-2 border-primary/30 p-3">
                                                            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-primary">
                                                                Superserie
                                                            </p>
                                                            <div className="flex flex-col items-stretch gap-1.5 sm:flex-row">
                                                                {it.comboItems.map((sub, i) => (
                                                                    <React.Fragment key={sub.key}>
                                                                        {i > 0 && (
                                                                            <span
                                                                                className="flex shrink-0 items-center justify-center text-sm font-bold text-primary"
                                                                                aria-hidden="true"
                                                                            >
                                                                                +
                                                                            </span>
                                                                        )}
                                                                        <div className="min-w-0 flex-1 rounded-lg bg-secondary p-2">
                                                                            <p className="text-xs font-bold leading-tight sm:truncate">
                                                                                {sub.nombre}
                                                                            </p>
                                                                            {sub.grupo && (
                                                                                <p className="text-xs text-muted-foreground">{sub.grupo}</p>
                                                                            )}
                                                                            <p className="mt-0.5 text-xs font-semibold text-foreground">
                                                                                {resumenSeries(sub)}
                                                                                {sub.peso && ` · ${sub.peso}`}
                                                                            </p>
                                                                        </div>
                                                                    </React.Fragment>
                                                                ))}
                                                            </div>
                                                            <p className="mt-2 text-xs text-muted-foreground">
                                                                Descanso <span className="font-semibold text-foreground">{it.descanso || '—'}</span>
                                                                {it.intensidad && it.intensidad !== '—' && (
                                                                    <>
                                                                        {' · '}Intensidad{' '}
                                                                        <span className="font-semibold text-foreground">{it.intensidad}</span>
                                                                    </>
                                                                )}
                                                            </p>
                                                            {it.comentario && (
                                                                <p className="mt-2 border-t border-border pt-2 text-xs italic text-muted-foreground">
                                                                    {it.comentario}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        // Ejercicio suelto -- mismo rediseño de arriba: una línea
                                                        // de texto (nombre + grupo a la izquierda, "4x10 · 60s" a
                                                        // la derecha) en vez de la grilla de cajas Series/Reps/
                                                        // Peso/Descanso/Intensidad de antes. resumenSeries() ya
                                                        // resuelve series desglosadas (pirámide/dropset) sola, no
                                                        // hace falta el join("/") manual que había acá.
                                                        <div
                                                            key={it.key}
                                                            className="rounded-xl border border-border p-3"
                                                        >
                                                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                                                <span className="min-w-0 text-sm font-bold">
                                                                    {it.nombre}
                                                                    {it.grupo && (
                                                                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                                            {it.grupo}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                <span className="text-xs font-semibold text-foreground">
                                                                    {resumenSeries(it)}
                                                                    {!esRepsPorTiempo(it.reps) && it.peso ? ` · ${it.peso}` : ''}
                                                                    {it.descanso ? ` · ${it.descanso}` : ''}
                                                                </span>
                                                            </div>
                                                            {it.intensidad && it.intensidad !== '—' && (
                                                                <p className="mt-1 text-xs text-muted-foreground">
                                                                    Intensidad:{' '}
                                                                    <span className="font-semibold text-foreground">{it.intensidad}</span>
                                                                </p>
                                                            )}
                                                            {it.comentario && (
                                                                <p className="mt-2 border-t border-border pt-2 text-xs italic text-muted-foreground">
                                                                    {it.comentario}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ),
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    ))}
                </div>
            )}

            <HistorialRutinas historial={historial} />

            <style>{ESTILOS_IMPRESION_RUTINA}</style>
            <RutinaImprimiblePDF
                nombre={plan.nombre}
                items={plan.items}
                color={gimnasio?.color_principal}
                logoUrl={gimnasio?.logo_url}
                alumnoNombre={alumnoNombre}
                fechaInicio={plan.fechaInicio}
                fechaFin={plan.fechaFin}
                duracionSemanas={plan.duracionSemanas}
            />

            {modalRutina}
        </div>
    );
};

export default PlanEntrenamiento;
