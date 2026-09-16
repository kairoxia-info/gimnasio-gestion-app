import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Eye, Pencil, UserRound } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import AppLayout from '@/components/AppLayout';
import { Badge, Card, ErrorBox, Loading } from '@/components/ui-kit';
import { columnasDe, listAll } from '@/lib/data';
import { ESTADOS_ALUMNO, antiguedad, estadoAlumno, fmtFecha } from '@/lib/format';
import AccesoAlumno from '@/components/alumno/AccesoAlumno';
import AsistenciaAlumno from '@/components/alumno/AsistenciaAlumno';
import EstadoCuotaAlumno from '@/components/alumno/EstadoCuotaAlumno';
import NotasPrivadas from '@/components/alumno/NotasPrivadas';
import PagosAlumno from '@/components/alumno/PagosAlumno';
import PlanAlimentacion from '@/components/alumno/PlanAlimentacion';
import PlanEntrenamiento from '@/components/alumno/PlanEntrenamiento';
import Progreso from '@/components/alumno/Progreso';

// rutinas es la plantilla (nombre/descripcion/duracion_semanas/items),
// rutinas_asignadas es el vínculo con el alumno Y la copia de lo que se le
// asignó (migración 0026). Pedido de Nalux (04/09/2026): editar una rutina
// en la biblioteca NO tiene que cambiarle nada al alumno que ya la tiene
// asignada -- por eso acá se lee la copia guardada en la asignación, no la
// plantilla en vivo. Para actualizarle la rutina hay que reasignársela.
const cargarRutinaAsignada = async (alumnoId) => {
    // Filtra por activa=true en la propia consulta: si no, "Quitar rutina" (que
    // solo pone activa=false, no borra la fila) queda pisado por este fallback
    // apenas se recarga, porque sigue habiendo una fila -aunque inactiva- para
    // volver a mostrar. Con el filtro server-side, sin ninguna activa esto
    // devuelve [] limpio, tal como espera "Quitar rutina".
    const asignadas = await listAll('rutinas_asignadas', {
        filters: { alumno_id: alumnoId, activa: true },
        sort: '-created_at',
    });
    if (asignadas.length === 0) return null;
    const asignacion = asignadas[0];
    return {
        asignacionId: asignacion.id,
        rutinaId: asignacion.rutina_id,
        nombre: asignacion.rutina_nombre || 'Rutina asignada',
        descripcion: asignacion.rutina_descripcion,
        duracionSemanas: asignacion.rutina_duracion_semanas,
        fechaInicio: asignacion.fecha_inicio,
        fechaFin: asignacion.fecha_fin,
        items: asignacion.items || [],
    };
};

// Rutinas que el alumno tuvo antes: son las asignaciones que quedaron con
// activa=false ("Cambiar rutina" y "Quitar rutina" no borran la fila, la
// desactivan justamente para esto). El nombre sale de la copia de cada
// asignación, así el historial dice qué tenía en ese momento aunque después
// esa rutina se haya renombrado o borrado de la biblioteca.
const cargarHistorialRutinas = async (alumnoId) => {
    const asignadas = await listAll('rutinas_asignadas', {
        filters: { alumno_id: alumnoId, activa: false },
        sort: '-created_at',
    });
    return asignadas.map((a) => ({
        id: a.id,
        nombre: a.rutina_nombre || 'Rutina sin nombre',
        desde: a.fecha_inicio || a.created_at,
    }));
};

/* ---------------- Ficha ---------------- */

const TABS = [
    ['entrenamiento', 'Entrenamiento'],
    ['nutricion', 'Nutrición'],
    ['progreso', 'Progreso'],
    ['asistencia', 'Asistencia'],
    ['pagos', 'Pagos'],
];

