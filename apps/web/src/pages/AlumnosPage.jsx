import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { Plus, Search, UserRound } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { antiguedad, fmtFecha, hoy } from '@/lib/format';

const vacio = {
    nombre: '',
    contacto: '',
    email: '',
    fecha_alta: hoy(),
    foto_url: '',
    activo: true,
    observaciones_salud: '',
    plan_precio_nombre: '',
};

const AlumnosPage = () => {
    const [alumnos, setAlumnos] = useState([]);
    const [planes, setPlanes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [q, setQ] = useState('');
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
            foto_url: a.foto_url || '',
            activo: !!a.activo,
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
            if (editId) await updateRec('alumnos', editId, form);
            else await createRec('alumnos', form);
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

    const filtrados = alumnos.filter((a) => a.nombre?.toLowerCase().includes(q.toLowerCase()));

    return (
        <AppLayout
            title="Alumnos"
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

            <div className="mb-6 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar alumno"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
            </div>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={4} />
            ) : filtrados.length === 0 ? (
                <Empty>Todavía no hay alumnos cargados. Empezá con el botón &ldquo;Nuevo alumno&rdquo;.</Empty>
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
                                <Badge
                                    className={
                                        a.activo
                                            ? 'text-ok border-current'
                                            : a.origen === 'autorregistro'
                                              ? 'text-warn border-current'
                                              : 'text-muted-foreground border-border'
                                    }
                                >
                                    {a.activo ? 'Activo' : a.origen === 'autorregistro' ? 'Pendiente de aprobación' : 'Inactivo'}
                                </Badge>
                            </div>

                            <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
                                <div>Alta: {fmtFecha(a.fecha_alta)}</div>
                                {a.contacto && <div>Contacto: {a.contacto}</div>}
                                {a.plan_precio_nombre && <div>Plan: {a.plan_precio_nombre}</div>}
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
                                {a.origen === 'autorregistro' && !a.activo && (
                                    <Btn
                                        className="px-3 py-2 text-xs"
                                        onClick={() => updateRec('alumnos', a.id, { activo: true }).then(cargar)}
                                    >
                                        Aprobar
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
                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={form.activo}
                            onChange={(e) => setForm({ ...form, activo: e.target.checked })}
                            className="h-4 w-4 accent-[hsl(var(--primary))]"
                        />
                        Alumno activo
                    </label>
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
