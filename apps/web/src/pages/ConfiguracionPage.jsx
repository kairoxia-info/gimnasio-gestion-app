import React, { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import QRCode from 'qrcode';
import { AlertTriangle, Check, CheckCircle2, Copy, ImagePlus, RefreshCw } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Btn, Card, ErrorBox, Field, Input, Loading, Modal, PasswordInput, Textarea } from '@/components/ui-kit';
import { updateRec } from '@/lib/data';
import { copiarAlPortapapeles } from '@/lib/copiar';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';

// Mismo criterio que OnboardingPage.jsx (subida de logo): 2 MB de tope y
// solo estos tres formatos, para no duplicar lógica de validación distinta
// en dos lugares del mismo flujo.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const COLOR_DEFAULT = '#E10600';

// Días que abre el gimnasio (migración 0031). Los números son los mismos
// que devuelve Date.getDay() (0 = domingo), pero se listan arrancando en
// lunes porque es como se lee una semana acá.
const DIAS_SEMANA = [
    { numero: 1, etiqueta: 'Lun' },
    { numero: 2, etiqueta: 'Mar' },
    { numero: 3, etiqueta: 'Mié' },
    { numero: 4, etiqueta: 'Jue' },
    { numero: 5, etiqueta: 'Vie' },
    { numero: 6, etiqueta: 'Sáb' },
    { numero: 0, etiqueta: 'Dom' },
];
const DIAS_ABIERTOS_DEFAULT = [1, 2, 3, 4, 5, 6];

