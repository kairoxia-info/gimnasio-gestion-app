import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { money } from '@/lib/format';

// Los períodos ya no son una lista fija en el código: los carga el profesor
// desde esta misma pantalla (migración 0014). Esta constante queda solo como
// sugerencia para el gimnasio que todavía no cargó ninguno.
const PERIODOS_SUGERIDOS = [
    { nombre: 'Clase suelta', dias: 1 },
    { nombre: 'Diario', dias: 1 },
    { nombre: 'Semanal', dias: 7 },
    { nombre: 'Mensual', dias: 30 },
    { nombre: 'Trimestral', dias: 90 },
    { nombre: 'Anual', dias: 365 },
];

const vacio = {
    nombre: '',
    precio: '',
    periodo: '',
    dias_semana: 3,
    descuento: '',
    interes_mora: '',
    activo: true,
};

const vacioPeriodo = { nombre: '', dias: '', activo: true };
const vacioDescuento = { nombre: '', porcentaje: '', activo: true };

const PreciosPage = () => {
    const [items, setItems] = useState([]);
    const [periodos, setPeriodos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);

    const [openPeriodo, setOpenPeriodo] = useState(false);
    const [formPeriodo, setFormPeriodo] = useState(vacioPeriodo);
    const [editPeriodoId, setEditPeriodoId] = useState(null);
    const [savingPeriodo, setSavingPeriodo] = useState(false);

    const [descuentos, setDescuentos] = useState([]);
    const [openDescuento, setOpenDescuento] = useState(false);
    const [formDescuento, setFormDescuento] = useState(vacioDescuento);
    const [editDescuentoId, setEditDescuentoId] = useState(null);
    const [savingDescuento, setSavingDescuento] = useState(false);

    const cargar = () => {
        setLoading(true);
        return Promise.all([
            listAll('configuracion_precios'),
            listAll('configuracion_periodos'),
            listAll('configuracion_descuentos'),
        ])
            .then(([planes, pers, desc]) => {
                setItems(planes);
                setPeriodos(pers.sort((a, b) => Number(a.dias) - Number(b.dias)));
                setDescuentos(desc.sort((a, b) => a.nombre.localeCompare(b.nombre)));
                setError('');
            })
            .catch(() => setError('No se pudieron cargar los planes.'))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        cargar();
    }, []);

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
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
        } catch (err) {
            // Nombre repetido (dos planes no pueden llamarse igual en el mismo
            // gimnasio) -- reportado por Nalux (03/09/2026): con el mensaje
            // genérico de antes, esto se sentía como que "algo se rompió" en
            // vez de explicar qué pasó. El código 23505 de Postgres es
            // justamente violación de UNIQUE.
            setError(
                err?.code === '23505'
                    ? `Ya existe un plan llamado "${form.nombre}". Elegir otro nombre o editar el que ya existe.`
                    : 'No se pudo guardar el plan.',
            );
        } finally {
            setSaving(false);
        }
    };

    const guardarPeriodo = async (e) => {
        e.preventDefault();
        setSavingPeriodo(true);
        setError('');
        const payload = {
            nombre: formPeriodo.nombre,
            dias: Math.max(1, Number(formPeriodo.dias || 1)),
            activo: !!formPeriodo.activo,
        };
        try {
            if (editPeriodoId) await updateRec('configuracion_periodos', editPeriodoId, payload);
            else await createRec('configuracion_periodos', payload);
            setOpenPeriodo(false);
            cargar();
        } catch (_) {
            setError('No se pudo guardar el período.');
        } finally {
            setSavingPeriodo(false);
        }
    };

    // Un período usado por algún plan no se borra: dejaría a ese plan con un
    // período que ya no existe y el cálculo del vencimiento quedaría sin base.
    const borrarPeriodo = async (p) => {
        const enUso = items.filter((x) => x.periodo === p.nombre);
        if (enUso.length > 0) {
            setError(
                `No se puede borrar "${p.nombre}": lo usan ${enUso.length} plan(es). Cambiarles el período primero, o pausarlo.`,
            );
            return;
        }
        await removeRec('configuracion_periodos', p.id);
        cargar();
    };

    const cargarSugeridos = async () => {
        await Promise.all(PERIODOS_SUGERIDOS.map((p) => createRec('configuracion_periodos', p)));
        cargar();
    };

    // A diferencia de los períodos, un descuento con nombre no queda anotado
    // en ningún plan -- se elige al cobrar, en Pagos, no al armar el plan. Por
    // eso no hace falta revisar "en uso" antes de borrarlo: no puede dejar
    // nada huérfano.
    const guardarDescuento = async (e) => {
        e.preventDefault();
        setSavingDescuento(true);
        setError('');
        const payload = {
            nombre: formDescuento.nombre,
            porcentaje: Math.max(0, Number(formDescuento.porcentaje || 0)),
            activo: !!formDescuento.activo,
        };
        try {
            if (editDescuentoId) await updateRec('configuracion_descuentos', editDescuentoId, payload);
            else await createRec('configuracion_descuentos', payload);
            setOpenDescuento(false);
            cargar();
        } catch (_) {
            setError('No se pudo guardar el descuento.');
        } finally {
            setSavingDescuento(false);
        }
    };

    const borrarDescuento = async (d) => {
        await removeRec('configuracion_descuentos', d.id);
        cargar();
    };

    const periodosActivos = periodos.filter((p) => p.activo);

    return (
        <AppLayout
            title="Planes y precios"
            subtitle="Los planes que se les cobra a los alumnos, y los períodos con los que se arman."
            actions={
                <Btn
                    onClick={() => {
                        setForm({ ...vacio, periodo: periodosActivos[0]?.nombre || '' });
                        setEditId(null);
                        setError('');
                        setOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4" /> Nuevo plan
                </Btn>
            }
        >
            <Helmet>
                <title>Planes y precios | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Planes, precios, descuentos e interés por mora del gimnasio, con períodos configurables."
                />
            </Helmet>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            <Card className="mb-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="font-display text-lg font-bold">Períodos</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            La duración que puede tener un plan. Crear los que se necesiten — una clase suelta, un
                            pase de 15 días, lo que sea — y borrarlos o pausarlos cuando se quiera.
                        </p>
                    </div>
                    <Btn
                        variant="ghost"
                        onClick={() => {
                            setFormPeriodo(vacioPeriodo);
                            setEditPeriodoId(null);
                            setError('');
                            setOpenPeriodo(true);
                        }}
                    >
                        <Plus className="h-4 w-4" /> Nuevo período
                    </Btn>
                </div>

                {loading ? null : periodos.length === 0 ? (
                    <div className="mt-4">
                        <Empty>
                            Todavía no hay períodos cargados.{' '}
                            <button type="button" onClick={cargarSugeridos} className="font-semibold text-primary">
                                Cargar los típicos
                            </button>{' '}
                            (clase suelta, diario, semanal, mensual, trimestral y anual) y después editarlos.
                        </Empty>
                    </div>
                ) : (
                    <ul className="mt-4 divide-y divide-border">
                        {periodos.map((p) => (
                            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div>
                                    <p className="text-sm font-semibold">
                                        {p.nombre}{' '}
                                        {!p.activo && (
                                            <Badge className="ml-1 border-border text-muted-foreground">Pausado</Badge>
                                        )}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Cubre {p.dias} {Number(p.dias) === 1 ? 'día' : 'días'}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Btn
                                        variant="ghost"
                                        className="px-3 py-1.5 text-xs"
                                        onClick={() => {
                                            setFormPeriodo({
                                                nombre: p.nombre || '',
                                                dias: p.dias ?? '',
                                                activo: !!p.activo,
                                            });
                                            setEditPeriodoId(p.id);
                                            setError('');
                                            setOpenPeriodo(true);
                                        }}
                                    >
                                        Editar
                                    </Btn>
                                    <Btn
                                        variant="danger"
                                        className="px-3 py-1.5 text-xs"
                                        onClick={() => borrarPeriodo(p)}
                                    >
                                        Eliminar
                                    </Btn>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            <Card className="mb-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="font-display text-lg font-bold">Descuentos</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Para elegir al cobrar en Pagos (&quot;Estudiante -10%&quot;, &quot;Promo verano
                            -20%&quot;) en vez de escribir el porcentaje cada vez.
                        </p>
                    </div>
                    <Btn
                        variant="ghost"
                        onClick={() => {
                            setFormDescuento(vacioDescuento);
                            setEditDescuentoId(null);
                            setError('');
                            setOpenDescuento(true);
                        }}
                    >
                        <Plus className="h-4 w-4" /> Nuevo descuento
                    </Btn>
                </div>

                {loading ? null : descuentos.length === 0 ? (
                    <div className="mt-4">
                        <Empty>Todavía no cargaste ningún descuento con nombre.</Empty>
                    </div>
                ) : (
                    <ul className="mt-4 divide-y divide-border">
                        {descuentos.map((d) => (
                            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div>
                                    <p className="text-sm font-semibold">
                                        {d.nombre}{' '}
                                        {!d.activo && (
                                            <Badge className="ml-1 border-border text-muted-foreground">Pausado</Badge>
                                        )}
                                    </p>
                                    <p className="text-xs text-muted-foreground">{d.porcentaje}% de descuento</p>
                                </div>
                                <div className="flex gap-2">
                                    <Btn
                                        variant="ghost"
                                        className="px-3 py-1.5 text-xs"
                                        onClick={() => {
                                            setFormDescuento({
                                                nombre: d.nombre || '',
                                                porcentaje: d.porcentaje ?? '',
                                                activo: !!d.activo,
                                            });
                                            setEditDescuentoId(d.id);
                                            setError('');
                                            setOpenDescuento(true);
                                        }}
                                    >
                                        Editar
                                    </Btn>
                                    <Btn
                                        variant="danger"
                                        className="px-3 py-1.5 text-xs"
                                        onClick={() => borrarDescuento(d)}
                                    >
                                        Eliminar
                                    </Btn>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

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
                                {p.periodo || 'Sin período'} · {p.dias_semana || 0} días por semana
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
                                            periodo: p.periodo || '',
                                            dias_semana: p.dias_semana ?? 3,
                                            descuento: p.descuento ?? '',
                                            interes_mora: p.interes_mora ?? '',
                                            activo: !!p.activo,
                                        });
                                        setEditId(p.id);
                                        setError('');
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
                                <option value="">Elegir un período...</option>
                                {periodosActivos.map((p) => (
                                    <option key={p.id} value={p.nombre}>
                                        {p.nombre} ({p.dias} {Number(p.dias) === 1 ? 'día' : 'días'})
                                    </option>
                                ))}
                            </Select>
                            {periodosActivos.length === 0 && (
                                <span className="text-xs text-warn">
                                    Cargar primero un período acá arriba.
                                </span>
                            )}
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
                            <span className="text-xs text-muted-foreground">
                                El recargo que se le suma si paga después del vencimiento. Cuándo empieza a
                                aplicarse lo definís en Configuración.
                            </span>
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
                    {/* Reportado por Nalux (03/09/2026): el cartel de error vivía
                        arriba de todo en la página, y el modal (fondo negro que tapa
                        toda la pantalla) lo dejaba oculto detrás -- guardar fallaba
                        (ej. nombre repetido) y no se veía absolutamente nada, parecía
                        que la app no hacía nada. Por eso también se muestra acá
                        adentro, donde el profesor lo puede ver de verdad. */}
                    {error && <ErrorBox>{error}</ErrorBox>}
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

            <Modal
                open={openPeriodo}
                onClose={() => setOpenPeriodo(false)}
                title={editPeriodoId ? 'Editar período' : 'Nuevo período'}
            >
                <form onSubmit={guardarPeriodo} className="space-y-4">
                    <Field label="Nombre">
                        <Input
                            value={formPeriodo.nombre}
                            onChange={(e) => setFormPeriodo({ ...formPeriodo, nombre: e.target.value })}
                            placeholder="Mensual, Clase suelta, Pase de 15 días..."
                            required
                        />
                    </Field>
                    <Field label="Cuántos días cubre">
                        <Input
                            type="number"
                            min="1"
                            value={formPeriodo.dias}
                            onChange={(e) => setFormPeriodo({ ...formPeriodo, dias: e.target.value })}
                            required
                        />
                        <span className="text-xs text-muted-foreground">
                            Es lo que se le suma a la fecha de inicio para calcular hasta cuándo le cubre el pago.
                            Una clase suelta: 1 día.
                        </span>
                    </Field>
                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={formPeriodo.activo}
                            onChange={(e) => setFormPeriodo({ ...formPeriodo, activo: e.target.checked })}
                            className="h-4 w-4 accent-[hsl(var(--primary))]"
                        />
                        Disponible para elegir en los planes
                    </label>
                    {error && <ErrorBox>{error}</ErrorBox>}
                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpenPeriodo(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={savingPeriodo}>
                            {savingPeriodo ? 'Guardando...' : 'Guardar'}
                        </Btn>
                    </div>
                </form>
            </Modal>

            <Modal
                open={openDescuento}
                onClose={() => setOpenDescuento(false)}
                title={editDescuentoId ? 'Editar descuento' : 'Nuevo descuento'}
            >
                <form onSubmit={guardarDescuento} className="space-y-4">
                    <Field label="Nombre">
                        <Input
                            value={formDescuento.nombre}
                            onChange={(e) => setFormDescuento({ ...formDescuento, nombre: e.target.value })}
                            placeholder="Estudiante, Promo verano, 2x1..."
                            required
                        />
                    </Field>
                    <Field label="Porcentaje">
                        <Input
                            type="number"
                            min="0"
                            max="100"
                            value={formDescuento.porcentaje}
                            onChange={(e) => setFormDescuento({ ...formDescuento, porcentaje: e.target.value })}
                            required
                        />
                    </Field>
                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={formDescuento.activo}
                            onChange={(e) => setFormDescuento({ ...formDescuento, activo: e.target.checked })}
                            className="h-4 w-4 accent-[hsl(var(--primary))]"
                        />
                        Disponible para elegir al cobrar
                    </label>
                    {error && <ErrorBox>{error}</ErrorBox>}
                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpenDescuento(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={savingDescuento}>
                            {savingDescuento ? 'Guardando...' : 'Guardar'}
                        </Btn>
                    </div>
                </form>
            </Modal>
        </AppLayout>
    );
};

export default PreciosPage;
