import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Printer, Trash2, UserRound } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QRCode from 'qrcode';
import supabase from '@/lib/supabaseClient';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { ESTILOS_IMPRESION_RUTINA, RutinaImprimiblePDF, esperarImagenesCargadas } from '@/components/RutinaPDF';
import { ESTILOS_IMPRESION_ALIMENTACION, PlanAlimentacionImprimiblePDF } from '@/components/PlanAlimentacionPDF';
import { useAuth } from '@/contexts/AuthContext';
import { createRec, listAll, removeRec, snapshotRutina, updateRec } from '@/lib/data';
import {
    ESTADOS_ALUMNO,
    agruparCombos,
    agruparItemsRutina,
    agruparPorBloque,
    armarTextoAlimentos,
    ESTADOS_PAGO,
    antiguedad,
    estadoAlumno,
    estadoCuota,
    fmtFecha,
    hoy,
    money,
} from '@/lib/format';

// rutinas es la plantilla (nombre/descripcion/duracion_semanas/items),
// rutinas_asignadas es el vínculo con el alumno Y la copia de lo que se le
// asignó (migración 0026). Pedido de Nalux (04/09/2026): editar una rutina
// en la biblioteca NO tiene que cambiarle nada al alumno que ya la tiene
// asignada -- por eso acá se lee la copia guardada en la asignación, no la
// plantilla en vivo. Para actualizarle la rutina hay que reasignársela.
const cargarRutinaAsignada = async (alumnoId) => {
    // Filtra por activa=true en la propia consulta: si no, "Quitar rutina" (que
    // solo pone activa=false, no borra la fila) queda pisado por este fallback
    // apenas se recarga, porque sigue habiendo una fila -aunque inactiva- para
    // volver a mostrar. Con el filtro server-side, sin ninguna activa esto
    // devuelve [] limpio, tal como espera "Quitar rutina".
    const asignadas = await listAll('rutinas_asignadas', {
        filters: { alumno_id: alumnoId, activa: true },
        sort: '-created_at',
    });
    if (asignadas.length === 0) return null;
    const asignacion = asignadas[0];
    return {
        asignacionId: asignacion.id,
        rutinaId: asignacion.rutina_id,
        nombre: asignacion.rutina_nombre || 'Rutina asignada',
        descripcion: asignacion.rutina_descripcion,
        duracionSemanas: asignacion.rutina_duracion_semanas,
        fechaInicio: asignacion.fecha_inicio,
        fechaFin: asignacion.fecha_fin,
        items: asignacion.items || [],
    };
};

// Rutinas que el alumno tuvo antes: son las asignaciones que quedaron con
// activa=false ("Cambiar rutina" y "Quitar rutina" no borran la fila, la
// desactivan justamente para esto). El nombre sale de la copia de cada
// asignación, así el historial dice qué tenía en ese momento aunque después
// esa rutina se haya renombrado o borrado de la biblioteca.
const cargarHistorialRutinas = async (alumnoId) => {
    const asignadas = await listAll('rutinas_asignadas', {
        filters: { alumno_id: alumnoId, activa: false },
        sort: '-created_at',
    });
    return asignadas.map((a) => ({
        id: a.id,
        nombre: a.rutina_nombre || 'Rutina sin nombre',
        desde: a.fecha_inicio || a.created_at,
    }));
};

