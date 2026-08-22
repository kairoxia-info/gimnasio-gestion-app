import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Dumbbell, ExternalLink, Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { GRUPOS, createRec, listAll, removeRec, updateRec } from '@/lib/data';

const vacio = { nombre: '', grupo_muscular: GRUPOS[0], media_url: '', descripcion: '' };

const EjerciciosPage = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filtro, setFiltro] = useState('todos');
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);

    const cargar = () => {
        setLoading(true);
        listAll('ejercicios', { sort: 'nombre' })
            .then((r) => {
                setItems(r);
                setError('');
            })
            .catch(() => setError('No se pudo cargar la biblioteca de ejercicios.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    const grupos = useMemo(
        () => Array.from(new Set([...GRUPOS, ...items.map((i) => i.grupo_muscular).filter(Boolean)])),
        [items],
    );

    const visibles = filtro === 'todos' ? items : items.filter((i) => i.grupo_muscular === filtro);

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (editId) await updateRec('ejercicios', editId, form);
            else await createRec('ejercicios', form);
            setOpen(false);
            cargar();
        } catch (_) {
            setError('No se pudo guardar el ejercicio.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppLayout
            title="Biblioteca de ejercicios"
            subtitle="Cargá cada ejercicio una sola vez: después se elige desde el armador de planes."
            actions={
                <Btn
                    onClick={() => {
                        setForm(vacio);
                        setEditId(null);
                        setOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4" /> Nuevo ejercicio
                </Btn>
            }
        >
            <Helmet>
                <title>Biblioteca de ejercicios | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Biblioteca de ejercicios por grupo muscular con descripción y video demostrativo para armar planes de entrenamiento."
                />
            </Helmet>

            <div className="mb-6 flex flex-wrap gap-2">
                {['todos', ...grupos].map((g) => (
                    <button
                        key={g}
                        type="button"
                        onClick={() => setFiltro(g)}
                        className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                            filtro === g
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {g === 'todos' ? 'Todos' : g}
                    </button>
                ))}
            </div>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={4} />
            ) : visibles.length === 0 ? (
                <Empty>No hay ejercicios en este grupo muscular.</Empty>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {visibles.map((ej) => (
                        <div key={ej.id} className="rounded-2xl border border-border bg-card p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                                        <Dumbbell className="h-5 w-5 text-primary" strokeWidth={2} />
                                    </span>
                                    <p className="font-display text-base font-bold">{ej.nombre}</p>
                                </div>
                                <Badge className="border-border text-muted-foreground">{ej.grupo_muscular || '—'}</Badge>
                            </div>
                            {ej.descripcion && (
                                <p className="mt-3 text-sm text-muted-foreground">{ej.descripcion}</p>
                            )}
                            {ej.media_url && (
                                <a
                                    href={ej.media_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                                >
                                    Ver demostración <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                            <div className="mt-4 flex gap-2">
                                <Btn
                                    variant="ghost"
                                    className="px-3 py-2 text-xs"
                                    onClick={() => {
                                        setForm({
                                            nombre: ej.nombre || '',
                                            grupo_muscular: ej.grupo_muscular || GRUPOS[0],
                                            media_url: ej.media_url || '',
                                            descripcion: ej.descripcion || '',
                                        });
                                        setEditId(ej.id);
                                        setOpen(true);
                                    }}
                                >
                                    Editar
                                </Btn>
                                <Btn
                                    variant="danger"
                                    className="px-3 py-2 text-xs"
                                    onClick={() => removeRec('ejercicios', ej.id).then(cargar)}
                                >
                                    Eliminar
                                </Btn>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Editar ejercicio' : 'Nuevo ejercicio'}>
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Nombre">
                        <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
                    </Field>
                    <Field label="Grupo muscular">
                        <Select
                            value={form.grupo_muscular}
                            onChange={(e) => setForm({ ...form, grupo_muscular: e.target.value })}
                        >
                            {grupos.map((g) => (
                                <option key={g} value={g}>
                                    {g}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label="Video o imagen demostrativa (URL opcional)">
                        <Input
                            value={form.media_url}
                            onChange={(e) => setForm({ ...form, media_url: e.target.value })}
                            placeholder="https://..."
                        />
                    </Field>
                    <Field label="Descripción / técnica">
                        <Textarea
                            value={form.descripcion}
                            onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                        />
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

export default EjerciciosPage;
