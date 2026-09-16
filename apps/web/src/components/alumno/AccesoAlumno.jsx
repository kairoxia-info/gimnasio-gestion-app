import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, MessageCircle } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { Btn, Card, Empty, ErrorBox, Field, Input, PasswordInput } from '@/components/ui-kit';
import { copiarAlPortapapeles } from '@/lib/copiar';
import { validarContrasena } from '@/lib/validacionPassword';
import { crearAccesoAutomatico, generarContrasenaAlumno } from '@/lib/accesoAlumno';
import { updateRec } from '@/lib/data';

/* ---------------- Acceso del alumno (usuario y contraseña) ---------------- */

// Reemplaza al QR/link (migración 0028, pedido de Nalux 04/09/2026: "que el
// profesor se lo cree y el alumno pueda ingresar" -- nada de QR, "sencillo
// y claro" del lado del alumno). El profesor le pone un usuario corto y
// una contraseña; el alumno entra con eso en /alumno, en vez de depender
// de un link/QR para imprimir o reenviar. crear_acceso_alumno() hashea la
// contraseña -- nunca se guarda ni se puede volver a mostrar en texto
// plano después, por eso justo al crearla/cambiarla se ofrece mandarla por
// WhatsApp: es la única vez que el profesor la tiene a mano para copiarla.
const AccesoAlumno = ({ alumno, onCambiado }) => {
    const [abierto, setAbierto] = useState(false);
    const [usuarioForm, setUsuarioForm] = useState('');
    const [contrasenaForm, setContrasenaForm] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    // {usuario, contrasena} en texto plano, solo en memoria del componente
    // -- se pierde al cerrar el formulario, navegar o recargar. Es la única
    // vez que la contraseña existe en algún lado fuera del hash guardado.
    const [creado, setCreado] = useState(null);
    const [confirmandoQuitar, setConfirmandoQuitar] = useState(false);
    const [quitando, setQuitando] = useState(false);
    const [confirmandoReenvio, setConfirmandoReenvio] = useState(false);
    const [regenerando, setRegenerando] = useState(false);
    // Aprobar un alumno autorregistrado y darle acceso en el mismo paso
    // (pedido de Nalux, 09/09/2026: "cuando se apruebe ya el alumno tenga
    // acceso a su plataforma... sino no tiene sentido mandarle para que se
    // registre y no tenga acceso al panel").
    const [aprobando, setAprobando] = useState(false);
    // QR/link fijo hacia /alumno (pedido de Nalux, 09/09/2026: "que el alumno
    // escanee... o el profe copie el link y se lo mande por WhatsApp"). Es el
    // MISMO QR para cualquier alumno del gimnasio -- no identifica a nadie,
    // solo abre la pantalla de login. Cada alumno igual necesita su propio
    // usuario/contraseña (arriba) para entrar una vez ahí.
    const [qrDataUrl, setQrDataUrl] = useState('');
    // '' | 'ok' | 'error' -- el aviso se muestra en pantalla, no solo como un
    // cambio de ícono: Nalux reportó que apretaba y "no me dice nada".
    const [linkCopiado, setLinkCopiado] = useState('');

    const abrirForm = () => {
        setUsuarioForm(alumno?.usuario || '');
        setContrasenaForm('');
        setError('');
        setCreado(null);
        setAbierto(true);
    };

    const guardar = async (e) => {
        e.preventDefault();
        setError('');
        // Pedido de Nalux (09/09/2026, ajustado el mismo día: mínimo 8, no
        // 4): al menos una mayúscula, también acá. Se valida del lado del
        // cliente para el aviso inmediato, y también adentro de
        // crear_acceso_alumno() (migración) por si algún día se llama a la
        // RPC directo, sin pasar por este formulario.
        const errorContrasena = validarContrasena(contrasenaForm, 8);
        if (errorContrasena) {
            setError(errorContrasena);
            return;
        }
        setGuardando(true);
        try {
            const { error: err } = await supabase.rpc('crear_acceso_alumno', {
                p_alumno_id: alumno.id,
                p_usuario: usuarioForm.trim(),
                p_contrasena: contrasenaForm,
            });
            if (err) throw err;
            setCreado({ usuario: usuarioForm.trim(), contrasena: contrasenaForm });
            setAbierto(false);
            onCambiado({ usuario: usuarioForm.trim() });
        } catch (err) {
            setError(err?.message || 'No se pudo guardar el acceso.');
        } finally {
            setGuardando(false);
        }
    };

    const quitar = async () => {
        setQuitando(true);
        setError('');
        try {
            const { error: err } = await supabase.rpc('quitar_acceso_alumno', { p_alumno_id: alumno.id });
            if (err) throw err;
            setCreado(null);
            setConfirmandoQuitar(false);
            onCambiado({ usuario: null });
        } catch (_) {
            setError('No se pudo quitar el acceso.');
        } finally {
            setQuitando(false);
        }
    };

    // Aprobar + crear acceso en un solo paso, para un alumno que se
    // autorregistró (o cualquiera marcado "Pendiente" a mano) y todavía no
    // tiene usuario/contraseña. Usuario a partir del nombre, contraseña al
    // azar -- el profesor los ve acá mismo y los puede cambiar después con
    // "Cambiar contraseña" si quiere otros.
    const aprobarYCrearAcceso = async () => {
        setAprobando(true);
        setError('');
        try {
            const { usuario, contrasena } = await crearAccesoAutomatico(alumno);
            await updateRec('alumnos', alumno.id, { activo: true, pendiente: false });
            setCreado({ usuario, contrasena });
            onCambiado({ usuario, activo: true, pendiente: false });
        } catch (err) {
            setError(err?.message || 'No se pudo aprobar al alumno.');
        } finally {
            setAprobando(false);
        }
    };

    // Reenviar el acceso YA CON la contraseña adentro del mensaje (pedido de
    // Nalux, 09/09/2026: "en el mensaje le tiene que decir la contraseña").
    // La vieja no se puede recuperar -- está hasheada con bcrypt, ni la app la
    // sabe -- así que la única forma de que el mensaje la incluya es generar
    // una nueva en el momento. Por eso esto pide confirmación: la anterior
    // deja de funcionar.
    const reenviarConContrasenaNueva = async () => {
        setRegenerando(true);
        setError('');
        try {
            const nueva = generarContrasenaAlumno();
            const { error: err } = await supabase.rpc('crear_acceso_alumno', {
                p_alumno_id: alumno.id,
                p_usuario: alumno.usuario,
                p_contrasena: nueva,
            });
            if (err) throw err;
            // Se abre WhatsApp con el mensaje ya completo, y además queda en
            // pantalla el recuadro con usuario y contraseña por si lo quiere
            // pasar por otro lado.
            const texto = `${saludo} Ya se puede entrar a ver la rutina y el plan de alimentación en ${urlIngreso}. Usuario: ${alumno.usuario} · Contraseña: ${nueva}`;
            window.open(
                `https://wa.me/?text=${encodeURIComponent(texto)}`,
                '_blank',
                'noopener,noreferrer',
            );
            setCreado({ usuario: alumno.usuario, contrasena: nueva });
            setConfirmandoReenvio(false);
        } catch (err) {
            setError(err?.message || 'No se pudo generar la contraseña nueva.');
        } finally {
            setRegenerando(false);
        }
    };

    const urlIngreso = `${window.location.origin}/alumno`;

    useEffect(() => {
        QRCode.toDataURL(urlIngreso, { width: 160, margin: 1 })
            .then(setQrDataUrl)
            .catch(() => setQrDataUrl(''));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const copiarLink = async () => {
        const ok = await copiarAlPortapapeles(urlIngreso);
        setLinkCopiado(ok ? 'ok' : 'error');
        setTimeout(() => setLinkCopiado(''), 2500);
    };

    // Dos mensajes distintos según el momento (pedido de Nalux, 09/09/2026:
    // "a lo mejor el alumno pierde el acceso y no puede entrar, el profe le
    // vuelve a mandar el link"):
    //  - Recién creada/cambiada la contraseña: va completo, con la
    //    contraseña -- es la única vez que existe en texto plano.
    //  - Después: se puede reenviar igual el link y el usuario, pero sin
    //    contraseña, porque está hasheada y ni la app la sabe. Si el alumno
    //    la perdió, el camino es "Cambiar contraseña" y reenviar.
    const saludo = `Hola${alumno?.nombre ? ` ${alumno.nombre}` : ''}!`;
    const textoWhatsapp = creado
        ? `${saludo} Ya se puede entrar a ver la rutina y el plan de alimentación en ${urlIngreso}. Usuario: ${creado.usuario} · Contraseña: ${creado.contrasena}`
        : `${saludo} Para ver la rutina y el plan de alimentación, entrar en ${urlIngreso}. Usuario: ${alumno?.usuario} · La contraseña es la que te pasé cuando creamos el acceso; si no la tenés a mano, avisame y te paso una nueva.`;
    const linkWhatsapp = `https://wa.me/?text=${encodeURIComponent(textoWhatsapp)}`;

    return (
        <Card className="mb-6">
            <h2 className="font-display text-lg font-bold">Acceso del alumno</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Usuario y contraseña para que entre a ver su rutina y su plan desde el celular, en{' '}
                <span className="font-mono">{urlIngreso}</span>.
            </p>

            {/* QR/link fijo hacia la pantalla de login (mismo para cualquier
                alumno del gimnasio): para escanear en el momento con el
                celular del alumno, o copiarlo y mandarlo aparte -- solo
                tiene sentido mostrarlo si ya hay un usuario/contraseña
                creado para entrar del otro lado. */}
            {(alumno?.usuario || creado) && (
                <div className="mt-4 flex items-center gap-4 rounded-xl border border-border bg-secondary p-4">
                    {qrDataUrl && (
                        <img
                            src={qrDataUrl}
                            alt="Código QR para entrar"
                            className="h-24 w-24 shrink-0 rounded-lg border border-border bg-white p-1.5"
                        />
                    )}
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-foreground">
                            Para que el alumno escanee y entre directo
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                            <input
                                readOnly
                                value={urlIngreso}
                                onFocus={(e) => e.target.select()}
                                aria-label="Link para entrar"
                                className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                            />
                            <Btn
                                type="button"
                                variant="ghost"
                                className="shrink-0 px-3 py-1.5 text-xs"
                                onClick={copiarLink}
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
                            <p className="mt-2 text-xs text-warn">
                                El navegador no dejó copiar. Tocar el link de arriba (se selecciona solo) y
                                copiarlo a mano.
                            </p>
                        )}
                    </div>
                </div>
            )}

            {creado && (
                <div className="mt-4 space-y-3 rounded-xl border border-ok bg-ok/10 p-4">
                    <p className="text-sm font-semibold">Acceso guardado. Enviarle estos datos al alumno.</p>
                    <p className="text-sm">
                        Usuario <span className="font-mono font-semibold">{creado.usuario}</span>
                        {' · '}
                        Contraseña <span className="font-mono font-semibold">{creado.contrasena}</span>
                    </p>
                    {/* La contraseña se guarda cifrada, así que esta es la única
                        vez que se puede leer. No es un problema: si el alumno la
                        pierde, se le crea una nueva acá mismo en dos toques
                        (pedido de Nalux, 09/09/2026). */}
                    <p className="text-xs text-muted-foreground">
                        La contraseña se guarda cifrada, así que esta es la única vez que aparece. Si el alumno
                        la pierde, se le crea una nueva con &ldquo;Cambiar contraseña&rdquo; y se le reenvía --
                        no se pierde el acceso.
                    </p>
                    <Btn
                        type="button"
                        variant="ghost"
                        onClick={() => window.open(linkWhatsapp, '_blank', 'noopener,noreferrer')}
                    >
                        <MessageCircle className="h-4 w-4" /> Enviar por WhatsApp
                    </Btn>
                </div>
            )}

            {!abierto && !creado && alumno?.usuario && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm">
                        Usuario actual: <span className="font-mono font-semibold">{alumno.usuario}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {/* Dos formas de reenviar, según qué perdió el alumno:
                            - Solo el link (sigue sabiendo su contraseña): va el
                              mensaje sin tocar nada.
                            - También la contraseña: se genera una nueva y el
                              mensaje va completo, que es lo que pidió Nalux. */}
                        <Btn
                            type="button"
                            variant="ghost"
                            className="px-3 py-2 text-xs"
                            onClick={() => window.open(linkWhatsapp, '_blank', 'noopener,noreferrer')}
                        >
                            <MessageCircle className="h-3.5 w-3.5" /> Reenviar solo el link
                        </Btn>
                        {confirmandoReenvio ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">
                                    Se le crea una contraseña nueva y la anterior deja de servir. ¿Seguir?
                                </span>
                                <Btn
                                    type="button"
                                    className="px-3 py-2 text-xs"
                                    disabled={regenerando}
                                    onClick={reenviarConContrasenaNueva}
                                >
                                    {regenerando ? 'Generando...' : 'Sí, enviar'}
                                </Btn>
                                <Btn
                                    type="button"
                                    variant="ghost"
                                    className="px-3 py-2 text-xs"
                                    disabled={regenerando}
                                    onClick={() => setConfirmandoReenvio(false)}
                                >
                                    Cancelar
                                </Btn>
                            </div>
                        ) : (
                            <Btn
                                type="button"
                                variant="ghost"
                                className="px-3 py-2 text-xs"
                                onClick={() => setConfirmandoReenvio(true)}
                            >
                                <MessageCircle className="h-3.5 w-3.5" /> Enviar con contraseña nueva
                            </Btn>
                        )}
                        <Btn type="button" variant="ghost" className="px-3 py-2 text-xs" onClick={abrirForm}>
                            Cambiar contraseña
                        </Btn>
                        {confirmandoQuitar ? (
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">¿Seguro?</span>
                                <Btn
                                    type="button"
                                    variant="danger"
                                    className="px-3 py-2 text-xs"
                                    disabled={quitando}
                                    onClick={quitar}
                                >
                                    {quitando ? 'Quitando...' : 'Sí, quitar'}
                                </Btn>
                                <Btn
                                    type="button"
                                    variant="ghost"
                                    className="px-3 py-2 text-xs"
                                    onClick={() => setConfirmandoQuitar(false)}
                                >
                                    Cancelar
                                </Btn>
                            </div>
                        ) : (
                            <Btn
                                type="button"
                                variant="danger"
                                className="px-3 py-2 text-xs"
                                onClick={() => setConfirmandoQuitar(true)}
                            >
                                Quitar acceso
                            </Btn>
                        )}
                    </div>
                    <p className="w-full text-xs text-muted-foreground">
                        Si el alumno perdió la contraseña, con &ldquo;Enviar con contraseña nueva&rdquo; se le
                        genera una y el mensaje de WhatsApp ya sale con el usuario y la contraseña adentro.
                    </p>
                </div>
            )}

            {!abierto && !alumno?.usuario && !creado && alumno?.pendiente ? (
                // Pendiente (autorregistrado o marcado a mano) y sin acceso
                // todavía: un solo botón aprueba Y crea el usuario/contraseña
                // de una -- Nalux (09/09/2026): "cuando se apruebe ya el
                // alumno tenga acceso a su plataforma... sino no tiene
                // sentido mandarle para que se registre y no tenga acceso al
                // panel".
                <div className="mt-4 space-y-3 rounded-xl border border-warn/40 bg-warn/10 p-4">
                    <p className="text-sm">
                        Este alumno está pendiente de aprobación. Al aprobarlo se le crea el acceso
                        automáticamente (usuario a partir de su nombre, contraseña al azar) -- se puede
                        cambiar después si se quiere otro.
                    </p>
                    {error && <ErrorBox>{error}</ErrorBox>}
                    <Btn type="button" disabled={aprobando} onClick={aprobarYCrearAcceso}>
                        {aprobando ? 'Aprobando...' : 'Aprobar y crear acceso'}
                    </Btn>
                </div>
            ) : (
                !abierto &&
                !alumno?.usuario &&
                !creado && (
                    <div className="mt-4">
                        <Empty>
                            Este alumno todavía no tiene acceso.{' '}
                            <button type="button" onClick={abrirForm} className="font-semibold text-primary">
                                Crear usuario y contraseña
                            </button>
                            .
                        </Empty>
                    </div>
                )
            )}

            {abierto && (
                <form onSubmit={guardar} className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Usuario">
                            <Input
                                value={usuarioForm}
                                onChange={(e) => setUsuarioForm(e.target.value)}
                                placeholder="alumno"
                                required
                                minLength={3}
                            />
                        </Field>
                        <Field label="Contraseña">
                            <PasswordInput
                                value={contrasenaForm}
                                onChange={(e) => setContrasenaForm(e.target.value)}
                                placeholder="Mínimo 8 caracteres"
                                required
                                minLength={8}
                                autoComplete="new-password"
                            />
                            <span className="text-xs text-muted-foreground">
                                Mínimo 8 caracteres, con al menos una mayúscula. El ojito la muestra para
                                dictarla.
                            </span>
                        </Field>
                    </div>
                    {error && <ErrorBox>{error}</ErrorBox>}
                    <div className="flex flex-wrap gap-2">
                        <Btn type="submit" disabled={guardando}>
                            {guardando ? 'Guardando...' : 'Guardar acceso'}
                        </Btn>
                        <Btn type="button" variant="ghost" onClick={() => setAbierto(false)}>
                            Cancelar
                        </Btn>
                    </div>
                </form>
            )}

            {!abierto && error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
        </Card>
    );
};

export default AccesoAlumno;