const AlumnoPage = () => {
    const { id } = useParams();
    // Permite llegar directo a una pestaña puntual (ej. desde la campanita de
    // notificaciones del header: "?tab=pagos" abre la ficha ya en Pagos, sin
    // que el profesor tenga que buscarla a mano).
    const [searchParams] = useSearchParams();
    const tabInicial = TABS.some(([valor]) => valor === searchParams.get('tab'))
        ? searchParams.get('tab')
        : 'entrenamiento';
    const [tab, setTab] = useState(tabInicial);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [data, setData] = useState({
        alumno: null,
        planEnt: null,
        historialRutinas: [],
        planAli: null,
        progreso: [],
        asistencias: [],
        pagos: [],
        config: null,
    });

    const cargar = async () => {
        try {
            // `config` trae dias_gracia_cuota/dias_aviso_vencimiento -- la
            // policy de gimnasios ya filtra por tenant (id = get_mi_gimnasio_id()),
            // así que no hace falta pasarle el id a mano acá. Con .single() en
            // vez de vía Promise.all porque un error acá (ej. RLS todavía sin
            // aplicar en un gimnasio recién creado) no tiene que tirar abajo el
            // resto de la ficha -- si falla, estadoCuota() cae a sus defaults
            // (0 días de gracia, 7 de aviso) en vez de romper la pantalla.
            const [alumnoRes, planAliRows, progreso, asistencias, pagos, gimnasioRes] = await Promise.all([
                // columnasDe('alumnos') y no '*' (repaso de seguridad del
                // 14/09/2026): desde la migración 0051 los permisos de esta
                // tabla son por columna, y un '*' falla entero contra las que
                // el panel ya no puede pedir (hash de contraseña, contadores
                // internos, DNI). Ver el comentario largo en lib/data.js.
                supabase.from('alumnos').select(columnasDe('alumnos')).eq('id', id).single(),
                listAll('planes_alimentacion', { filters: { alumno_id: id }, sort: '-created_at' }),
                listAll('progreso', { filters: { alumno_id: id }, sort: '-fecha' }),
                listAll('asistencias', { filters: { alumno_id: id }, sort: '-fecha' }),
                listAll('pagos', { filters: { alumno_id: id }, sort: '-fecha_pago' }),
                supabase
                    .from('gimnasios')
                    .select('dias_gracia_cuota, dias_aviso_vencimiento')
                    .single()
                    .then((r) => r.data)
                    .catch(() => null),
            ]);
            if (alumnoRes.error) throw alumnoRes.error;
            // Se pide después y aparte del Promise.all de arriba a propósito:
            // depende del alumno recién cargado (necesita su id, que ya
            // tenemos por route param, pero conceptualmente es "lo próximo"
            // una vez que sabemos que el alumno existe) y trae dos tablas
            // relacionadas (rutinas_asignadas + rutinas) en cascada.
            const [planEnt, historialRutinas] = await Promise.all([
                cargarRutinaAsignada(id),
                cargarHistorialRutinas(id),
            ]);
            setData({
                alumno: alumnoRes.data,
                planEnt,
                historialRutinas,
                planAli: planAliRows[0] || null,
                progreso,
                asistencias,
                pagos,
                config: gimnasioRes,
            });
            setError('');
        } catch (_) {
            setError('No se pudo cargar la ficha del alumno.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        cargar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const { alumno } = data;

    return (
        <AppLayout>
            <Helmet>
                <title>{alumno ? `${alumno.nombre} | RutNail` : 'Ficha del alumno | RutNail'}</title>
                <meta
                    name="description"
                    content="Ficha completa del alumno: plan de entrenamiento, plan de alimentación, progreso, asistencia y pagos."
                />
            </Helmet>

            <Link
                to="/alumnos"
                className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-primary"
            >
                <ArrowLeft className="h-4 w-4" /> Volver a alumnos
            </Link>

            {error && <ErrorBox>{error}</ErrorBox>}

            {loading ? (
                <Loading rows={5} />
            ) : (
                alumno && (
                    <>
                        <div className="mb-6 flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-card p-6">
                            {alumno.foto_url ? (
                                <img src={alumno.foto_url} alt={alumno.nombre} className="h-20 w-20 rounded-2xl object-cover" />
                            ) : (
                                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary">
                                    <UserRound className="h-8 w-8 text-muted-foreground" />
                                </div>
                            )}
                            <div className="min-w-0">
                                <h1 className="font-display text-3xl font-extrabold uppercase">{alumno.nombre}</h1>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {antiguedad(alumno.fecha_alta)} · Alta {fmtFecha(alumno.fecha_alta)}
                                    {alumno.contacto ? ` · ${alumno.contacto}` : ''}
                                </p>
                            </div>
                            <div className="ml-auto flex flex-col items-end gap-2">
                                <Badge className={ESTADOS_ALUMNO[estadoAlumno(alumno)].className}>
                                    {ESTADOS_ALUMNO[estadoAlumno(alumno)].label}
                                </Badge>
                                <div className="flex flex-wrap justify-end gap-2">
                                    {/* Fase 2.2 (13/09/2026), pedido de Nalux: que el
                                        profesor pueda ver exactamente lo que ve el
                                        alumno antes de mandarle el link. No hace falta
                                        construir una vista aparte -- alumno.codigo_acceso
                                        ya viaja con el select('*') de más arriba, y
                                        /mi-plan/:codigo es la MISMA ruta que usa el
                                        alumno de verdad (via ver_plan_por_codigo()), así
                                        que abrirla es literalmente lo que él ve, sin
                                        simular nada. Esa RPC exige activo=true, por eso
                                        el botón se esconde si el alumno está inactivo o
                                        pendiente -- para esos casos daría "Código de
                                        acceso inválido" en vez de mostrar algo útil. */}
                                    {alumno.activo && (
                                        <a
                                            href={`/mi-plan/${alumno.codigo_acceso}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"
                                        >
                                            <Eye className="h-3.5 w-3.5" /> Ver como alumno
                                        </a>
                                    )}
                                    {/* La ficha no tiene su propio formulario -- "Editar
                                        datos" abre el mismo modal de la lista (pedido de
                                        Nalux, 10/09/2026: la campanita manda acá diciendo
                                        "faltan sus datos" pero no había cómo cargarlos sin
                                        volver a la lista). */}
                                    <Link
                                        to={`/alumnos?editar=${id}`}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"
                                    >
                                        <Pencil className="h-3.5 w-3.5" /> Editar datos
                                    </Link>
                                </div>
                            </div>
                        </div>

                        {alumno.observaciones_salud && (
                            <div className="mb-6 rounded-2xl border border-primary/50 bg-primary/10 p-4 text-sm">
                                <p className="font-bold uppercase tracking-wide text-primary">Observaciones de salud</p>
                                <p className="mt-1">{alumno.observaciones_salud}</p>
                            </div>
                        )}

                        {(alumno.email || alumno.fecha_nacimiento || alumno.contacto_emergencia || alumno.objetivo) && (
                            <Card className="mb-6">
                                <h2 className="mb-3 font-display text-lg font-bold">Datos personales</h2>
                                <dl className="grid gap-3 sm:grid-cols-2">
                                    {alumno.email && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Correo
                                            </dt>
                                            <dd className="text-sm">{alumno.email}</dd>
                                        </div>
                                    )}
                                    {alumno.fecha_nacimiento && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Fecha de nacimiento
                                            </dt>
                                            <dd className="text-sm">{fmtFecha(alumno.fecha_nacimiento)}</dd>
                                        </div>
                                    )}
                                    {alumno.contacto_emergencia && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Contacto de emergencia
                                            </dt>
                                            <dd className="text-sm">{alumno.contacto_emergencia}</dd>
                                        </div>
                                    )}
                                    {alumno.objetivo && (
                                        <div className="sm:col-span-2">
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                Objetivo
                                            </dt>
                                            <dd className="text-sm">{alumno.objetivo}</dd>
                                        </div>
                                    )}
                                </dl>
                            </Card>
                        )}

                        <NotasPrivadas alumnoId={id} notasIniciales={alumno.notas_internas} />

                        <AccesoAlumno
                            alumno={alumno}
                            // Recibe un objeto parcial (usuario, y a veces también
                            // activo/pendiente cuando se aprueba desde acá) para que
                            // el Badge de "Pendiente"/"Activo" de arriba se actualice
                            // solo, sin recargar la página.
                            onCambiado={(patch) => setData((d) => ({ ...d, alumno: { ...d.alumno, ...patch } }))}
                        />

                        <EstadoCuotaAlumno alumnoId={id} pagos={data.pagos} config={data.config} />

                        <div className="mb-6 flex flex-wrap gap-2">
                            {TABS.map(([key, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setTab(key)}
                                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                                        tab === key
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'border-border text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {tab === 'entrenamiento' && (
                            <PlanEntrenamiento
                                alumnoId={id}
                                alumnoNombre={data.alumno?.nombre}
                                plan={data.planEnt}
                                historial={data.historialRutinas}
                                onSaved={cargar}
                            />
                        )}
                        {tab === 'nutricion' && (
                            <PlanAlimentacion
                                alumnoId={id}
                                alumnoNombre={data.alumno?.nombre}
                                plan={data.planAli}
                                onSaved={cargar}
                            />
                        )}
                        {tab === 'progreso' && (
                            <Progreso alumnoId={id} registros={data.progreso} onChange={cargar} />
                        )}
                        {tab === 'asistencia' && (
                            <AsistenciaAlumno alumnoId={id} asistencias={data.asistencias} onChange={cargar} />
                        )}
                        {tab === 'pagos' && (
                            <PagosAlumno pagos={data.pagos} config={data.config} onChange={cargar} />
                        )}
                    </>
                )
            )}
        </AppLayout>
    );
};

export default AlumnoPage;
