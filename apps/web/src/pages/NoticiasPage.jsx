import React, { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ImagePlus, Newspaper, Trash2 } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Loading } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';

// Noticias (migración 0068, pedido de Nalux 21/09/2026, visto en Control
// Gym): banners con imagen para el portal del alumno. Módulo aparte de
// Avisos, que sigue siendo texto con "Entendido". Acá no hay título ni texto
// ni video: imagen + interruptor activa/inactiva + borrar, y nada más.
//
// El alumno ve UNA sola (la activa más reciente), arriba de todo en su
// portal -- ver_plan_por_codigo() la elige del lado del servidor.
//
// Misma coreografía de subida que ejercicios/alumnos/progreso: primero se
// crea la fila (para tener el id), después se sube el archivo con ESE id
// como nombre (la policy del bucket exige que la fila exista), y al final se
// guarda la URL. Si la subida falla, se borra la fila -- una noticia sin
// imagen no sirve para nada y ver_plan_por_codigo() igual la ignoraría.
const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const BUCKET = 'noticias-imagenes';

// Path dentro del bucket a partir de la URL pública guardada -- mismo
// criterio que pathEnBucket() de lib/mediaEjercicio.js, para otro bucket.
const pathDeNoticia = (url) => {
    const marca = `/object/public/${BUCKET}/`;
    const i = url?.indexOf(marca) ?? -1;
    return i === -1 ? null : url.slice(i + marca.length);
};

const NoticiasPage = () => {
    const { profile } = useAuth();
    const [noticias, setNoticias] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [subiendo, setSubiendo] = useState(false);
    const [ocupadaId, setOcupadaId] = useState(null);
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

    const onElegirImagen = async (e) => {
        const file = e.target.files?.[0];
        setError('');
        if (!file || !profile?.gimnasio_id) return;
        if (!MIME_TO_EXT[file.type]) {
            setError('La imagen debe ser PNG, JPG o WEBP.');
            e.target.value = '';
            return;
        }
        if (file.size > MAX_IMAGEN_BYTES) {
            setError('La imagen no puede pesar más de 5 MB.');
            e.target.value = '';
            return;
        }

        setSubiendo(true);
        let creada = null;
        try {
            creada = await createRec('noticias', { activa: true, orden: 0 });
            const ext = MIME_TO_EXT[file.type];
            const path = `${profile.gimnasio_id}/${creada.id}.${ext}`;
            const { error: uploadError } = await supabase.storage
                .from(BUCKET)
                .upload(path, file, { upsert: true });
            if (uploadError) throw uploadError;

            const {
                data: { publicUrl },
            } = supabase.storage.from(BUCKET).getPublicUrl(path);
            await updateRec('noticias', creada.id, { imagen_url: publicUrl });
            cargar();
        } catch (_) {
            // Sin imagen la fila no sirve: se borra para no dejar un banner
            // vacío colgado. Best effort -- si esto también falla, la RPC del
            // alumno igual la ignora (imagen_url NULL).
            if (creada?.id) {
                try {
                    await removeRec('noticias', creada.id);
                } catch (__) {
                    // nada más que hacer
                }
            }
            setError('No se pudo subir la imagen. Probar de nuevo.');
        } finally {
            setSubiendo(false);
            if (inputRef.current) inputRef.current.value = '';
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
    // historial que valga la pena conservar, y cada una ocupa storage. El
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

    // La que ve el alumno hoy: misma regla que ver_plan_por_codigo() (activa,
    // con imagen, orden DESC y después la más nueva). Se marca en la lista
    // para que el profesor sepa cuál está al aire sin tener que adivinar.
    const enElPortal = noticias
        .filter((n) => n.activa && n.imagen_url)
        .sort((a, b) => b.orden - a.orden || new Date(b.created_at) - new Date(a.created_at))[0];

    return (
        <AppLayout
            ayuda="Imágenes grandes (una promoción, un cambio de horario, un evento) que el alumno ve arriba de todo al abrir su rutina. Se muestra solo la activa más reciente; las demás quedan guardadas para volver a activarlas. Para mensajes de texto, usa Avisos."
            title="Noticias"
            subtitle="Banners con imagen para el portal del alumno. Se muestra la activa más reciente."
            actions={
                <>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={onElegirImagen}
                        className="hidden"
                    />
                    <Btn onClick={() => inputRef.current?.click()} disabled={subiendo}>
                        <ImagePlus className="h-4 w-4" /> {subiendo ? 'Subiendo...' : 'Subir imagen'}
                    </Btn>
                </>
            }
        >
            <Helmet>
                <title>Noticias | RutNail</title>
                <meta name="description" content="Banners con imagen para el portal del alumno." />
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
                    Todavía no hay ninguna noticia. Subir una imagen con el botón de arriba: PNG, JPG o WEBP,
                    hasta 5 MB. Se ve mejor apaisada (más ancha que alta).
                </Empty>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {noticias.map((n) => {
                        const ocupada = ocupadaId === n.id;
                        return (
                            <Card key={n.id} className="flex flex-col gap-3">
                                <div className="relative overflow-hidden rounded-xl border border-border bg-secondary/40">
                                    {n.imagen_url ? (
                                        <img
                                            src={n.imagen_url}
                                            alt="Noticia"
                                            className={`aspect-video w-full object-cover transition ${n.activa ? '' : 'opacity-40 grayscale'}`}
                                        />
                                    ) : (
                                        <div className="flex aspect-video w-full items-center justify-center text-muted-foreground">
                                            <Newspaper className="h-8 w-8" strokeWidth={1.6} />
                                        </div>
                                    )}
                                    {enElPortal?.id === n.id && (
                                        <Badge className="absolute left-3 top-3 border-transparent bg-primary text-primary-foreground">
                                            En el portal ahora
                                        </Badge>
                                    )}
                                </div>

                                <div className="flex items-center justify-between gap-2">
                                    <Badge className={n.activa ? 'border-ok/60 text-ok' : 'border-border text-muted-foreground'}>
                                        {n.activa ? 'Activa' : 'Inactiva'}
                                    </Badge>
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
        </AppLayout>
    );
};

export default NoticiasPage;
