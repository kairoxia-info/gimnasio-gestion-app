import React, { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Image as ImageIcon, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Textarea } from '@/components/ui-kit';
import NoticiaVista, { PALETA_CARTEL } from '@/components/NoticiaVista';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';

// Noticias (migraciones 0068 + 0069, pedido de Nalux 21/09/2026, visto en
// Control Gym): lo que el alumno ve arriba de todo al abrir su rutina.
// Módulo aparte de Avisos, que sigue siendo texto con "Entendido".
//
// Dos tipos, elegidos al crear:
//   * Imagen: solo una foto, tal cual.
//   * Cartel: título + texto + color de fondo de una paleta fija de seis, con
//     imagen opcional adentro. Sin editor visual, sin elegir color libre: es
//     una plantilla, así sale siempre prolija sin que el profesor tenga que
//     pensar en diseño.
//
// Las dos conviven en esta lista y en el mismo carrusel del portal.
//
// Coreografía de subida (misma que ejercicios/alumnos/progreso): primero la
// fila (para tener el id), después el archivo con ESE id como nombre (la
// policy del bucket exige que la fila exista), al final la URL. Si la subida
// falla en una noticia de tipo imagen, se borra la fila (sin foto no sirve);
// en un cartel la imagen es opcional, así que la fila queda y se avisa.
const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const BUCKET = 'noticias-imagenes';
const MAX_TITULO = 80;
const MAX_TEXTO = 400;

// Path dentro del bucket a partir de la URL pública guardada -- mismo
// criterio que pathEnBucket() de lib/mediaEjercicio.js, para otro bucket.
const pathDeNoticia = (url) => {
    const marca = `/object/public/${BUCKET}/`;
    const i = url?.indexOf(marca) ?? -1;
    return i === -1 ? null : url.slice(i + marca.length);
};

const formVacio = { tipo: null, titulo: '', texto: '', color_fondo: PALETA_CARTEL[0].clave };

