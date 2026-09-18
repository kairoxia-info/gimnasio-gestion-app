import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { Btn, Card, ConfirmInlineActions, ErrorBox } from '@/components/ui-kit';
import { updateRec } from '@/lib/data';
import { copiarAlPortapapeles } from '@/lib/copiar';
import supabase from '@/lib/supabaseClient';

// Autorregistro de alumnos por link/QR (migración 0004, pedido de Nalux
// 09/09/2026): la base y las RPC (join_gimnasio_por_codigo,
// regenerar_codigo_invitacion) ya existían desde antes, pero no había
// NINGUNA pantalla donde el profesor pudiera ver, copiar o compartir el
// link, ni prender/apagar el autorregistro -- quedó a mitad de camino,
// documentado como pendiente en el propio archivo de esa migración.
const AltaAlumnosPorLink = ({ gimnasioFull, setGimnasioFull }) => {
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

    return (
        <Card className="mb-8">
            <h2 className="font-display text-lg font-bold">Alta de alumnos por enlace</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Un enlace (o el mismo QR) para que los alumnos se registren por su cuenta, sin tener que
                agregarlos uno por uno. Quedan como &quot;Pendiente&quot; en Alumnos hasta que se revisan
                y se aprueban.
            </p>

            <label className="mt-4 flex items-center gap-3 text-sm">
                <input
                    type="checkbox"
                    checked={!!gimnasioFull.autorregistro_activo}
                    onChange={toggleAutorregistro}
                    disabled={autorregistroSaving}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                Permitir que los alumnos se registren por su cuenta con este enlace
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
                            alt="Código QR para registrarse"
                            className="h-40 w-40 shrink-0 rounded-2xl border border-border bg-white p-2"
                        />
                    )}
                    <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex items-center gap-2">
                            <input
                                readOnly
                                value={linkAutorregistro}
                                onFocus={(e) => e.target.select()}
                                aria-label="Enlace para registrarse"
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
                                El navegador no dejó copiar. Tocar el enlace de arriba (se selecciona
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
                                    El enlace y el QR actuales dejan de funcionar (incluido cualquier QR ya
                                    impreso). ¿Seguro?
                                </span>
                                <ConfirmInlineActions
                                    className="px-3 py-1.5 text-xs"
                                    confirmLabel="Sí, regenerar"
                                    ejecutandoLabel="Regenerando..."
                                    ejecutando={regenerando}
                                    onConfirmar={regenerarCodigo}
                                    onCancelar={() => setConfirmandoRegenerar(false)}
                                />
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
                    Desactivado -- nadie puede registrarse por este enlace hasta que se active de nuevo.
                </p>
            )}
        </Card>
    );
};

export default AltaAlumnosPorLink;
