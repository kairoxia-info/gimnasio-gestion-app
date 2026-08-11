import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Empty, ErrorBox, Field, Input, Loading, Modal, Select } from '@/components/ui-kit';
import { createRec, listAll, money, removeRec, updateRec } from '@/lib/data';

const PERIODOS = ['Diario', 'Semanal', 'Mensual', 'Trimestral', 'Anual'];

const vacio = {
    nombre: '',
    precio: '',
    periodo: 'Mensual',
    dias_semana: 3,
    descuento: '',
    interes_mora: '',
    activo: true,
};

const ConfiguracionPage = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);

    const cargar = () => {
        listAll('configuracion_precios', { sort: 'nombre' })
            .then((r) => {
                setItems(r);
                setError('');
            })
            .catch(() => setError('No se pudo cargar la configuración de precios.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        const payload = {
            ...form,
            precio: Number(form.precio || 0),
            dias_semana: Number(form.dias_semana || 0),
            descuento: Number(form.descuento || 0),
            interes_mora: Number(form.interes_mora || 0),
        };
        try {
            if (editId) await updateRec('configuracion_precios', editId, payload);
            else await createRec('configuracion_precios', payload);
            setOpen(false);
            cargar();
        } catch (_) {
            setError('No se pudo guardar el plan.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppLayout
            title="Planes y precios"
            subtitle="Definí libremente tus planes, precios, descuentos y el interés por mora que se aplica al registrar un pago."
            actions={
                <Btn
                    onClick={() => {
                        setForm(vacio);
                        setEditId(null);
                        setOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4" /> Nuevo plan
                </Btn>
            }
        >
            <Helmet>
                <title>Planes y precios | Fitness Gym Place</title>
                <meta
                    name="description"
                    content="Configuración editable de planes del gimnasio: precios, períodos, descuentos y porcentaje de interés por mora."
                />
            </Helmet>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={3} />
            ) : items.length === 0 ? (
                <Empty>No hay planes configurados todavía.</Empty>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {items.map((p) => (
                        <div key={p.id} className="flex flex-col rounded-2xl border border-border bg-card p-5">
                            <div className="flex items-start justify-between gap-3">
                                <h2 className="font-display text-lg font-bold">{p.nombre}</h2>
                                <Badge className={p.activo ? 'text-ok border-current' : 'border-border text-muted-foreground'}>
                                    {p.activo ? 'Activo' : 'Pausado'}
                                </Badge>
                            </div>
                            <p className="mt-4 font-display text-3xl font-extrabold text-primary">{money(p.precio)}</p>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                {p.periodo} · {p.dias_semana || 0} días por semana
                            </p>
                            <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                                <li>Descuento: {p.descuento || 0}%</li>
                                <li>Interés por mora: {p.interes_mora || 0}%</li>
                            </ul>
                            <div className="mt-5 flex gap-2">
                                <Btn
                                    variant="ghost"
                                    className="px-3 py-2 text-xs"
                                    onClick={() => {
                                        setForm({
                                            nombre: p.nombre || '',
                                            precio: p.precio ?? '',
                                            periodo: p.periodo || 'Mensual',
                                            dias_semana: p.dias_semana ?? 3,
                                            descuento: p.descuento ?? '',
                                            interes_mora: p.interes_mora ?? '',
                                            activo: !!p.activo,
                                        });
                                        setEditId(p.id);
                                        setOpen(true);
                                    }}
                                >
                                    Editar
                                </Btn>
                                <Btn
                                    variant="danger"
                                    className="px-3 py-2 text-xs"
                                    onClick={() => removeRec('configuracion_precios', p.id).then(cargar)}
                                >
                                    Eliminar
                                </Btn>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Editar plan' : 'Nuevo plan'}>
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Nombre del plan">
                        <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Precio">
                            <Input
                                type="number"
                                value={form.precio}
                                onChange={(e) => setForm({ ...form, precio: e.target.value })}
                                required
                            />
                        </Field>
                        <Field label="Período">
                            <Select value={form.periodo} onChange={(e) => setForm({ ...form, periodo: e.target.value })}>
                                {PERIODOS.map((p) => (
                                    <option key={p} value={p}>
                                        {p}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Días por semana">
                            <Input
                                type="number"
                                value={form.dias_semana}
                                onChange={(e) => setForm({ ...form, dias_semana: e.target.value })}
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
                                value={form.interes_mora}
                                onChange={(e) => setForm({ ...form, interes_mora: e.target.value })}
                            />
                        </Field>
                    </div>
                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={form.activo}
                            onChange={(e) => setForm({ ...form, activo: e.target.checked })}
                            className="h-4 w-4 accent-[hsl(var(--primary))]"
                        />
                        Plan activo
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

export default ConfiguracionPage;