const ConfiguracionPage = () => {
    const { profile, refreshProfile, eliminarCuenta, signOut } = useAuth();

    // Fila completa de "gimnasios" (id, codigo_invitacion, autorregistro_activo,
    // etc.): useAuth().gimnasio solo trae nombre/logo_url/color_principal (ver
    // AuthContext.fetchProfile), no alcanza para esta página. RLS ya permite
    // este SELECT (policy gimnasios_select).
    const [gimnasioFull, setGimnasioFull] = useState(null);
    const [gimnasioLoading, setGimnasioLoading] = useState(true);
    const [gimnasioError, setGimnasioError] = useState('');

    const [dgForm, setDgForm] = useState({
        nombre: '',
        color_principal: COLOR_DEFAULT,
        dias_abiertos: DIAS_ABIERTOS_DEFAULT,
    });
    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState('');
    const [dgSaving, setDgSaving] = useState(false);
    const [dgError, setDgError] = useState('');
    const logoInputRef = useRef(null);

    // Vencimiento de cuotas (migración 0013). El % de recargo NO va acá: ya
    // existe por plan (interes_mora, más abajo en esta misma pantalla) y tener
    // dos perillas para el mismo número termina en que no coinciden.
    //
    // politica_vencimiento_cuota/restringir_rutina/restringir_alimentacion
    // (migraciones 0020/0021): qué pasa con un alumno vencido, más allá del
    // cartel visual que ya existía. "Darlo de baja" lo aplica AppLayout.jsx
    // de forma perezosa (ver ese archivo) -- acá solo se guarda la decisión.
    const [vencForm, setVencForm] = useState({
        dias_gracia_cuota: '0',
        dias_aviso_vencimiento: '7',
        politica_vencimiento_cuota: 'dejar',
        restringir_rutina: true,
        restringir_alimentacion: false,
    });
    const [vencSaving, setVencSaving] = useState(false);
    const [vencError, setVencError] = useState('');
    const [vencOk, setVencOk] = useState(false);

    // Aviso automático de cuota (migración 0015): una plantilla por gimnasio,
    // que ver_plan_por_codigo() arma sola para cada alumno según su propio
    // vencimiento -- no se guarda un aviso por alumno.
    const [avisoCuotaForm, setAvisoCuotaForm] = useState({ activo: false, titulo: '', mensaje: '' });
    const [avisoCuotaSaving, setAvisoCuotaSaving] = useState(false);
    const [avisoCuotaError, setAvisoCuotaError] = useState('');
    const [avisoCuotaOk, setAvisoCuotaOk] = useState(false);

    // Archivado manual de pagos (migración 0024, 04/09/2026). NUNCA
    // automático a propósito: cada fila de pagos es también el comprobante
    // numerado, borrarla pierde la posibilidad de reimprimirlo. El profesor
    // elige la fecha de corte y confirma en dos pasos (mismo patrón que
    // "Quitar" en RutinasPage.jsx -- nada de window.confirm) antes de que se
    // dispare archivar_pagos_hasta().
    const [archivoFechaCorte, setArchivoFechaCorte] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 12);
        return d.toISOString().slice(0, 10);
    });
    const [archivoConfirmando, setArchivoConfirmando] = useState(false);
    const [archivoLoading, setArchivoLoading] = useState(false);
    const [archivoError, setArchivoError] = useState('');
    const [archivoResultado, setArchivoResultado] = useState(null);

    // Texto de pie del comprobante (migración 0018) — antes fijo en el
    // código de PagosPage.jsx ("Este comprobante no es válido como
    // factura."), pedido editable al investigar Configuración.
    const [comprobanteTexto, setComprobanteTexto] = useState('');
    const [comprobanteSaving, setComprobanteSaving] = useState(false);
    const [comprobanteError, setComprobanteError] = useState('');
    const [comprobanteOk, setComprobanteOk] = useState(false);

    // Eliminar cuenta (migración 0035), pedido de Nalux (08/09/2026): borrado
    // definitivo e inmediato, pide la contraseña de nuevo antes de ejecutar
    // (eliminarCuenta() en AuthContext ya se encarga de reautenticar). Modal
    // en vez de la confirmación inline que usa "Archivo de pagos": acá hace
    // falta pedir la contraseña, no solo un "¿Seguro?".
    const [eliminarAbierto, setEliminarAbierto] = useState(false);
    const [eliminarPassword, setEliminarPassword] = useState('');
    const [eliminarError, setEliminarError] = useState('');
    const [eliminarLoading, setEliminarLoading] = useState(false);
    const [eliminarHecho, setEliminarHecho] = useState(false);

    // Autorregistro de alumnos por link/QR (migración 0004, pedido de Nalux
    // 09/09/2026): la base y las RPC (join_gimnasio_por_codigo,
    // regenerar_codigo_invitacion) ya existían desde antes, pero no había
    // NINGUNA pantalla donde el profesor pudiera ver, copiar o compartir el
    // link, ni prender/apagar el autorregistro -- quedó a mitad de camino,
    // documentado como pendiente en el propio archivo de esa migración.
    const [autorregistroSaving, setAutorregistroSaving] = useState(false);
    const [autorregistroError, setAutorregistroError] = useState('');
    const [qrDataUrl, setQrDataUrl] = useState('');
    // '' | 'ok' | 'error' -- ver lib/copiar.js: antes fallaba mudo.
    const [linkCopiado, setLinkCopiado] = useState('');
    const [confirmandoRegenerar, setConfirmandoRegenerar] = useState(false);
    const [regenerando, setRegenerando] = useState(false);
    const [regenerarError, setRegenerarError] = useState('');

    const linkAutorregistro = gimnasioFull?.codigo_invitacion
        ? `${window.location.origin}/unirse/${gimnasioFull.codigo_invitacion}`
        : '';

    // El QR se genera del lado del cliente (librería 'qrcode', ya estaba
    // instalada mano a mano en package.json desde antes sin usarse en
    // ningún lado) -- no depende de ningún servicio externo, así que
    // funciona igual en local que en producción.
    useEffect(() => {
        if (!linkAutorregistro) {
            setQrDataUrl('');
            return;
        }
        let cancelado = false;
        QRCode.toDataURL(linkAutorregistro, { width: 220, margin: 1 })
            .then((url) => {
                if (!cancelado) setQrDataUrl(url);
            })
            .catch(() => {
                if (!cancelado) setQrDataUrl('');
            });
        return () => {
            cancelado = true;
        };
    }, [linkAutorregistro]);

    const copiarLinkAutorregistro = async () => {
        const ok = await copiarAlPortapapeles(linkAutorregistro);
        setLinkCopiado(ok ? 'ok' : 'error');
        setTimeout(() => setLinkCopiado(''), 2500);
    };

    const toggleAutorregistro = async () => {
        if (!gimnasioFull?.id) return;
        setAutorregistroSaving(true);
        setAutorregistroError('');
        try {
            const actualizado = await updateRec('gimnasios', gimnasioFull.id, {
                autorregistro_activo: !gimnasioFull.autorregistro_activo,
            });
            setGimnasioFull((g) => ({ ...g, ...actualizado }));
        } catch (_) {
            setAutorregistroError('No se pudo guardar el cambio.');
        } finally {
            setAutorregistroSaving(false);
        }
    };

    const regenerarCodigo = async () => {
        setRegenerando(true);
        setRegenerarError('');
        try {
            const { data, error: err } = await supabase.rpc('regenerar_codigo_invitacion');
            if (err) throw err;
            setGimnasioFull((g) => ({ ...g, codigo_invitacion: data }));
            setConfirmandoRegenerar(false);
        } catch (_) {
            setRegenerarError('No se pudo regenerar el código.');
        } finally {
            setRegenerando(false);
        }
    };

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
                setDgForm({
                    nombre: data.nombre || '',
                    color_principal: data.color_principal || COLOR_DEFAULT,
                    dias_abiertos: data.dias_abiertos?.length ? data.dias_abiertos : DIAS_ABIERTOS_DEFAULT,
                });
                setVencForm({
                    dias_gracia_cuota: String(data.dias_gracia_cuota ?? 0),
                    dias_aviso_vencimiento: String(data.dias_aviso_vencimiento ?? 7),
                    politica_vencimiento_cuota: data.politica_vencimiento_cuota || 'dejar',
                    restringir_rutina: data.restringir_rutina ?? true,
                    restringir_alimentacion: data.restringir_alimentacion ?? false,
                });
                setAvisoCuotaForm({
                    activo: !!data.aviso_cuota_activo,
                    titulo: data.aviso_cuota_titulo || '',
                    mensaje: data.aviso_cuota_mensaje || '',
                });
                setComprobanteTexto(data.comprobante_texto_pie ?? '');
                setGimnasioError('');
            })
            .catch(() => setGimnasioError('No se pudieron cargar los datos del gimnasio.'))
            .finally(() => setGimnasioLoading(false));
    };

    useEffect(cargarGimnasio, [profile?.gimnasio_id]);

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
        // La base tiene un CHECK que exige al menos un día (migración 0031);
        // se avisa acá con un mensaje entendible en vez de dejar que vuelva
        // el error crudo de Postgres.
        if (dgForm.dias_abiertos.length === 0) {
            setDgError('Elegir al menos un día en el que el gimnasio abre.');
            setDgSaving(false);
            return;
        }
        try {
            await updateRec('gimnasios', gimnasioFull.id, {
                nombre: dgForm.nombre.trim(),
                color_principal: dgForm.color_principal || COLOR_DEFAULT,
                dias_abiertos: dgForm.dias_abiertos,
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
                'No se pudieron guardar los datos del gimnasio. Si no es administrador, no tiene permiso para editar esto.',
            );
        } finally {
            setDgSaving(false);
        }
    };

    const guardarAvisoCuota = async (e) => {
        e.preventDefault();
        if (!gimnasioFull?.id) return;
        setAvisoCuotaSaving(true);
        setAvisoCuotaError('');
        setAvisoCuotaOk(false);
        try {
            const actualizado = await updateRec('gimnasios', gimnasioFull.id, {
                aviso_cuota_activo: avisoCuotaForm.activo,
                aviso_cuota_titulo: avisoCuotaForm.titulo,
                aviso_cuota_mensaje: avisoCuotaForm.mensaje,
            });
            setGimnasioFull((g) => ({ ...g, ...actualizado }));
            setAvisoCuotaOk(true);
            setTimeout(() => setAvisoCuotaOk(false), 2000);
        } catch (_) {
            setAvisoCuotaError('No se pudo guardar. Si no es administrador, no tiene permiso.');
        } finally {
            setAvisoCuotaSaving(false);
        }
    };

    // Primer click: solo pide confirmación (no ejecuta nada todavía). El
    // RPC en sí (archivar_pagos_hasta) recién se llama desde
    // confirmarArchivado(), después de que el profesor vio la advertencia y
    // apretó "Sí, archivar".
    const pedirConfirmacionArchivado = () => {
        setArchivoError('');
        setArchivoResultado(null);
        setArchivoConfirmando(true);
    };

    const confirmarArchivado = async () => {
        setArchivoLoading(true);
        setArchivoError('');
        try {
            const { data, error } = await supabase.rpc('archivar_pagos_hasta', {
                p_fecha_corte: archivoFechaCorte,
            });
            if (error) throw error;
            const fila = Array.isArray(data) ? data[0] : data;
            setArchivoResultado({
                meses: fila?.meses_afectados ?? 0,
                pagos: fila?.pagos_archivados ?? 0,
            });
            setArchivoConfirmando(false);
        } catch (_) {
            setArchivoError('No se pudo archivar. Si no es administrador, no tiene permiso.');
        } finally {
            setArchivoLoading(false);
        }
    };

    const guardarComprobante = async (e) => {
        e.preventDefault();
        if (!gimnasioFull?.id) return;
        setComprobanteSaving(true);
        setComprobanteError('');
        setComprobanteOk(false);
        try {
            const actualizado = await updateRec('gimnasios', gimnasioFull.id, {
                comprobante_texto_pie: comprobanteTexto,
            });
            setGimnasioFull((g) => ({ ...g, ...actualizado }));
            setComprobanteOk(true);
            setTimeout(() => setComprobanteOk(false), 2000);
        } catch (_) {
            setComprobanteError('No se pudo guardar. Si no es administrador, no tiene permiso.');
        } finally {
            setComprobanteSaving(false);
        }
    };

    const abrirEliminarCuenta = () => {
        setEliminarPassword('');
        setEliminarError('');
        setEliminarHecho(false);
        setEliminarAbierto(true);
    };

    const cerrarEliminarCuenta = () => {
        if (eliminarLoading || eliminarHecho) return; // no se cierra a mitad de la operación
        setEliminarAbierto(false);
    };

    const confirmarEliminarCuenta = async (e) => {
        e.preventDefault();
        setEliminarLoading(true);
        setEliminarError('');
        try {
            const { error } = await eliminarCuenta(eliminarPassword);
            if (error) {
                setEliminarError(error.message || 'No se pudo eliminar la cuenta.');
                return;
            }
            setEliminarHecho(true);
            // Deja ver la confirmación un momento antes de cerrar la sesión --
            // mismo criterio de tiempo que ResetPasswordPage.jsx al terminar.
            setTimeout(() => signOut(), 2200);
        } finally {
            setEliminarLoading(false);
        }
    };

    const esAdminConGimnasio = profile?.role === 'admin' && !!profile?.gimnasio_id;

    const guardarVencimientos = async (e) => {
        e.preventDefault();
        if (!gimnasioFull?.id) return;
        setVencSaving(true);
        setVencError('');
        setVencOk(false);
        try {
            const actualizado = await updateRec('gimnasios', gimnasioFull.id, {
                dias_gracia_cuota: Math.max(0, Number(vencForm.dias_gracia_cuota || 0)),
                dias_aviso_vencimiento: Math.max(0, Number(vencForm.dias_aviso_vencimiento || 0)),
                politica_vencimiento_cuota: vencForm.politica_vencimiento_cuota,
                restringir_rutina: !!vencForm.restringir_rutina,
                restringir_alimentacion: !!vencForm.restringir_alimentacion,
            });
            setGimnasioFull((g) => ({ ...g, ...actualizado }));
            setVencOk(true);
            setTimeout(() => setVencOk(false), 2000);
        } catch (_) {
            setVencError('No se pudo guardar. Si no es administrador, no tiene permiso.');
        } finally {
            setVencSaving(false);
        }
    };

    return (
        <AppLayout
            title="Configuración"
            subtitle="Los datos y las reglas del gimnasio. Los planes y precios se configuran en su propia pantalla."
        >
            <Helmet>
                <title>Configuración | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Datos del gimnasio, logo y color, comprobante y reglas de vencimiento de cuotas."
                />
            </Helmet>

            <div className="mb-6 space-y-6">
                <Card>
                    <h2 className="font-display text-lg font-bold">Datos del gimnasio</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Nombre, logo y color que se ven adentro de la app.
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
                                    <span className="text-xs text-muted-foreground">
                                        PNG, JPG o WEBP. Máximo 2 MB.
                                    </span>
                                </Field>

                                <Field label="Color principal">
                                    <input
                                        type="color"
                                        value={dgForm.color_principal || COLOR_DEFAULT}
                                        onChange={(e) =>
                                            setDgForm({ ...dgForm, color_principal: e.target.value })
                                        }
                                        className="h-11 w-20 cursor-pointer rounded-lg border border-input bg-background p-1"
                                    />
                                </Field>
                            </div>

                            {/* Pedido de Nalux (07/09/2026): los domingos el gimnasio
                                suele estar cerrado, pero que lo elija cada profesor.
                                En la grilla de asistencia los días cerrados quedan
                                atenuados y no se pueden marcar. */}
                            <Field label="Días que abre el gimnasio">
                                <div className="flex flex-wrap gap-2">
                                    {DIAS_SEMANA.map(({ numero, etiqueta }) => {
                                        const activo = dgForm.dias_abiertos.includes(numero);
                                        return (
                                            <button
                                                key={numero}
                                                type="button"
                                                aria-pressed={activo}
                                                onClick={() =>
                                                    setDgForm((f) => ({
                                                        ...f,
                                                        dias_abiertos: activo
                                                            ? f.dias_abiertos.filter((n) => n !== numero)
                                                            : [...f.dias_abiertos, numero].sort(),
                                                    }))
                                                }
                                                className={`h-10 w-12 rounded-xl border text-xs font-bold uppercase transition active:scale-95 ${
                                                    activo
                                                        ? 'border-transparent bg-primary text-primary-foreground'
                                                        : 'border-border text-muted-foreground hover:border-primary'
                                                }`}
                                            >
                                                {etiqueta}
                                            </button>
                                        );
                                    })}
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    Los días apagados aparecen en gris en la asistencia y no cuentan como
                                    falta. Tiene que quedar al menos uno encendido.
                                </span>
                            </Field>

                            {dgError && <ErrorBox>{dgError}</ErrorBox>}

                            <div className="flex justify-end">
                                <Btn type="submit" disabled={dgSaving}>
                                    {dgSaving ? 'Guardando...' : 'Guardar cambios'}
                                </Btn>
                            </div>
                        </form>
                    ) : null}
                </Card>
            </div>

            {/* Alta de alumnos por link/QR (migración 0004): la base y las RPC ya
                existían, esta tarjeta es la pantalla que faltaba para poder
                usarlas -- pedido de Nalux (09/09/2026). */}
            {gimnasioFull && (
                <Card className="mb-8">
                    <h2 className="font-display text-lg font-bold">Alta de alumnos por link</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Un link (o el mismo QR) para que los alumnos se anoten solos, sin tener que cargarlos
                        uno por uno. Quedan como &quot;Pendiente&quot; en Alumnos hasta que se revisan y se
                        aprueban.
                    </p>

                    <label className="mt-4 flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={!!gimnasioFull.autorregistro_activo}
                            onChange={toggleAutorregistro}
                            disabled={autorregistroSaving}
                            className="h-4 w-4 accent-[hsl(var(--primary))]"
                        />
                        Permitir que los alumnos se anoten solos con este link
                    </label>

                    {autorregistroError && (
                        <div className="mt-3">
                            <ErrorBox>{autorregistroError}</ErrorBox>
                        </div>
                    )}

                    {gimnasioFull.autorregistro_activo ? (
                        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
                            {qrDataUrl && (
                                <img
                                    src={qrDataUrl}
                                    alt="Código QR para anotarse"
                                    className="h-40 w-40 shrink-0 rounded-2xl border border-border bg-white p-2"
                                />
                            )}
                            <div className="min-w-0 flex-1 space-y-3">
                                <div className="flex items-center gap-2">
                                    <input
                                        readOnly
                                        value={linkAutorregistro}
                                        onFocus={(e) => e.target.select()}
                                        aria-label="Link para anotarse"
                                        className="min-w-0 flex-1 truncate rounded-xl border border-border bg-secondary px-3 py-2.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                                    />
                                    <Btn
                                        type="button"
                                        variant="ghost"
                                        className="shrink-0 px-3 py-2 text-xs"
                                        onClick={copiarLinkAutorregistro}
                                    >
                                        {linkCopiado === 'ok' ? (
                                            <>
                                                <Check className="h-3.5 w-3.5 text-ok" /> Copiado
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="h-3.5 w-3.5" /> Copiar
                                            </>
                                        )}
                                    </Btn>
                                </div>
                                {linkCopiado === 'error' && (
                                    <p className="text-xs text-warn">
                                        El navegador no dejó copiar. Tocar el link de arriba (se selecciona
                                        solo) y copiarlo a mano.
                                    </p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                    Se puede compartir por WhatsApp o imprimir el QR. Al escanearlo o abrirlo, el
                                    alumno completa su nombre y queda pendiente de aprobación -- no hace falta
                                    que tenga usuario ni contraseña para esto.
                                </p>

                                {regenerarError && <ErrorBox>{regenerarError}</ErrorBox>}

                                {confirmandoRegenerar ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs text-muted-foreground">
                                            El link y el QR actuales dejan de funcionar (incluido cualquier QR ya
                                            impreso). ¿Seguro?
                                        </span>
                                        <Btn
                                            variant="danger"
                                            className="px-3 py-1.5 text-xs"
                                            disabled={regenerando}
                                            onClick={regenerarCodigo}
                                        >
                                            {regenerando ? 'Regenerando...' : 'Sí, regenerar'}
                                        </Btn>
                                        <Btn
                                            variant="ghost"
                                            className="px-3 py-1.5 text-xs"
                                            disabled={regenerando}
                                            onClick={() => setConfirmandoRegenerar(false)}
                                        >
                                            Cancelar
                                        </Btn>
                                    </div>
                                ) : (
                                    <Btn
                                        variant="ghost"
                                        className="px-3 py-1.5 text-xs"
                                        onClick={() => setConfirmandoRegenerar(true)}
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" /> Regenerar código
                                    </Btn>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="mt-4 text-xs text-muted-foreground">
                            Desactivado -- nadie puede anotarse por este link hasta que se active de nuevo.
                        </p>
                    )}
                </Card>
            )}

            <Card className="mb-8">
                <h2 className="font-display text-lg font-bold">Vencimiento de cuotas</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Cuándo el sistema considera que un alumno pasó a deber. El porcentaje de recargo se
                    configura en cada plan, más abajo (&quot;Interés por mora&quot;).
                </p>
                <form onSubmit={guardarVencimientos} className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Días de gracia después del vencimiento">
                            <Input
                                type="number"
                                min="0"
                                value={vencForm.dias_gracia_cuota}
                                onChange={(e) =>
                                    setVencForm({ ...vencForm, dias_gracia_cuota: e.target.value })
                                }
                            />
                            <span className="text-xs text-muted-foreground">
                                0 = apenas se le vence ya queda como atrasado. 7 = tiene una semana más para
                                pagar antes de que cuente como deuda (y antes de que se le aplique el
                                recargo).
                            </span>
                        </Field>
                        <Field label="Avisar con cuántos días de anticipación">
                            <Input
                                type="number"
                                min="0"
                                value={vencForm.dias_aviso_vencimiento}
                                onChange={(e) =>
                                    setVencForm({ ...vencForm, dias_aviso_vencimiento: e.target.value })
                                }
                            />
                            <span className="text-xs text-muted-foreground">
                                Cuántos días antes del vencimiento aparece como &quot;Próximo a vencer&quot;
                                en el panel y en Pagos.
                            </span>
                        </Field>
                    </div>

                    {/* Política de alumno vencido (migraciones 0020/0021), pedido de
                        Nalux (03/09/2026). Caja con borde/ícono de aviso a propósito
                        -- es una decisión delicada (puede ocultarle el plan a un
                        alumno o darlo de baja solo) y tiene que leerse con atención
                        antes de tocarla, no pasar desapercibida entre el resto de
                        los campos de la pantalla. */}
                    <div className="space-y-4 rounded-2xl border-2 border-warn bg-warn/10 p-4">
                        <div className="flex items-start gap-2.5">
                            <AlertTriangle
                                className="mt-0.5 h-5 w-5 shrink-0 text-warn"
                                strokeWidth={2.2}
                                aria-hidden="true"
                            />
                            <div>
                                <p className="font-display text-base font-bold">Alumno con cuota vencida</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Qué pasa, además del cartel de aviso, cuando a un alumno se le vence la
                                    cuota (pasado el plazo de gracia de arriba). Leer bien antes de
                                    cambiarlo: puede ocultarle su plan o darlo de baja sin que haga falta
                                    nada más.
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {[
                                { valor: 'dejar', label: 'Dejarlo como está' },
                                { valor: 'restringir', label: 'Restringirle el acceso' },
                                { valor: 'dar_de_baja', label: 'Darlo de baja' },
                            ].map((op) => (
                                <button
                                    key={op.valor}
                                    type="button"
                                    onClick={() =>
                                        setVencForm({ ...vencForm, politica_vencimiento_cuota: op.valor })
                                    }
                                    aria-pressed={vencForm.politica_vencimiento_cuota === op.valor}
                                    className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                                        vencForm.politica_vencimiento_cuota === op.valor
                                            ? 'border-warn bg-warn text-black'
                                            : 'border-border text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {op.label}
                                </button>
                            ))}
                        </div>

                        {vencForm.politica_vencimiento_cuota === 'dejar' && (
                            <p className="text-xs text-muted-foreground">
                                No cambia nada de lo que ya hay hoy: el alumno sigue viendo su rutina y su
                                plan de comidas igual, solo con el cartel de aviso (si está prendido más
                                abajo en &quot;Recordatorio automático&quot;).
                            </p>
                        )}

                        {vencForm.politica_vencimiento_cuota === 'restringir' && (
                            <div className="space-y-2 border-t border-warn/40 pt-3">
                                <p className="text-xs text-muted-foreground">
                                    En su link personal (el que abre sin login), en vez del contenido tildado
                                    de abajo va a ver un cartel de &quot;cuota vencida, pasar por el
                                    gimnasio&quot;. Apenas se le registre el pago vuelve a ver todo -- no se
                                    borra nada. La rutina y el plan de comidas se restringen por separado,
                                    porque uno puede seguir vigente aunque el otro no.
                                </p>
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={!!vencForm.restringir_rutina}
                                        onChange={(e) =>
                                            setVencForm({ ...vencForm, restringir_rutina: e.target.checked })
                                        }
                                        className="h-4 w-4 rounded border-border accent-[hsl(var(--warn))]"
                                    />
                                    Ocultarle la rutina de ejercicios
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={!!vencForm.restringir_alimentacion}
                                        onChange={(e) =>
                                            setVencForm({
                                                ...vencForm,
                                                restringir_alimentacion: e.target.checked,
                                            })
                                        }
                                        className="h-4 w-4 rounded border-border accent-[hsl(var(--warn))]"
                                    />
                                    Ocultarle el plan de alimentación
                                </label>
                            </div>
                        )}

                        {vencForm.politica_vencimiento_cuota === 'dar_de_baja' && (
                            <p className="border-t border-warn/40 pt-3 text-xs text-muted-foreground">
                                Pasa a &quot;inactivo&quot;, igual que si se lo diera de baja a mano: sigue en
                                el sistema con todo su historial de pagos, asistencia y rutinas, pero deja de
                                contar como alumno activo (se puede reactivar cuando pague). No es
                                instantáneo al minuto que vence: se aplica solo la próxima vez que se entra a
                                la app.
                            </p>
                        )}
                    </div>

                    {vencError && <ErrorBox>{vencError}</ErrorBox>}
                    <div className="flex items-center gap-3">
                        <Btn type="submit" disabled={vencSaving || !gimnasioFull}>
                            {vencSaving ? 'Guardando...' : 'Guardar'}
                        </Btn>
                        {vencOk && <span className="text-sm font-semibold text-ok">Guardado.</span>}
                    </div>
                </form>
            </Card>

            <Card className="mb-8">
                <h2 className="font-display text-lg font-bold">Comprobante</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    El texto chico que va al pie de cada comprobante de pago (ver Pagos).
                </p>
                <form onSubmit={guardarComprobante} className="mt-4 space-y-4">
                    <Field label="Texto de pie">
                        <Textarea
                            value={comprobanteTexto}
                            onChange={(e) => setComprobanteTexto(e.target.value.slice(0, 255))}
                            rows={2}
                            maxLength={255}
                        />
                        <span className="text-xs text-muted-foreground">{comprobanteTexto.length}/255</span>
                    </Field>
                    {comprobanteError && <ErrorBox>{comprobanteError}</ErrorBox>}
                    <div className="flex items-center gap-3">
                        <Btn type="submit" disabled={comprobanteSaving || !gimnasioFull}>
                            {comprobanteSaving ? 'Guardando...' : 'Guardar'}
                        </Btn>
                        {comprobanteOk && <span className="text-sm font-semibold text-ok">Guardado.</span>}
                    </div>
                </form>
            </Card>

            <Card className="mb-8">
                <h2 className="font-display text-lg font-bold">Aviso automático de cuota</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Un recordatorio que le aparece solo al alumno en su plan cuando se le acerca o se le vence
                    la cuota -- no hace falta crearlo a mano cada vez. Desaparece solo cuando paga.
                </p>
                <form onSubmit={guardarAvisoCuota} className="mt-4 space-y-4">
                    <label className="flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={avisoCuotaForm.activo}
                            onChange={(e) =>
                                setAvisoCuotaForm({ ...avisoCuotaForm, activo: e.target.checked })
                            }
                            className="h-4 w-4 accent-[hsl(var(--primary))]"
                        />
                        Mostrárselo al alumno
                    </label>
                    <Field label="Título">
                        <Input
                            value={avisoCuotaForm.titulo}
                            onChange={(e) => setAvisoCuotaForm({ ...avisoCuotaForm, titulo: e.target.value })}
                            placeholder="Tu cuota está por vencer"
                        />
                    </Field>
                    <Field label="Mensaje">
                        <Textarea
                            value={avisoCuotaForm.mensaje}
                            onChange={(e) =>
                                setAvisoCuotaForm({ ...avisoCuotaForm, mensaje: e.target.value })
                            }
                            rows={3}
                        />
                        <span className="text-xs text-muted-foreground">
                            Se puede usar {'{nombre}'}, {'{vence}'}, {'{plan}'} y {'{gimnasio}'} -- se
                            reemplazan solos por los datos de cada alumno.
                        </span>
                    </Field>
                    {avisoCuotaError && <ErrorBox>{avisoCuotaError}</ErrorBox>}
                    <div className="flex items-center gap-3">
                        <Btn type="submit" disabled={avisoCuotaSaving || !gimnasioFull}>
                            {avisoCuotaSaving ? 'Guardando...' : 'Guardar'}
                        </Btn>
                        {avisoCuotaOk && <span className="text-sm font-semibold text-ok">Guardado.</span>}
                    </div>
                </form>
            </Card>

            {/* Archivado manual de pagos (migración 0024), pedido de Nalux
                (04/09/2026): nunca automático -- cada fila de pagos es también
                el comprobante numerado, así que solo se archiva cuando el
                profesor lo pide a propósito y confirma la advertencia. */}
            <Card className="mb-8 border-2 border-warn/60">
                <div className="flex items-start gap-2.5">
                    <AlertTriangle
                        className="mt-0.5 h-5 w-5 shrink-0 text-warn"
                        strokeWidth={2.2}
                        aria-hidden="true"
                    />
                    <div>
                        <h2 className="font-display text-lg font-bold">Archivo de pagos</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Comprime en un resumen mensual (y borra el detalle fila por fila) los pagos
                            anteriores a la fecha elegida. Los comprobantes de esos pagos dejan de poder
                            reimprimirse -- el gráfico de &quot;Ingresos por mes&quot; del panel sigue
                            mostrando el total igual, solo que ya sin el detalle de cada pago.
                        </p>
                    </div>
                </div>

                <div className="mt-4 max-w-xs">
                    <Field label="Archivar pagos anteriores a">
                        <Input
                            type="date"
                            value={archivoFechaCorte}
                            onChange={(e) => {
                                setArchivoFechaCorte(e.target.value);
                                setArchivoConfirmando(false);
                                setArchivoResultado(null);
                            }}
                        />
                    </Field>
                </div>

                {archivoError && (
                    <div className="mt-3">
                        <ErrorBox>{archivoError}</ErrorBox>
                    </div>
                )}

                {archivoResultado && (
                    <p className="mt-3 text-sm font-semibold text-ok">
                        Se archivaron {archivoResultado.pagos} pago{archivoResultado.pagos === 1 ? '' : 's'} de{' '}
                        {archivoResultado.meses} mes{archivoResultado.meses === 1 ? '' : 'es'}.
                    </p>
                )}

                <div className="mt-4">
                    {archivoConfirmando ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                                ¿Seguro? No se van a poder reimprimir esos comprobantes.
                            </span>
                            <Btn variant="danger" disabled={archivoLoading} onClick={confirmarArchivado}>
                                {archivoLoading ? 'Archivando...' : 'Sí, archivar'}
                            </Btn>
                            <Btn
                                variant="ghost"
                                disabled={archivoLoading}
                                onClick={() => setArchivoConfirmando(false)}
                            >
                                Cancelar
                            </Btn>
                        </div>
                    ) : (
                        <Btn variant="ghost" onClick={pedirConfirmacionArchivado} disabled={!archivoFechaCorte}>
                            Archivar pagos anteriores a esa fecha
                        </Btn>
                    )}
                </div>
            </Card>

            {/* Eliminar cuenta (migración 0035), pedido de Nalux (08/09/2026).
                border-destructive (no warn): a diferencia de "Archivo de pagos"
                -- que se puede corregir cargando pagos de nuevo a mano -- esto
                es irreversible por completo. */}
            <Card className="mb-8 border-2 border-destructive/60">
                <div className="flex items-start gap-2.5">
                    <AlertTriangle
                        className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
                        strokeWidth={2.2}
                        aria-hidden="true"
                    />
                    <div>
                        <h2 className="font-display text-lg font-bold">Eliminar cuenta</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {esAdminConGimnasio ? (
                                <>
                                    Borra el gimnasio completo: alumnos, pagos, rutinas, planes de
                                    alimentación, asistencias, ejercicios propios y todo lo demás cargado en
                                    esta cuenta. No se puede deshacer.
                                </>
                            ) : (
                                <>
                                    Borra tu acceso a este gimnasio. Los datos del gimnasio (alumnos, pagos,
                                    etc.) no se ven afectados -- son del administrador, no de tu cuenta.
                                </>
                            )}
                        </p>
                    </div>
                </div>

                <div className="mt-4">
                    <Btn variant="danger" onClick={abrirEliminarCuenta}>
                        Eliminar mi cuenta
                    </Btn>
                </div>
            </Card>

            <Modal
                open={eliminarAbierto}
                onClose={cerrarEliminarCuenta}
                title={eliminarHecho ? 'Cuenta eliminada' : 'Eliminar cuenta'}
            >
                {eliminarHecho ? (
                    <div className="flex flex-col items-center gap-3 py-4 text-center">
                        <CheckCircle2 className="h-12 w-12 text-ok" strokeWidth={1.6} />
                        <p className="text-sm text-foreground">
                            La cuenta y sus datos se eliminaron. Ya se puede registrar una cuenta nueva con el
                            mismo correo.
                        </p>
                        <p className="text-xs text-muted-foreground">Cerrando sesión...</p>
                    </div>
                ) : (
                    <form onSubmit={confirmarEliminarCuenta} className="space-y-4">
                        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
                            {esAdminConGimnasio
                                ? 'Esta acción borra el gimnasio entero, con todo lo que tiene cargado, para siempre.'
                                : 'Esta acción borra tu acceso a este gimnasio para siempre.'}{' '}
                            Para confirmar, ingresar la contraseña de la cuenta.
                        </div>

                        <Field label="Contraseña">
                            <PasswordInput
                                value={eliminarPassword}
                                onChange={(e) => setEliminarPassword(e.target.value)}
                                placeholder="••••••••"
                                autoComplete="current-password"
                                required
                                autoFocus
                            />
                        </Field>

                        {eliminarError && <ErrorBox>{eliminarError}</ErrorBox>}

                        <div className="flex justify-end gap-2">
                            <Btn variant="ghost" type="button" onClick={cerrarEliminarCuenta} disabled={eliminarLoading}>
                                Cancelar
                            </Btn>
                            <Btn variant="danger" type="submit" disabled={eliminarLoading || !eliminarPassword}>
                                {eliminarLoading ? 'Eliminando...' : 'Eliminar definitivamente'}
                            </Btn>
                        </div>
                    </form>
                )}
            </Modal>
        </AppLayout>
    );
};

export default ConfiguracionPage;
