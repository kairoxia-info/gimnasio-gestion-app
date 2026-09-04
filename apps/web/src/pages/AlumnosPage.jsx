import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { Info, Plus, Search, UserRound, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { ESTADOS_ALUMNO, antiguedad, estadoAlumno, fmtFecha, hoy } from '@/lib/format';

const vacio = {
    nombre: '',
    contacto: '',
    email: '',
    fecha_alta: hoy(),
    fecha_nacimiento: '',
    dni: '',
    contacto_emergencia: '',
    objetivo: '',
    foto_url: '',
    activo: true,
    pendiente: false,
    observaciones_salud: '',
    plan_precio_nombre: '',
};

// Texto de referencia para el ícono de info: qué significa cada estado, en
// las palabras de Nalux. "Pendiente" cubre dos orígenes a propósito — ver
// estadoAlumno() en format.js.
const AYUDA_ESTADOS = [
    ['activo', 'Está entrenando. Cuenta en las estadísticas y aparece en pagos/asistencia.'],
    [
        'pendiente',
        'Cargado pero todavía no arrancó — se autorregistró por QR y falta aprobarlo, o lo marcaste así a propósito (ej. "se anotó pero no vino todavía").',
    ],
    ['inactivo', 'Dado de baja, no entrena más por ahora.'],
];

const AlumnosPage = () => {
    const [alumnos, setAlumnos] = useState([]);
    const [planes, setPlanes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [q, setQ] = useState('');
    const [filtroEstado, setFiltroEstado] = useState('todos');
    const [mostrarAyudaEstados, setMostrarAyudaEstados] = useState(false);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);

    const cargar = () => {
        setLoading(true);
        Promise.all([listAll('alumnos', { sort: 'nombre' }), listAll('configuracion_precios', { sort: 'nombre' })])
            .then(([a, p]) => {
                setAlumnos(a);
                setPlanes(p);
                setError('');
            })
            .catch(() => setError('No se pudieron cargar los alumnos.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    const abrirNuevo = () => {
        setForm(vacio);
        setEditId(null);
        setOpen(true);
    };

    const abrirEditar = (a) => {
        setForm({
            nombre: a.nombre || '',
            contacto: a.contacto || '',
            email: a.email || '',
            fecha_alta: String(a.fecha_alta || '').slice(0, 10) || hoy(),
            fecha_nacimiento: String(a.fecha_nacimiento || '').slice(0, 10),
            dni: a.dni || '',
            contacto_emergencia: a.contacto_emergencia || '',
            objetivo: a.objetivo || '',
            foto_url: a.foto_url || '',
            activo: !!a.activo,
            pendiente: !!a.pendiente,
            observaciones_salud: a.observaciones_salud || '',
            plan_precio_nombre: a.plan_precio_nombre || '',
        });
        setEditId(a.id);
        setOpen(true);
    };

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            // fecha_nacimiento es opcional y es DATE en la base: un '' (el
            // input vacío) rompe el insert/update ("invalid input syntax for
            // type date"), a diferencia de un campo TEXT donde '' es válido.
            // Postgres sí acepta null.
            const payload = { ...form, fecha_nacimiento: form.fecha_nacimiento || null };
            if (editId) await updateRec('alumnos', editId, payload);
            else await createRec('alumnos', payload);
            setOpen(false);
            cargar();
        } catch (_) {
            setError('No se pudo guardar el alumno.');
        } finally {
            setSaving(false);
        }
    };

    const borrar = async (id) => {
        await removeRec('alumnos', id);
        cargar();
    };

    const filtrados = alumnos.filter((a) => {
        if (filtroEstado !== 'todos' && estadoAlumno(a) !== filtroEstado) return false;
        if (q.trim() && !a.nombre?.toLowerCase().includes(q.trim().toLowerCase())) return false;
        return true;
    });

    // Cuánta gente hay en cada estado, para mostrarlo directo en el chip del
    // filtro (Nalux pidió que activo/inactivo/pendiente sea "más accesible y
    // fácil de mostrar" sin tener que clickear cada chip para enterarse).
    const conteos = useMemo(() => {
        const c = { todos: alumnos.length, activo: 0, pendiente: 0, inactivo: 0 };
        alumnos.forEach((a) => {
            c[estadoAlumno(a)] += 1;
        });
        return c;
    }, [alumnos]);

    return (
        <AppLayout
            title={
                <span className="inline-flex flex-wrap items-center gap-3">
                    Alumnos
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-bold normal-case text-primary">
                        {alumnos.length} {alumnos.length === 1 ? 'alumno' : 'alumnos'}
                    </span>
                </span>
            }
            subtitle="Ficha de cada alumno con estado, antigüedad y observaciones de salud."
            actions={
                <Btn onClick={abrirNuevo}>
                    <Plus className="h-4 w-4" /> Nuevo alumno
                </Btn>
            }
        >
            <Helmet>
                <title>Alumnos | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Listado de alumnos del gimnasio con estado, antigüedad, contacto y observaciones de salud."
                />
            </Helmet>

            <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar alumno"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
            </div>

            <div className="relative mb-6 flex flex-wrap items-center gap-2">
                {[
                    ['todos', 'Todos'],
                    ['activo', 'Activos'],
                    ['pendiente', 'Pendientes'],
                    ['inactivo', 'Inactivos'],
                ].map(([valor, etiqueta]) => (
                    <button
                        key={valor}
                        type="button"
                        onClick={() => setFiltroEstado(valor)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                            filtroEstado === valor
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {valor === 'pendiente' && conteos.pendiente > 0 && filtroEstado !== 'pendiente' && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                        )}
                        {etiqueta} ({conteos[valor]})
                    </button>
                ))}

                <button
                    type="button"
                    onClick={() => setMostrarAyudaEstados((v) => !v)}
                    aria-expanded={mostrarAyudaEstados}
                    aria-label="Qué significa cada estado"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:border-primary hover:text-primary"
                >
                    <Info className="h-4 w-4" aria-hidden="true" />
                </button>

                {mostrarAyudaEstados && (
                    <div className="absolute left-0 top-full z-10 mt-2 w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-sm font-bold">Qué significa cada estado</p>
                            <button
                                type="button"
                                onClick={() => setMostrarAyudaEstados(false)}
                                aria-label="Cerrar"
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border"
                            >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        </div>
                        <dl className="space-y-3">
                            {AYUDA_ESTADOS.map(([valor, texto]) => (
                                <div key={valor}>
                                    <dt className={`text-xs font-bold ${ESTADOS_ALUMNO[valor].className.split(' ')[0]}`}>
                                        {ESTADOS_ALUMNO[valor].label}
                                    </dt>
                                    <dd className="mt-0.5 text-xs text-muted-foreground">{texto}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                )}
            </div>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={4} />
            ) : filtrados.length === 0 ? (
                <Empty>
                    {alumnos.length === 0 ? (
                        <>Todavía no hay alumnos cargados. Empezar con el botón &ldquo;Nuevo alumno&rdquo;.</>
                    ) : (
                        'No hay alumnos que coincidan con estos filtros.'
                    )}
                </Empty>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filtrados.map((a) => (
                        <div
                            key={a.id}
                            className="flex flex-col rounded-2xl border border-border bg-card p-5 transition hover:border-primary"
                        >
                            <div className="flex items-start gap-4">
                                {a.foto_url ? (
                                    <img
                                        src={a.foto_url}
                                        alt={a.nombre}
                                        className="h-14 w-14 rounded-xl object-cover"
                                    />
                                ) : (
                                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary">
                                        <UserRound className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-display text-lg font-bold">{a.nombre}</p>
                                    <p className="text-xs text-muted-foreground">{antiguedad(a.fecha_alta)}</p>
                                </div>
                                <Badge className={ESTADOS_ALUMNO[estadoAlumno(a)].className}>
                                    {ESTADOS_ALUMNO[estadoAlumno(a)].label}
                                </Badge>
                            </div>

                            <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
                                <div>Alta: {fmtFecha(a.fecha_alta)}</div>
                                {a.contacto && <div>Contacto: {a.contacto}</div>}
                                {a.email && <div>Correo: {a.email}</div>}
                                {a.plan_precio_nombre && <div>Plan: {a.plan_precio_nombre}</div>}
                                {a.objetivo && <div>Objetivo: {a.objetivo}</div>}
                            </dl>

                            {a.observaciones_salud && (
                                <p className="mt-3 rounded-xl border border-primary/40 bg-primary/10 p-3 text-xs">
                                    Salud: {a.observaciones_salud}
                                </p>
                            )}

                            <div className="mt-5 flex flex-wrap gap-2">
                                <Link
                                    to={`/alumnos/${a.id}`}
                                    className="inline-flex items-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                                >
                                    Abrir ficha
                                </Link>
                                <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirEditar(a)}>
                                    Editar
                                </Btn>
                                {estadoAlumno(a) === 'pendiente' && (
                                    <Btn
                                        className="px-3 py-2 text-xs"
                                        onClick={() =>
                                            updateRec('alumnos', a.id, { activo: true, pendiente: false }).then(cargar)
                                        }
                                    >
                                        Activar
                                    </Btn>
                                )}
                                <Btn variant="danger" className="px-3 py-2 text-xs" onClick={() => borrar(a.id)}>
                                    Eliminar
                                </Btn>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Editar alumno' : 'Nuevo alumno'}>
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Nombre y apellido">
                        <Input
                            value={form.nombre}
                            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                            required
                        />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Teléfono / contacto">
                            <Input
                                value={form.contacto}
                                onChange={(e) => setForm({ ...form, contacto: e.target.value })}
                            />
                        </Field>
                        <Field label="Correo">
                            <Input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                            />
                        </Field>
                        <Field label="Fecha de alta">
                            <Input
                                type="date"
                                value={form.fecha_alta}
                                onChange={(e) => setForm({ ...form, fecha_alta: e.target.value })}
                            />
                        </Field>
                        <Field label="Plan contratado">
                            <Select
                                value={form.plan_precio_nombre}
                                onChange={(e) => setForm({ ...form, plan_precio_nombre: e.target.value })}
                            >
                                <option value="">Sin plan asignado</option>
                                {planes.map((p) => (
                                    <option key={p.id} value={p.nombre}>
                                        {p.nombre}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Fecha de nacimiento (opcional)">
                            <Input
                                type="date"
                                value={form.fecha_nacimiento}
                                onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })}
                            />
                            <span className="text-xs text-muted-foreground">
                                Para el aviso de cumpleaños en el panel general.
                            </span>
                        </Field>
                        <Field label="DNI (opcional)">
                            <Input
                                value={form.dni}
                                onChange={(e) => setForm({ ...form, dni: e.target.value })}
                            />
                        </Field>
                        <Field label="Contacto de emergencia (opcional)">
                            <Input
                                value={form.contacto_emergencia}
                                onChange={(e) => setForm({ ...form, contacto_emergencia: e.target.value })}
                                placeholder="Nombre y teléfono"
                            />
                        </Field>
                        <Field label="Objetivo (opcional)">
                            <Input
                                value={form.objetivo}
                                onChange={(e) => setForm({ ...form, objetivo: e.target.value })}
                                placeholder="Bajar de peso, ganar masa muscular..."
                            />
                        </Field>
                    </div>
                    <Field label="Foto (URL opcional)">
                        <Input
                            value={form.foto_url}
                            onChange={(e) => setForm({ ...form, foto_url: e.target.value })}
                            placeholder="https://..."
                        />
                    </Field>
                    <Field label="Observaciones de salud, lesiones o restricciones">
                        <Textarea
                            value={form.observaciones_salud}
                            onChange={(e) => setForm({ ...form, observaciones_salud: e.target.value })}
                        />
                    </Field>
                    <Field label="Estado">
                        <div className="flex flex-wrap gap-2">
                            {['activo', 'pendiente', 'inactivo'].map((valor) => {
                                const seleccionado = estadoAlumno(form) === valor;
                                return (
                                    <button
                                        key={valor}
                                        type="button"
                                        onClick={() =>
                                            setForm((f) => ({
                                                ...f,
                                                activo: valor === 'activo',
                                                pendiente: valor === 'pendiente',
                                            }))
                                        }
                                        aria-pressed={seleccionado}
                                        className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                                            seleccionado
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'border-border text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        {ESTADOS_ALUMNO[valor].label}
                                    </button>
                                );
                            })}
                        </div>
                        <span className="text-xs text-muted-foreground">
                            &ldquo;Pendiente&rdquo; sirve tanto para alguien que se autorregistró por QR (falta
                            aprobarlo) como para alguien cargado manualmente que todavía no arrancó.
                        </span>
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpen(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Btn>
                    </div>
                </form>
            </Modal>
        </AppLayout>
    );
};

export default AlumnosPage;