const NoticiasPage = () => {
    const { profile } = useAuth();
    const [noticias, setNoticias] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [ocupadaId, setOcupadaId] = useState(null);

    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(formVacio);
    const [archivo, setArchivo] = useState(null);
    const [preview, setPreview] = useState('');
    const [formError, setFormError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const inputRef = useRef(null);

    const cargar = () => {
        setLoading(true);
        listAll('noticias', { sort: '-created_at' })
            .then((n) => {
                setNoticias(n);
                setError('');
            })
            .catch(() => setError('No se pudieron cargar las noticias.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    const abrirNueva = () => {
        setForm(formVacio);
        setArchivo(null);
        setPreview('');
        setFormError('');
        setOpen(true);
    };

    const cerrar = () => {
        if (guardando) return;
        setOpen(false);
        if (preview) URL.revokeObjectURL(preview);
    };

    const onElegirArchivo = (e) => {
        const file = e.target.files?.[0];
        setFormError('');
        if (!file) {
            setArchivo(null);
            setPreview('');
            return;
        }
        if (!MIME_TO_EXT[file.type]) {
            setFormError('La imagen debe ser PNG, JPG o WEBP.');
            e.target.value = '';
            return;
        }
        if (file.size > MAX_IMAGEN_BYTES) {
            setFormError('La imagen no puede pesar más de 5 MB.');
            e.target.value = '';
            return;
        }
        setArchivo(file);
        setPreview(URL.createObjectURL(file));
    };

    const subirImagen = async (noticiaId, file) => {
        const ext = MIME_TO_EXT[file.type];
        const path = `${profile.gimnasio_id}/${noticiaId}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;
        const {
            data: { publicUrl },
        } = supabase.storage.from(BUCKET).getPublicUrl(path);
        await updateRec('noticias', noticiaId, { imagen_url: publicUrl });
    };

    const guardar = async (e) => {
        e.preventDefault();
        setFormError('');
        if (!profile?.gimnasio_id) return;

        const esCartel = form.tipo === 'cartel';
        if (!esCartel && !archivo) {
            setFormError('Elegir una imagen para subir.');
            return;
        }
        if (esCartel && !form.titulo.trim()) {
            setFormError('El cartel necesita un título.');
            return;
        }

        setGuardando(true);
        let creada = null;
        try {
            creada = await createRec('noticias', {
                tipo: form.tipo,
                activa: true,
                orden: 0,
                titulo: esCartel ? form.titulo.trim() : null,
                texto: esCartel ? form.texto.trim() || null : null,
                color_fondo: esCartel ? form.color_fondo : null,
            });

            if (archivo) {
                try {
                    await subirImagen(creada.id, archivo);
                } catch (errSubida) {
                    if (!esCartel) throw errSubida;
                    // En un cartel la imagen es opcional: el cartel queda, y
                    // se avisa que la foto no entró para que lo reintente.
                    setError('El cartel se creó, pero la imagen no se pudo subir. Borrarlo y crearlo de nuevo si la quieres.');
                }
            }

            setOpen(false);
            if (preview) URL.revokeObjectURL(preview);
            cargar();
        } catch (_) {
            if (creada?.id) {
                try {
                    await removeRec('noticias', creada.id);
                } catch (__) {
                    // nada más que hacer
                }
            }
            setFormError('No se pudo crear la noticia. Probar de nuevo.');
        } finally {
            setGuardando(false);
        }
    };

    const toggleActiva = async (n) => {
        setOcupadaId(n.id);
        try {
            await updateRec('noticias', n.id, { activa: !n.activa });
            setNoticias((prev) => prev.map((x) => (x.id === n.id ? { ...x, activa: !n.activa } : x)));
        } catch (_) {
            setError('No se pudo actualizar la noticia.');
        } finally {
            setOcupadaId(null);
        }
    };

    // Borrado real (no archivado como en Avisos): una noticia vieja no tiene
    // historial que valga la pena conservar, y cada imagen ocupa storage. El
    // archivo se saca del bucket antes que la fila, best effort -- igual que
    // EjerciciosPage.jsx.
    const borrar = async (n) => {
        if (!window.confirm('¿Borrar esta noticia? Se saca del portal de los alumnos y no se puede deshacer.')) return;
        setOcupadaId(n.id);
        try {
            const path = pathDeNoticia(n.imagen_url);
            if (path) {
                try {
                    await supabase.storage.from(BUCKET).remove([path]);
                } catch (_) {
                    // best effort
                }
            }
            await removeRec('noticias', n.id);
            setNoticias((prev) => prev.filter((x) => x.id !== n.id));
        } catch (_) {
            setError('No se pudo borrar la noticia.');
        } finally {
            setOcupadaId(null);
        }
    };

    // Las que el alumno ve hoy, en el orden del carrusel: misma regla que
    // ver_plan_por_codigo() (activas, un cartel siempre / una imagen solo con
    // foto subida, orden DESC y después la más nueva).
    const enElPortal = noticias
        .filter((n) => n.activa && (n.tipo === 'cartel' || n.imagen_url))
        .sort((a, b) => b.orden - a.orden || new Date(b.created_at) - new Date(a.created_at));
    const posicionEnPortal = (id) => enElPortal.findIndex((n) => n.id === id);

    // Vista previa del cartel mientras se completa: la misma pieza que va a
    // ver el alumno, así el profesor no tiene que imaginarse cómo queda.
    const previewCartel = {
        tipo: 'cartel',
        titulo: form.titulo || 'Título del cartel',
        texto: form.texto,
        color_fondo: form.color_fondo,
        imagen_url: preview || null,
    };

    return (
        <AppLayout
            ayuda="Lo que el alumno ve arriba de todo al abrir su rutina: una foto (una promoción, un evento) o un cartel con título y texto sobre un color. Si hay varias activas, pasan solas en un carrusel. Para mensajes que el alumno tiene que confirmar con 'Entendido', usa Avisos."
            title="Noticias"
            subtitle="Imágenes o carteles para el portal del alumno. Las activas pasan en un carrusel."
            actions={
                <Btn onClick={abrirNueva}>
                    <Plus className="h-4 w-4" /> Nueva noticia
                </Btn>
            }
        >
            <Helmet>
                <title>Noticias | RutNail</title>
                <meta name="description" content="Imágenes y carteles para el portal del alumno." />
            </Helmet>

            {error && (
                <div className="mb-4">
                    <ErrorBox>{error}</ErrorBox>
                </div>
            )}

            {loading ? (
                <Loading rows={3} />
            ) : noticias.length === 0 ? (
                <Empty>
                    Todavía no hay ninguna noticia. Con &ldquo;Nueva noticia&rdquo; se sube una imagen (PNG, JPG o
                    WEBP, hasta 5 MB) o se arma un cartel con título, texto y color.
                </Empty>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {noticias.map((n) => {
                        const ocupada = ocupadaId === n.id;
                        const pos = posicionEnPortal(n.id);
                        return (
                            <Card key={n.id} className="flex flex-col gap-3">
                                <div
                                    className={`relative flex min-h-[180px] items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary/40 p-2 transition ${
                                        n.activa ? '' : 'opacity-40 grayscale'
                                    }`}
                                >
                                    <NoticiaVista noticia={n} compacto />
                                    {pos !== -1 && (
                                        <Badge className="absolute left-3 top-3 border-transparent bg-primary text-primary-foreground">
                                            {enElPortal.length > 1 ? `En el portal · ${pos + 1} de ${enElPortal.length}` : 'En el portal ahora'}
                                        </Badge>
                                    )}
                                </div>

                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex flex-wrap gap-1.5">
                                        <Badge className="border-border text-muted-foreground">
                                            {n.tipo === 'cartel' ? 'Cartel' : 'Imagen'}
                                        </Badge>
                                        <Badge className={n.activa ? 'border-ok/60 text-ok' : 'border-border text-muted-foreground'}>
                                            {n.activa ? 'Activa' : 'Inactiva'}
                                        </Badge>
                                    </div>
                                    <div className="flex gap-2">
                                        <Btn
                                            variant="ghost"
                                            className="px-3 py-2 text-xs"
                                            disabled={ocupada}
                                            onClick={() => toggleActiva(n)}
                                        >
                                            {n.activa ? 'Desactivar' : 'Activar'}
                                        </Btn>
                                        <Btn
                                            variant="danger"
                                            className="px-3 py-2 text-xs"
                                            disabled={ocupada}
                                            onClick={() => borrar(n)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" /> Borrar
                                        </Btn>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            <Modal open={open} onClose={cerrar} title="Nueva noticia" wide={form.tipo === 'cartel'}>
                {!form.tipo ? (
                    // Paso 1: elegir el tipo. Dos botones grandes, nada más.
                    <div className="grid gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, tipo: 'imagen' })}
                            className="flex flex-col items-start gap-2 rounded-2xl border border-border p-5 text-left transition hover:border-primary"
                        >
                            <ImageIcon className="h-7 w-7 text-primary" strokeWidth={1.8} />
                            <span className="font-display text-base font-bold">Imagen</span>
                            <span className="text-sm text-muted-foreground">
                                Subir una foto tal cual está: un flyer, una promoción, una foto del gimnasio.
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, tipo: 'cartel' })}
                            className="flex flex-col items-start gap-2 rounded-2xl border border-border p-5 text-left transition hover:border-primary"
                        >
                            <LayoutTemplate className="h-7 w-7 text-primary" strokeWidth={1.8} />
                            <span className="font-display text-base font-bold">Cartel</span>
                            <span className="text-sm text-muted-foreground">
                                Título y texto sobre un color, sin necesidad de diseñar nada. Con foto opcional.
                            </span>
                        </button>
                    </div>
                ) : (
                    <form onSubmit={guardar} className="space-y-4">
                        {form.tipo === 'cartel' && (
                            <>
                                <Field label="Título">
                                    <Input
                                        value={form.titulo}
                                        onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                                        maxLength={MAX_TITULO}
                                        placeholder="Ej: Cerrado el lunes 24"
                                        required
                                    />
                                </Field>
                                <Field label="Texto (opcional)">
                                    <Textarea
                                        value={form.texto}
                                        onChange={(e) => setForm({ ...form, texto: e.target.value })}
                                        maxLength={MAX_TEXTO}
                                        placeholder="Ej: Por el feriado, reabrimos el martes a las 8."
                                    />
                                </Field>
                                <Field label="Color de fondo">
                                    <div className="flex flex-wrap gap-2">
                                        {PALETA_CARTEL.map((c) => (
                                            <button
                                                key={c.clave}
                                                type="button"
                                                onClick={() => setForm({ ...form, color_fondo: c.clave })}
                                                aria-label={c.nombre}
                                                aria-pressed={form.color_fondo === c.clave}
                                                className={`h-10 w-10 rounded-xl border-2 transition ${
                                                    form.color_fondo === c.clave
                                                        ? 'scale-110 border-foreground'
                                                        : 'border-transparent hover:scale-105'
                                                }`}
                                                style={{ background: c.fondo }}
                                            />
                                        ))}
                                    </div>
                                </Field>
                            </>
                        )}

                        <Field label={form.tipo === 'cartel' ? 'Imagen (opcional)' : 'Imagen'}>
                            <input
                                ref={inputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={onElegirArchivo}
                                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground file:transition hover:file:brightness-110"
                            />
                            <span className="text-xs text-muted-foreground">
                                PNG, JPG o WEBP, hasta 5 MB. Se muestra completa, sin recortar.
                            </span>
                        </Field>

                        {/* Vista previa: exactamente lo que va a ver el alumno. */}
                        {(form.tipo === 'cartel' || preview) && (
                            <Field label="Así lo va a ver el alumno">
                                <div className="rounded-xl border border-border bg-secondary/40 p-3">
                                    <NoticiaVista
                                        noticia={
                                            form.tipo === 'cartel'
                                                ? previewCartel
                                                : { tipo: 'imagen', imagen_url: preview }
                                        }
                                        compacto
                                    />
                                </div>
                            </Field>
                        )}

                        {formError && <ErrorBox>{formError}</ErrorBox>}

                        <div className="flex justify-between gap-2 pt-2">
                            <Btn variant="ghost" onClick={() => setForm({ ...form, tipo: null })} disabled={guardando}>
                                Cambiar tipo
                            </Btn>
                            <div className="flex gap-2">
                                <Btn variant="ghost" onClick={cerrar} disabled={guardando}>
                                    Cancelar
                                </Btn>
                                <Btn type="submit" disabled={guardando}>
                                    {guardando ? 'Guardando...' : 'Publicar'}
                                </Btn>
                            </div>
                        </div>
                    </form>
                )}
            </Modal>
        </AppLayout>
    );
};

export default NoticiasPage;
