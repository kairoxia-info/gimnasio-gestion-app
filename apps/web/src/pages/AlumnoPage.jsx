import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, UserRound } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import supabase from '@/lib/supabaseClient';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { COMIDAS, ESTADOS_PAGO, antiguedad, estadoDesdeVencimiento, fmtFecha, hoy, money } from '@/lib/format';

// rutinas es la plantilla (nombre/descripcion/duracion_semanas/items),
// rutinas_asignadas es el vínculo con el alumno. Acá se trae la asignación
// más reciente (activa si hay varias) y se combina con su rutina en un solo
// objeto para que PlanEntrenamiento no tenga que saber nada del modelo de
// dos tablas.
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
    const rutinas = await listAll('rutinas', { filters: { id: asignacion.rutina_id } });
    const rutina = rutinas[0];
    if (!rutina) return null;
    return {
        asignacionId: asignacion.id,
        rutinaId: rutina.id,
        nombre: rutina.nombre,
        descripcion: rutina.descripcion,
        duracionSemanas: rutina.duracion_semanas,
        items: rutina.items || [],
    };
};

/* ---------------- Plan de entrenamiento ---------------- */

// Desde el Bloque G, las rutinas son plantillas de la biblioteca compartidas
// por varios alumnos (rutinas + rutinas_asignadas) — este componente ya NO
// edita la plantilla en línea (eso pisaría la rutina de todos los demás
// alumnos que también la tienen asignada). Acá solo se lee en modo
// solo-lectura y se reasigna: cambiar de rutina desactiva la asignación
// vieja (no la borra, queda como historial) y crea una nueva. Armar o editar
// el contenido de una rutina vive únicamente en RutinasPage.
const PlanEntrenamiento = ({ alumnoId, plan, onSaved }) => {
    const [cambiando, setCambiando] = useState(false);
    const [rutinasDisponibles, setRutinasDisponibles] = useState([]);
    const [cargandoRutinas, setCargandoRutinas] = useState(false);
    const [rutinaElegida, setRutinaElegida] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    const abrirSelector = () => {
        setMsg('');
        setCambiando(true);
        setCargandoRutinas(true);
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
        setSaving(true);
        setMsg('');
        try {
            if (plan?.asignacionId) {
                // No se borra: queda desactivada como historial.
                await updateRec('rutinas_asignadas', plan.asignacionId, { activa: false });
            }
            await createRec('rutinas_asignadas', { rutina_id: rutinaElegida, alumno_id: alumnoId });
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

    const porDia = useMemo(() => {
        const map = {};
        (plan?.items || []).forEach((it) => {
            map[it.dia] = map[it.dia] || [];
            map[it.dia].push(it);
        });
        return map;
    }, [plan]);

    if (!plan) {
        return (
            <Empty>
                Este alumno todavía no tiene una rutina asignada. Armala o asignala desde la{' '}
                <Link to="/rutinas" className="font-semibold text-primary">
                    biblioteca de rutinas
                </Link>
                .
            </Empty>
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
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={abrirSelector}>
                            Cambiar rutina
                        </Btn>
                        <Btn variant="danger" className="px-3 py-2 text-xs" onClick={quitar} disabled={saving}>
                            Quitar rutina
                        </Btn>
                    </div>
                </div>
                {msg && !cambiando && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
            </Card>

            {(plan.items || []).length === 0 ? (
                <Empty>Esta rutina todavía no tiene ejercicios cargados.</Empty>
            ) : (
                <div className="space-y-4">
                    {Object.entries(porDia).map(([d, lista]) => (
                        <Card key={d}>
                            <div className="mb-3 flex items-center justify-between">
                                <h3 className="font-display text-lg font-bold uppercase">{d}</h3>
                                <Badge className="border-border text-muted-foreground">
                                    {lista.length} ejercicios
                                </Badge>
                            </div>
                            <div className="space-y-2">
                                {lista.map((it) => (
                                    <div
                                        key={it.key}
                                        className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[2fr,repeat(4,minmax(0,1fr))]"
                                    >
                                        <div>
                                            <p className="text-sm font-bold">{it.nombre}</p>
                                            <p className="text-xs text-muted-foreground">{it.grupo}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Series</p>
                                            <p className="text-sm font-semibold">{it.series}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Reps</p>
                                            <p className="text-sm font-semibold">{it.reps}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Peso</p>
                                            <p className="text-sm font-semibold">{it.peso || '—'}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                                Descanso
                                            </p>
                                            <p className="text-sm font-semibold">{it.descanso || '—'}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <Modal open={cambiando} onClose={() => setCambiando(false)} title="Cambiar rutina asignada">
                <div className="space-y-4">
                    {cargandoRutinas ? (
                        <Loading rows={2} />
                    ) : rutinasDisponibles.length === 0 ? (
                        <Empty>
                            No hay rutinas en la biblioteca todavía. Armá una desde{' '}
                            <Link to="/rutinas" className="font-semibold text-primary">
                                Rutinas
                            </Link>
                            .
                        </Empty>
                    ) : (
                        <Field label="Rutina de la biblioteca">
                            <Select value={rutinaElegida} onChange={(e) => setRutinaElegida(e.target.value)}>
                                {rutinasDisponibles.map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.nombre}
                                    </option>
                                ))}
                            </Select>
                        </Field>
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
        </div>
    );
};

/* ---------------- Plan de alimentación ---------------- */

const PlanAlimentacion = ({ alumnoId, alimentos, plan, onSaved }) => {
    const [items, setItems] = useState(plan?.items || []);
    const [nombre, setNombre] = useState(plan?.nombre || 'Plan de alimentación');
    const [sel, setSel] = useState(alimentos[0]?.id || '');
    const [comida, setComida] = useState(COMIDAS[0]);
    const [cantidad, setCantidad] = useState('100');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    useEffect(() => {
        setItems(plan?.items || []);
        setNombre(plan?.nombre || 'Plan de alimentación');
    }, [plan]);

    const agregar = () => {
        const al = alimentos.find((a) => a.id === sel);
        if (!al) return;
        setItems([
            ...items,
            {
                key: `${al.id}-${Date.now()}`,
                alimentoId: al.id,
                nombre: al.nombre,
                unidad: al.unidad || '100 g',
                calorias: Number(al.calorias || 0),
                comida,
                cantidad: Number(cantidad || 0),
            },
        ]);
    };

    const guardar = async () => {
        setSaving(true);
        setMsg('');
        try {
            const payload = { alumno_id: alumnoId, nombre, items };
            if (plan?.id) await updateRec('planes_alimentacion', plan.id, payload);
            else await createRec('planes_alimentacion', payload);
            setMsg('Plan guardado.');
            onSaved();
        } catch (_) {
            setMsg('No se pudo guardar el plan.');
        } finally {
            setSaving(false);
        }
    };

    const totalKcal = items.reduce(
        (acc, it) => acc + (Number(it.calorias || 0) * Number(it.cantidad || 0)) / 100,
        0,
    );

    return (
        <div className="space-y-5">
            <Card>
                <Field label="Nombre del plan">
                    <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </Field>
                {alimentos.length === 0 ? (
                    <div className="mt-4">
                        <Empty>
                            Primero cargá alimentos en la{' '}
                            <Link to="/alimentos" className="font-semibold text-primary">
                                biblioteca
                            </Link>
                            .
                        </Empty>
                    </div>
                ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-[2fr,1fr,1fr,auto]">
                        <Field label="Alimento">
                            <Select value={sel} onChange={(e) => setSel(e.target.value)}>
                                {alimentos.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.nombre}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Comida">
                            <Select value={comida} onChange={(e) => setComida(e.target.value)}>
                                {COMIDAS.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Cantidad (g o unid.)">
                            <Input type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                        </Field>
                        <div className="flex items-end">
                            <Btn onClick={agregar} className="w-full sm:w-auto">
                                <Plus className="h-4 w-4" /> Agregar
                            </Btn>
                        </div>
                    </div>
                )}
            </Card>

            {items.length === 0 ? (
                <Empty>Todavía no agregaste alimentos a este plan.</Empty>
            ) : (
                <div className="space-y-4">
                    {COMIDAS.filter((c) => items.some((i) => i.comida === c)).map((c) => (
                        <Card key={c}>
                            <h3 className="mb-3 font-display text-lg font-bold uppercase">{c}</h3>
                            <ul className="divide-y divide-border">
                                {items
                                    .filter((i) => i.comida === c)
                                    .map((it) => (
                                        <li key={it.key} className="flex items-center justify-between gap-3 py-3">
                                            <div>
                                                <p className="text-sm font-semibold">{it.nombre}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {it.cantidad} g/unid. ·{' '}
                                                    {Math.round((Number(it.calorias) * Number(it.cantidad)) / 100)} kcal
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                aria-label="Quitar alimento"
                                                onClick={() => setItems(items.filter((x) => x.key !== it.key))}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-primary"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </li>
                                    ))}
                            </ul>
                        </Card>
                    ))}
                    <p className="text-sm text-muted-foreground">
                        Total estimado del día: <span className="font-bold text-foreground">{Math.round(totalKcal)} kcal</span>
                    </p>
                </div>
            )}

            <div className="flex items-center gap-3">
                <Btn onClick={guardar} disabled={saving}>
                    {saving ? 'Guardando...' : 'Guardar plan'}
                </Btn>
                {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
            </div>
        </div>
    );
};

/* ---------------- Progreso ---------------- */

const Progreso = ({ alumnoId, registros, onChange }) => {
    const [form, setForm] = useState({ fecha: hoy(), peso: '', cintura: '', pecho: '', brazo: '', observaciones: '' });
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
                pecho: Number(form.pecho || 0),
                brazo: Number(form.brazo || 0),
                observaciones: form.observaciones,
            });
            setForm({ fecha: hoy(), peso: '', cintura: '', pecho: '', brazo: '', observaciones: '' });
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
                        <Empty>Cargá al menos dos registros para ver el gráfico.</Empty>
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
                                            Cintura {r.cintura || 0} · Pecho {r.pecho || 0} · Brazo {r.brazo || 0}
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
            </p>
        </Card>
    );
};

/* ---------------- Pagos del alumno ---------------- */

const PagosAlumno = ({ alumnoId, pagos, precios, onChange }) => {
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({
        monto: '',
        fecha_pago: hoy(),
        periodo_desde: hoy(),
        periodo_hasta: hoy(),
        descuento: '',
        interes: '',
        metodo: 'Efectivo',
        notas: '',
    });
    const [saving, setSaving] = useState(false);

    const aplicarPlan = (nombre) => {
        const p = precios.find((x) => x.nombre === nombre);
        if (!p) return;
        const desde = new Date();
        const hasta = new Date();
        hasta.setMonth(hasta.getMonth() + (p.periodo === 'Trimestral' ? 3 : 1));
        setForm((f) => ({
            ...f,
            monto: String(p.precio || ''),
            descuento: String(p.descuento || ''),
            interes: String(p.interes_mora || ''),
            periodo_desde: desde.toISOString().slice(0, 10),
            periodo_hasta: hasta.toISOString().slice(0, 10),
            notas: p.nombre,
        }));
    };

    const total = useMemo(() => {
        const base = Number(form.monto || 0);
        const desc = (base * Number(form.descuento || 0)) / 100;
        const mora =
            new Date(form.periodo_desde) < new Date(form.fecha_pago)
                ? (base * Number(form.interes || 0)) / 100
                : 0;
        return Math.max(0, base - desc + mora);
    }, [form]);

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await createRec('pagos', {
                alumno_id: alumnoId,
                monto: total,
                fecha_pago: form.fecha_pago,
                periodo_desde: form.periodo_desde,
                periodo_hasta: form.periodo_hasta,
                estado: estadoDesdeVencimiento(form.periodo_hasta),
                descuento: Number(form.descuento || 0),
                interes: Number(form.interes || 0),
                metodo: form.metodo,
                notas: form.notas,
            });
            setOpen(false);
            onChange();
        } finally {
            setSaving(false);
        }
    };

    const ultimo = pagos[0];
    const estado = ultimo ? estadoDesdeVencimiento(ultimo.periodo_hasta) : 'vencido';

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
                    <Btn onClick={() => setOpen(true)}>
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
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge className={ESTADOS_PAGO[estadoDesdeVencimiento(p.periodo_hasta)].className}>
                                        {ESTADOS_PAGO[estadoDesdeVencimiento(p.periodo_hasta)].label}
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

            <Modal open={open} onClose={() => setOpen(false)} title="Registrar pago">
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Aplicar plan de precios">
                        <Select defaultValue="" onChange={(e) => aplicarPlan(e.target.value)}>
                            <option value="">Elegir plan...</option>
                            {precios.map((p) => (
                                <option key={p.id} value={p.nombre}>
                                    {p.nombre} · {money(p.precio)}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Monto base">
                            <Input
                                type="number"
                                value={form.monto}
                                onChange={(e) => setForm({ ...form, monto: e.target.value })}
                                required
                            />
                        </Field>
                        <Field label="Fecha de pago">
                            <Input
                                type="date"
                                value={form.fecha_pago}
                                onChange={(e) => setForm({ ...form, fecha_pago: e.target.value })}
                            />
                        </Field>
                        <Field label="Período desde">
                            <Input
                                type="date"
                                value={form.periodo_desde}
                                onChange={(e) => setForm({ ...form, periodo_desde: e.target.value })}
                            />
                        </Field>
                        <Field label="Período hasta">
                            <Input
                                type="date"
                                value={form.periodo_hasta}
                                onChange={(e) => setForm({ ...form, periodo_hasta: e.target.value })}
                            />
                        </Field>
                        <Field label="Descuento (%)">
                            <Input
                                type="number"
                                value={form.descuento}
                                onChange={(e) => setForm({ ...form, descuento: e.target.value })}
                            />
                        </Field>
                        <Field label="Interés por mora (%)">
                            <Input
                                type="number"
                                value={form.interes}
                                onChange={(e) => setForm({ ...form, interes: e.target.value })}
                            />
                        </Field>
                        <Field label="Método">
                            <Select value={form.metodo} onChange={(e) => setForm({ ...form, metodo: e.target.value })}>
                                {['Efectivo', 'Transferencia', 'Débito', 'Crédito'].map((m) => (
                                    <option key={m} value={m}>
                                        {m}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Referencia / notas">
                            <Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
                        </Field>
                    </div>
                    <p className="rounded-xl border border-border bg-secondary p-3 text-sm">
                        Total a registrar: <span className="font-bold">{money(total)}</span>
                    </p>
                    <div className="flex justify-end gap-2">
                        <Btn variant="ghost" onClick={() => setOpen(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Registrar'}
                        </Btn>
                    </div>
                </form>
            </Modal>
        </div>
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
    const [tab, setTab] = useState('entrenamiento');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [data, setData] = useState({
        alumno: null,
        alimentos: [],
        planEnt: null,
        planAli: null,
        progreso: [],
        asistencias: [],
        pagos: [],
        precios: [],
    });

    const cargar = async () => {
        try {
            const [alumnoRes, alimentos, planAliRows, progreso, asistencias, pagos, precios] = await Promise.all([
                supabase.from('alumnos').select('*').eq('id', id).single(),
                listAll('alimentos', { sort: 'nombre' }),
                listAll('planes_alimentacion', { filters: { alumno_id: id }, sort: '-created_at' }),
                listAll('progreso', { filters: { alumno_id: id }, sort: '-fecha' }),
                listAll('asistencias', { filters: { alumno_id: id }, sort: '-fecha' }),
                listAll('pagos', { filters: { alumno_id: id }, sort: '-fecha_pago' }),
                listAll('configuracion_precios', { sort: 'nombre' }),
            ]);
            if (alumnoRes.error) throw alumnoRes.error;
            // Se pide después y aparte del Promise.all de arriba a propósito:
            // depende del alumno recién cargado (necesita su id, que ya
            // tenemos por route param, pero conceptualmente es "lo próximo"
            // una vez que sabemos que el alumno existe) y trae dos tablas
            // relacionadas (rutinas_asignadas + rutinas) en cascada.
            const planEnt = await cargarRutinaAsignada(id);
            setData({
                alumno: alumnoRes.data,
                alimentos,
                planEnt,
                planAli: planAliRows[0] || null,
                progreso,
                asistencias,
                pagos,
                precios,
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
                            <Badge
                                className={`ml-auto ${alumno.activo ? 'text-ok border-current' : 'border-border text-muted-foreground'}`}
                            >
                                {alumno.activo ? 'Activo' : 'Inactivo'}
                            </Badge>
                        </div>

                        {alumno.observaciones_salud && (
                            <div className="mb-6 rounded-2xl border border-primary/50 bg-primary/10 p-4 text-sm">
                                <p className="font-bold uppercase tracking-wide text-primary">Observaciones de salud</p>
                                <p className="mt-1">{alumno.observaciones_salud}</p>
                            </div>
                        )}

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
                            <PlanEntrenamiento alumnoId={id} plan={data.planEnt} onSaved={cargar} />
                        )}
                        {tab === 'nutricion' && (
                            <PlanAlimentacion
                                alumnoId={id}
                                alimentos={data.alimentos}
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
                            <PagosAlumno alumnoId={id} pagos={data.pagos} precios={data.precios} onChange={cargar} />
                        )}
                    </>
                )
            )}
        </AppLayout>
    );
};

export default AlumnoPage;
