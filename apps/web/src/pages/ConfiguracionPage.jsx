import React, { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import QRCode from 'qrcode';
import { ImagePlus, Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { money } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';

const PERIODOS = ['Diario', 'Semanal', 'Mensual', 'Trimestral', 'Anual'];

// Mismo criterio que OnboardingPage.jsx (subida de logo): 2 MB de tope y
// solo estos tres formatos, para no duplicar lógica de validación distinta
// en dos lugares del mismo flujo.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const COLOR_DEFAULT = '#E10600';

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
    const { profile, refreshProfile } = useAuth();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);

    // Fila completa de "gimnasios" (id, codigo_invitacion, autorregistro_activo,
    // etc.): useAuth().gimnasio solo trae nombre/logo_url/color_principal (ver
    // AuthContext.fetchProfile), no alcanza para esta página. RLS ya permite
    // este SELECT (policy gimnasios_select).
    const [gimnasioFull, setGimnasioFull] = useState(null);
    const [gimnasioLoading, setGimnasioLoading] = useState(true);
    const [gimnasioError, setGimnasioError] = useState('');

    const [dgForm, setDgForm] = useState({ nombre: '', color_principal: COLOR_DEFAULT });
    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState('');
    const [dgSaving, setDgSaving] = useState(false);
    const [dgError, setDgError] = useState('');
    const logoInputRef = useRef(null);

    const [codigoError, setCodigoError] = useState('');
    const [copiado, setCopiado] = useState(false);
    const [autorregistroSaving, setAutorregistroSaving] = useState(false);
    const [regenerando, setRegenerando] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState('');

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

    const cargarGimnasio = () => {
        if (!profile?.gimnasio_id) return;
        setGimnasioLoading(true);
        supabase
            .from('gimnasios')
            .select('*')
            .eq('id', profile.gimnasio_id)
            .single()
            .then(({ data, error: err }) => {
                if (err) throw err;
                setGimnasioFull(data);
                setDgForm({ nombre: data.nombre || '', color_principal: data.color_principal || COLOR_DEFAULT });
                setGimnasioError('');
            })
            .catch(() => setGimnasioError('No se pudieron cargar los datos del gimnasio.'))
            .finally(() => setGimnasioLoading(false));
    };

    useEffect(cargarGimnasio, [profile?.gimnasio_id]);

    // Regenerá el QR cada vez que cambia el código (o el nombre, que va como
    // query param decorativo del saludo en la pantalla pública /unirse).
    useEffect(() => {
        if (!gimnasioFull?.codigo_invitacion) {
            setQrDataUrl('');
            return;
        }
        let cancelado = false;
        const link = `${window.location.origin}/unirse/${gimnasioFull.codigo_invitacion}?g=${encodeURIComponent(gimnasioFull.nombre || '')}`;
        QRCode.toDataURL(link, { width: 240 })
            .then((url) => {
                if (!cancelado) setQrDataUrl(url);
            })
            .catch(() => {
                if (!cancelado) setQrDataUrl('');
            });
        return () => {
            cancelado = true;
        };
    }, [gimnasioFull?.codigo_invitacion, gimnasioFull?.nombre]);

    const onLogoChange = (e) => {
        const file = e.target.files?.[0];
        setDgError('');
        if (!file) {
            setLogoFile(null);
            setLogoPreview('');
            return;
        }
        if (!MIME_TO_EXT[file.type]) {
            setDgError('El logo debe ser PNG, JPG o WEBP.');
            e.target.value = '';
            return;
        }
        if (file.size > MAX_LOGO_BYTES) {
            setDgError('El logo no puede pesar más de 2 MB.');
            e.target.value = '';
            return;
        }
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
    };

    const guardarDatosGimnasio = async (e) => {
        e.preventDefault();
        if (!gimnasioFull?.id) return;
        setDgSaving(true);
        setDgError('');
        try {
            await updateRec('gimnasios', gimnasioFull.id, {
                nombre: dgForm.nombre.trim(),
                color_principal: dgForm.color_principal || COLOR_DEFAULT,
            });

            if (logoFile) {
                const ext = MIME_TO_EXT[logoFile.type];
                const path = `${gimnasioFull.id}/logo.${ext}`;
                const { error: uploadError } = await supabase.storage
                    .from('gimnasio-logos')
                    .upload(path, logoFile, { upsert: true });
                if (uploadError) throw uploadError;

                const {
                    data: { publicUrl },
                } = supabase.storage.from('gimnasio-logos').getPublicUrl(path);

                await updateRec('gimnasios', gimnasioFull.id, { logo_url: publicUrl });
            }

            setLogoFile(null);
            setLogoPreview('');
            if (logoInputRef.current) logoInputRef.current.value = '';
            await refreshProfile();
            cargarGimnasio();
        } catch (_) {
            setDgError(
                'No se pudieron guardar los datos del gimnasio. Si no sos administrador, no tenés permiso para editar esto.',
            );
        } finally {
            setDgSaving(false);
        }
    };

    const copiarCodigo = async () => {
        if (!gimnasioFull?.codigo_invitacion) return;
        try {
            await navigator.clipboard.writeText(gimnasioFull.codigo_invitacion);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
        } catch (_) {
            setCodigoError('No se pudo copiar el código. Copialo a mano.');
        }
    };

    const toggleAutorregistro = async (checked) => {
        if (!gimnasioFull?.id) return;
        setAutorregistroSaving(true);
        setCodigoError('');
        try {
            const actualizado = await updateRec('gimnasios', gimnasioFull.id, { autorregistro_activo: checked });
            setGimnasioFull((g) => ({ ...g, autorregistro_activo: actualizado.autorregistro_activo }));
        } catch (_) {
            setCodigoError('No se pudo actualizar el autorregistro. Si no sos administrador, no tenés permiso.');
        } finally {
            setAutorregistroSaving(false);
        }
    };

    const regenerarCodigo = async () => {
        if (!gimnasioFull?.id) return;
        if (!window.confirm('¿Seguro que querés regenerar el código? El código actual deja de funcionar al toque.')) {
            return;
        }
        setRegenerando(true);
        setCodigoError('');
        try {
            const { data, error: err } = await supabase.rpc('regenerar_codigo_invitacion');
            if (err) throw err;
            setGimnasioFull((g) => ({ ...g, codigo_invitacion: data }));
        } catch (_) {
            setCodigoError('No se pudo regenerar el código. Si no sos administrador, no tenés permiso.');
        } finally {
            setRegenerando(false);
        }
    };

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
                <title>Planes y precios | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Configuración editable de planes del gimnasio: precios, períodos, descuentos y porcentaje de interés por mora."
                />
            </Helmet>

            <div className="mb-6 space-y-6">
                <Card>
                    <h2 className="font-display text-lg font-bold">Datos del gimnasio</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Nombre, logo y color que se ven adentro de la app y en la pantalla de autorregistro.
                    </p>

                    {gimnasioError && (
                        <div className="mt-4">
                            <ErrorBox>{gimnasioError}</ErrorBox>
                        </div>
                    )}

                    {gimnasioLoading ? (
                        <div className="mt-4">
                            <Loading rows={2} />
                        </div>
                    ) : gimnasioFull ? (
                        <form onSubmit={guardarDatosGimnasio} className="mt-4 space-y-4">
                            <Field label="Nombre del gimnasio">
                                <Input
                                    value={dgForm.nombre}
                                    onChange={(e) => setDgForm({ ...dgForm, nombre: e.target.value })}
                                    required
                                />
                            </Field>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Logo">
                                    <div className="flex items-center gap-3">
                                        {logoPreview || gimnasioFull.logo_url ? (
                                            <img
                                                src={logoPreview || gimnasioFull.logo_url}
                                                alt="Logo del gimnasio"
                                                className="h-12 w-12 shrink-0 rounded-xl border border-border object-contain"
                                            />
                                        ) : (
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
                                                <ImagePlus className="h-5 w-5" strokeWidth={1.6} />
                                            </div>
                                        )}
                                        <input
                                            ref={logoInputRef}
                                            type="file"
                                            accept="image/png,image/jpeg,image/webp"
                                            onChange={onLogoChange}
                                            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground file:transition hover:file:brightness-110"
                                        />
                                    </div>
                                    <span className="text-xs text-muted-foreground">PNG, JPG o WEBP. Máximo 2 MB.</span>
                                </Field>

                                <Field label="Color principal">
                                    <input
                                        type="color"
                                        value={dgForm.color_principal || COLOR_DEFAULT}
                                        onChange={(e) => setDgForm({ ...dgForm, color_principal: e.target.value })}
                                        className="h-11 w-20 cursor-pointer rounded-lg border border-input bg-background p-1"
                                    />
                                </Field>
                            </div>

                            {dgError && <ErrorBox>{dgError}</ErrorBox>}

                            <div className="flex justify-end">
                                <Btn type="submit" disabled={dgSaving}>
                                    {dgSaving ? 'Guardando...' : 'Guardar cambios'}
                                </Btn>
                            </div>
                        </form>
                    ) : null}
                </Card>

                <Card>
                    <h2 className="font-display text-lg font-bold">Código de invitación</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Compartí este código o el QR con tus alumnos para que se autorregistren. Quedan pendientes de
                        tu aprobación antes de contar como alta real.
                    </p>

                    {gimnasioLoading ? (
                        <div className="mt-4">
                            <Loading rows={2} />
                        </div>
                    ) : gimnasioFull ? (
                        <div className="mt-4 grid gap-6 md:grid-cols-2">
                            <div className="space-y-4">
                                <Field label="Código">
                                    <div className="flex gap-2">
                                        <Input readOnly value={gimnasioFull.codigo_invitacion || ''} className="font-mono" />
                                        <Btn type="button" variant="ghost" onClick={copiarCodigo} className="shrink-0">
                                            {copiado ? '¡Copiado!' : 'Copiar'}
                                        </Btn>
                                    </div>
                                </Field>

                                <label className="flex items-center gap-3 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={!!gimnasioFull.autorregistro_activo}
                                        onChange={(e) => toggleAutorregistro(e.target.checked)}
                                        disabled={autorregistroSaving}
                                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                                    />
                                    Autorregistro activo
                                </label>

                                <Btn type="button" variant="ghost" onClick={regenerarCodigo} disabled={regenerando}>
                                    {regenerando ? 'Regenerando...' : 'Regenerar código'}
                                </Btn>

                                {codigoError && <ErrorBox>{codigoError}</ErrorBox>}
                            </div>

                            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-4">
                                {qrDataUrl ? (
                                    <>
                                        {/* Fondo blanco fijo a propósito (no bg-card): un QR necesita
                                            contraste real para escanear, no el tema claro/oscuro de la app. */}
                                        <img src={qrDataUrl} alt="Código QR de invitación" className="h-48 w-48 rounded-lg bg-white p-2" />
                                        <a
                                            href={qrDataUrl}
                                            download="codigo-invitacion.png"
                                            className="text-sm font-semibold text-primary hover:underline"
                                        >
                                            Descargar QR
                                        </a>
                                    </>
                                ) : (
                                    <span className="text-sm text-muted-foreground">Generando QR...</span>
                                )}
                            </div>
                        </div>
                    ) : null}
                </Card>
            </div>

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
