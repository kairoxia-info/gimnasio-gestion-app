import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Cake, CalendarCheck, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AppLayout from '@/components/AppLayout';
import { Card, Empty, Loading } from '@/components/ui-kit';
import CountUp from '@/components/CountUp';
import { listAll } from '@/lib/data';
import supabase from '@/lib/supabaseClient';
import { ESTADOS_PAGO, estadoAlumno, estadoDesdeVencimiento, fmtFecha, fmtMes, money } from '@/lib/format';

// Últimos 12 meses, agrupados en el servidor (ingresos_por_mes(), migración
// 0024) -- reemplaza el viejo listAll('pagos') sin filtro que traía TODA la
// tabla al cliente solo para sumarla mes a mes en un useMemo. RPC en vez de
// listAll() porque PostgREST no arma un GROUP BY por su cuenta.
const cargarIngresosMensuales = () =>
    supabase
        .rpc('ingresos_por_mes', { p_meses: 12 })
        .then(({ data, error }) => {
            if (error) throw error;
            return data || [];
        });

const DashboardPage = () => {
    const [state, setState] = useState({
        loading: true,
        alumnos: [],
        pagos: [],
        asistencias: [],
        rutinasAsignadas: [],
        planesAlimentacion: [],
        ingresosMensuales: [],
    });

    useEffect(() => {
        let alive = true;
        Promise.all([
            listAll('alumnos'),
            listAll('pagos'),
            listAll('asistencias'),
            listAll('rutinas_asignadas', { filters: { activa: true } }),
            listAll('planes_alimentacion'),
            cargarIngresosMensuales(),
        ])
            .then(([alumnos, pagos, asistencias, rutinasAsignadas, planesAlimentacion, ingresosMensuales]) => {
                if (alive) {
                    setState({
                        loading: false,
                        alumnos,
                        pagos,
                        asistencias,
                        rutinasAsignadas,
                        planesAlimentacion,
                        ingresosMensuales,
                    });
                }
            })
            .catch(() => alive && setState((s) => ({ ...s, loading: false })));
        return () => {
            alive = false;
        };
    }, []);

    const { alumnos, pagos, asistencias, rutinasAsignadas, planesAlimentacion, ingresosMensuales, loading } = state;

    const resumen = useMemo(() => {
        // El mes actual es siempre el último de la serie que ya trae
        // ingresos_por_mes() (0024) -- ya no hace falta recalcularlo acá
        // filtrando pagos a mano, es el mismo número que va a mostrar el
        // gráfico de más abajo.
        const cajaMes = Number(ingresosMensuales[ingresosMensuales.length - 1]?.total || 0);

        const ultimoPorAlumno = new Map();
        pagos.forEach((p) => {
            const prev = ultimoPorAlumno.get(p.alumno_id);
            if (!prev || String(p.periodo_hasta || '') > String(prev.periodo_hasta || '')) {
                ultimoPorAlumno.set(p.alumno_id, p);
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

        // Cumpleaños de hoy: compara mes+día contra la fecha de hoy, ignora el
        // año (fecha_nacimiento es opcional, la mayoría de los alumnos no la
        // van a tener cargada — no filtramos por activo, un alumno inactivo
        // sigue siendo alguien a quien saludar si vuelve a aparecer).
        const ahora = new Date();
        const cumpleañeros = alumnos.filter((a) => {
            if (!a.fecha_nacimiento) return false;
            const nacimiento = new Date(`${a.fecha_nacimiento}T00:00:00`);
            return nacimiento.getMonth() === ahora.getMonth() && nacimiento.getDate() === ahora.getDate();
        });

        // Mismo criterio que AlumnosPage/AlumnoPage (estadoAlumno() en
        // format.js): "Pendiente" es tanto autorregistro por QR sin aprobar
        // como alguien que el profesor marcó pendiente a mano.
        const pendientes = alumnos.filter((a) => estadoAlumno(a) === 'pendiente');

        // Vencimiento de rutina y plan de comida, mismo criterio de 7 días
        // que ya usa el estado de cuotas (estadoDesdeVencimiento) — pero acá
        // NO hay estado por default: sin fecha_fin cargada, ese plan
        // simplemente no entra en la cuenta (no se inventa un vencimiento
        // para algo al que nunca se le puso fecha).
        const hoyMedianoche = new Date();
        hoyMedianoche.setHours(0, 0, 0, 0);
        const diasHasta = (fecha) => {
            const f = new Date(`${fecha}T00:00:00`);
            return Math.round((f - hoyMedianoche) / 86400000);
        };

        // rutinas_asignadas no tiene límite de una fila activa por alumno a
        // nivel de base -- en la práctica sí lo es (RutinasPage/AlumnoPage
        // desactivan la vieja antes de crear la nueva), pero por las dudas
        // se toma la más reciente si hubiera más de una.
        const rutinaPorAlumno = new Map();
        rutinasAsignadas.forEach((r) => {
            if (!r.fecha_fin) return;
            const prev = rutinaPorAlumno.get(r.alumno_id);
            if (!prev || String(r.created_at) > String(prev.created_at)) rutinaPorAlumno.set(r.alumno_id, r);
        });
        const dietaPorAlumno = new Map();
        planesAlimentacion.forEach((p) => {
            if (!p.fecha_fin) return;
            const prev = dietaPorAlumno.get(p.alumno_id);
            if (!prev || String(p.created_at) > String(prev.created_at)) dietaPorAlumno.set(p.alumno_id, p);
        });

        const planesPorVencer = [];
        activos.forEach((a) => {
            const rutina = rutinaPorAlumno.get(a.id);
            if (rutina) {
                const dias = diasHasta(rutina.fecha_fin);
                if (dias <= 7) {
                    planesPorVencer.push({ alumno: a, tipo: 'Rutina', fecha: rutina.fecha_fin, vencido: dias < 0 });
                }
            }
            const dieta = dietaPorAlumno.get(a.id);
            if (dieta) {
                const dias = diasHasta(dieta.fecha_fin);
                if (dias <= 7) {
                    planesPorVencer.push({
                        alumno: a,
                        tipo: 'Plan de comida',
                        fecha: dieta.fecha_fin,
                        vencido: dias < 0,
                    });
                }
            }
        });
        // Vencidos primero, y entre iguales el que vence/venció antes.
        planesPorVencer.sort((x, y) => {
            if (x.vencido !== y.vencido) return x.vencido ? -1 : 1;
            return String(x.fecha).localeCompare(String(y.fecha));
        });

        // Alumnos activos que hace rato no aparecen. Se mide contra la última
        // fecha con presente=true — "ausente" y "sin registro" no cuentan
        // como venir. El corte es de 10 días y no de 7 como los vencimientos:
        // la asistencia se carga a mano y el profesor puede saltearse algún
        // día, así que una ventana más ancha evita avisar de más por alguien
        // que se tomó un fin de semana largo.
        //
        // Un alumno activo que NUNCA tuvo un presente no entra en la lista:
        // no se puede distinguir al que dejó de venir del recién dado de alta
        // que todavía no arrancó (ese caso ya lo cubre "alumnos pendientes").
        const DIAS_SIN_VENIR = 10;
        const ultimaPresenciaPorAlumno = new Map();
        asistencias.forEach((x) => {
            if (!x.presente) return;
            const prev = ultimaPresenciaPorAlumno.get(x.alumno_id);
            if (!prev || String(x.fecha) > String(prev)) ultimaPresenciaPorAlumno.set(x.alumno_id, x.fecha);
        });

        const dejaronDeVenir = activos
            .map((a) => {
                const ultima = ultimaPresenciaPorAlumno.get(a.id);
                return ultima ? { alumno: a, ultima, dias: -diasHasta(ultima) } : null;
            })
            .filter((x) => x && x.dias >= DIAS_SIN_VENIR)
            .sort((x, y) => y.dias - x.dias);

        return {
            cajaMes,
            activos: activos.length,
            alDia,
            proximos,
            deudores,
            presentes,
            semana: semana.length,
            morosos,
            cumpleañeros,
            pendientes,
            planesPorVencer,
            dejaronDeVenir,
        };
    }, [alumnos, pagos, asistencias, rutinasAsignadas, planesAlimentacion, ingresosMensuales]);

    const stats = [
        { label: 'Alumnos activos', value: resumen.activos, icon: Users, to: '/alumnos' },
        { label: 'Al día con el pago', value: resumen.alDia, icon: Wallet, to: '/pagos' },
        { label: 'Asistencias (7 días)', value: resumen.presentes, icon: CalendarCheck, to: '/asistencia' },
        { label: 'Atrasados o por vencer', value: resumen.deudores + resumen.proximos, icon: TrendingUp, to: '/pagos' },
    ];

    // Serie para el gráfico de ingresos mensuales -- mismo dato que ya trae
    // ingresosMensuales, solo formateado para recharts (etiqueta corta de
    // mes en vez de la fecha "YYYY-MM-01" cruda).
    const serieIngresos = useMemo(
        () => ingresosMensuales.map((m) => ({ mes: fmtMes(m.mes), total: Number(m.total || 0) })),
        [ingresosMensuales],
    );

    return (
        <AppLayout
            title="Panel general"
            subtitle="Todo el estado del gimnasio en una sola pantalla: alumnos, asistencia y caja del mes."
        >
            <Helmet>
                <title>Panel general | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Resumen de alumnos activos, asistencias de la semana, caja del mes y alumnos atrasados en Gestión GYM Kairox IA."
                />
            </Helmet>

            {loading ? (
                <Loading rows={4} />
            ) : (
                <div className="space-y-8">
                    {resumen.pendientes.length > 0 && (
                        <Link
                            to="/alumnos"
                            className="flex flex-wrap items-center gap-3 rounded-2xl border border-warn/50 bg-warn/10 px-5 py-4 transition hover:border-warn"
                        >
                            <UserPlus className="h-5 w-5 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
                            <p className="text-sm">
                                <span className="font-bold text-warn">
                                    {resumen.pendientes.length === 1
                                        ? '1 alumno pendiente'
                                        : `${resumen.pendientes.length} alumnos pendientes`}
                                </span>{' '}
                                — todavía no arrancaron o están esperando que los actives.
                            </p>
                        </Link>
                    )}

                    {resumen.cumpleañeros.length > 0 && (
                        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/50 bg-primary/10 px-5 py-4">
                            <Cake className="h-5 w-5 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
                            <p className="text-sm">
                                <span className="font-bold">
                                    {resumen.cumpleañeros.length === 1 ? 'Hoy cumple años' : 'Hoy cumplen años'}
                                </span>{' '}
                                {resumen.cumpleañeros.map((a, i) => (
                                    <React.Fragment key={a.id}>
                                        {i > 0 && ', '}
                                        <Link to={`/alumnos/${a.id}`} className="font-semibold text-primary hover:underline">
                                            {a.nombre}
                                        </Link>
                                    </React.Fragment>
                                ))}
                                .
                            </p>
                        </div>
                    )}

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
                                {resumen.alDia} al día · {resumen.proximos} por vencer · {resumen.deudores} atrasados
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
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h2 className="font-display text-lg font-bold">Ingresos por mes</h2>
                                <p className="text-sm text-muted-foreground">
                                    Últimos 12 meses, según la fecha de cada pago cargado.
                                </p>
                            </div>
                            <Link to="/pagos" className="text-sm font-semibold text-primary">
                                Ver pagos
                            </Link>
                        </div>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={serieIngresos}>
                                    <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                                    <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                                    <YAxis
                                        stroke="hsl(var(--muted-foreground))"
                                        fontSize={12}
                                        width={70}
                                        tickFormatter={(v) => money(v)}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'hsl(var(--secondary))' }}
                                        contentStyle={{
                                            background: 'hsl(var(--card))',
                                            border: '1px solid hsl(var(--border))',
                                            borderRadius: 12,
                                            color: 'hsl(var(--foreground))',
                                        }}
                                        formatter={(v) => [money(v), 'Cobrado']}
                                    />
                                    <Bar dataKey="total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>

                    <Card>
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="font-display text-lg font-bold">Planes por vencer</h2>
                            <Link to="/alumnos" className="text-sm font-semibold text-primary">
                                Ver alumnos
                            </Link>
                        </div>
                        {resumen.planesPorVencer.length === 0 ? (
                            <Empty>
                                Ningún alumno tiene una rutina o plan de comida por vencer en los próximos 7
                                días.
                            </Empty>
                        ) : (
                            <ul className="divide-y divide-border">
                                {resumen.planesPorVencer.map((v) => (
                                    <li
                                        key={`${v.alumno.id}-${v.tipo}`}
                                        className="flex items-center justify-between gap-3 py-3"
                                    >
                                        <Link
                                            to={`/alumnos/${v.alumno.id}`}
                                            className="text-sm font-semibold hover:text-primary"
                                        >
                                            {v.alumno.nombre}
                                        </Link>
                                        <span className="text-right text-xs text-muted-foreground">
                                            {v.tipo} · {v.vencido ? 'Venció' : 'Vence'} {fmtFecha(v.fecha)}
                                            <span
                                                className={`ml-2 font-semibold ${
                                                    v.vencido ? 'text-primary' : 'text-warn'
                                                }`}
                                            >
                                                {v.vencido ? 'Vencido' : 'Por vencer'}
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>

                    <Card>
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="font-display text-lg font-bold">Dejaron de venir</h2>
                            <Link to="/asistencia" className="text-sm font-semibold text-primary">
                                Ver asistencia
                            </Link>
                        </div>
                        {resumen.dejaronDeVenir.length === 0 ? (
                            <Empty>Ningún alumno activo lleva más de 10 días sin venir.</Empty>
                        ) : (
                            <ul className="divide-y divide-border">
                                {resumen.dejaronDeVenir.slice(0, 6).map((v) => (
                                    <li key={v.alumno.id} className="flex items-center justify-between gap-3 py-3">
                                        <Link
                                            to={`/alumnos/${v.alumno.id}`}
                                            className="text-sm font-semibold hover:text-primary"
                                        >
                                            {v.alumno.nombre}
                                        </Link>
                                        <span className="text-right text-xs text-muted-foreground">
                                            Última vez {fmtFecha(v.ultima)}
                                            <span className="ml-2 font-semibold text-warn">
                                                Hace {v.dias} días
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>

                    <Card>
                        <h2 className="font-display text-lg font-bold">Flujo recomendado</h2>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {[
                                ['1. Cargar biblioteca', 'Ejercicios y alimentos una sola vez.', '/ejercicios'],
                                ['2. Armar el plan', 'Elegir ejercicios y definir series y reps.', '/alumnos'],
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
