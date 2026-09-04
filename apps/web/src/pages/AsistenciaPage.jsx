import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { CheckCheck, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Btn, Card, Empty, ErrorBox, Input, Loading, Modal } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { fmtFecha } from '@/lib/format';

// El lunes de la semana en la que cae `fecha`. getDay() devuelve 0 para
// domingo, así que (getDay() + 6) % 7 da los días que hay que restar para
// llegar al lunes con la semana arrancando en lunes, no en domingo.
const lunesDe = (fecha) => {
    const d = new Date(fecha);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
};

// Se arma la fecha con los campos locales en vez de toISOString() (que pasa
// a UTC) para que el día sea siempre el local — el que ve y marca el
// profesor — sin depender de la zona horaria.
const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const diasDeLaSemana = (lunes) =>
    Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(lunes);
        d.setDate(lunes.getDate() + i);
        return iso(d);
    });

// Todos los días de un mes 'YYYY-MM'. El día 0 del mes siguiente es el último
// del mes pedido, que es la forma de saber si tiene 28, 29, 30 o 31.
const diasDelMes = (mes) => {
    const [año, mesNum] = mes.split('-').map(Number);
    const cantidad = new Date(año, mesNum, 0).getDate();
    return Array.from({ length: cantidad }).map((_, i) => iso(new Date(año, mesNum - 1, i + 1)));
};

