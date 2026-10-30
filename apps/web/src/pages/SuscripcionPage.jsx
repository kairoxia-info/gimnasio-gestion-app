import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useSearchParams } from 'react-router-dom';
import { Check, CreditCard, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, ErrorBox, Field, Input, Loading } from '@/components/ui-kit';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';
import { fmtFecha } from '@/lib/format';
import { AYUDAS } from '@/lib/guiaDeUso';
import { PERIODOS_PAGO, formatoPesos } from '@/lib/planesSuscripcion';

// Suscripción (migración 0086, pedido de Nalux del 30/10/2026): plan actual, uso y pago con Mercado Pago.
// Solo el administrador la ve. Los precios, los topes y el estado salen de la base (mi_suscripcion):
// acá solo se muestran. El pago lo crea la función "suscripcion" y lo confirma Mercado Pago por
// webhook, así que después de pagar se consulta cada pocos segundos hasta que aparece activo.

const ETIQUETA_ESTADO = {
    prueba: ['Prueba gratis', 'border-primary text-foreground'],
    activa: ['Activa', 'border-ok text-ok'],
    pendiente: ['Esperando el pago', 'border-warn text-warn'],
    cancelada: ['Cobro automático cancelado', 'border-warn text-warn'],
    cortesia: ['Cortesía', 'border-ok text-ok'],
};

const mensajeDeError = async (error, porDefecto) => {
    try {
        const cuerpo = await error?.context?.json?.();
        if (cuerpo?.error) return cuerpo.error;
    } catch (_) {
        // sin cuerpo legible
    }
    return porDefecto;
};

const llamarSuscripcion = async (body) => {
    const { data, error } = await supabase.functions.invoke('suscripcion', { body });
    if (error) return { error: await mensajeDeError(error, 'No se pudo completar la acción. Inténtalo de nuevo en unos minutos.') };
    if (data?.error) return { error: data.error };
    return { data };
};

const textoTope = (n, singular, plural) => (n === null || n === undefined ? 'sin límite' : `${n} ${n === 1 ? singular : plural}`);