// No hay columna de "fecha de baja" en rutinas_asignadas, así que a propósito
// solo se muestra desde cuándo la tenía, no hasta cuándo: inventar una fecha
// de fin a partir de otra cosa sería mentir.
const HistorialRutinas = ({ historial }) => {
    if (!historial || historial.length === 0) return null;
    return (
        <Card>
            <h3 className="font-display text-lg font-bold">Rutinas anteriores</h3>
            <ul className="mt-3 divide-y divide-border">
                {historial.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="text-sm">{h.nombre}</span>
                        <span className="text-xs text-muted-foreground">Desde el {fmtFecha(h.desde)}</span>
                    </li>
                ))}
            </ul>
        </Card>
    );
};

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

    useEffect(() => {
        setFechaFinEdit(plan?.fechaFin || '');
    }, [plan]);

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

    // La hoja de impresión (RutinaImprimiblePDF) queda siempre montada, oculta
    // por CSS (ver ESTILOS_IMPRESION_RUTINA) mientras hay plan -- no hace
    // falta un estado "imprimiendo" como en RutinasPage/MiPlanPage porque acá
    // solo hay UNA cosa para imprimir en esta pantalla, nunca dos secciones
    // que puedan pisarse. Igual se espera a que el logo termine de cargar
    // antes de imprimir (ver esperarImagenesCargadas) -- normalmente ya está
    // cargado porque la hoja está montada desde que entró a la página, pero
    // no hay que asumirlo (conexión lenta, logo recién cambiado, etc.).
    const imprimir = async () => {
        await esperarImagenesCargadas('.rutina-pdf-hoja img');
        window.print();
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
                        No hay rutinas en la biblioteca todavía. Armar una desde{' '}
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
                    , o armar una rutina nueva desde{' '}
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
                        <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={imprimir}>
                            <Printer className="h-3.5 w-3.5" /> Descargar PDF
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
            </Card>

            {(plan.items || []).length === 0 ? (
                <Empty>Esta rutina todavía no tiene ejercicios cargados.</Empty>
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
                                    <div className="mb-3 flex items-center justify-between">
                                        <h3 className="font-display text-lg font-bold uppercase">{d}</h3>
                                        <Badge className="border-border text-muted-foreground">
                                            {lista.length} ejercicio{lista.length === 1 ? '' : 's'}
                                        </Badge>
                                    </div>
                                    <div className="space-y-4">
                                        {agruparPorBloque(agruparCombos(lista)).map(([nombreBloque, delBloque], iBloque) => (
                                            <div key={`${nombreBloque}-${iBloque}`} className="space-y-2">
                                                {nombreBloque && (
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                        {nombreBloque}
                                                    </p>
                                                )}
                                                {delBloque.map((it) =>
                                                    it.esCombo ? (
                                                        // Superserie: cada ejercicio en su propia caja chica, uno al
                                                        // lado del otro (mismo criterio que MiPlanPage) — descanso e
                                                        // intensidad son del combo entero, se muestran una sola vez.
                                                        <div key={it.key} className="rounded-xl border-2 border-primary/30 p-3">
                                                            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-primary">
                                                                Superserie
                                                            </p>
                                                            <div className="flex items-stretch gap-1.5">
                                                                {it.comboItems.map((sub, i) => (
                                                                    <React.Fragment key={sub.key}>
                                                                        {i > 0 && (
                                                                            <span
                                                                                className="flex shrink-0 items-center text-sm font-bold text-primary"
                                                                                aria-hidden="true"
                                                                            >
                                                                                +
                                                                            </span>
                                                                        )}
                                                                        <div className="min-w-0 flex-1 rounded-lg bg-secondary p-2">
                                                                            <p className="truncate text-xs font-bold leading-tight">
                                                                                {sub.nombre}
                                                                            </p>
                                                                            <p className="mt-1 text-xs text-muted-foreground">
                                                                                Series <span className="font-semibold text-foreground">{sub.series}</span>
                                                                                {' · '}Reps <span className="font-semibold text-foreground">{sub.reps}</span>
                                                                                {sub.peso && (
                                                                                    <>
                                                                                        {' · '}Peso{' '}
                                                                                        <span className="font-semibold text-foreground">
                                                                                            {sub.peso}
                                                                                        </span>
                                                                                    </>
                                                                                )}
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
                                                        <div key={it.key} className="rounded-xl border border-border p-3">
                                                            <div className="grid gap-3 sm:grid-cols-[2fr,repeat(5,minmax(0,1fr))]">
                                                                <div>
                                                                    <p className="text-sm font-bold">{it.nombre}</p>
                                                                    <p className="text-xs text-muted-foreground">{it.grupo}</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                                                        Series
                                                                    </p>
                                                                    <p className="text-sm font-semibold">{it.series}</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                                                        Reps
                                                                    </p>
                                                                    <p className="text-sm font-semibold">{it.reps}</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                                                        Peso
                                                                    </p>
                                                                    <p className="text-sm font-semibold">{it.peso || '—'}</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                                                        Descanso
                                                                    </p>
                                                                    <p className="text-sm font-semibold">{it.descanso || '—'}</p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                                                        Intensidad
                                                                    </p>
                                                                    <p className="text-sm font-semibold">{it.intensidad || '—'}</p>
                                                                </div>
                                                            </div>
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

    const imprimir = async () => {
        await esperarImagenesCargadas('.alimentacion-pdf-hoja img');
        window.print();
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
                        <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={imprimir}>
                            <Printer className="h-3.5 w-3.5" /> Descargar PDF
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

/* ---------------- Progreso ---------------- */

// pierna y cadera (migración 0023, 04/09/2026): investigado qué miden los
// gimnasios para seguimiento de progreso -- el set estándar es cintura,
// cadera, pecho, brazo y muslo. Nalux pidió pierna explícitamente; cadera se
// suma de una vez por ser el complemento estándar de cintura (relación
// cintura-cadera) en toda la bibliografía consultada.
const FORM_VACIO = {
    fecha: hoy(),
    peso: '',
    cintura: '',
    cadera: '',
    pecho: '',
    brazo: '',
    pierna: '',
    observaciones: '',
};

const Progreso = ({ alumnoId, registros, onChange }) => {
    const [form, setForm] = useState(FORM_VACIO);
    const [saving, setSaving] = useState(false);

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await createRec('progreso', {
                alumno_id: alumnoId,
                fecha: form.fecha,
                peso: Number(form.peso || 0),
                cintura: Number(form.cintura || 0),
                cadera: Number(form.cadera || 0),
                pecho: Number(form.pecho || 0),
                brazo: Number(form.brazo || 0),
                pierna: Number(form.pierna || 0),
                observaciones: form.observaciones,
            });
            setForm({ ...FORM_VACIO, fecha: hoy() });
            onChange();
        } finally {
            setSaving(false);
        }
    };

    const serie = [...registros]
        .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
        .map((r) => ({ fecha: fmtFecha(r.fecha).slice(0, 5), peso: Number(r.peso || 0) }));

    return (
        <div className="grid gap-5 lg:grid-cols-[1fr,1.2fr]">
            <Card>
                <h3 className="mb-4 font-display text-lg font-bold">Nuevo registro</h3>
                <form onSubmit={guardar} className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Fecha">
                            <Input
                                type="date"
                                value={form.fecha}
                                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                                required
                            />
                        </Field>
                        <Field label="Peso (kg)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.peso}
                                onChange={(e) => setForm({ ...form, peso: e.target.value })}
                            />
                        </Field>
                        <Field label="Cintura (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.cintura}
                                onChange={(e) => setForm({ ...form, cintura: e.target.value })}
                            />
                        </Field>
                        <Field label="Cadera (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.cadera}
                                onChange={(e) => setForm({ ...form, cadera: e.target.value })}
                            />
                        </Field>
                        <Field label="Pecho (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.pecho}
                                onChange={(e) => setForm({ ...form, pecho: e.target.value })}
                            />
                        </Field>
                        <Field label="Brazo (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.brazo}
                                onChange={(e) => setForm({ ...form, brazo: e.target.value })}
                            />
                        </Field>
                        <Field label="Pierna (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.pierna}
                                onChange={(e) => setForm({ ...form, pierna: e.target.value })}
                            />
                        </Field>
                    </div>
                    <Field label="Observaciones de salud / lesiones">
                        <Textarea
                            value={form.observaciones}
                            onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                        />
                    </Field>
                    <Btn type="submit" disabled={saving}>
                        {saving ? 'Guardando...' : 'Registrar'}
                    </Btn>
                </form>
            </Card>

            <div className="space-y-5">
                <Card>
                    <h3 className="mb-4 font-display text-lg font-bold">Evolución del peso</h3>
                    {serie.length < 2 ? (
                        <Empty>Cargar al menos dos registros para ver el gráfico.</Empty>
                    ) : (
                        <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={serie}>
                                    <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                    <XAxis dataKey="fecha" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={['auto', 'auto']} />
                                    <Tooltip
                                        contentStyle={{
                                            background: 'hsl(var(--card))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: 12,
                                            color: 'hsl(var(--foreground))',
                                        }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="peso"
                                        stroke="hsl(var(--primary))"
                                        strokeWidth={3}
                                        dot={{ r: 3 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </Card>

                <Card>
                    <h3 className="mb-3 font-display text-lg font-bold">Historial</h3>
                    {registros.length === 0 ? (
                        <Empty>Sin registros de progreso.</Empty>
                    ) : (
                        <ul className="divide-y divide-border">
                            {registros.map((r) => (
                                <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                                    <div>
                                        <p className="text-sm font-semibold">
                                            {fmtFecha(r.fecha)} · {r.peso || 0} kg
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Cintura {r.cintura || 0} · Cadera {r.cadera || 0} · Pecho {r.pecho || 0} ·
                                            Brazo {r.brazo || 0} · Pierna {r.pierna || 0}
                                        </p>
                                        {r.observaciones && <p className="mt-1 text-xs">{r.observaciones}</p>}
                                    </div>
                                    <button
                                        type="button"
                                        aria-label="Eliminar registro"
                                        onClick={() => removeRec('progreso', r.id).then(onChange)}
                                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-primary"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>
        </div>
    );
};

/* ---------------- Asistencia del alumno ---------------- */

const AsistenciaAlumno = ({ alumnoId, asistencias, onChange }) => {
    const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
    const mapa = useMemo(() => {
        const m = {};
        asistencias.forEach((a) => {
            m[a.fecha] = a;
        });
        return m;
    }, [asistencias]);

    const [año, mesNum] = mes.split('-').map(Number);
    const primero = new Date(año, mesNum - 1, 1);
    const dias = new Date(año, mesNum, 0).getDate();
    const offset = (primero.getDay() + 6) % 7;

    const marcar = async (fecha) => {
        const actual = mapa[fecha];
        if (!actual) await createRec('asistencias', { alumno_id: alumnoId, fecha, presente: true });
        else if (actual.presente) await updateRec('asistencias', actual.id, { presente: false });
        else await removeRec('asistencias', actual.id);
        onChange();
    };

    const presentes = asistencias.filter((a) => a.presente && a.fecha.startsWith(mes)).length;
    const ausentes = asistencias.filter((a) => !a.presente && a.fecha.startsWith(mes)).length;

    // % sobre los días REGISTRADOS del mes, no sobre los días del mes: un día
    // sin registro no es una falta (nadie lo marcó), así que meterlo en el
    // divisor haría que el porcentaje baje solo por días que el profesor no
    // tocó. Sin registros en el mes no hay porcentaje que mostrar.
    const registrados = presentes + ausentes;
    const porcentaje = registrados > 0 ? Math.round((presentes / registrados) * 100) : null;

    // Faltas seguidas contando desde el registro más reciente hacia atrás,
    // sobre todo el historial (no solo el mes que se está mirando). Corta en
    // el primer presente. Igual que arriba, los días sin registro no cuentan
    // como falta: solo lo que el profesor marcó ausente expresamente.
    const rachaFaltas = useMemo(() => {
        const ordenadas = [...asistencias].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        let racha = 0;
        for (const a of ordenadas) {
            if (a.presente) break;
            racha += 1;
        }
        return racha;
    }, [asistencias]);

    return (
        <Card>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="font-display text-lg font-bold">Calendario de asistencia</h3>
                    <p className="text-xs text-muted-foreground">
                        Un clic: presente. Dos: ausente. Tres: sin registro.
                    </p>
                </div>
                <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-auto" />
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] uppercase text-muted-foreground">
                {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'].map((d) => (
                    <span key={d}>{d}</span>
                ))}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
                {Array.from({ length: offset }).map((_, i) => (
                    <span key={`x${i}`} />
                ))}
                {Array.from({ length: dias }).map((_, i) => {
                    const dia = String(i + 1).padStart(2, '0');
                    const fecha = `${mes}-${dia}`;
                    const reg = mapa[fecha];
                    const estilo = !reg
                        ? 'border-border text-muted-foreground hover:border-primary'
                        : reg.presente
                          ? 'border-transparent bg-[hsl(var(--ok))] text-white'
                          : 'border-transparent bg-primary text-primary-foreground';
                    return (
                        <button
                            key={fecha}
                            type="button"
                            onClick={() => marcar(fecha)}
                            className={`aspect-square rounded-xl border text-sm font-semibold transition active:scale-95 ${estilo}`}
                        >
                            {i + 1}
                        </button>
                    );
                })}
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
                En el mes: <span className="font-bold text-ok">{presentes} presentes</span> ·{' '}
                <span className="font-bold text-primary">{ausentes} ausentes</span>
                {porcentaje !== null && (
                    <>
                        {' · '}
                        <span className="font-bold text-foreground">{porcentaje}% de asistencia</span>
                    </>
                )}
            </p>
            {rachaFaltas > 0 && (
                <p className="mt-1 text-sm text-warn">
                    {rachaFaltas === 1 ? 'Viene de 1 falta' : `Viene de ${rachaFaltas} faltas seguidas`}.
                </p>
            )}
        </Card>
    );
};

/* ---------------- Pagos del alumno ---------------- */

// Registrar/cobrar un pago vive SOLO en Pagos (PagosPage.jsx) desde acá.
// Antes esta ficha tenía su PROPIO formulario de pago, más viejo e
// incompleto: sin pago parcial (monto_adeudado), sin "activar sin cobrar",
// sin comprobante numerado, adivinaba la duración del período comparando
// contra 4 strings fijos en vez de usar configuracion_periodos, y calculaba
// el estado de cuota con estadoDesdeVencimiento() (3 estados, sin la config
// de días de gracia/aviso del gimnasio) en vez de estadoCuota() (6 estados,
// la misma que ya usan Pagos/Dashboard/la campanita de notificaciones). Podía
// mostrar "Atrasado" ACÁ y "Con deuda" en Pagos para el MISMO alumno al mismo
// tiempo -- inconsistencia real, no cosmética.
//
// Se saca la duplicación: "Registrar pago" manda a Pagos con el alumno ya
// elegido (reusa ahí todo lo bueno, comprobante incluido) y acá queda una
// vista de estado + historial en modo lectura, con el mismo cálculo que el
// resto de la app.
const PagosAlumno = ({ alumnoId, pagos, config, onChange }) => {
    const navigate = useNavigate();
    const ultimo = pagos[0];
    const estado = estadoCuota(ultimo, config);

    return (
        <div className="space-y-5">
            <Card>
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Estado de cuota
                        </p>
                        <p className="mt-2 font-display text-2xl font-extrabold">{ESTADOS_PAGO[estado].label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {ultimo
                                ? `Último pago ${fmtFecha(ultimo.fecha_pago)} · cubre hasta ${fmtFecha(ultimo.periodo_hasta)}`
                                : 'Sin pagos registrados'}
                        </p>
                    </div>
                    <Btn onClick={() => navigate(`/pagos?alumno=${alumnoId}`)}>
                        <Plus className="h-4 w-4" /> Registrar pago
                    </Btn>
                </div>
            </Card>

            <Card>
                <h3 className="mb-3 font-display text-lg font-bold">Historial de pagos</h3>
                {pagos.length === 0 ? (
                    <Empty>Sin pagos registrados para este alumno.</Empty>
                ) : (
                    <ul className="divide-y divide-border">
                        {pagos.map((p) => (
                            <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                                <div>
                                    <p className="text-sm font-bold">{money(p.monto)}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {fmtFecha(p.fecha_pago)} · {fmtFecha(p.periodo_desde)} a{' '}
                                        {fmtFecha(p.periodo_hasta)} · {p.metodo || 'Efectivo'}
                                    </p>
                                    {p.notas && <p className="text-xs text-muted-foreground">{p.notas}</p>}
                                    {Number(p.monto_adeudado || 0) > 0 && (
                                        <p className="text-xs font-semibold text-warn">
                                            Debe {money(p.monto_adeudado)}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge className={ESTADOS_PAGO[estadoCuota(p, config)].className}>
                                        {ESTADOS_PAGO[estadoCuota(p, config)].label}
                                    </Badge>
                                    <button
                                        type="button"
                                        aria-label="Eliminar pago"
                                        onClick={() => removeRec('pagos', p.id).then(onChange)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-primary"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
};

/* ---------------- QR de acceso del alumno ---------------- */

// Mismo patrón que la sección "Código de invitación" de ConfiguracionPage.jsx
// (QR client-side con la librería qrcode, fondo blanco fijo, descarga y
// regenerar), pero acá el código es individual por alumno (codigo_acceso,
// migración 0006) en vez de uno solo por gimnasio. La RPC pública que lee
// ese código (ver_plan_por_codigo) no requiere sesión: por eso el link
// apunta a /mi-plan/:codigo, la pantalla que el alumno abre desde el QR.
const QrAlumno = ({ alumno, onRegenerado }) => {
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [copiado, setCopiado] = useState(false);
    const [regenerando, setRegenerando] = useState(false);
    const [qrError, setQrError] = useState('');

    const link = alumno?.codigo_acceso ? `${window.location.origin}/mi-plan/${alumno.codigo_acceso}` : '';

    useEffect(() => {
        if (!link) {
            setQrDataUrl('');
            return;
        }
        let cancelado = false;
        QRCode.toDataURL(link, { width: 240 })
            .then((url) => {
                if (!cancelado) setQrDataUrl(url);
            })
            .catch(() => {
                if (!cancelado) setQrDataUrl('');
            });
        return () => {
            cancelado = true;
        };
    }, [link]);

    const copiarLink = async () => {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
        } catch (_) {
            setQrError('No se pudo copiar el link. Copialo a mano.');
        }
    };

    const regenerar = async () => {
        if (!alumno?.id) return;
        if (
            !window.confirm(
                '¿Seguro que quiere regenerar el código? El QR y el link ya compartidos con este alumno dejan de funcionar al toque.',
            )
        ) {
            return;
        }
        setRegenerando(true);
        setQrError('');
        try {
            const { data: nuevoCodigo, error: err } = await supabase.rpc('regenerar_codigo_acceso_alumno', {
                p_alumno_id: alumno.id,
            });
            if (err) throw err;
            onRegenerado(nuevoCodigo);
        } catch (_) {
            setQrError('No se pudo regenerar el código.');
        } finally {
            setRegenerando(false);
        }
    };

    return (
        <Card className="mb-6">
            <h2 className="font-display text-lg font-bold">QR para el alumno</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Imprimir o enviarle este QR al alumno para que vea su rutina y su plan desde el celular, sin
                necesidad de usuario ni contraseña.
            </p>

            {!alumno?.codigo_acceso ? (
                <div className="mt-4">
                    <Empty>Este alumno todavía no tiene un código de acceso propio.</Empty>
                </div>
            ) : (
                <div className="mt-4 grid gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                        <Field label="Link del alumno">
                            <div className="flex gap-2">
                                <Input readOnly value={link} className="font-mono text-xs" />
                                <Btn type="button" variant="ghost" onClick={copiarLink} className="shrink-0">
                                    {copiado ? '¡Copiado!' : 'Copiar'}
                                </Btn>
                            </div>
                        </Field>

                        <Btn type="button" variant="ghost" onClick={regenerar} disabled={regenerando}>
                            {regenerando ? 'Regenerando...' : 'Regenerar código'}
                        </Btn>

                        {qrError && <ErrorBox>{qrError}</ErrorBox>}
                    </div>

                    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-4">
                        {qrDataUrl ? (
                            <>
                                {/* Fondo blanco fijo a propósito (no bg-card): un QR necesita
                                    contraste real para escanear, no el tema claro/oscuro de la app. */}
                                <img
                                    src={qrDataUrl}
                                    alt="Código QR del alumno"
                                    className="h-48 w-48 rounded-lg bg-white p-2"
                                />
                                <a
                                    href={qrDataUrl}
                                    download={`qr-${(alumno.nombre || 'alumno').replace(/\s+/g, '-').toLowerCase()}.png`}
                                    className="text-sm font-semibold text-primary hover:underline"
                                >
                                    Descargar QR
                                </a>
                            </>
                        ) : (
                            <span className="text-sm text-muted-foreground">Generando QR...</span>
                        )}
                    </div>
                </div>
            )}
        </Card>
    );
};

/* ---------------- Ficha ---------------- */

const TABS = [
    ['entrenamiento', 'Entrenamiento'],
    ['nutricion', 'Nutrición'],
    ['progreso', 'Progreso'],
    ['asistencia', 'Asistencia'],
    ['pagos', 'Pagos'],
];

const AlumnoPage = () => {
    const { id } = useParams();
    // Permite llegar directo a una pestaña puntual (ej. desde la campanita de
    // notificaciones del header: "?tab=pagos" abre la ficha ya en Pagos, sin
    // que el profesor tenga que buscarla a mano).
    const [searchParams] = useSearchParams();
    const tabInicial = TABS.some(([valor]) => valor === searchParams.get('tab'))
        ? searchParams.get('tab')
        : 'entrenamiento';
    const [tab, setTab] = useState(tabInicial);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [data, setData] = useState({
        alumno: null,
        planEnt: null,
        historialRutinas: [],
        planAli: null,
        progreso: [],
        asistencias: [],
        pagos: [],
        config: null,
    });

    const cargar = async () => {
        try {
            // `config` trae dias_gracia_cuota/dias_aviso_vencimiento -- la
            // policy de gimnasios ya filtra por tenant (id = get_mi_gimnasio_id()),
            // así que no hace falta pasarle el id a mano acá. Con .single() en
            // vez de vía Promise.all porque un error acá (ej. RLS todavía sin
            // aplicar en un gimnasio recién creado) no tiene que tirar abajo el
            // resto de la ficha -- si falla, estadoCuota() cae a sus defaults
            // (0 días de gracia, 7 de aviso) en vez de romper la pantalla.
            const [alumnoRes, planAliRows, progreso, asistencias, pagos, gimnasioRes] = await Promise.all([
                supabase.from('alumnos').select('*').eq('id', id).single(),
                listAll('planes_alimentacion', { filters: { alumno_id: id }, sort: '-created_at' }),
                listAll('progreso', { filters: { alumno_id: id }, sort: '-fecha' }),
                listAll('asistencias', { filters: { alumno_id: id }, sort: '-fecha' }),
                listAll('pagos', { filters: { alumno_id: id }, sort: '-fecha_pago' }),
                supabase
                    .from('gimnasios')
                    .select('dias_gracia_cuota, dias_aviso_vencimiento')
                    .single()
                    .then((r) => r.data)
                    .catch(() => null),
            ]);
            if (alumnoRes.error) throw alumnoRes.error;
            // Se pide después y aparte del Promise.all de arriba a propósito:
            // depende del alumno recién cargado (necesita su id, que ya
            // tenemos por route param, pero conceptualmente es "lo próximo"
            // una vez que sabemos que el alumno existe) y trae dos tablas
            // relacionadas (rutinas_asignadas + rutinas) en cascada.
            const [planEnt, historialRutinas] = await Promise.all([
                cargarRutinaAsignada(id),
                cargarHistorialRutinas(id),
            ]);
            setData({
                alumno: alumnoRes.data,
                planEnt,
                historialRutinas,
                planAli: planAliRows[0] || null,
                progreso,
                asistencias,
                pagos,
                config: gimnasioRes,
            });
            setError('');
        } catch (_) {
            setError('No se pudo cargar la ficha del alumno.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        cargar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const { alumno } = data;

    return (
        <AppLayout>
            <Helmet>
                <title>{alumno ? `${alumno.nombre} | Gestión GYM Kairox IA` : 'Ficha del alumno | Gestión GYM Kairox IA'}</title>
                <meta
                    name="description"
                    content="Ficha completa del alumno: plan de entrenamiento, plan de alimentación, progreso, asistencia y pagos."
                />
            </Helmet>

            <Link
                to="/alumnos"
                className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-primary"
            >
                <ArrowLeft className="h-4 w-4" /> Volver a alumnos
            </Link>

            {error && <ErrorBox>{error}</ErrorBox>}

            {loading ? (
                <Loading rows={5} />
            ) : (
                alumno && (
                    <>
                        <div className="mb-6 flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-card p-6">
                            {alumno.foto_url ? (
                                <img src={alumno.foto_url} alt={alumno.nombre} className="h-20 w-20 rounded-2xl object-cover" />
                            ) : (
                                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary">
                                    <UserRound className="h-8 w-8 text-muted-foreground" />
                                </div>
                            )}
                            <div className="min-w-0">
                                <h1 className="font-display text-3xl font-extrabold uppercase">{alumno.nombre}</h1>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {antiguedad(alumno.fecha_alta)} · Alta {fmtFecha(alumno.fecha_alta)}
                                    {alumno.contacto ? ` · ${alumno.contacto}` : ''}
                                </p>
                            </div>
                            <Badge className={`ml-auto ${ESTADOS_ALUMNO[estadoAlumno(alumno)].className}`}>
                                {ESTADOS_ALUMNO[estadoAlumno(alumno)].label}
                            </Badge>
                        </div>

                        {alumno.observaciones_salud && (
                            <div className="mb-6 rounded-2xl border border-primary/50 bg-primary/10 p-4 text-sm">
                                <p className="font-bold uppercase tracking-wide text-primary">Observaciones de salud</p>
                                <p className="mt-1">{alumno.observaciones_salud}</p>
                            </div>
                        )}

                        {(alumno.email || alumno.dni || alumno.fecha_nacimiento || alumno.contacto_emergencia || alumno.objetivo) && (
                            <Card className="mb-6">
                                <h2 className="mb-3 font-display text-lg font-bold">Datos personales</h2>
                                <dl className="grid gap-3 sm:grid-cols-2">
                                    {alumno.email && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Correo
                                            </dt>
                                            <dd className="text-sm">{alumno.email}</dd>
                                        </div>
                                    )}
                                    {alumno.dni && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                DNI
                                            </dt>
                                            <dd className="text-sm">{alumno.dni}</dd>
                                        </div>
                                    )}
                                    {alumno.fecha_nacimiento && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Fecha de nacimiento
                                            </dt>
                                            <dd className="text-sm">{fmtFecha(alumno.fecha_nacimiento)}</dd>
                                        </div>
                                    )}
                                    {alumno.contacto_emergencia && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Contacto de emergencia
                                            </dt>
                                            <dd className="text-sm">{alumno.contacto_emergencia}</dd>
                                        </div>
                                    )}
                                    {alumno.objetivo && (
                                        <div className="sm:col-span-2">
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Objetivo
                                            </dt>
                                            <dd className="text-sm">{alumno.objetivo}</dd>
                                        </div>
                                    )}
                                </dl>
                            </Card>
                        )}

                        <QrAlumno
                            alumno={alumno}
                            onRegenerado={(nuevoCodigo) =>
                                setData((d) => ({ ...d, alumno: { ...d.alumno, codigo_acceso: nuevoCodigo } }))
                            }
                        />

                        <div className="mb-6 flex flex-wrap gap-2">
                            {TABS.map(([key, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setTab(key)}
                                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                                        tab === key
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'border-border text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {tab === 'entrenamiento' && (
                            <PlanEntrenamiento
                                alumnoId={id}
                                alumnoNombre={data.alumno?.nombre}
                                plan={data.planEnt}
                                historial={data.historialRutinas}
                                onSaved={cargar}
                            />
                        )}
                        {tab === 'nutricion' && (
                            <PlanAlimentacion
                                alumnoId={id}
                                alumnoNombre={data.alumno?.nombre}
                                plan={data.planAli}
                                onSaved={cargar}
                            />
                        )}
                        {tab === 'progreso' && (
                            <Progreso alumnoId={id} registros={data.progreso} onChange={cargar} />
                        )}
                        {tab === 'asistencia' && (
                            <AsistenciaAlumno alumnoId={id} asistencias={data.asistencias} onChange={cargar} />
                        )}
                        {tab === 'pagos' && (
                            <PagosAlumno alumnoId={id} pagos={data.pagos} config={data.config} onChange={cargar} />
                        )}
                    </>
                )
            )}
        </AppLayout>
    );
};

export default AlumnoPage;
