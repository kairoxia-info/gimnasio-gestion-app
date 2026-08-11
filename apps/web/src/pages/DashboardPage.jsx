import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarCheck, TrendingUp, Users, Wallet } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Card, Empty, Loading } from '@/components/ui-kit';
import CountUp from '@/components/CountUp';
import { ESTADOS_PAGO, estadoDesdeVencimiento, fmtFecha, listAll, money } from '@/lib/data';

const DashboardPage = () => {
    const [state, setState] = useState({ loading: true, alumnos: [], pagos: [], asistencias: [] });

    useEffect(() => {
        let alive = true;
        Promise.all([listAll('alumnos'), listAll('pagos'), listAll('asistencias')])
            .then(([alumnos, pagos, asistencias]) => {
                if (alive) setState({ loading: false, alumnos, pagos, asistencias });
            })
            .catch(() => alive && setState((s) => ({ ...s, loading: false })));
        return () => {
            alive = false;
        };
    }, []);

    const { alumnos, pagos, asistencias, loading } = state;

    const resumen = useMemo(() => {
        const mes = new Date().toISOString().slice(0, 7);
        const cajaMes = pagos
            .filter((p) => String(p.fecha_pago || '').startsWith(mes))
            .reduce((acc, p) => acc + Number(p.monto || 0), 0);

        const ultimoPorAlumno = new Map();
        pagos.forEach((p) => {
            const prev = ultimoPorAlumno.get(p.alumno);
            if (!prev || String(p.periodo_hasta || '') > String(prev.periodo_hasta || '')) {
                ultimoPorAlumno.set(p.alumno, p);
            }
        });

        const activos = alumnos.filter((a) => a.activo);
        let alDia = 0;
        let proximos = 0;
        let deudores = 0;
        activos.forEach((a) => {
            const p = ultimoPorAlumno.get(a.id);
            const estado = p ? estadoDesdeVencimiento(p.periodo_hasta) : 'vencido';
            if (estado === 'al_dia') alDia += 1;
            else if (estado === 'proximo') proximos += 1;
            else deudores += 1;
        });

        const desde = new Date();
        desde.setDate(desde.getDate() - 7);
        const semana = asistencias.filter((x) => new Date(x.fecha + 'T00:00:00') >= desde);
        const presentes = semana.filter((x) => x.presente).length;

        const morosos = activos
            .map((a) => ({ alumno: a, pago: ultimoPorAlumno.get(a.id) }))
            .filter(({ pago }) => (pago ? estadoDesdeVencimiento(pago.periodo_hasta) !== 'al_dia' : true));

        return { cajaMes, activos: activos.length, alDia, proximos, deudores, presentes, semana: semana.length, morosos };
    }, [alumnos, pagos, asistencias]);

    const stats = [
        { label: 'Alumnos activos', value: resumen.activos, icon: Users, to: '/alumnos' },
        { label: 'Al día con el pago', value: resumen.alDia, icon: Wallet, to: '/pagos' },
        { label: 'Asistencias (7 días)', value: resumen.presentes, icon: CalendarCheck, to: '/asistencia' },
        { label: 'En mora o por vencer', value: resumen.deudores + resumen.proximos, icon: TrendingUp, to: '/pagos' },
    ];

    return (
        <AppLayout
            title="Panel general"
            subtitle="Todo el estado del gimnasio en una sola pantalla: alumnos, asistencia y caja del mes."
        >
            <Helmet>
                <title>Panel general | Fitness Gym Place</title>
                <meta
                    name="description"
                    content="Resumen de alumnos activos, asistencias de la semana, caja del mes y alumnos en mora en Fitness Gym Place."
                />
            </Helmet>

            {loading ? (
                <Loading rows={4} />
            ) : (
                <div className="space-y-8">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {stats.map(({ label, value, icon: Icon, to }) => (
                            <Link
                                key={label}
                                to={to}
                                className="group rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary"
                            >
                                <div className="flex items-center justify-between">
                                    <Icon className="h-5 w-5 text-primary" strokeWidth={2} />
                                    <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
                                </div>
                                <p className="mt-5 font-display text-4xl font-extrabold">
                                    <CountUp value={value} />
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">{label}</p>
                            </Link>
                        ))}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                        <div className="relative overflow-hidden rounded-2xl border border-border bg-primary p-6 text-primary-foreground lg:col-span-1">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-90">
                                Caja del mes
                            </p>
                            <p className="mt-4 font-display text-3xl font-extrabold">{money(resumen.cajaMes)}</p>
                            <p className="mt-2 text-sm opacity-90">
                                {resumen.alDia} al día · {resumen.proximos} por vencer · {resumen.deudores} en mora
                            </p>
                        </div>

                        <Card className="lg:col-span-2">
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="font-display text-lg font-bold">Atención requerida</h2>
                                <Link to="/pagos" className="text-sm font-semibold text-primary">
                                    Ver pagos
                                </Link>
                            </div>
                            {resumen.morosos.length === 0 ? (
                                <Empty>Todos los alumnos activos están al día. Buen trabajo.</Empty>
                            ) : (
                                <ul className="divide-y divide-border">
                                    {resumen.morosos.slice(0, 6).map(({ alumno, pago }) => {
                                        const estado = pago ? estadoDesdeVencimiento(pago.periodo_hasta) : 'vencido';
                                        return (
                                            <li key={alumno.id} className="flex items-center justify-between gap-3 py-3">
                                                <Link
                                                    to={`/alumnos/${alumno.id}`}
                                                    className="text-sm font-semibold hover:text-primary"
                                                >
                                                    {alumno.nombre}
                                                </Link>
                                                <span className="text-right text-xs text-muted-foreground">
                                                    {pago
                                                        ? `Vence ${fmtFecha(pago.periodo_hasta)}`
                                                        : 'Sin pagos registrados'}
                                                    <span className="ml-2 font-semibold text-foreground">
                                                        {ESTADOS_PAGO[estado].label}
                                                    </span>
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </Card>
                    </div>

                    <Card>
                        <h2 className="font-display text-lg font-bold">Flujo recomendado</h2>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {[
                                ['1. Cargar biblioteca', 'Ejercicios y alimentos una sola vez.', '/ejercicios'],
                                ['2. Armar el plan', 'Elegí ejercicios y definí series y reps.', '/alumnos'],
                                ['3. Marcar asistencia', 'Presente o ausente, día por día.', '/asistencia'],
                                ['4. Registrar el pago', 'Monto, período y estado del alumno.', '/pagos'],
                            ].map(([t, d, to]) => (
                                <Link
                                    key={t}
                                    to={to}
                                    className="rounded-xl border border-border p-4 transition hover:border-primary"
                                >
                                    <p className="text-sm font-bold">{t}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">{d}</p>
                                </Link>
                            ))}
                        </div>
                    </Card>
                </div>
            )}
        </AppLayout>
    );
};

export default DashboardPage;
