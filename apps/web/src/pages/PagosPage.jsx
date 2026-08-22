import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Badge, Card, Empty, ErrorBox, Loading } from '@/components/ui-kit';
import { ESTADOS_PAGO, estadoDesdeVencimiento, fmtFecha, listAll, money } from '@/lib/data';

const PagosPage = () => {
    const [alumnos, setAlumnos] = useState([]);
    const [pagos, setPagos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        Promise.all([listAll('alumnos', { sort: 'nombre' }), listAll('pagos', { sort: '-fecha_pago' })])
            .then(([a, p]) => {
                setAlumnos(a);
                setPagos(p);
            })
            .catch(() => setError('No se pudieron cargar los pagos.'))
            .finally(() => setLoading(false));
    }, []);

    const resumen = useMemo(() => {
        const mes = new Date().toISOString().slice(0, 7);
        const cajaMes = pagos
            .filter((p) => String(p.fecha_pago || '').startsWith(mes))
            .reduce((acc, p) => acc + Number(p.monto || 0), 0);

        const ultimo = new Map();
        pagos.forEach((p) => {
            const prev = ultimo.get(p.alumno);
            if (!prev || String(p.periodo_hasta || '') > String(prev.periodo_hasta || '')) ultimo.set(p.alumno, p);
        });

        const filas = alumnos
            .filter((a) => a.activo)
            .map((a) => {
                const p = ultimo.get(a.id);
                return { alumno: a, pago: p, estado: p ? estadoDesdeVencimiento(p.periodo_hasta) : 'vencido' };
            });

        return {
            cajaMes,
            filas,
            alDia: filas.filter((f) => f.estado === 'al_dia').length,
            proximos: filas.filter((f) => f.estado === 'proximo').length,
            vencidos: filas.filter((f) => f.estado === 'vencido').length,
        };
    }, [alumnos, pagos]);

    const nombre = (id) => alumnos.find((a) => a.id === id)?.nombre || 'Alumno';

    return (
        <AppLayout title="Pagos y caja" subtitle="Estado de cuota por alumno y resumen de lo cobrado en el mes.">
            <Helmet>
                <title>Pagos y caja | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Resumen de caja mensual, estado de cuota de cada alumno e historial completo de pagos registrados."
                />
            </Helmet>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={5} />
            ) : (
                <div className="space-y-8">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-border bg-primary p-5 text-primary-foreground">
                            <p className="text-xs font-semibold uppercase tracking-wide opacity-90">Cobrado este mes</p>
                            <p className="mt-3 font-display text-3xl font-extrabold">{money(resumen.cajaMes)}</p>
                        </div>
                        {[
                            ['Al día', resumen.alDia, 'text-ok'],
                            ['Próximos a vencer', resumen.proximos, 'text-warn'],
                            ['En mora', resumen.vencidos, 'text-primary'],
                        ].map(([label, valor, color]) => (
                            <Card key={label}>
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {label}
                                </p>
                                <p className={`mt-3 font-display text-3xl font-extrabold ${color}`}>{valor}</p>
                            </Card>
                        ))}
                    </div>

                    <Card className="p-0">
                        <h2 className="px-5 py-4 font-display text-lg font-bold">Estado por alumno</h2>
                        {resumen.filas.length === 0 ? (
                            <div className="p-5">
                                <Empty>No hay alumnos activos todavía.</Empty>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[36rem] text-sm">
                                    <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                                        <tr>
                                            <th className="px-5 py-3 text-left">Alumno</th>
                                            <th className="px-5 py-3 text-left">Último pago</th>
                                            <th className="px-5 py-3 text-left">Cubre hasta</th>
                                            <th className="px-5 py-3 text-left">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {resumen.filas.map(({ alumno, pago, estado }) => (
                                            <tr key={alumno.id}>
                                                <td className="px-5 py-3 font-semibold">
                                                    <Link to={`/alumnos/${alumno.id}`} className="hover:text-primary">
                                                        {alumno.nombre}
                                                    </Link>
                                                </td>
                                                <td className="px-5 py-3 text-muted-foreground">
                                                    {pago ? `${money(pago.monto)} · ${fmtFecha(pago.fecha_pago)}` : '—'}
                                                </td>
                                                <td className="px-5 py-3 text-muted-foreground">
                                                    {pago ? fmtFecha(pago.periodo_hasta) : '—'}
                                                </td>
                                                <td className="px-5 py-3">
                                                    <Badge className={ESTADOS_PAGO[estado].className}>
                                                        {ESTADOS_PAGO[estado].label}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>

                    <Card>
                        <h2 className="mb-3 font-display text-lg font-bold">Últimos pagos registrados</h2>
                        {pagos.length === 0 ? (
                            <Empty>Todavía no registraste pagos. Hacelo desde la ficha del alumno.</Empty>
                        ) : (
                            <ul className="divide-y divide-border">
                                {pagos.slice(0, 15).map((p) => (
                                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                                        <div>
                                            <p className="text-sm font-semibold">{nombre(p.alumno)}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {fmtFecha(p.fecha_pago)} · {p.metodo || 'Efectivo'}
                                                {p.descuento ? ` · -${p.descuento}%` : ''}
                                            </p>
                                        </div>
                                        <p className="font-display text-lg font-bold">{money(p.monto)}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                </div>
            )}
        </AppLayout>
    );
};

export default PagosPage;
