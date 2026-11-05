import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Empty, ErrorBox, Input, Loading, Select } from '@/components/ui-kit';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';
import { money } from '@/lib/format';
import { enlaceSeguro } from '@/lib/enlaces';

// Control de RutNail (migración 0091, pedido de Nalux del 03/11/2026): el panel de la dueña de la
// plataforma, con TODAS las cuentas. Solo lo ve quien está en admins_plataforma; la base lo garantiza
// (plataforma_resumen() rechaza a cualquier otro), esta pantalla solo evita mostrar un menú que no abre.
// Todo sale de una sola llamada: plataforma_resumen(p_dias).

const PERIODOS = [
    { dias: 7, label: 'Últimos 7 días' },
    { dias: 30, label: 'Últimos 30 días' },
    { dias: 90, label: 'Últimos 90 días' },
];

const ESTADOS_SUSCRIPCION = {
    prueba: { label: 'Prueba gratis', className: 'border-primary text-primary' },
    activa: { label: 'Activa', className: 'border-ok text-ok' },
    pendiente: { label: 'Pago pendiente', className: 'border-warn text-warn' },
    cancelada: { label: 'Cancelada', className: 'border-destructive text-destructive' },
    cortesia: { label: 'Cortesía', className: 'border-border text-muted-foreground' },
};

const ACCESOS = {
    solo_lectura: { label: 'Solo lectura', className: 'border-warn text-warn' },
    bloqueado: { label: 'Bloqueada', className: 'border-destructive text-destructive' },
};

const MOVIMIENTOS_MP = {
    'pago:approved': { label: 'Pago aprobado', className: 'text-ok' },
    'pago:rejected': { label: 'Pago rechazado', className: 'text-destructive' },
    'pago:cancelled': { label: 'Pago cancelado', className: 'text-destructive' },
    'pago:refunded': { label: 'Pago devuelto', className: 'text-warn' },
    'pago:pending': { label: 'Pago pendiente', className: 'text-warn' },
    'pago:in_process': { label: 'Pago en revisión', className: 'text-warn' },
    'suscripcion:authorized': { label: 'Cobro automático activado', className: 'text-ok' },
    'suscripcion:paused': { label: 'Cobro automático pausado', className: 'text-warn' },
    'suscripcion:cancelled': { label: 'Cobro automático cancelado', className: 'text-destructive' },
    'suscripcion:pending': { label: 'Suscripción sin confirmar', className: 'text-warn' },
};

// Sin actividad hace más de esto: cuenta en riesgo de dejar de usar la app.
const DIAS_SIN_ACTIVIDAD = 7;

const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es', { dateStyle: 'medium' }) : '—');

const haceCuanto = (iso) => {
    if (!iso) return 'Nunca';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'Recién';
    if (min < 60) return `Hace ${min} min`;
    const horas = Math.round(min / 60);
    if (horas < 24) return `Hace ${horas} h`;
    const dias = Math.round(horas / 24);
    return `Hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
};

const diasDesde = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Un error típico después de subir una versión nueva: la pantalla quedó abierta con la versión
// anterior y pide un archivo que ya no existe. Se explica en palabras para no tener que leer el detalle.
const explicarError = (mensaje) => {
    if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(mensaje)) {
        return 'Pantalla abierta con una versión vieja después de una actualización. Desde el aviso de versión nueva, se recarga sola.';
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(mensaje)) {
        return 'Se cortó la conexión a internet mientras cargaba.';
    }
    return null;
};

// Semáforo del período: rojo si falló algo del servidor o hay muchos errores; amarillo si hay algo
// para mirar; verde si no hay nada.
const semaforoDe = (p) => {
    const problemas = [];
    const atencion = [];
    if (p.problemas_servidor > 0) {
        problemas.push(`${plural(p.problemas_servidor, 'problema', 'problemas')} del servidor (por ejemplo, un aviso de Mercado Pago que no se pudo aplicar).`);
    }
    if (p.errores >= 10) {
        problemas.push(`${plural(p.errores, 'error', 'errores')} en pantallas de clientes.`);
    } else if (p.errores > 0) {
        atencion.push(`${plural(p.errores, 'error', 'errores')} en pantallas de clientes.`);
    }
    if (p.pagos_rechazados > 0) atencion.push(`${plural(p.pagos_rechazados, 'pago rechazado', 'pagos rechazados')} en Mercado Pago.`);
    if (p.bloqueadas > 0) atencion.push(`${plural(p.bloqueadas, 'cuenta bloqueada', 'cuentas bloqueadas')} por suscripción vencida.`);
    if (p.solo_lectura > 0) atencion.push(`${plural(p.solo_lectura, 'cuenta', 'cuentas')} en solo lectura (venció y le quedan días para pagar).`);
    if (p.avisos_servidor > 0) atencion.push(`${plural(p.avisos_servidor, 'aviso', 'avisos')} del servidor para revisar.`);

    if (problemas.length) return { nivel: 'problema', titulo: 'Hay algo para resolver', items: [...problemas, ...atencion] };
    if (atencion.length) return { nivel: 'atencion', titulo: 'Hay cosas para mirar', items: atencion };
    return { nivel: 'ok', titulo: 'Todo en orden', items: ['Sin errores, sin pagos rechazados y sin problemas del servidor.'] };
};

const SEMAFORO_ESTILO = {
    ok: { icon: CheckCircle2, className: 'border-ok/50 bg-ok/10', iconClass: 'text-ok' },
    atencion: { icon: AlertTriangle, className: 'border-warn/50 bg-warn/10', iconClass: 'text-warn' },
    problema: { icon: XCircle, className: 'border-destructive/60 bg-destructive/10', iconClass: 'text-destructive' },
};

const Dato = ({ label, valor, detalle, alerta = false }) => (
    <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 font-display text-2xl font-extrabold tabular-nums ${alerta ? 'text-destructive' : ''}`}>{valor}</p>
        {detalle && <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{detalle}</p>}
    </div>
);

