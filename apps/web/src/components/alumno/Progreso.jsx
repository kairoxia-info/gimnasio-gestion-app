import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Smartphone, Trash2 } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { Btn, Card, ConfirmInlineActions, Empty, ErrorBox, Field, Input, Textarea } from '@/components/ui-kit';
import { useAuth } from '@/contexts/AuthContext';
import { createRec, removeRec, updateRec } from '@/lib/data';
import { fmtFecha, hoy } from '@/lib/format';

// Carga diferida: recharts (~100 KB) recién se descarga cuando el profesor
// entra a la pestaña de Progreso, no de entrada con el resto de la ficha del
// alumno -- mismo criterio que components/GraficoIngresos.jsx.
const GraficoPeso = React.lazy(() => import('@/components/GraficoPeso'));

/* ---------------- Progreso ---------------- */

// pierna y cadera (migración 0023, 04/09/2026): investigado qué miden los
// gimnasios para seguimiento de progreso -- el set estándar es cintura,
// cadera, pecho, brazo y muslo. Nalux pidió pierna explícitamente; cadera se
// suma de una vez por ser el complemento estándar de cintura (relación
// cintura-cadera) en toda la bibliografía consultada.
const FORM_VACIO = {
    fecha: hoy(),
    peso: '',
    cintura: '',
    cadera: '',
    pecho: '',
    brazo: '',
    pierna: '',
    observaciones: '',
};

// Un campo vacio se guarda como null, NO como 0: el profesor casi nunca
// mide todo el mismo dia (lo normal es pesar seguido y medir de vez en
// cuando), y un 0 se guardaba como si le hubiera medido 0 cm de cintura.
// Ademas ensuciaba el historial ("Cintura 0 · Cadera 0 · ...") y arruinaria
// cualquier grafico de evolucion de esa medida mas adelante.
const medida = (v) => {
    const texto = String(v ?? '').trim();
    if (texto === '') return null;
    const n = Number(texto);
    if (!Number.isFinite(n)) return null;
    // El 0 tambien cuenta como "no medido": nadie pesa 0 kg ni tiene 0 cm de
    // cintura. Ademas de los que se carguen vacios de ahora en mas, esto tapa
    // los registros que ya quedaron con 0 guardado antes de este arreglo, sin
    // tener que tocarle ningun dato ya cargado.
    return n > 0 ? n : null;
};