const mesDe = (fecha) => `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;

const NOMBRES_MES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const etiquetaMes = (mes) => {
    const [año, mesNum] = mes.split('-').map(Number);
    return `${NOMBRES_MES[mesNum - 1]} ${año}`;
};

const NOMBRES_DIA_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const etiquetaDia = (fecha) => {
    const d = new Date(`${fecha}T00:00:00`);
    return `${NOMBRES_DIA_LARGO[d.getDay()]} ${d.getDate()} de ${NOMBRES_MES[d.getMonth()].toLowerCase()}`;
};

const AsistenciaPage = () => {
    const [alumnos, setAlumnos] = useState([]);
    const [asistencias, setAsistencias] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busqueda, setBusqueda] = useState('');
    // Arranca en el día porque es lo que se usa todos los días: pasar lista.
    // Semana y mes son para mirar hacia atrás, no para la operación diaria.
    const [vista, setVista] = useState('dia'); // 'dia' | 'semana' | 'mes'
    const [dia, setDia] = useState(() => iso(new Date()));
    const [lunes, setLunes] = useState(() => lunesDe(new Date()));
    const [mes, setMes] = useState(() => mesDe(new Date()));
    const [cerrando, setCerrando] = useState(false);
    const [guardando, setGuardando] = useState(false);

    const esDia = vista === 'dia';
    const esMes = vista === 'mes';
    const dias = useMemo(
        () => (esMes ? diasDelMes(mes) : diasDeLaSemana(lunes)),
        [esMes, mes, lunes],
    );

    const moverSemana = (semanas) =>
        setLunes((actual) => {
            const d = new Date(actual);
            d.setDate(d.getDate() + semanas * 7);
            return d;
        });

    const moverMes = (meses) =>
        setMes((actual) => {
            const [año, mesNum] = actual.split('-').map(Number);
            return mesDe(new Date(año, mesNum - 1 + meses, 1));
        });

    const moverDia = (cantidad) =>
        setDia((actual) => {
            const d = new Date(`${actual}T00:00:00`);
            d.setDate(d.getDate() + cantidad);
            return iso(d);
        });

    const esSemanaActual = lunes.getTime() === lunesDe(new Date()).getTime();
    const esMesActual = mes === mesDe(new Date());
    const esHoy = dia === iso(new Date());

    // Celdas vacías antes del día 1 para que caiga en su columna. Igual que en
    // lunesDe(), (getDay() + 6) % 7 convierte el domingo=0 de JS a una semana
    // que arranca en lunes.
    const offsetMes = useMemo(() => {
        const [año, mesNum] = mes.split('-').map(Number);
        return (new Date(año, mesNum - 1, 1).getDay() + 6) % 7;
    }, [mes]);

    // Devuelve la promesa a propósito: escribirMarca() la espera antes de
    // soltar el lock de la celda, si no el lock se libera antes de que `mapa`
    // tenga el registro nuevo y vuelve a haber ventana para el doble insert.
    const cargar = () => {
        return Promise.all([listAll('alumnos', { sort: 'nombre' }), listAll('asistencias')])
            .then(([a, as]) => {
                setAlumnos(a.filter((x) => x.activo));
                setAsistencias(as);
                setError('');
            })
            .catch(() => setError('No se pudo cargar la asistencia.'))
            .finally(() => setLoading(false));
    };

    // No se pasa `cargar` directo: ahora devuelve una promesa y React entiende
    // cualquier retorno de useEffect que no sea función como cleanup inválido.
    useEffect(() => {
        cargar();
    }, []);

    const mapa = useMemo(() => {
        const m = {};
        asistencias.forEach((a) => {
            m[`${a.alumno_id}|${a.fecha}`] = a;
        });
        return m;
    }, [asistencias]);

    // Guarda contra el doble toque: `mapa` recién se actualiza cuando termina
    // cargar(), así que dos clicks seguidos sobre la misma celda leían los dos
    // "no hay registro" e intentaban insertar dos veces la misma
    // (alumno_id, fecha) -- que tiene UNIQUE en la base, así que el segundo
    // insert reventaba con 23505 sin que el profesor viera nada. Se ignora el
    // click mientras esa celda tiene una escritura en vuelo.
    const enVuelo = useRef(new Set());

    const escribirMarca = async (clave, accion) => {
        if (enVuelo.current.has(clave)) return;
        enVuelo.current.add(clave);
        try {
            await accion();
            await cargar();
        } catch (_) {
            setError('No se pudo guardar la asistencia. Intentar de nuevo.');
        } finally {
            enVuelo.current.delete(clave);
        }
    };

    // Usada tanto por los dos botones de "Pasar lista" (día) como por el menú
    // "Presente / Ausente" que abre una celda de semana o mes: "presente" y
    // "ausente" se piden siempre expresamente, nunca por ciclo. Volver a
    // elegir el estado que ya está activo borra la marca, que es la forma de
    // corregir a alguien que se marcó por error.
    const marcarComo = (alumnoId, fecha, presente) => {
        const clave = `${alumnoId}|${fecha}`;
        const actual = mapa[clave];
        return escribirMarca(clave, () => {
            if (!actual) return createRec('asistencias', { alumno_id: alumnoId, fecha, presente });
            if (actual.presente === presente) return removeRec('asistencias', actual.id);
            return updateRec('asistencias', actual.id, { presente });
        });
    };

    const quitarMarca = (alumnoId, fecha) => {
        const clave = `${alumnoId}|${fecha}`;
        const actual = mapa[clave];
        if (!actual) return;
        return escribirMarca(clave, () => removeRec('asistencias', actual.id));
    };

    // Reportado por Nalux (03/09/2026): en semana y mes, la celda funcionaba a
    // click cíclico (un click presente, dos ausente, tres sin marcar) -- nada
    // en la celda avisaba que existía un segundo estado, así que el profesor
    // tocaba una vez, veía "presente" y ahí se quedaba sin saber cómo poner a
    // alguien ausente. Se reemplaza por un menú explícito: tocar la celda abre
    // una cajita al lado con "Presente" / "Ausente" / "Sin marcar" a la vista,
    // mismo criterio que ya tenía "Pasar lista" (día) con sus dos botones.
    const [eligiendo, setEligiendo] = useState(null); // { alumnoId, alumnoNombre, fecha, top, left }
    const ELEGIR_ANCHO = 168;
    const ELEGIR_ALTO = 150;
    const ELEGIR_MARGEN = 8;

    const abrirEligiendo = (ev, alumnoId, alumnoNombre, fecha) => {
        const rect = ev.currentTarget.getBoundingClientRect();
        const entraADerecha = rect.right + ELEGIR_MARGEN + ELEGIR_ANCHO <= window.innerWidth - ELEGIR_MARGEN;
        const entraAIzquierda = rect.left - ELEGIR_MARGEN - ELEGIR_ANCHO >= ELEGIR_MARGEN;

        let left;
        if (entraADerecha) left = rect.right + ELEGIR_MARGEN;
        else if (entraAIzquierda) left = rect.left - ELEGIR_ANCHO - ELEGIR_MARGEN;
        else left = rect.left;
        left = Math.max(ELEGIR_MARGEN, Math.min(left, window.innerWidth - ELEGIR_ANCHO - ELEGIR_MARGEN));

        let top = rect.top;
        top = Math.max(ELEGIR_MARGEN, Math.min(top, window.innerHeight - ELEGIR_ALTO - ELEGIR_MARGEN));

        setEligiendo({ alumnoId, alumnoNombre, fecha, top, left });
    };

    const elegir = (presente) => {
        if (!eligiendo) return;
        marcarComo(eligiendo.alumnoId, eligiendo.fecha, presente);
        setEligiendo(null);
    };

    const elegirQuitar = () => {
        if (!eligiendo) return;
        quitarMarca(eligiendo.alumnoId, eligiendo.fecha);
        setEligiendo(null);
    };

    // Si cambia la pestaña (día/semana/mes) o la fecha mientras el menú está
    // abierto, la celda que lo abrió ya no está donde estaba -- se cierra
    // solo para no dejarlo apuntando a cualquier lado.
    useEffect(() => {
        setEligiendo(null);
    }, [vista, dia, lunes, mes]);

    const sinMarcar = alumnos.filter((a) => !mapa[`${a.id}|${dia}`]);
    const presentesDelDia = alumnos.filter((a) => mapa[`${a.id}|${dia}`]?.presente).length;
    const ausentesDelDia = alumnos.filter(
        (a) => mapa[`${a.id}|${dia}`] && !mapa[`${a.id}|${dia}`].presente,
    ).length;

    // "Cerrar el día": el profesor marca a los que vinieron y el resto queda
    // como ausente de una. Alcanza con los que no tienen ninguna marca — a los
    // ya marcados no se los toca. Se ejecuta sobre TODOS los alumnos activos,
    // no sobre el filtro del buscador, para no cerrar el día a medias.
    const cerrarDia = async () => {
        setGuardando(true);
        try {
            await Promise.all(
                sinMarcar.map((a) => createRec('asistencias', { alumno_id: a.id, fecha: dia, presente: false })),
            );
            setCerrando(false);
            cargar();
        } catch (_) {
            setError('No se pudo cerrar el día.');
        } finally {
            setGuardando(false);
        }
    };

    const nombresDia = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    const visibles = busqueda.trim()
        ? alumnos.filter((a) => a.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase()))
        : alumnos;

    return (
        <AppLayout
            title={esDia ? 'Pasar lista' : esMes ? 'Asistencia del mes' : 'Asistencia semanal'}
            subtitle={
                esDia
                    ? 'Marcar presente o ausente alumno por alumno y cerrar el día al terminar.'
                    : esMes
                      ? 'Todos los días del mes y cuántos fue o faltó cada alumno. Tocar un día para elegir presente o ausente.'
                      : 'Marcar presente o ausente para toda la semana. Tocar un día para elegir presente o ausente.'
            }
        >
            <Helmet>
                <title>Control de asistencia | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Grilla semanal de asistencia de todos los alumnos activos del gimnasio, con conteo de presentes y ausentes."
                />
            </Helmet>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            <div className="mb-4 grid gap-3 sm:grid-cols-[1fr,auto] sm:items-center">
                <div className="relative">
                    <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <Input
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                        placeholder="Buscar alumno por nombre..."
                        className="pl-9"
                        aria-label="Buscar alumno por nombre"
                    />
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <Btn
                        variant="ghost"
                        className="px-3 py-2"
                        onClick={() => (esDia ? moverDia(-1) : esMes ? moverMes(-1) : moverSemana(-1))}
                        aria-label={esDia ? 'Día anterior' : esMes ? 'Mes anterior' : 'Semana anterior'}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Btn>
                    <span className="text-center text-xs font-semibold sm:min-w-[11rem]">
                        {esDia
                            ? etiquetaDia(dia)
                            : esMes
                              ? etiquetaMes(mes)
                              : `${fmtFecha(dias[0])} al ${fmtFecha(dias[6])}`}
                        {(esDia ? esHoy : esMes ? esMesActual : esSemanaActual) && (
                            <span className="block font-normal text-muted-foreground">
                                {esDia ? 'Hoy' : esMes ? 'Mes actual' : 'Semana actual'}
                            </span>
                        )}
                    </span>
                    <Btn
                        variant="ghost"
                        className="px-3 py-2"
                        onClick={() => (esDia ? moverDia(1) : esMes ? moverMes(1) : moverSemana(1))}
                        aria-label={esDia ? 'Día siguiente' : esMes ? 'Mes siguiente' : 'Semana siguiente'}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Btn>
                    {!(esDia ? esHoy : esMes ? esMesActual : esSemanaActual) && (
                        <Btn
                            variant="ghost"
                            className="px-3 py-2 text-xs"
                            onClick={() => {
                                if (esDia) setDia(iso(new Date()));
                                else if (esMes) setMes(mesDe(new Date()));
                                else setLunes(lunesDe(new Date()));
                            }}
                        >
                            Hoy
                        </Btn>
                    )}
                </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
                {[
                    ['dia', 'Pasar lista del día'],
                    ['semana', 'Por semana'],
                    ['mes', 'Mes completo'],
                ].map(([valor, etiqueta]) => (
                    <button
                        key={valor}
                        type="button"
                        onClick={() => setVista(valor)}
                        aria-pressed={vista === valor}
                        className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                            vista === valor
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {etiqueta}
                    </button>
                ))}
            </div>

            {loading ? (
                <Loading rows={5} />
            ) : alumnos.length === 0 ? (
                <Empty>
                    No hay alumnos activos.{' '}
                    <Link to="/alumnos" className="font-semibold text-primary">
                        Cargar alumnos
                    </Link>
                </Empty>
            ) : visibles.length === 0 ? (
                <Empty>Ningún alumno activo coincide con esa búsqueda.</Empty>
            ) : esDia ? (
                <>
                    <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 py-4">
                        <p className="text-sm">
                            <span className="font-bold text-ok">{presentesDelDia} presentes</span> ·{' '}
                            <span className="font-bold text-primary">{ausentesDelDia} ausentes</span> ·{' '}
                            <span className="font-semibold text-muted-foreground">
                                {sinMarcar.length} sin marcar
                            </span>
                        </p>
                        {sinMarcar.length > 0 && (
                            <Btn onClick={() => setCerrando(true)}>
                                <CheckCheck className="h-4 w-4" /> Cerrar el día
                            </Btn>
                        )}
                    </Card>

                    <Card className="divide-y divide-border p-0">
                        {visibles.map((a) => {
                            const reg = mapa[`${a.id}|${dia}`];
                            return (
                                <div
                                    key={a.id}
                                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                                >
                                    <Link
                                        to={`/alumnos/${a.id}`}
                                        className="font-semibold hover:text-primary"
                                    >
                                        {a.nombre}
                                    </Link>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            aria-pressed={reg?.presente === true}
                                            onClick={() => marcarComo(a.id, dia, true)}
                                            className={`rounded-xl border px-4 py-2 text-xs font-bold transition active:scale-95 ${
                                                reg?.presente === true
                                                    ? 'border-transparent bg-[hsl(var(--ok))] text-white'
                                                    : 'border-border text-muted-foreground hover:border-[hsl(var(--ok))] hover:text-foreground'
                                            }`}
                                        >
                                            Presente
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={reg?.presente === false}
                                            onClick={() => marcarComo(a.id, dia, false)}
                                            className={`rounded-xl border px-4 py-2 text-xs font-bold transition active:scale-95 ${
                                                reg?.presente === false
                                                    ? 'border-transparent bg-primary text-primary-foreground'
                                                    : 'border-border text-muted-foreground hover:border-primary hover:text-foreground'
                                            }`}
                                        >
                                            Ausente
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </Card>

                    {/* Nalux preguntó qué pasa si se olvida de cerrar el día. No pasa
                        nada: cada botón guarda al instante, "Cerrar el día" es solo el
                        atajo para el resto. Se aclara acá para que no quede la duda. */}
                    <p className="mt-3 text-xs text-muted-foreground">
                        Cada marca se guarda sola apenas se toca — no hace falta cerrar el día para que quede
                        registrada, y se ve al toque en la semana y en el mes. Cerrar el día es solo el atajo
                        para marcar de una a los que faltaron. Tocar de nuevo el botón marcado para borrar la
                        marca.
                    </p>
                </>
            ) : esMes ? (
                // Un calendario por alumno en vez de una fila de 31 celdas: los
                // días quedan acomodados por semana como en cualquier almanaque,
                // que es como el profesor está acostumbrado a leer un mes, y no
                // hay que scrollear al costado para llegar a fin de mes.
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visibles.map((a) => {
                        const presentes = dias.filter((d) => mapa[`${a.id}|${d}`]?.presente).length;
                        const ausentes = dias.filter(
                            (d) => mapa[`${a.id}|${d}`] && !mapa[`${a.id}|${d}`].presente,
                        ).length;
                        // Mismo criterio que la ficha del alumno: el % se calcula
                        // sobre los días registrados, no sobre los del mes — un día
                        // que nadie marcó no es una falta.
                        const registrados = presentes + ausentes;
                        const porcentaje = registrados > 0 ? Math.round((presentes / registrados) * 100) : null;
                        return (
                            <Card key={a.id}>
                                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                                    <Link
                                        to={`/alumnos/${a.id}`}
                                        className="font-display text-base font-bold hover:text-primary"
                                    >
                                        {a.nombre}
                                    </Link>
                                    <span className="text-xs text-muted-foreground">
                                        <span className="font-bold text-ok">{presentes} fue</span> ·{' '}
                                        <span className="font-bold text-primary">{ausentes} faltó</span>
                                        {porcentaje !== null && (
                                            <span className="ml-1 font-semibold text-foreground">({porcentaje}%)</span>
                                        )}
                                    </span>
                                </div>

                                <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] uppercase text-muted-foreground">
                                    {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'].map((d) => (
                                        <span key={d}>{d}</span>
                                    ))}
                                </div>
                                <div className="mt-2 grid grid-cols-7 gap-1.5">
                                    {/* Huecos hasta que arranque el día 1: el mes puede
                                        empezar cualquier día de la semana. */}
                                    {Array.from({ length: offsetMes }).map((_, i) => (
                                        <span key={`hueco${i}`} />
                                    ))}
                                    {dias.map((d) => {
                                        const reg = mapa[`${a.id}|${d}`];
                                        const estilo = !reg
                                            ? 'border-border text-muted-foreground hover:border-primary'
                                            : reg.presente
                                              ? 'border-transparent bg-[hsl(var(--ok))] text-white'
                                              : 'border-transparent bg-primary text-primary-foreground';
                                        return (
                                            <button
                                                key={d}
                                                type="button"
                                                aria-label={`Marcar ${a.nombre} el ${d}`}
                                                onClick={(ev) => abrirEligiendo(ev, a.id, a.nombre, d)}
                                                className={`aspect-square rounded-xl border text-sm font-semibold transition active:scale-95 ${estilo}`}
                                            >
                                                {Number(d.slice(8))}
                                            </button>
                                        );
                                    })}
                                </div>
                            </Card>
                        );
                    })}
                </div>
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
                            {visibles.map((a) => {
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
                                                        onClick={(ev) => abrirEligiendo(ev, a.id, a.nombre, d)}
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

            {/* Menú "Presente / Ausente / Sin marcar" que abre una celda de semana
                o mes (ver abrirEligiendo). El backdrop transparente es solo para
                poder cerrar tocando afuera -- las opciones en sí ya cierran solas
                al elegir. */}
            {eligiendo && (
                <>
                    <div className="fixed inset-0 z-[59]" onClick={() => setEligiendo(null)} aria-hidden="true" />
                    <div
                        className="fixed z-[60] rounded-xl border border-border bg-card p-3 shadow-2xl"
                        style={{ top: eligiendo.top, left: eligiendo.left, width: ELEGIR_ANCHO }}
                    >
                        <p className="mb-2 truncate text-xs font-semibold text-muted-foreground">
                            {eligiendo.alumnoNombre} · {fmtFecha(eligiendo.fecha)}
                        </p>
                        <div className="space-y-1.5">
                            <button
                                type="button"
                                onClick={() => elegir(true)}
                                className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs font-bold text-[hsl(var(--ok))] transition hover:border-[hsl(var(--ok))]"
                            >
                                Presente
                            </button>
                            <button
                                type="button"
                                onClick={() => elegir(false)}
                                className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs font-bold text-primary transition hover:border-primary"
                            >
                                Ausente
                            </button>
                            {mapa[`${eligiendo.alumnoId}|${eligiendo.fecha}`] && (
                                <button
                                    type="button"
                                    onClick={elegirQuitar}
                                    className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs font-semibold text-muted-foreground transition hover:border-foreground hover:text-foreground"
                                >
                                    Sin marcar
                                </button>
                            )}
                        </div>
                    </div>
                </>
            )}

            <Modal open={cerrando} onClose={() => setCerrando(false)} title="Cerrar el día">
                <p className="text-sm text-muted-foreground">
                    Se van a marcar como <span className="font-semibold text-foreground">ausentes</span> los{' '}
                    <span className="font-semibold text-foreground">{sinMarcar.length}</span> alumnos que todavía
                    no tienen marca en {etiquetaDia(dia).toLowerCase()}. A los que ya marcaste no se los toca.
                </p>
                {sinMarcar.length > 0 && (
                    <p className="mt-3 text-sm">
                        {sinMarcar.map((a) => a.nombre).join(', ')}.
                    </p>
                )}
                <div className="mt-6 flex justify-end gap-2">
                    <Btn variant="ghost" onClick={() => setCerrando(false)}>
                        Cancelar
                    </Btn>
                    <Btn onClick={cerrarDia} disabled={guardando}>
                        {guardando ? 'Cerrando...' : 'Marcar ausentes y cerrar'}
                    </Btn>
                </div>
            </Modal>
        </AppLayout>
    );
};

export default AsistenciaPage;