const SuscripcionPage = () => {
    const { profile, user, refreshProfile } = useAuth();
    const [busqueda, setBusqueda] = useSearchParams();
    const volvio = busqueda.get('volvio') === '1';
    const esAdmin = profile?.role === 'admin';

    const [info, setInfo] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [periodoClave, setPeriodoClave] = useState('mensual');
    const [elegido, setElegido] = useState(null); // clave del plan
    const [email, setEmail] = useState('');
    const [pagando, setPagando] = useState(false);
    const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);
    const [cancelando, setCancelando] = useState(false);
    const [confirmando, setConfirmando] = useState(volvio); // esperando el aviso de Mercado Pago
    const [confirmado, setConfirmado] = useState(false);
    const venceAntes = useRef(null);

    const cargar = useCallback(async () => {
        const { data, error: err } = await supabase.rpc('mi_suscripcion');
        if (err) {
            setError('No se pudo cargar la suscripción. Inténtalo de nuevo.');
            return null;
        }
        setInfo(data);
        return data;
    }, []);

    useEffect(() => {
        let cancelado = false;
        cargar().finally(() => {
            if (!cancelado) setCargando(false);
        });
        return () => {
            cancelado = true;
        };
    }, [cargar]);

    useEffect(() => {
        if (user?.email) setEmail((e) => e || user.email);
    }, [user?.email]);

    // Al volver de Mercado Pago: se consulta cada 4 s (hasta 2 minutos) hasta que el pago figura aprobado.
    useEffect(() => {
        if (!volvio) return undefined;
        let intentos = 0;
        let cancelado = false;
        const t = setInterval(async () => {
            intentos += 1;
            const data = await cargar();
            if (cancelado) return;
            if (data?.estado === 'activa' && data.vence_en !== venceAntes.current) {
                clearInterval(t);
                setConfirmando(false);
                setConfirmado(true);
                refreshProfile?.();
                setBusqueda({}, { replace: true });
            } else if (intentos >= 30) {
                clearInterval(t);
                setConfirmando(false);
            }
        }, 4000);
        return () => {
            cancelado = true;
            clearInterval(t);
        };
    }, [volvio, cargar, refreshProfile, setBusqueda]);

    useEffect(() => {
        if (info && venceAntes.current === null) venceAntes.current = info.vence_en;
    }, [info]);

    const periodo = PERIODOS_PAGO.find((p) => p.clave === periodoClave);

    const pagar = async () => {
        setError('');
        setPagando(true);
        const { data, error: err } = await llamarSuscripcion({
            accion: 'crear',
            plan: elegido,
            periodo: periodoClave,
            email: email.trim(),
            volver_a: window.location.origin,
        });
        if (err) {
            setError(err);
            setPagando(false);
            return;
        }
        // Se va a Mercado Pago a pagar; vuelve a esta pantalla con ?volvio=1.
        window.location.href = data.init_point;
    };

    const cancelarCobro = async () => {
        setError('');
        setCancelando(true);
        const { error: err } = await llamarSuscripcion({ accion: 'cancelar' });
        setCancelando(false);
        setConfirmandoCancelar(false);
        if (err) {
            setError(err);
            return;
        }
        await cargar();
        refreshProfile?.();
    };

    if (profile && !esAdmin) {
        return (
            <AppLayout title="Suscripción" subtitle="Plan y pagos de RutNail.">
                <Card>
                    <p className="text-sm text-muted-foreground">Solo el administrador puede ver y cambiar la suscripción.</p>
                </Card>
            </AppLayout>
        );
    }

    const plan = info?.planes?.find((p) => p.clave === info.plan);
    const [textoEstado, tonoEstado] = ETIQUETA_ESTADO[info?.estado] || [info?.estado || '', 'border-border'];
    const alertaAcceso =
        info?.acceso === 'solo_lectura'
            ? 'Tu suscripción venció: la cuenta está en solo lectura. Renueva el plan para volver a editar.'
            : info?.acceso === 'bloqueado'
              ? 'Tu suscripción venció y el acceso está pausado. Renueva el plan y todo vuelve a estar como lo dejaste.'
              : '';

    return (
        <AppLayout title="Suscripción" subtitle="Tu plan, tu uso y el pago con Mercado Pago." ayuda={AYUDAS.suscripcion}>
            <Helmet>
                <title>Suscripción | RutNail</title>
                <meta name="description" content="Plan, uso y pago de la suscripción de RutNail." />
            </Helmet>

            {error && (
                <div className="mb-4">
                    <ErrorBox>{error}</ErrorBox>
                </div>
            )}

            {confirmando && (
                <div className="mb-4 rounded-2xl border-2 border-primary bg-primary/10 p-4 text-sm font-semibold">
                    Estamos confirmando tu pago con Mercado Pago. Puede tardar un minuto: esta pantalla se actualiza sola.
                </div>
            )}
            {confirmado && (
                <div className="mb-4 flex items-start gap-2 rounded-2xl border-2 border-ok bg-ok/10 p-4 text-sm font-semibold text-ok">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} /> ¡Listo! Tu pago se confirmó y tu suscripción
                    está activa.
                </div>
            )}
            {alertaAcceso && (
                <div className="mb-4 rounded-2xl border-2 border-destructive bg-destructive/10 p-4 text-sm font-semibold text-destructive">
                    {alertaAcceso}
                </div>
            )}

            {cargando || !info ? (
                <Loading />
            ) : (
                <>
                    <div className="mb-6 grid gap-4 lg:grid-cols-2">
                        <Card>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h2 className="font-display text-lg font-bold">Tu plan</h2>
                                <Badge className={tonoEstado}>{textoEstado}</Badge>
                            </div>
                            <p className="font-display mt-3 text-3xl font-extrabold">{plan?.nombre}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {info.vence_en
                                    ? `${info.estado === 'prueba' ? 'La prueba termina' : info.acceso === 'completo' ? 'Vence' : 'Venció'} el ${fmtFecha(info.vence_en)}`
                                    : ''}
                                {info.acceso === 'completo' && info.dias_restantes !== null && info.dias_restantes >= 0
                                    ? ` (${info.dias_restantes === 0 ? 'hoy' : info.dias_restantes === 1 ? 'en 1 día' : `en ${info.dias_restantes} días`})`
                                    : ''}
                            </p>
                            {info.tiene_cobro_automatico && (
                                <div className="mt-4">
                                    {!confirmandoCancelar ? (
                                        <Btn variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setConfirmandoCancelar(true)}>
                                            Cancelar el cobro automático
                                        </Btn>
                                    ) : (
                                        <div className="rounded-xl border border-border p-3 text-sm">
                                            <p>
                                                No se te cobrará más. Sigues con acceso hasta el vencimiento ya pagado y después la
                                                cuenta pasa a solo lectura.
                                            </p>
                                            <div className="mt-3 flex gap-2">
                                                <Btn variant="danger" className="px-3 py-1.5 text-xs" onClick={cancelarCobro} disabled={cancelando}>
                                                    {cancelando ? 'Cancelando...' : 'Sí, cancelar'}
                                                </Btn>
                                                <Btn variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setConfirmandoCancelar(false)}>
                                                    No
                                                </Btn>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </Card>

                        <Card>
                            <h2 className="font-display text-lg font-bold">Tu uso</h2>
                            <dl className="mt-3 space-y-3 text-sm">
                                <div>
                                    <dt className="text-muted-foreground">Alumnos activos</dt>
                                    <dd className="font-semibold">
                                        {info.uso.alumnos} de {textoTope(plan?.max_alumnos, 'alumno', 'alumnos')}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-muted-foreground">Gimnasios</dt>
                                    <dd className="font-semibold">
                                        {info.uso.gimnasios} de {textoTope(plan?.max_gimnasios, 'gimnasio', 'gimnasios')}
                                    </dd>
                                </div>
                            </dl>
                        </Card>
                    </div>

                    <h2 className="font-display mb-3 text-xl font-bold">
                        {info.estado === 'activa' ? 'Cambiar de plan o renovar' : 'Elige tu plan'}
                    </h2>
                    <div
                        role="group"
                        aria-label="Período de pago"
                        className="mb-4 flex w-fit max-w-full flex-wrap gap-1 rounded-2xl border border-border bg-card p-1"
                    >
                        {PERIODOS_PAGO.map((p) => (
                            <button
                                key={p.clave}
                                type="button"
                                aria-pressed={p.clave === periodoClave}
                                onClick={() => setPeriodoClave(p.clave)}
                                className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold transition ${
                                    p.clave === periodoClave ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {p.etiqueta}
                                {p.descuento > 0 && <span className="ml-1.5 text-xs font-bold">−{Math.round(p.descuento * 100)}%</span>}
                            </button>
                        ))}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                        {info.planes.map((p) => {
                            const total = p.montos[periodoClave];
                            const porMes = Math.round(total / periodo.meses);
                            const esElActual = p.clave === info.plan && info.estado === 'activa' && info.periodo === periodoClave;
                            const seleccionado = elegido === p.clave;
                            return (
                                <Card key={p.clave} className={seleccionado ? 'border-2 border-primary' : ''}>
                                    <h3 className="font-display text-xl font-bold">{p.nombre}</h3>
                                    <p className="mt-2">
                                        <span className="font-display text-3xl font-extrabold tabular-nums">{formatoPesos(porMes)}</span>
                                        <span className="text-sm text-muted-foreground"> / mes</span>
                                    </p>
                                    <p className="mt-1 min-h-[20px] text-xs text-muted-foreground">
                                        {periodo.meses > 1 ? `Pagas ${formatoPesos(total)} cada ${periodo.meses} meses` : 'Pago mes a mes'}
                                    </p>
                                    <ul className="mt-4 space-y-2 text-sm">
                                        <li className="flex items-start gap-2">
                                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2.5} />
                                            {textoTope(p.max_gimnasios, 'gimnasio', 'gimnasios')}
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2.5} />
                                            {p.max_alumnos === null ? 'Alumnos ilimitados' : `Hasta ${p.max_alumnos} alumnos`}
                                        </li>
                                        <li className={`flex items-start gap-2 ${p.incluye_alimentacion ? '' : 'text-muted-foreground'}`}>
                                            {p.incluye_alimentacion ? (
                                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2.5} />
                                            ) : (
                                                <X className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                                            )}
                                            Alimentos y planes de alimentación
                                        </li>
                                    </ul>
                                    <Btn
                                        className="mt-5 w-full"
                                        variant={seleccionado ? 'primary' : 'ghost'}
                                        onClick={() => setElegido(p.clave)}
                                        disabled={esElActual}
                                    >
                                        {esElActual ? 'Tu plan actual' : seleccionado ? 'Elegido' : 'Elegir este plan'}
                                    </Btn>
                                </Card>
                            );
                        })}
                    </div>

                    {elegido && (
                        <Card className="mt-6">
                            <h3 className="font-display text-lg font-bold">Pagar con Mercado Pago</h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Pagarás {formatoPesos(info.planes.find((p) => p.clave === elegido).montos[periodoClave])}{' '}
                                {periodo.meses > 1 ? `cada ${periodo.meses} meses` : 'cada mes'}, con cobro automático. Puedes cancelarlo
                                cuando quieras desde esta pantalla.
                            </p>
                            <Field label="Correo de tu cuenta de Mercado Pago" className="mt-4 max-w-md">
                                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                            </Field>
                            <Btn className="mt-4" onClick={pagar} disabled={pagando || !email.trim()}>
                                <CreditCard className="h-4 w-4" /> {pagando ? 'Abriendo Mercado Pago...' : 'Pagar con Mercado Pago'}
                            </Btn>
                        </Card>
                    )}
                </>
            )}
        </AppLayout>
    );
};

export default SuscripcionPage;