// Fase 2.5 (13/09/2026): mismo límite y mapa de extensiones que ya usan
// AlumnosPage.jsx/ConfiguracionPage.jsx/EjerciciosPage.jsx para sus propias
// subidas -- se repite acá en vez de compartirlo porque ese es el patrón
// que ya sigue el resto de estas pantallas (cada una con su propia
// constante chica), no algo nuevo que se está inventando.
const MAX_FOTO_PROGRESO_BYTES = 2 * 1024 * 1024;
const MIME_TO_EXT_PROGRESO = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const Progreso = ({ alumnoId, registros, onChange }) => {
    const { profile } = useAuth();
    const [form, setForm] = useState(FORM_VACIO);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    // Confirmación inline por registro (10/09/2026, repaso general): antes esto
    // era un window.confirm(), el mismo cartel nativo que Nalux ya reportó que
    // en algunos navegadores no aparece y deja el botón "sin hacer nada". Y si
    // el borrado fallaba, no se avisaba nada.
    const [confirmandoBorrarId, setConfirmandoBorrarId] = useState(null);
    const [borrando, setBorrando] = useState(false);
    // Foto de progreso (Fase 2.5, 13/09/2026): mismo patrón de
    // archivo+preview que AlumnosPage.jsx, pero el bucket ('progreso-fotos',
    // migración 0049) es PRIVADO -- una foto de progreso físico es más
    // sensible que una de perfil. Por eso acá no hay getPublicUrl(): se
    // guarda el PATH crudo en progreso.foto_path y se piden signed URLs
    // (fotosFirmadas más abajo) cada vez que hay que mostrarlas.
    const [fotoFile, setFotoFile] = useState(null);
    const [fotoPreview, setFotoPreview] = useState('');
    const [fotoError, setFotoError] = useState('');
    const [fotosFirmadas, setFotosFirmadas] = useState({});

    // Se resuelven en batch (createSignedUrls, un solo viaje de red) cada
    // vez que cambia la lista de registros -- no una por una al renderizar,
    // que dispararía N requests innecesarios en cada re-render.
    useEffect(() => {
        const paths = registros.filter((r) => r.foto_path).map((r) => r.foto_path);
        if (paths.length === 0) {
            setFotosFirmadas({});
            return;
        }
        supabase.storage
            .from('progreso-fotos')
            .createSignedUrls(paths, 3600)
            .then(({ data }) => {
                const mapa = {};
                (data || []).forEach((d) => {
                    if (d.signedUrl) mapa[d.path] = d.signedUrl;
                });
                setFotosFirmadas(mapa);
            })
            .catch(() => setFotosFirmadas({}));
    }, [registros]);

    const onFotoChange = (e) => {
        const file = e.target.files?.[0];
        setFotoError('');
        if (!file) {
            setFotoFile(null);
            setFotoPreview('');
            return;
        }
        if (!MIME_TO_EXT_PROGRESO[file.type]) {
            setFotoError('La foto debe ser PNG, JPG o WEBP.');
            e.target.value = '';
            return;
        }
        if (file.size > MAX_FOTO_PROGRESO_BYTES) {
            setFotoError('La foto no puede pesar más de 2 MB.');
            e.target.value = '';
            return;
        }
        setFotoFile(file);
        setFotoPreview(URL.createObjectURL(file));
    };

    // Reintentar SOLO la foto en un registro que ya existe pero se quedó sin
    // ella (14/09/2026, probado en vivo por Nalux: subir la foto falló por
    // un corte puntual del lado de Supabase -- el peso/medidas ya se habían
    // guardado bien). Hasta acá, la única forma de reintentar era borrar el
    // registro entero y cargarlo todo de nuevo, perdiendo también el peso y
    // las medidas por un problema que era solo de la foto. Un input de
    // archivo compartido (en vez de uno por fila) porque son N filas
    // dinámicas -- más simple que manejar N refs.
    const retryFotoInputRef = useRef(null);
    const [retryFotoTargetId, setRetryFotoTargetId] = useState(null);
    const [subiendoFotoId, setSubiendoFotoId] = useState(null);
    const [errorFoto, setErrorFoto] = useState(null); // { id, mensaje } | null

    const pedirFotoParaRegistro = (registroId) => {
        setRetryFotoTargetId(registroId);
        retryFotoInputRef.current?.click();
    };

    const onRetryFotoSeleccionada = async (e) => {
        const file = e.target.files?.[0];
        const targetId = retryFotoTargetId;
        e.target.value = '';
        if (!file || !targetId) return;
        setErrorFoto(null);
        if (!MIME_TO_EXT_PROGRESO[file.type]) {
            setErrorFoto({ id: targetId, mensaje: 'La foto debe ser PNG, JPG o WEBP.' });
            return;
        }
        if (file.size > MAX_FOTO_PROGRESO_BYTES) {
            setErrorFoto({ id: targetId, mensaje: 'La foto no puede pesar más de 2 MB.' });
            return;
        }
        if (!profile?.gimnasio_id) return;
        setSubiendoFotoId(targetId);
        try {
            const ext = MIME_TO_EXT_PROGRESO[file.type];
            const path = `${profile.gimnasio_id}/${targetId}.${ext}`;
            const { error: uploadError } = await supabase.storage
                .from('progreso-fotos')
                .upload(path, file, { upsert: true });
            if (uploadError) throw uploadError;
            await updateRec('progreso', targetId, { foto_path: path });
            onChange();
        } catch (_) {
            setErrorFoto({ id: targetId, mensaje: 'No se pudo subir. Probar de nuevo en unos minutos.' });
        } finally {
            setSubiendoFotoId(null);
        }
    };

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            const creado = await createRec('progreso', {
                alumno_id: alumnoId,
                fecha: form.fecha,
                peso: medida(form.peso),
                cintura: medida(form.cintura),
                cadera: medida(form.cadera),
                pecho: medida(form.pecho),
                brazo: medida(form.brazo),
                pierna: medida(form.pierna),
                observaciones: form.observaciones,
            });

            // La foto se sube DESPUÉS de crear el registro, nunca antes: la
            // policy del bucket exige que ya exista una fila real de
            // progreso con ese id (mismo criterio que alumnos-fotos).
            if (fotoFile && profile?.gimnasio_id) {
                try {
                    const ext = MIME_TO_EXT_PROGRESO[fotoFile.type];
                    const path = `${profile.gimnasio_id}/${creado.id}.${ext}`;
                    const { error: uploadError } = await supabase.storage
                        .from('progreso-fotos')
                        .upload(path, fotoFile, { upsert: true });
                    if (uploadError) throw uploadError;
                    await updateRec('progreso', creado.id, { foto_path: path });
                } catch (_) {
                    setError(
                        'El registro se guardó, pero la foto no se pudo subir. Se puede volver a intentar desde "Agregar foto" en el registro, sin perder lo demás.',
                    );
                }
            }

            setForm({ ...FORM_VACIO, fecha: hoy() });
            setFotoFile(null);
            setFotoPreview('');
            onChange();
        } catch (_) {
            setError('No se pudo guardar el registro. Reintentar en unos minutos.');
        } finally {
            setSaving(false);
        }
    };

    const borrar = async (registro) => {
        setBorrando(true);
        setError('');
        try {
            // Storage no se limpia solo (mismo criterio que EjerciciosPage.jsx):
            // se borra el archivo primero, best effort -- si ya no está o
            // falla, no bloquea el borrado del registro en sí.
            if (registro.foto_path) {
                try {
                    await supabase.storage.from('progreso-fotos').remove([registro.foto_path]);
                } catch (_) {
                    // best effort, seguimos igual
                }
            }
            await removeRec('progreso', registro.id);
            setConfirmandoBorrarId(null);
            onChange();
        } catch (_) {
            setError('No se pudo eliminar el registro. Reintentar en unos minutos.');
        } finally {
            setBorrando(false);
        }
    };

    // Solo los dias en que efectivamente se pesó: un registro donde el
    // profesor midió la cintura pero no el peso no tiene que hundir la linea
    // hasta cero.
    const serie = [...registros]
        .filter((r) => medida(r.peso) !== null)
        .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
        .map((r) => ({ fecha: fmtFecha(r.fecha).slice(0, 5), peso: Number(r.peso) }));

    return (
        <div className="grid gap-5 lg:grid-cols-[1fr,1.2fr]">
            {/* Input compartido para "Agregar foto" en un registro ya
                existente (ver pedirFotoParaRegistro/onRetryFotoSeleccionada
                más arriba) -- uno solo para las N filas del historial, oculto,
                se dispara por código al tocar el botón de la fila. */}
            <input
                ref={retryFotoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onRetryFotoSeleccionada}
            />
            {error && (
                <div className="lg:col-span-2">
                    <ErrorBox>{error}</ErrorBox>
                </div>
            )}
            <Card>
                <h3 className="mb-4 font-display text-lg font-bold">Nuevo registro</h3>
                <form onSubmit={guardar} className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Fecha">
                            <Input
                                type="date"
                                value={form.fecha}
                                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                                required
                            />
                        </Field>
                        <Field label="Peso (kg)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.peso}
                                onChange={(e) => setForm({ ...form, peso: e.target.value })}
                            />
                        </Field>
                        <Field label="Cintura (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.cintura}
                                onChange={(e) => setForm({ ...form, cintura: e.target.value })}
                            />
                        </Field>
                        <Field label="Cadera (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.cadera}
                                onChange={(e) => setForm({ ...form, cadera: e.target.value })}
                            />
                        </Field>
                        <Field label="Pecho (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.pecho}
                                onChange={(e) => setForm({ ...form, pecho: e.target.value })}
                            />
                        </Field>
                        <Field label="Brazo (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.brazo}
                                onChange={(e) => setForm({ ...form, brazo: e.target.value })}
                            />
                        </Field>
                        <Field label="Pierna (cm)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.pierna}
                                onChange={(e) => setForm({ ...form, pierna: e.target.value })}
                            />
                        </Field>
                    </div>
                    <Field label="Observaciones de salud / lesiones">
                        <Textarea
                            value={form.observaciones}
                            onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                        />
                    </Field>
                    <Field label="Foto de progreso (opcional)">
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={onFotoChange}
                            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-semibold"
                        />
                        <span className="text-xs text-muted-foreground">PNG, JPG o WEBP. Máximo 2 MB.</span>
                        {fotoError && <p className="mt-1 text-xs text-destructive">{fotoError}</p>}
                        {fotoPreview && (
                            <img
                                src={fotoPreview}
                                alt="Vista previa"
                                className="mt-2 h-24 w-24 rounded-xl border border-border object-cover"
                            />
                        )}
                    </Field>
                    <Btn type="submit" disabled={saving}>
                        {saving ? 'Guardando...' : 'Registrar'}
                    </Btn>
                </form>
            </Card>

            <div className="space-y-5">
                <Card>
                    <h3 className="mb-4 font-display text-lg font-bold">Evolución del peso</h3>
                    {serie.length < 2 ? (
                        <Empty>Agregar al menos dos registros para ver el gráfico.</Empty>
                    ) : (
                        <div className="h-56">
                            <React.Suspense
                                fallback={
                                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                        Cargando el gráfico...
                                    </div>
                                }
                            >
                                <GraficoPeso serie={serie} />
                            </React.Suspense>
                        </div>
                    )}
                </Card>

                <Card>
                    <h3 className="mb-3 font-display text-lg font-bold">Historial</h3>
                    {registros.length === 0 ? (
                        <Empty>Sin registros de progreso.</Empty>
                    ) : (
                        <ul className="divide-y divide-border">
                            {registros.map((r) => (
                                <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                                    <div className="flex min-w-0 items-start gap-3">
                                        {/* Foto de progreso (Fase 2.5, 13/09/2026): miniatura
                                            clickeable que abre la foto de tamaño real en una
                                            pestaña nueva -- con la signed URL ya resuelta
                                            (fotosFirmadas), nunca la URL pública (el bucket es
                                            privado). Si la signed URL todavía no llegó (recién
                                            montado, o venció y no se refrescó), no se muestra
                                            nada en vez de un ícono roto. */}
                                        {r.foto_path && fotosFirmadas[r.foto_path] && (
                                            <a
                                                href={fotosFirmadas[r.foto_path]}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="shrink-0"
                                            >
                                                <img
                                                    src={fotosFirmadas[r.foto_path]}
                                                    alt={`Foto de progreso del ${fmtFecha(r.fecha)}`}
                                                    className="h-14 w-14 rounded-xl border border-border object-cover"
                                                />
                                            </a>
                                        )}
                                        <div className="min-w-0">
                                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                                            <span>
                                                {fmtFecha(r.fecha)}
                                                {medida(r.peso) !== null ? ` · ${r.peso} kg` : ''}
                                            </span>
                                            {/* Fase 2.7 (13/09/2026): distingue lo que cargó el
                                                alumno desde /mi-plan (migración 0050,
                                                alumno_cargar_peso) de lo que cargó el profesor acá
                                                mismo -- sin esto, el profesor no tiene forma de
                                                saber que el alumno cargó su propio peso. */}
                                            {r.origen === 'alumno' && (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                                                    <Smartphone className="h-3 w-3" aria-hidden="true" />
                                                    Registrado por el alumno
                                                </span>
                                            )}
                                        </p>
                                        {/* Solo las medidas realmente tomadas ese dia: antes
                                            salian las cinco siempre, con 0 en las que no se
                                            habian medido. */}
                                        {(() => {
                                            const tomadas = [
                                                ['Cintura', r.cintura],
                                                ['Cadera', r.cadera],
                                                ['Pecho', r.pecho],
                                                ['Brazo', r.brazo],
                                                ['Pierna', r.pierna],
                                            ].filter(([, v]) => medida(v) !== null);
                                            if (tomadas.length === 0) return null;
                                            return (
                                                <p className="text-xs text-muted-foreground">
                                                    {tomadas.map(([n, v]) => `${n} ${v}`).join(' · ')}
                                                </p>
                                            );
                                        })()}
                                        {r.observaciones && <p className="mt-1 text-xs">{r.observaciones}</p>}
                                        {/* Sin foto todavía: puede ser porque nunca se cargó
                                            una, o porque se intentó al crear el registro y
                                            falló (ver el mensaje de error de guardar() más
                                            arriba) -- de cualquier manera, subirla ahora no
                                            pierde nada de lo que ya está guardado. */}
                                        {!r.foto_path && (
                                            <button
                                                type="button"
                                                disabled={subiendoFotoId === r.id}
                                                onClick={() => pedirFotoParaRegistro(r.id)}
                                                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline disabled:opacity-60"
                                            >
                                                <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                                                {subiendoFotoId === r.id ? 'Subiendo...' : 'Agregar foto'}
                                            </button>
                                        )}
                                        {errorFoto?.id === r.id && (
                                            <p className="mt-1 text-xs text-destructive">{errorFoto.mensaje}</p>
                                        )}
                                        </div>
                                    </div>
                                    {confirmandoBorrarId === r.id ? (
                                        <div className="flex shrink-0 items-center gap-1.5">
                                            <ConfirmInlineActions
                                                className="px-3 py-1.5 text-xs"
                                                ejecutando={borrando}
                                                onConfirmar={() => borrar(r)}
                                                onCancelar={() => setConfirmandoBorrarId(null)}
                                            />
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            aria-label="Eliminar registro"
                                            onClick={() => setConfirmandoBorrarId(r.id)}
                                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-destructive"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default Progreso;
