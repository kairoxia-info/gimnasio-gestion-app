import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Btn, Card, Empty, ErrorBox, Loading } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';

const semanaActual = () => {
    const base = new Date();
    const lunes = new Date(base);
    lunes.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    return Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(lunes);
        d.setDate(lunes.getDate() + i);
        return d.toISOString().slice(0, 10);
    });
};

const AsistenciaPage = () => {
    const [alumnos, setAlumnos] = useState([]);
    const [asistencias, setAsistencias] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const dias = useMemo(semanaActual, []);

    const cargar = () => {
        Promise.all([listAll('alumnos', { sort: 'nombre' }), listAll('asistencias')])
            .then(([a, as]) => {
                setAlumnos(a.filter((x) => x.activo));
                setAsistencias(as);
                setError('');
            })
            .catch(() => setError('No se pudo cargar la asistencia.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    const mapa = useMemo(() => {
        const m = {};
        asistencias.forEach((a) => {
            m[`${a.alumno}|${a.fecha}`] = a;
        });
        return m;
    }, [asistencias]);

    const marcar = async (alumnoId, fecha) => {
        const actual = mapa[`${alumnoId}|${fecha}`];
        if (!actual) await createRec('asistencias', { alumno: alumnoId, fecha, presente: true });
        else if (actual.presente) await updateRec('asistencias', actual.id, { presente: false });
        else await removeRec('asistencias', actual.id);
        cargar();
    };

    const nombresDia = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    return (
        <AppLayout
            title="Asistencia semanal"
            subtitle="Marcá presente o ausente para toda la semana. Un clic presente, dos ausente, tres sin registro."
        >
            <Helmet>
                <title>Control de asistencia | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Grilla semanal de asistencia de todos los alumnos activos del gimnasio, con conteo de presentes y ausentes."
                />
            </Helmet>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={5} />
            ) : alumnos.length === 0 ? (
                <Empty>
                    No hay alumnos activos.{' '}
                    <Link to="/alumnos" className="font-semibold text-primary">
                        Cargar alumnos
                    </Link>
                </Empty>
            ) : (
                <Card className="overflow-x-auto p-0">
                    <table className="w-full min-w-[42rem] text-sm">
                        <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 text-left">Alumno</th>
                                {dias.map((d, i) => (
                                    <th key={d} className="px-2 py-3 text-center">
                                        {nombresDia[i]}
                                        <span className="block text-[10px] font-normal">{d.slice(8)}</span>
                                    </th>
                                ))}
                                <th className="px-4 py-3 text-center">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {alumnos.map((a) => {
                                const total = dias.filter((d) => mapa[`${a.id}|${d}`]?.presente).length;
                                return (
                                    <tr key={a.id}>
                                        <td className="px-4 py-3 font-semibold">
                                            <Link to={`/alumnos/${a.id}`} className="hover:text-primary">
                                                {a.nombre}
                                            </Link>
                                        </td>
                                        {dias.map((d) => {
                                            const reg = mapa[`${a.id}|${d}`];
                                            const estilo = !reg
                                                ? 'border-border text-muted-foreground hover:border-primary'
                                                : reg.presente
                                                  ? 'border-transparent bg-[hsl(var(--ok))] text-white'
                                                  : 'border-transparent bg-primary text-primary-foreground';
                                            return (
                                                <td key={d} className="px-2 py-2 text-center">
                                                    <button
                                                        type="button"
                                                        aria-label={`Marcar ${a.nombre} el ${d}`}
                                                        onClick={() => marcar(a.id, d)}
                                                        className={`h-9 w-9 rounded-xl border text-xs font-bold transition active:scale-95 ${estilo}`}
                                                    >
                                                        {!reg ? '·' : reg.presente ? 'P' : 'A'}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                        <td className="px-4 py-3 text-center font-bold">{total}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </Card>
            )}

            <div className="mt-6">
                <Btn variant="ghost" onClick={cargar}>
                    Actualizar
                </Btn>
            </div>
        </AppLayout>
    );
};

export default AsistenciaPage;
