import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Plus, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Empty, ErrorBox, Field, Input, Loading, Modal, Select } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';

const CATEGORIAS = ['Proteínas', 'Carbohidratos', 'Grasas', 'Frutas', 'Verduras', 'Lácteos', 'Suplementos', 'Otros'];

const vacio = {
    nombre: '',
    categoria: CATEGORIAS[0],
    unidad: '100 g',
    calorias: '',
    proteinas: '',
    carbohidratos: '',
    grasas: '',
};

const num = (v) => (v === '' || v === null ? 0 : Number(v));

const AlimentosPage = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filtro, setFiltro] = useState('todos');
    const [busqueda, setBusqueda] = useState('');
    const [filtroNutricion, setFiltroNutricion] = useState('todos'); // 'todos' | 'con' | 'sin'
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);

    const cargar = () => {
        setLoading(true);
        listAll('alimentos', { sort: 'nombre' })
            .then((r) => {
                setItems(r);
                setError('');
            })
            .catch(() => setError('No se pudo cargar la biblioteca de alimentos.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    const categorias = useMemo(
        () => Array.from(new Set([...CATEGORIAS, ...items.map((i) => i.categoria).filter(Boolean)])),
        [items],
    );

    // Los 3 filtros se combinan con AND, mismo criterio que en Ejercicios:
    // categoría sigue siendo chips (la más usada), información nutricional es
    // un select chico, y el buscador reduce por nombre.
    const visibles = items.filter((a) => {
        if (filtro !== 'todos' && a.categoria !== filtro) return false;
        if (filtroNutricion === 'con' && !a.calorias) return false;
        if (filtroNutricion === 'sin' && a.calorias) return false;
        if (busqueda.trim() && !a.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
        return true;
    });

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        const payload = {
            ...form,
            calorias: num(form.calorias),
            proteinas: num(form.proteinas),
            carbohidratos: num(form.carbohidratos),
            grasas: num(form.grasas),
        };
        try {
            if (editId) await updateRec('alimentos', editId, payload);
            else await createRec('alimentos', payload);
            setOpen(false);
            cargar();
        } catch (_) {
            setError('No se pudo guardar el alimento.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppLayout
            title="Biblioteca de alimentos"
            subtitle="Cargar cada alimento una vez con su información nutricional y reutilizarlo en los planes."
            actions={
                <Btn
                    onClick={() => {
                        setForm(vacio);
                        setEditId(null);
                        setOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4" /> Nuevo alimento
                </Btn>
            }
        >
            <Helmet>
                <title>Biblioteca de alimentos | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Alimentos con calorías y macros por porción para armar planes de alimentación personalizados."
                />
            </Helmet>

            <div className="mb-4 grid gap-3 sm:grid-cols-[2fr,1fr]">
                <div className="relative">
                    <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <Input
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                        placeholder="Buscar por nombre..."
                        className="pl-9"
                        aria-label="Buscar alimento por nombre"
                    />
                </div>
                <Select
                    value={filtroNutricion}
                    onChange={(e) => setFiltroNutricion(e.target.value)}
                    aria-label="Filtrar por información nutricional cargada"
                >
                    <option value="todos">Con o sin información nutricional</option>
                    <option value="con">Con información nutricional</option>
                    <option value="sin">Sin información nutricional</option>
                </Select>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
                {['todos', ...categorias].map((c) => (
                    <button
                        key={c}
                        type="button"
                        onClick={() => setFiltro(c)}
                        className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                            filtro === c
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {c === 'todos' ? 'Todos' : c}
                    </button>
                ))}
            </div>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={4} />
            ) : visibles.length === 0 ? (
                <Empty>No hay alimentos que coincidan con estos filtros.</Empty>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-border">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3">Alimento</th>
                                <th className="px-4 py-3">Categoría</th>
                                <th className="px-4 py-3">Porción</th>
                                <th className="px-4 py-3">Kcal</th>
                                <th className="hidden px-4 py-3 sm:table-cell">P / C / G</th>
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border bg-card">
                            {visibles.map((a) => (
                                <tr key={a.id}>
                                    <td className="px-4 py-3 font-semibold">{a.nombre}</td>
                                    <td className="px-4 py-3">
                                        <Badge className="border-border text-muted-foreground">{a.categoria || '—'}</Badge>
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">{a.unidad || '100 g'}</td>
                                    <td className="px-4 py-3">{a.calorias || 0}</td>
                                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                                        {a.proteinas || 0} / {a.carbohidratos || 0} / {a.grasas || 0}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex justify-end gap-2">
                                            <Btn
                                                variant="ghost"
                                                className="px-3 py-1.5 text-xs"
                                                onClick={() => {
                                                    setForm({
                                                        nombre: a.nombre || '',
                                                        categoria: a.categoria || CATEGORIAS[0],
                                                        unidad: a.unidad || '100 g',
                                                        calorias: a.calorias ?? '',
                                                        proteinas: a.proteinas ?? '',
                                                        carbohidratos: a.carbohidratos ?? '',
                                                        grasas: a.grasas ?? '',
                                                    });
                                                    setEditId(a.id);
                                                    setOpen(true);
                                                }}
                                            >
                                                Editar
                                            </Btn>
                                            <Btn
                                                variant="danger"
                                                className="px-3 py-1.5 text-xs"
                                                onClick={() => removeRec('alimentos', a.id).then(cargar)}
                                            >
                                                Eliminar
                                            </Btn>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Editar alimento' : 'Nuevo alimento'}>
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Nombre">
                        <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Categoría">
                            <Select
                                value={form.categoria}
                                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                            >
                                {categorias.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Porción de referencia">
                            <Input
                                value={form.unidad}
                                onChange={(e) => setForm({ ...form, unidad: e.target.value })}
                                placeholder="100 g / 1 unidad"
                            />
                        </Field>
                        <Field label="Calorías">
                            <Input
                                type="number"
                                value={form.calorias}
                                onChange={(e) => setForm({ ...form, calorias: e.target.value })}
                            />
                        </Field>
                        <Field label="Proteínas (g)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.proteinas}
                                onChange={(e) => setForm({ ...form, proteinas: e.target.value })}
                            />
                        </Field>
                        <Field label="Carbohidratos (g)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.carbohidratos}
                                onChange={(e) => setForm({ ...form, carbohidratos: e.target.value })}
                            />
                        </Field>
                        <Field label="Grasas (g)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.grasas}
                                onChange={(e) => setForm({ ...form, grasas: e.target.value })}
                            />
                        </Field>
                    </div>
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

export default AlimentosPage;