// Como Card pero sin relleno: cada fila de la lista lleva el suyo, así los divisores llegan al borde.
const Lista = ({ children }) => <div className="overflow-hidden rounded-2xl border border-border bg-card">{children}</div>;

const Seccion = ({ titulo, sub, children }) => (
    <section className="mt-8">
        <h2 className="font-display text-xl font-bold">{titulo}</h2>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
        <div className="mt-3">{children}</div>
    </section>
);

// Bot de Telegram (migración 0092). El enlace se muestra como botón en vez de abrirse solo: el navegador
// bloquea las ventanas que se abren después de esperar una respuesta.
const AvisosTelegram = () => {
    const [conectado, setConectado] = useState(null);
    const [enlace, setEnlace] = useState('');
    const [preparando, setPreparando] = useState(false);
    const [error, setError] = useState('');

    const revisar = useCallback(async () => {
        const { data } = await supabase.rpc('telegram_conectado');
        setConectado(data === true);
        if (data === true) setEnlace('');
    }, []);

    useEffect(() => {
        revisar();
    }, [revisar]);

    const conectar = async () => {
        setPreparando(true);
        setError('');
        const { data, error: errorFuncion } = await supabase.functions.invoke('telegram-bot', { body: { accion: 'conectar' } });
        if (data?.enlace) {
            setEnlace(data.enlace);
        } else {
            // Con un error, el mensaje de la función viene en el cuerpo de la respuesta.
            const cuerpo = await errorFuncion?.context?.json?.().catch(() => null);
            setError(cuerpo?.error || 'No se pudo preparar la conexión. Inténtalo de nuevo en un momento.');
        }
        setPreparando(false);
    };

    return (
        <Seccion
            titulo="Avisos por Telegram"
            sub="Te avisa si hay una cuenta nueva, un pago, una cancelación o un error, y le puedes preguntar cómo está todo."
        >
            <div className="rounded-2xl border border-border bg-card p-4">
                {error && (
                    <div className="mb-3">
                        <ErrorBox>{error}</ErrorBox>
                    </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm">
                        {conectado === null ? (
                            'Revisando…'
                        ) : conectado ? (
                            <span className="font-semibold text-ok">Conectado a tu Telegram</span>
                        ) : (
                            <span className="font-semibold">Todavía no está conectado</span>
                        )}
                    </p>
                    {conectado !== null && !enlace && (
                        <Btn variant={conectado ? 'ghost' : 'primary'} onClick={conectar} disabled={preparando}>
                            {preparando ? 'Preparando…' : conectado ? 'Volver a conectar' : 'Conectar Telegram'}
                        </Btn>
                    )}
                </div>
                {enlace && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                        <a
                            href={enlaceSeguro(enlace)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition active:scale-[0.98]"
                        >
                            Abrir Telegram
                        </a>
                        <Btn variant="ghost" onClick={revisar}>
                            Ya lo conecté
                        </Btn>
                        <p className="w-full text-xs text-muted-foreground">
                            En Telegram toca "Iniciar". El enlace sirve una sola vez y vence en 10 minutos.
                        </p>
                    </div>
                )}
            </div>
        </Seccion>
    );
};

// Verificación en dos pasos (migración 0097). Desde acá se activa para la cuenta de la dueña; la pantalla
// que pide el código al ingresar es components/SegundoPaso.jsx.
const DosPasos = () => {
    // undefined = revisando; null = sin activar; un objeto = el factor activo.
    const [factor, setFactor] = useState(undefined);
    const [alta, setAlta] = useState(null);
    const [codigo, setCodigo] = useState('');
    const [trabajando, setTrabajando] = useState(false);
    const [confirmandoBaja, setConfirmandoBaja] = useState(false);
    const [error, setError] = useState('');

    const revisar = useCallback(async () => {
        const { data, error: errorFactores } = await supabase.auth.mfa.listFactors();
        if (errorFactores) {
            setError('No se pudo revisar la verificación. Revisa la conexión.');
            return;
        }
        setFactor(data?.totp?.[0] ?? null);
    }, []);

    useEffect(() => {
        revisar();
    }, [revisar]);

    const empezar = async () => {
        setTrabajando(true);
        setError('');
        // Un alta que quedó a medias no deja crear otra con el mismo nombre.
        const { data: factores } = await supabase.auth.mfa.listFactors();
        for (const f of factores?.all ?? []) {
            if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
        const { data, error: errorAlta } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'RutNail' });
        if (errorAlta || !data) {
            setError('No se pudo empezar la activación. Prueba de nuevo en un momento.');
        } else {
            setAlta({ id: data.id, qr: data.totp.qr_code, clave: data.totp.secret });
        }
        setTrabajando(false);
    };

    const confirmar = async (e) => {
        e.preventDefault();
        setTrabajando(true);
        setError('');
        const { error: errorCodigo } = await supabase.auth.mfa.challengeAndVerify({ factorId: alta.id, code: codigo });
        if (errorCodigo) {
            setError(
                errorCodigo.code === 'mfa_verification_failed'
                    ? 'Ese código no es correcto o ya cambió. Escribe el que se ve ahora en tu app.'
                    : 'No se pudo verificar el código. Prueba de nuevo en unos segundos.',
            );
            setCodigo('');
        } else {
            setAlta(null);
            setCodigo('');
            await revisar();
        }
        setTrabajando(false);
    };

    const desactivar = async () => {
        setTrabajando(true);
        setError('');
        const { error: errorBaja } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (errorBaja) setError('No se pudo desactivar. Prueba de nuevo en un momento.');
        else await revisar();
        setConfirmandoBaja(false);
        setTrabajando(false);
    };

    return (
        <Seccion
            titulo="Verificación en dos pasos"
            sub="Además de la contraseña, para entrar a tu cuenta se pide un código que cambia cada 30 segundos en tu celular."
        >
            <div className="rounded-2xl border border-border bg-card p-4">
                {error && (
                    <div className="mb-3">
                        <ErrorBox>{error}</ErrorBox>
                    </div>
                )}

                {alta ? (
                    <form onSubmit={confirmar} className="space-y-4">
                        <ol className="list-decimal space-y-1 pl-5 text-sm">
                            <li>Instala en tu celular Google Authenticator o Microsoft Authenticator.</li>
                            <li>En esa app, agrega una cuenta y escanea este código.</li>
                            <li>Escribe abajo el código de 6 números que te muestra.</li>
                        </ol>
                        <img src={alta.qr} alt="Código QR para la app de autenticación" className="h-48 w-48 rounded-xl bg-white p-2" />
                        <div className="rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm">
                            <p className="font-semibold">Guarda esta clave en un lugar seguro</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Sirve para volver a cargar la cuenta si cambias de celular, o para escribirla a mano si no puedes
                                escanear el código.
                            </p>
                            <code className="mt-2 block select-all break-all font-mono text-sm">{alta.clave}</code>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="w-40">
                                <Input
                                    value={codigo}
                                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    placeholder="123456"
                                    aria-label="Código de 6 números"
                                    className="text-center tracking-[0.3em]"
                                    required
                                />
                            </div>
                            <Btn type="submit" disabled={trabajando || codigo.length !== 6}>
                                {trabajando ? 'Verificando...' : 'Activar'}
                            </Btn>
                            <Btn variant="ghost" onClick={() => setAlta(null)} disabled={trabajando}>
                                Cancelar
                            </Btn>
                        </div>
                    </form>
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm">
                            {factor === undefined ? (
                                'Revisando…'
                            ) : factor ? (
                                <span className="font-semibold text-ok">Activada en tu cuenta</span>
                            ) : (
                                <span className="font-semibold">Todavía no está activada</span>
                            )}
                        </p>
                        {factor === null && (
                            <Btn onClick={empezar} disabled={trabajando}>
                                {trabajando ? 'Preparando…' : 'Activar verificación'}
                            </Btn>
                        )}
                        {factor && !confirmandoBaja && (
                            <Btn variant="ghost" onClick={() => setConfirmandoBaja(true)}>
                                Desactivar
                            </Btn>
                        )}
                        {factor && confirmandoBaja && (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-muted-foreground">¿Desactivar la verificación?</span>
                                <Btn variant="danger" onClick={desactivar} disabled={trabajando}>
                                    Sí, desactivar
                                </Btn>
                                <Btn variant="ghost" onClick={() => setConfirmandoBaja(false)}>
                                    No
                                </Btn>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Seccion>
    );
};

const ControlPage = () => {
    const { profile, loading: cargandoPerfil } = useAuth();
    const [dias, setDias] = useState(7);
    const [datos, setDatos] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [abierto, setAbierto] = useState(null);

    const esAdminPlataforma = profile?.esAdminPlataforma === true;

    const cargar = useCallback(async () => {
        setLoading(true);
        const { data, error: errorCarga } = await supabase.rpc('plataforma_resumen', { p_dias: dias });
        if (errorCarga) {
            setError(
                /NO_AUTORIZADO/.test(errorCarga.message)
                    ? 'Esta cuenta no tiene acceso al control de RutNail.'
                    : 'No se pudo cargar el resumen. Revisa la conexión y toca "Actualizar".',
            );
        } else {
            setDatos(data);
            setError('');
        }
        setLoading(false);
    }, [dias]);

    useEffect(() => {
        if (esAdminPlataforma) cargar();
    }, [esAdminPlataforma, cargar]);

    if (!cargandoPerfil && profile && !esAdminPlataforma) {
        return <Navigate to="/panel" replace />;
    }

    const p = datos?.periodo;
    const semaforo = p ? semaforoDe(p) : null;
    const estiloSemaforo = semaforo ? SEMAFORO_ESTILO[semaforo.nivel] : null;
    const IconoSemaforo = estiloSemaforo?.icon;
    const cuentas = datos?.cuentas ?? [];
    const errores = datos?.errores ?? [];
    const eventos = datos?.eventos ?? [];
    const pagos = datos?.pagos ?? [];
    const alternar = (clave) => setAbierto(abierto === clave ? null : clave);

    return (
        <AppLayout
            title="Control de RutNail"
            subtitle="Solo lo ves tú: cómo están todas las cuentas, los pagos de Mercado Pago y los errores."
            actions={
                <Btn variant="ghost" onClick={cargar} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
                </Btn>
            }
        >
            <Helmet>
                <title>Control de RutNail</title>
            </Helmet>

            <div className="mb-5 flex flex-wrap items-center gap-3">
                <Select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período" className="sm:w-56">
                    {PERIODOS.map((o) => (
                        <option key={o.dias} value={o.dias}>
                            {o.label}
                        </option>
                    ))}
                </Select>
                {datos?.generado_en && (
                    <p className="text-xs text-muted-foreground">Actualizado: {fechaHora(datos.generado_en)}</p>
                )}
            </div>

            {error && (
                <div className="mb-4">
                    <ErrorBox>{error}</ErrorBox>
                </div>
            )}

            {loading && !datos ? (
                <Loading rows={4} />
            ) : (
                datos && (
                    <>
                        {/* Semáforo */}
                        <div className={`flex gap-3 rounded-2xl border p-4 sm:p-5 ${estiloSemaforo.className}`}>
                            <IconoSemaforo className={`mt-0.5 h-6 w-6 shrink-0 ${estiloSemaforo.iconClass}`} strokeWidth={2.2} aria-hidden="true" />
                            <div className="min-w-0">
                                <p className="font-display text-lg font-bold">{semaforo.titulo}</p>
                                <ul className="mt-1 space-y-0.5 text-sm">
                                    {semaforo.items.map((t) => (
                                        <li key={t}>{t}</li>
                                    ))}
                                </ul>
                                {(p.cuentas_nuevas > 0 || p.pruebas_por_vencer > 0) && (
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        {p.cuentas_nuevas > 0 && `${plural(p.cuentas_nuevas, 'cuenta nueva', 'cuentas nuevas')} en el período. `}
                                        {p.pruebas_por_vencer > 0 &&
                                            `${plural(p.pruebas_por_vencer, 'prueba gratis vence', 'pruebas gratis vencen')} en los próximos 3 días: buen momento para escribirles.`}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Números del período */}
                        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                            <Dato label="Cuentas nuevas" valor={p.cuentas_nuevas} />
                            <Dato label="Pagos aprobados" valor={p.pagos_aprobados} detalle={money(p.monto_aprobado)} />
                            <Dato label="Pagos rechazados" valor={p.pagos_rechazados} alerta={p.pagos_rechazados > 0} />
                            <Dato label="Cobros cancelados" valor={p.cancelaciones} />
                            <Dato label="Errores en pantallas" valor={p.errores} alerta={p.errores > 0} />
                            <Dato label="Problemas del servidor" valor={p.problemas_servidor} alerta={p.problemas_servidor > 0} />
                        </div>

                        <AvisosTelegram />
                        <DosPasos />

                        {/* Cuentas */}
                        <Seccion titulo={`Cuentas (${cuentas.length})`} sub="La más nueva primero. Los errores son los del período elegido.">
                            {cuentas.length === 0 ? (
                                <Empty>Todavía no hay cuentas.</Empty>
                            ) : (
                                <Lista>
                                    <ul className="divide-y divide-border">
                                        {cuentas.map((c) => {
                                            const estado = ESTADOS_SUSCRIPCION[c.estado];
                                            const acceso = c.estado !== 'cortesia' ? ACCESOS[c.acceso] : null;
                                            const inactiva = diasDesde(c.ultima_actividad) > DIAS_SIN_ACTIVIDAD;
                                            return (
                                                <li key={c.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                                                    <div className="min-w-0">
                                                        <p className="truncate font-semibold">{c.nombre}</p>
                                                        <p className="truncate text-xs text-muted-foreground">{c.dueno_email || 'Sin correo'}</p>
                                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                            {estado && <Badge className={estado.className}>{estado.label}</Badge>}
                                                            {acceso && <Badge className={acceso.className}>{acceso.label}</Badge>}
                                                            {c.plan_nombre && <Badge className="border-border text-muted-foreground">{c.plan_nombre}</Badge>}
                                                        </div>
                                                    </div>
                                                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-1">
                                                        <div>
                                                            <dt className="inline text-muted-foreground">Vence: </dt>
                                                            <dd className="inline tabular-nums">{c.estado === 'cortesia' ? 'Nunca' : fecha(c.vence_en)}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="inline text-muted-foreground">Creada: </dt>
                                                            <dd className="inline tabular-nums">{fecha(c.creada_en)}</dd>
                                                        </div>
                                                        <div className="col-span-2 sm:col-span-1">
                                                            <dt className="inline text-muted-foreground">Última actividad: </dt>
                                                            <dd className={`inline ${inactiva ? 'font-semibold text-warn' : ''}`}>{haceCuanto(c.ultima_actividad)}</dd>
                                                        </div>
                                                    </dl>
                                                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-1">
                                                        <div>
                                                            <dt className="inline text-muted-foreground">Alumnos: </dt>
                                                            <dd className="inline tabular-nums">
                                                                {c.alumnos_activos} activos de {c.alumnos}
                                                            </dd>
                                                        </div>
                                                        <div>
                                                            <dt className="inline text-muted-foreground">Gimnasios: </dt>
                                                            <dd className="inline tabular-nums">{c.gimnasios?.length ?? 0}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="inline text-muted-foreground">Equipo: </dt>
                                                            <dd className="inline tabular-nums">{c.equipo}</dd>
                                                        </div>
                                                        <div>
                                                            <dt className="inline text-muted-foreground">Errores: </dt>
                                                            <dd className={`inline tabular-nums ${c.errores > 0 ? 'font-semibold text-destructive' : ''}`}>{c.errores}</dd>
                                                        </div>
                                                    </dl>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </Lista>
                            )}
                        </Seccion>

                        {/* Errores */}
                        <Seccion
                            titulo="Errores en pantallas"
                            sub="Lo que falló en el navegador de un profesor, de su equipo o de un alumno, agrupado por tipo de error."
                        >
                            {errores.length === 0 ? (
                                <Empty>Sin errores en el período.</Empty>
                            ) : (
                                <Lista>
                                    <ul className="divide-y divide-border">
                                        {errores.map((e) => {
                                            const clave = `error:${e.mensaje}`;
                                            const explicacion = explicarError(e.mensaje);
                                            return (
                                                <li key={clave} className="p-4">
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <p className="min-w-0 break-words text-sm font-semibold">{e.mensaje}</p>
                                                        <p className="shrink-0 text-xs text-muted-foreground">{fechaHora(e.ultima_vez)}</p>
                                                    </div>
                                                    {explicacion && <p className="mt-1 text-sm text-muted-foreground">{explicacion}</p>}
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {plural(e.veces, 'vez', 'veces')} · {plural(e.cuentas, 'cuenta', 'cuentas')}
                                                        {e.ultimo?.gimnasio && ` · última en ${e.ultimo.gimnasio}`}
                                                        {e.ultimo?.ruta && ` · pantalla ${e.ultimo.ruta.split('?')[0]}`}
                                                    </p>
                                                    <button type="button" onClick={() => alternar(clave)} className="mt-2 text-xs font-semibold text-primary">
                                                        {abierto === clave ? 'Ocultar detalle' : 'Ver detalle'}
                                                    </button>
                                                    {abierto === clave && (
                                                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-secondary p-3 text-xs">
                                                            {[e.ultimo?.detalle, e.ultimo?.user_agent && `Navegador: ${e.ultimo.user_agent}`]
                                                                .filter(Boolean)
                                                                .join('\n\n') || 'Sin detalle.'}
                                                        </pre>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </Lista>
                            )}
                        </Seccion>

                        {/* Problemas del servidor */}
                        <Seccion
                            titulo="Problemas del servidor"
                            sub="Avisos de Mercado Pago que fallaron o no se reconocieron, y errores al abrir el pago."
                        >
                            {eventos.length === 0 ? (
                                <Empty>Sin problemas del servidor en el período.</Empty>
                            ) : (
                                <Lista>
                                    <ul className="divide-y divide-border">
                                        {eventos.map((ev) => {
                                            const clave = `evento:${ev.id}`;
                                            return (
                                                <li key={clave} className="p-4">
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <p className="min-w-0 text-sm">
                                                            <Badge
                                                                className={`mr-2 ${ev.nivel === 'error' ? 'border-destructive text-destructive' : 'border-warn text-warn'}`}
                                                            >
                                                                {ev.nivel === 'error' ? 'Error' : 'Aviso'}
                                                            </Badge>
                                                            <span className="font-semibold">{ev.mensaje}</span>
                                                        </p>
                                                        <p className="shrink-0 text-xs text-muted-foreground">{fechaHora(ev.creado_en)}</p>
                                                    </div>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {ev.origen}
                                                        {ev.cuenta && ` · ${ev.cuenta}`}
                                                    </p>
                                                    {ev.detalle && (
                                                        <>
                                                            <button type="button" onClick={() => alternar(clave)} className="mt-2 text-xs font-semibold text-primary">
                                                                {abierto === clave ? 'Ocultar detalle' : 'Ver detalle'}
                                                            </button>
                                                            {abierto === clave && (
                                                                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-secondary p-3 text-xs">
                                                                    {JSON.stringify(ev.detalle, null, 2)}
                                                                </pre>
                                                            )}
                                                        </>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </Lista>
                            )}
                        </Seccion>

                        {/* Mercado Pago */}
                        <Seccion titulo="Movimientos de Mercado Pago" sub="Lo que avisó Mercado Pago en el período, el más reciente primero.">
                            {pagos.length === 0 ? (
                                <Empty>Sin movimientos en el período.</Empty>
                            ) : (
                                <Lista>
                                    <ul className="divide-y divide-border">
                                        {pagos.map((m) => {
                                            const tipo = MOVIMIENTOS_MP[`${m.tipo}:${m.estado}`] ?? { label: `${m.tipo} ${m.estado}`, className: '' };
                                            return (
                                                <li key={`${m.creado_en}:${m.tipo}:${m.estado}`} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                                                    <div className="min-w-0">
                                                        <p className={`font-semibold ${tipo.className}`}>{tipo.label}</p>
                                                        <p className="text-xs text-muted-foreground">{m.cuenta || 'Cuenta borrada'}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        {m.monto != null && <p className="font-semibold tabular-nums">{money(m.monto)}</p>}
                                                        <p className="text-xs text-muted-foreground">{fechaHora(m.creado_en)}</p>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </Lista>
                            )}
                        </Seccion>
                    </>
                )
            )}
        </AppLayout>
    );
};

export default ControlPage;
