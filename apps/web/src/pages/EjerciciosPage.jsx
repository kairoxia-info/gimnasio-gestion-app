import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { AlertTriangle, Dumbbell, ExternalLink, Lock, Play, Plus, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { CLASIFICACIONES, GRUPOS } from '@/lib/format';
import { pathEnBucket, tipoDePreview } from '@/lib/mediaEjercicio';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';

const vacio = { nombre: '', grupo_muscular: [], clasificacion: '', media_url: '', descripcion: '' };

// Mismo criterio que 0005_ejercicios_media_storage.sql (bucket 'ejercicios-media'):
// tope de 50 MB y solo estos 6 MIME types, ya validados también a nivel de bucket,
// pero conviene validar del lado del cliente para dar un mensaje legible antes de
// intentar subir. El path final es SIEMPRE gimnasioId/ejercicioId.<ext>, nunca con
// el nombre de archivo original elegido por el usuario.
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MIME_TO_EXT = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
};

const EjerciciosPage = () => {
    const { profile } = useAuth();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filtro, setFiltro] = useState('todos');
    const [busqueda, setBusqueda] = useState('');
    const [filtroDemo, setFiltroDemo] = useState('todos'); // 'todos' | 'con' | 'sin'
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);
    const [warning, setWarning] = useState('');
    // Validación de "al menos un grupo" vive en el modal, no en `warning`
    // (ese cartel se pinta en el body de la página, que el Modal tapa por
    // completo con su overlay — quedaría invisible mientras el modal está
    // abierto).
    const [grupoError, setGrupoError] = useState('');

    // Archivo elegido para subir a Storage (equivalente a logoFile de
    // OnboardingPage/ConfiguracionPage). mediaUrlActual guarda el media_url
    // que ya tenía el ejercicio al abrir el modal en edición, solo para el
    // aviso de "ya tenés un archivo cargado".
    const [mediaFile, setMediaFile] = useState(null);
    const [mediaError, setMediaError] = useState('');
    const [mediaUrlActual, setMediaUrlActual] = useState('');
    const mediaInputRef = useRef(null);

    // Ejercicio cuya demostración se está mostrando en el modal de preview,
    // o null si está cerrado. Se guarda el ejercicio entero (no solo la url)
    // para poder mostrar también su nombre como título del modal.
    const [previewEj, setPreviewEj] = useState(null);

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

    // Storage no se limpia solo: hay que borrar el archivo del bucket antes
    // (o junto con) la fila. Es "best effort" — si el archivo ya no está o
    // falla el borrado, no bloqueamos el borrado del ejercicio en sí, porque
    // para el usuario lo que importa es que el ejercicio desaparezca de la
    // biblioteca.
    const borrar = async (ej) => {
        const path = pathEnBucket(ej.media_url);
        if (path) {
            try {
                await supabase.storage.from('ejercicios-media').remove([path]);
            } catch (_) {
                // best effort, seguimos igual
            }
        }
        await removeRec('ejercicios', ej.id);
        cargar();
    };

    const grupos = useMemo(
        () => Array.from(new Set([...GRUPOS, ...items.flatMap((i) => i.grupo_muscular || [])])),
        [items],
    );

    // Los 3 filtros se combinan con AND: cada uno reduce la lista, no la
    // reemplaza. El de grupo sigue siendo chips (es el que más se usa, tapa
    // grande); demostración es un select más chico (se usa menos seguido)
    // para no saturar la pantalla en el celular. El patrón de movimiento
    // (clasificacion) no tiene filtro propio a pedido de Nalux — el campo
    // sigue existiendo en el formulario y en la card, solo no hay forma de
    // filtrar la lista por él.
    const visibles = items.filter((ej) => {
        if (filtro !== 'todos' && !(ej.grupo_muscular || []).includes(filtro)) return false;
        if (filtroDemo === 'con' && !ej.media_url) return false;
        if (filtroDemo === 'sin' && ej.media_url) return false;
        if (busqueda.trim() && !ej.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
        return true;
    });

    const toggleGrupoForm = (g) =>
        setForm((f) => ({
            ...f,
            grupo_muscular: f.grupo_muscular.includes(g)
                ? f.grupo_muscular.filter((x) => x !== g)
                : [...f.grupo_muscular, g],
        }));

    const limpiarMedia = () => {
        setMediaFile(null);
        setMediaError('');
        setMediaUrlActual('');
        if (mediaInputRef.current) mediaInputRef.current.value = '';
    };

    const cerrarModal = () => {
        setOpen(false);
        limpiarMedia();
        setGrupoError('');
    };

    const onMediaChange = (e) => {
        const file = e.target.files?.[0];
        setMediaError('');
        if (!file) {
            setMediaFile(null);
            return;
        }
        if (!MIME_TO_EXT[file.type]) {
            setMediaError('El archivo debe ser MP4, WEBM, MOV, PNG, JPG o WEBP.');
            e.target.value = '';
            return;
        }
        if (file.size > MAX_MEDIA_BYTES) {
            setMediaError('El archivo no puede pesar más de 50 MB.');
            e.target.value = '';
            return;
        }
        setMediaFile(file);
    };

    const guardar = async (e) => {
        e.preventDefault();
        if (form.grupo_muscular.length === 0) {
            setGrupoError('Elegir al menos un grupo muscular.');
            return;
        }
        setGrupoError('');
        setSaving(true);
        setWarning('');
        try {
            // NO forzar media_url a '' acá cuando hay mediaFile: si el upload de abajo
            // falla, este guardado inicial tiene que dejar intacto lo que ya hubiera
            // (la URL externa vieja, o el media_url previo en edición) en vez de
            // pisarlo con vacío antes de saber si el archivo nuevo se subió bien. El
            // archivo, si se sube con éxito, gana recién en el updateRec de más abajo
            // (después del upload) — nunca acá.
            const payload = { ...form };

            let id = editId;
            if (editId) await updateRec('ejercicios', editId, payload);
            else {
                const creado = await createRec('ejercicios', payload);
                id = creado.id;
            }

            if (mediaFile && profile?.gimnasio_id && id) {
                try {
                    const ext = MIME_TO_EXT[mediaFile.type];
                    const path = `${profile.gimnasio_id}/${id}.${ext}`;
                    const { error: uploadError } = await supabase.storage
                        .from('ejercicios-media')
                        .upload(path, mediaFile, { upsert: true });
                    if (uploadError) throw uploadError;

                    const {
                        data: { publicUrl },
                    } = supabase.storage.from('ejercicios-media').getPublicUrl(path);

                    await updateRec('ejercicios', id, { media_url: publicUrl });
                } catch (_) {
                    setWarning(
                        'El ejercicio se guardó, pero el archivo no se pudo subir. Se puede volver a intentar editando el ejercicio.',
                    );
                }
            }

            setOpen(false);
            limpiarMedia();
            cargar();
        } catch (_) {
            setError('No se pudo guardar el ejercicio.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppLayout
            title={
                <span className="inline-flex flex-wrap items-center gap-3">
                    Biblioteca de ejercicios
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-bold normal-case text-primary">
                        {items.length} {items.length === 1 ? 'ejercicio' : 'ejercicios'}
                    </span>
                </span>
            }
            subtitle="Ya vienen 500 ejercicios de la biblioteca base, compartida por todos los gimnasios. Se pueden sumar más propios para completarla."
            actions={
                <Btn
                    onClick={() => {
                        setForm(vacio);
                        setEditId(null);
                        limpiarMedia();
                        setWarning('');
                        setGrupoError('');
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
                        aria-label="Buscar ejercicio por nombre"
                    />
                </div>
                <Select
                    value={filtroDemo}
                    onChange={(e) => setFiltroDemo(e.target.value)}
                    aria-label="Filtrar por demostración cargada"
                >
                    <option value="todos">Con o sin demostración</option>
                    <option value="con">Con demostración</option>
                    <option value="sin">Sin demostración</option>
                </Select>
            </div>

            {(filtro !== 'todos' || filtroDemo !== 'todos' || busqueda.trim()) && (
                <p className="mb-3 text-xs font-semibold text-muted-foreground">
                    Mostrando {visibles.length} de {items.length} ejercicios
                </p>
            )}

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
            {warning && !error && (
                <div className="mb-4 flex items-start gap-2 rounded-2xl border border-border bg-secondary p-4 text-sm text-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={1.8} />
                    <span>{warning}</span>
                </div>
            )}

            {loading ? (
                <Loading rows={4} />
            ) : visibles.length === 0 ? (
                <Empty>No hay ejercicios que coincidan con estos filtros.</Empty>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {visibles.map((ej) => (
                        <div key={ej.id} className="rounded-2xl border border-border bg-card p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                                        <Dumbbell className="h-5 w-5 text-primary" strokeWidth={2} />
                                    </span>
                                    <div>
                                        <p className="font-display text-base font-bold">{ej.nombre}</p>
                                        {!ej.gimnasio_id && (
                                            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                <Lock className="h-3 w-3" /> Biblioteca base
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex flex-wrap justify-end gap-1.5">
                                    {ej.grupo_muscular?.length ? (
                                        ej.grupo_muscular.map((g) => (
                                            <Badge key={g} className="border-border text-muted-foreground">
                                                {g}
                                            </Badge>
                                        ))
                                    ) : (
                                        <Badge className="border-border text-muted-foreground">—</Badge>
                                    )}
                                </div>
                            </div>
                            {ej.clasificacion && (
                                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-primary/80">
                                    {ej.clasificacion}
                                </p>
                            )}
                            {ej.descripcion && (
                                <p className="mt-3 text-sm text-muted-foreground">{ej.descripcion}</p>
                            )}
                            {ej.media_url && (
                                tipoDePreview(ej.media_url) ? (
                                    <button
                                        type="button"
                                        onClick={() => setPreviewEj(ej)}
                                        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                                    >
                                        Ver demostración <Play className="h-3 w-3" />
                                    </button>
                                ) : (
                                    <a
                                        href={ej.media_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                                    >
                                        Ver demostración <ExternalLink className="h-3 w-3" />
                                    </a>
                                )
                            )}
                            {ej.gimnasio_id ? (
                                <div className="mt-4 flex gap-2">
                                    <Btn
                                        variant="ghost"
                                        className="px-3 py-2 text-xs"
                                        onClick={() => {
                                            setForm({
                                                nombre: ej.nombre || '',
                                                grupo_muscular: ej.grupo_muscular || [],
                                                clasificacion: ej.clasificacion || '',
                                                media_url: ej.media_url || '',
                                                descripcion: ej.descripcion || '',
                                            });
                                            setEditId(ej.id);
                                            limpiarMedia();
                                            setMediaUrlActual(ej.media_url || '');
                                            setWarning('');
                                            setGrupoError('');
                                            setOpen(true);
                                        }}
                                    >
                                        Editar
                                    </Btn>
                                    <Btn
                                        variant="danger"
                                        className="px-3 py-2 text-xs"
                                        onClick={() => borrar(ej)}
                                    >
                                        Eliminar
                                    </Btn>
                                </div>
                            ) : (
                                <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Lock className="h-3.5 w-3.5" /> Es de la biblioteca compartida, no se puede
                                    editar ni borrar (afectaría a todos los gimnasios).
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <Modal open={open} onClose={cerrarModal} title={editId ? 'Editar ejercicio' : 'Nuevo ejercicio'}>
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Nombre">
                        <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
                    </Field>
                    <Field label="Grupos musculares">
                        <div className="flex flex-wrap gap-2">
                            {grupos.map((g) => {
                                const activo = form.grupo_muscular.includes(g);
                                return (
                                    <button
                                        key={g}
                                        type="button"
                                        onClick={() => toggleGrupoForm(g)}
                                        aria-pressed={activo}
                                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                            activo
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'border-border text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        {g}
                                    </button>
                                );
                            })}
                        </div>
                        <span className="text-xs text-muted-foreground">
                            Marcar los que correspondan — se puede elegir más de uno.
                        </span>
                        {grupoError && <ErrorBox>{grupoError}</ErrorBox>}
                    </Field>
                    <Field label="Patrón de movimiento (opcional)">
                        <Select
                            value={form.clasificacion}
                            onChange={(e) => setForm({ ...form, clasificacion: e.target.value })}
                        >
                            <option value="">Sin clasificar</option>
                            {CLASIFICACIONES.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field label="Video o imagen demostrativa (URL externa opcional)">
                        <Input
                            value={form.media_url}
                            onChange={(e) => setForm({ ...form, media_url: e.target.value })}
                            placeholder="https://..."
                            disabled={!!mediaFile}
                        />
                        <span className="text-xs text-muted-foreground">
                            Pegar un link de YouTube, Vimeo, etc. — o subir un archivo propio abajo.
                        </span>
                    </Field>
                    <Field label="Subir archivo propio (opcional)">
                        <input
                            ref={mediaInputRef}
                            type="file"
                            accept="video/mp4,video/webm,video/quicktime,image/png,image/jpeg,image/webp"
                            onChange={onMediaChange}
                            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground file:transition hover:file:brightness-110"
                        />
                        <span className="text-xs text-muted-foreground">
                            MP4, WEBM, MOV, PNG, JPG o WEBP. Máximo 50 MB. Si se sube un archivo, reemplaza la URL
                            de arriba.
                        </span>
                        {mediaFile && (
                            <span className="text-xs font-semibold text-primary">Archivo elegido: {mediaFile.name}</span>
                        )}
                        {!mediaFile && mediaUrlActual && (
                            <span className="text-xs text-muted-foreground">
                                Ya hay un archivo cargado para este ejercicio.
                            </span>
                        )}
                        {mediaError && <ErrorBox>{mediaError}</ErrorBox>}
                    </Field>
                    <Field label="Descripción / técnica">
                        <Textarea
                            value={form.descripcion}
                            onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                        />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={cerrarModal}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Btn>
                    </div>
                </form>
            </Modal>

            {/*
              Reportado por Nalux: con w-full (ancho fijo al 100% del modal), un
              video vertical (grabado con el celular, alto > ancho) terminaba
              gigante en pantalla porque la altura escalaba libre en proporción
              a ese ancho. max-h-[70vh] + w-auto deja que el navegador elija el
              tamaño que entra a la vez en el ancho del modal Y en el alto de
              la pantalla, funciona igual para fotos que ya se veían bien.
            */}
            <Modal
                open={!!previewEj}
                onClose={() => setPreviewEj(null)}
                title={previewEj?.nombre || 'Demostración'}
            >
                {previewEj && tipoDePreview(previewEj.media_url) === 'video' ? (
                    <video
                        src={previewEj.media_url}
                        controls
                        autoPlay
                        playsInline
                        className="mx-auto h-auto max-h-[70vh] w-auto max-w-full rounded-xl bg-black"
                    />
                ) : previewEj ? (
                    <img
                        src={previewEj.media_url}
                        alt={`Demostración de ${previewEj.nombre}`}
                        className="mx-auto h-auto max-h-[70vh] w-auto max-w-full rounded-xl"
                    />
                ) : null}
            </Modal>
        </AppLayout>
    );
};

export default EjerciciosPage;
