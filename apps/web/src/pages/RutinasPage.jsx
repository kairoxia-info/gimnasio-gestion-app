import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus, Trash2, UserPlus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { DIAS } from '@/lib/format';

const vacio = { nombre: '', descripcion: '', duracion_semanas: 4 };

// Biblioteca de rutinas reutilizables: se arman UNA vez acá y se asignan a
// N alumnos (rutinas_asignadas). Reemplaza al viejo modelo "un plan por
// alumno" que vivía embebido en AlumnoPage — ver PLAN.md, Decisión 4.
const RutinasPage = () => {
    const [rutinas, setRutinas] = useState([]);
    const [ejercicios, setEjercicios] = useState([]);
    const [asignadasActivas, setAsignadasActivas] = useState([]);
    const [alumnosActivos, setAlumnosActivos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Modal "Nueva rutina" / "Editar rutina"
    const [open, setOpen] = useState(false);
    const [editId, setEditId] = useState(null);
    const [form, setForm] = useState(vacio);
    const [items, setItems] = useState([]);
    const [sel, setSel] = useState('');
    const [dia, setDia] = useState(DIAS[0]);
    const [saving, setSaving] = useState(false);

    // Modal "Asignar a alumnos" (asignación masiva)
    const [asignarOpen, setAsignarOpen] = useState(false);
    const [rutinaAsignando, setRutinaAsignando] = useState(null);
    const [seleccionados, setSeleccionados] = useState(new Set());
    const [asignando, setAsignando] = useState(false);
    const [asignarMsg, setAsignarMsg] = useState('');

    const cargar = () => {
        setLoading(true);
        Promise.all([
            listAll('rutinas', { sort: 'nombre' }),
            listAll('ejercicios', { sort: 'nombre' }),
            listAll('rutinas_asignadas', { filters: { activa: true } }),
            listAll('alumnos', { filters: { activo: true }, sort: 'nombre' }),
        ])
            .then(([r, e, asig, al]) => {
                setRutinas(r);
                setEjercicios(e);
                setAsignadasActivas(asig);
                setAlumnosActivos(al);
                setError('');
            })
            .catch(() => setError('No se pudo cargar la biblioteca de rutinas.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    // Si el usuario abre "Nueva rutina" antes de que terminen de cargar los
    // ejercicios, el selector arranca vacío — se completa solo apenas llegan.
    useEffect(() => {
        if (!sel && ejercicios.length > 0) setSel(ejercicios[0].id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ejercicios]);

    // Conteo client-side de alumnos activos asignados a cada rutina — no hace
    // falta una vista SQL nueva para algo tan simple.
    const contarAsignados = (rutinaId) => asignadasActivas.filter((a) => a.rutina_id === rutinaId).length;

    const abrirNueva = () => {
        setForm(vacio);
        setEditId(null);
        setItems([]);
        setSel(ejercicios[0]?.id || '');
        setDia(DIAS[0]);
        setOpen(true);
    };

    const abrirEditar = (r) => {
        setForm({
            nombre: r.nombre || '',
            descripcion: r.descripcion || '',
            duracion_semanas: r.duracion_semanas || 4,
        });
        setEditId(r.id);
        setItems(r.items || []);
        setSel(ejercicios[0]?.id || '');
        setDia(DIAS[0]);
        setOpen(true);
    };

    const agregarItem = () => {
        const ej = ejercicios.find((e) => e.id === sel);
        if (!ej) return;
        setItems([
            ...items,
            {
                key: `${ej.id}-${Date.now()}`,
                ejercicioId: ej.id,
                nombre: ej.nombre,
                grupo: ej.grupo_muscular,
                dia,
                series: 4,
                reps: 10,
                peso: '',
                descanso: '60 s',
            },
        ]);
    };

    const editarItem = (key, campo, valor) =>
        setItems(items.map((it) => (it.key === key ? { ...it, [campo]: valor } : it)));

    const porDia = useMemo(() => {
        const map = {};
        items.forEach((it) => {
            map[it.dia] = map[it.dia] || [];
            map[it.dia].push(it);
        });
        return map;
    }, [items]);

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                nombre: form.nombre,
                descripcion: form.descripcion,
                duracion_semanas: Number(form.duracion_semanas || 0),
                items,
            };
            if (editId) await updateRec('rutinas', editId, payload);
            else await createRec('rutinas', payload);
            setOpen(false);
            cargar();
        } catch (_) {
            setError('No se pudo guardar la rutina.');
        } finally {
            setSaving(false);
        }
    };

    // El ON DELETE CASCADE del schema ya borra las rutinas_asignadas
    // asociadas — acá solo advertimos si eso va a dejar alumnos sin rutina
    // antes de confirmar, pero no bloqueamos el borrado si el usuario insiste.
    const borrar = async (r) => {
        const asignados = contarAsignados(r.id);
        const plural = asignados === 1 ? '' : 's';
        const mensaje =
            asignados > 0
                ? `Esta rutina está asignada a ${asignados} alumno${plural} activo${plural}. Si la borrás, ese${plural} alumno${plural} se queda${asignados === 1 ? '' : 'n'} sin rutina. ¿Igual querés borrarla?`
                : '¿Seguro que querés borrar esta rutina?';
        if (!window.confirm(mensaje)) return;
        await removeRec('rutinas', r.id);
        cargar();
    };

    const abrirAsignar = (r) => {
        setRutinaAsignando(r);
        setSeleccionados(new Set());
        setAsignarMsg('');
        setAsignarOpen(true);
    };

    const toggleAlumno = (alumnoId) => {
        setSeleccionados((prev) => {
            const next = new Set(prev);
            if (next.has(alumnoId)) next.delete(alumnoId);
            else next.add(alumnoId);
            return next;
        });
    };

    // Asignación masiva real: una fila en rutinas_asignadas por cada alumno
    // tildado, todas en paralelo.
    const confirmarAsignacion = async () => {
        if (!rutinaAsignando || seleccionados.size === 0) return;
        setAsignando(true);
        setAsignarMsg('');
        try {
            const ids = Array.from(seleccionados);
            await Promise.all(
                ids.map((alumnoId) =>
                    createRec('rutinas_asignadas', { rutina_id: rutinaAsignando.id, alumno_id: alumnoId }),
                ),
            );
            setAsignarMsg(`Rutina asignada a ${ids.length} alumno${ids.length === 1 ? '' : 's'}.`);
            setSeleccionados(new Set());
            cargar();
        } catch (_) {
            setAsignarMsg('No se pudo completar la asignación. Probá de nuevo.');
        } finally {
            setAsignando(false);
        }
    };

    return (
        <AppLayout
            title="Biblioteca de rutinas"
            subtitle="Armá cada rutina una sola vez y asignala a todos los alumnos que la necesiten."
            actions={
                <Btn onClick={abrirNueva}>
                    <Plus className="h-4 w-4" /> Nueva rutina
                </Btn>
            }
        >
            <Helmet>
                <title>Biblioteca de rutinas | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Rutinas de entrenamiento reutilizables por gimnasio, con asignación masiva a alumnos."
                />
            </Helmet>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={4} />
            ) : rutinas.length === 0 ? (
                <Empty>Todavía no hay rutinas cargadas. Empezá con el botón &ldquo;Nueva rutina&rdquo;.</Empty>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {rutinas.map((r) => {
                        const asignados = contarAsignados(r.id);
                        return (
                            <Card key={r.id}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                                            <ClipboardList className="h-5 w-5 text-primary" strokeWidth={2} />
                                        </span>
                                        <div>
                                            <p className="font-display text-base font-bold">{r.nombre}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {r.duracion_semanas
                                                    ? `${r.duracion_semanas} semana${r.duracion_semanas === 1 ? '' : 's'}`
                                                    : 'Duración libre'}
                                            </p>
                                        </div>
                                    </div>
                                    <Badge className={asignados > 0 ? 'text-ok border-current' : 'border-border text-muted-foreground'}>
                                        {asignados} alumno{asignados === 1 ? '' : 's'}
                                    </Badge>
                                </div>
                                {r.descripcion && (
                                    <p className="mt-3 text-sm text-muted-foreground">{r.descripcion}</p>
                                )}
                                <p className="mt-3 text-xs text-muted-foreground">
                                    {(r.items || []).length} ejercicio{(r.items || []).length === 1 ? '' : 's'} cargado{(r.items || []).length === 1 ? '' : 's'}
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirEditar(r)}>
                                        Editar
                                    </Btn>
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirAsignar(r)}>
                                        <UserPlus className="h-3.5 w-3.5" /> Asignar a alumnos
                                    </Btn>
                                    <Btn variant="danger" className="px-3 py-2 text-xs" onClick={() => borrar(r)}>
                                        Eliminar
                                    </Btn>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Editar rutina' : 'Nueva rutina'} wide>
                <form onSubmit={guardar} className="space-y-5">
                    <Card>
                        <div className="grid gap-4 sm:grid-cols-[2fr,1fr]">
                            <Field label="Nombre de la rutina">
                                <Input
                                    value={form.nombre}
                                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                                    required
                                />
                            </Field>
                            <Field label="Duración (semanas)">
                                <Input
                                    type="number"
                                    min="1"
                                    value={form.duracion_semanas}
                                    onChange={(e) => setForm({ ...form, duracion_semanas: e.target.value })}
                                />
                            </Field>
                        </div>
                        <div className="mt-4">
                            <Field label="Descripción">
                                <Textarea
                                    value={form.descripcion}
                                    onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                                />
                            </Field>
                        </div>

                        {ejercicios.length === 0 ? (
                            <div className="mt-4">
                                <Empty>
                                    Primero cargá ejercicios en la{' '}
                                    <Link to="/ejercicios" className="font-semibold text-primary">
                                        biblioteca
                                    </Link>
                                    .
                                </Empty>
                            </div>
                        ) : (
                            <div className="mt-4 grid gap-3 sm:grid-cols-[2fr,1fr,auto]">
                                <Field label="Ejercicio de la biblioteca">
                                    <Select value={sel} onChange={(e) => setSel(e.target.value)}>
                                        {ejercicios.map((e) => (
                                            <option key={e.id} value={e.id}>
                                                {e.nombre} · {e.grupo_muscular}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <Field label="Día">
                                    <Select value={dia} onChange={(e) => setDia(e.target.value)}>
                                        {DIAS.map((d) => (
                                            <option key={d} value={d}>
                                                {d}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <div className="flex items-end">
                                    <Btn type="button" onClick={agregarItem} className="w-full sm:w-auto">
                                        <Plus className="h-4 w-4" /> Agregar
                                    </Btn>
                                </div>
                            </div>
                        )}
                    </Card>

                    {items.length === 0 ? (
                        <Empty>Todavía no agregaste ejercicios a esta rutina.</Empty>
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
                                    <div className="space-y-3">
                                        {lista.map((it) => (
                                            <div
                                                key={it.key}
                                                className="grid items-end gap-3 rounded-xl border border-border p-3 sm:grid-cols-[2fr,repeat(4,minmax(0,1fr)),auto]"
                                            >
                                                <div>
                                                    <p className="text-sm font-bold">{it.nombre}</p>
                                                    <p className="text-xs text-muted-foreground">{it.grupo}</p>
                                                </div>
                                                <Field label="Series">
                                                    <Input
                                                        type="number"
                                                        value={it.series}
                                                        onChange={(e) => editarItem(it.key, 'series', e.target.value)}
                                                    />
                                                </Field>
                                                <Field label="Reps">
                                                    <Input
                                                        value={it.reps}
                                                        onChange={(e) => editarItem(it.key, 'reps', e.target.value)}
                                                    />
                                                </Field>
                                                <Field label="Peso">
                                                    <Input
                                                        value={it.peso}
                                                        onChange={(e) => editarItem(it.key, 'peso', e.target.value)}
                                                        placeholder="kg"
                                                    />
                                                </Field>
                                                <Field label="Descanso">
                                                    <Input
                                                        value={it.descanso}
                                                        onChange={(e) => editarItem(it.key, 'descanso', e.target.value)}
                                                    />
                                                </Field>
                                                <button
                                                    type="button"
                                                    aria-label="Quitar ejercicio"
                                                    onClick={() => setItems(items.filter((x) => x.key !== it.key))}
                                                    className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-primary"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpen(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar rutina'}
                        </Btn>
                    </div>
                </form>
            </Modal>

            <Modal
                open={asignarOpen}
                onClose={() => setAsignarOpen(false)}
                title={rutinaAsignando ? `Asignar "${rutinaAsignando.nombre}" a alumnos` : 'Asignar a alumnos'}
            >
                <div className="space-y-4">
                    {alumnosActivos.length === 0 ? (
                        <Empty>No hay alumnos activos para asignar.</Empty>
                    ) : (
                        <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
                            <ul className="divide-y divide-border">
                                {alumnosActivos.map((a) => {
                                    const yaTiene = asignadasActivas.some(
                                        (x) => x.rutina_id === rutinaAsignando?.id && x.alumno_id === a.id,
                                    );
                                    return (
                                        <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                                            <input
                                                type="checkbox"
                                                id={`asignar-alumno-${a.id}`}
                                                checked={seleccionados.has(a.id)}
                                                disabled={yaTiene}
                                                onChange={() => toggleAlumno(a.id)}
                                                className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))] disabled:opacity-40"
                                            />
                                            <label
                                                htmlFor={`asignar-alumno-${a.id}`}
                                                className={`flex-1 text-sm ${yaTiene ? 'text-muted-foreground' : 'cursor-pointer'}`}
                                            >
                                                {a.nombre}
                                                {yaTiene && <span className="ml-2 text-xs">(ya la tiene asignada)</span>}
                                            </label>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {asignarMsg && <p className="text-sm text-muted-foreground">{asignarMsg}</p>}

                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setAsignarOpen(false)}>
                            Cerrar
                        </Btn>
                        <Btn onClick={confirmarAsignacion} disabled={asignando || seleccionados.size === 0}>
                            {asignando
                                ? 'Asignando...'
                                : `Asignar${seleccionados.size > 0 ? ` a ${seleccionados.size} alumno${seleccionados.size === 1 ? '' : 's'}` : ''}`}
                        </Btn>
                    </div>
                </div>
            </Modal>
        </AppLayout>
    );
};

export default RutinasPage;
