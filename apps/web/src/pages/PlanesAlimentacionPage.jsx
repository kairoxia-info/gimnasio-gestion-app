import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { ArrowDown, ArrowUp, Copy, Plus, Printer, Search, Trash2, UserPlus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { ESTILOS_IMPRESION_ALIMENTACION, PlanAlimentacionImprimiblePDF } from '@/components/PlanAlimentacionPDF';
import { esperarImagenesCargadas } from '@/components/RutinaPDF';
import { useAuth } from '@/contexts/AuthContext';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { fmtFecha, hoy } from '@/lib/format';

// Nombres típicos que sugiere "Agregar comida" -- el mismo criterio que
// DIAS en rutinas (agregarDia toma el primero que todavía no se usó), pero
// acá con nombres de comida en vez de "Día 1/2/3" porque eso es lo que
// pidió Nalux (04/09/2026): "que se arme por ejemplo desayuno, almuerzo,
// media tarde, cena". Es solo el default -- el nombre de cada comida queda
// editable, por si un gimnasio usa otros (pre-entreno, colación...).
const COMIDAS_TIPICAS = ['Desayuno', 'Media mañana', 'Almuerzo', 'Media tarde', 'Cena'];

const comidaVacia = (nombreSugerido) => ({
    key: `comida-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nombre: nombreSugerido,
    alimentos: [],
});

// Fila de planes_alimentacion a partir de un plan de la biblioteca. El
// contenido se COPIA (copia profunda), no se referencia: editar después el
// plan en la biblioteca no le cambia nada al alumno que ya lo tiene, igual
// que con las rutinas asignadas (ver snapshotRutina en lib/data.js).
// origen_id (migración 0026) queda solo como referencia informativa, para
// que el modal de asignar sepa distinguir "ya tiene este mismo" de "tiene
// otro".
const asignacionDesdePlan = (plan, extra = {}) => ({
    origen_id: plan.id,
    nombre: plan.nombre,
    items: JSON.parse(JSON.stringify(plan.items || [])),
    notas: plan.notas || null,
    ...extra,
});

// Arma los "renglones" para mostrar: los alimentos que comparten `grupo`
// (alternativas, "elegí uno") se muestran juntos en un solo renglón; cada
// alimento sin grupo es su propio renglón. Separado del array plano de
// alimentos (que es lo que se guarda tal cual) solo para el render -- no
// cambia cómo se persiste, solo cómo se agrupa visualmente.
const renglonesDe = (alimentosComida) => {
    const gruposVistos = new Set();
    const renglones = [];
    alimentosComida.forEach((it) => {
        if (it.grupo) {
            if (gruposVistos.has(it.grupo)) return;
            gruposVistos.add(it.grupo);
            renglones.push({
                tipo: 'grupo',
                grupoId: it.grupo,
                items: alimentosComida.filter((x) => x.grupo === it.grupo),
            });
        } else {
            renglones.push({ tipo: 'solo', item: it });
        }
    });
    return renglones;
};

// Biblioteca de "planes de alimentación" reutilizables (migración 0025) --
// el equivalente de Rutinas para el lado de alimentación: armar UNA vez un
// día completo (comida por comida) y reusarlo en el plan de varios
// alumnos, en vez de tipear la misma comida de nuevo cada vez. A
// diferencia de rutinas, acá no hay "asignar a un alumno" ni fechas: cada
// comida de este plan es un bloque de texto reutilizable que se elige al
// armar la comida real de un alumno (AlumnoPage.jsx, PlanAlimentacion, ver
// armarTextoAlimentos en lib/format.js).
const PlanesAlimentacionPage = () => {
    const { gimnasio } = useAuth();
    const [planes, setPlanes] = useState([]);
    const [alimentos, setAlimentos] = useState([]);
    const [alumnosActivos, setAlumnosActivos] = useState([]);
    // Todos los planes_alimentacion ya asignados (a cualquier alumno) --
    // solo para detectar, al generar un PDF, si el alumno elegido ya tiene
    // uno puesto. No hay FK de vuelta a la biblioteca (cada asignación es
    // una copia, no una referencia -- mismo criterio que AlumnoPage.jsx), así
    // que el conflicto se detecta por "ya tiene ALGUNA fila", no por "ya
    // tiene ESTE plan puntual".
    const [planesAlumnos, setPlanesAlumnos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busqueda, setBusqueda] = useState('');

    const [open, setOpen] = useState(false);
    const [editId, setEditId] = useState(null);
    const [nombre, setNombre] = useState('');
    const [comidas, setComidas] = useState([]);
    const [notas, setNotas] = useState('');
    // Un buscador de alimentos por comida -- Desayuno y Cena pueden estar
    // buscando cosas distintas al mismo tiempo, cada card tiene el suyo.
    const [filtros, setFiltros] = useState({});
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [creandoAlimento, setCreandoAlimento] = useState(false);
    const [eliminandoId, setEliminandoId] = useState(null);
    // Alimentos tildados para agrupar como alternativas ("elegí uno"),
    // separados por comida -- ver agruparSeleccionados() más abajo. Pedido
    // de Nalux (04/09/2026): "si no sabemos que le gusta, le tenemos que
    // poner arroz o atun o palta... tiene que estar bien aclarado".
    const [seleccion, setSeleccion] = useState({});

    // Modal "Datos para el PDF" (biblioteca -> PDF), mismo patrón que el de
    // RutinasPage.jsx: pdfModalPlan es el plan que se está por imprimir (o
    // null si el modal está cerrado). Pedido de Nalux (04/09/2026): "que
    // cuando habrá descarga salte un cartel para poner fecha inicio y
    // finalización, y agregar el alumno asignado".
    const [planImprimiendo, setPlanImprimiendo] = useState(null);
    const [pdfModalPlan, setPdfModalPlan] = useState(null);
    const [pdfModo, setPdfModo] = useState('alumno');
    const [pdfAlumnoId, setPdfAlumnoId] = useState('');
    const [pdfAlumnoNombre, setPdfAlumnoNombre] = useState('');
    const [pdfFechaInicio, setPdfFechaInicio] = useState('');
    const [pdfFechaFin, setPdfFechaFin] = useState('');
    const [pdfAsignando, setPdfAsignando] = useState(false);
    const [pdfError, setPdfError] = useState('');
    // {id, nombre} del plan que ya tenía asignado ese alumno, o null si no
    // hay conflicto (o todavía no se comprobó).
    const [pdfConflicto, setPdfConflicto] = useState(null);

    // Modal "Asignar a alumnos" (asignación masiva), calcado del de
    // RutinasPage.jsx -- pedido de Nalux (04/09/2026): además de descargar,
    // poder asignarle la nutrición a varios alumnos desde este mismo módulo.
    const [asignarOpen, setAsignarOpen] = useState(false);
    const [planAsignando, setPlanAsignando] = useState(null);
    const [seleccionados, setSeleccionados] = useState(new Set());
    const [asignando, setAsignando] = useState(false);
    const [asignarMsg, setAsignarMsg] = useState('');
    const [fechaInicioAsig, setFechaInicioAsig] = useState(hoy());
    const [fechaFinAsig, setFechaFinAsig] = useState('');
    // Alumnos tildados que ya tienen OTRO plan asignado: no se los pisa en
    // silencio, sale el cartel para elegir dejar o reemplazar.
    const [conflictoAlumnos, setConflictoAlumnos] = useState(null);
    const [confirmandoQuitarId, setConfirmandoQuitarId] = useState(null);
    const [quitandoId, setQuitandoId] = useState(null);

    // ¿Esta fila asignada salió de este plan de la biblioteca? origen_id
    // existe recién desde la migración 0026: las asignaciones anteriores lo
    // tienen en null, así que ahí se cae al nombre (que se copia tal cual al
    // asignar) en vez de tratarlas como "otro plan" y hacer saltar un cartel
    // de conflicto contra el mismo plan que ya tienen.
    const esEstePlan = (asignado, plan) =>
        asignado.origen_id ? asignado.origen_id === plan?.id : asignado.nombre === plan?.nombre;

    const cargar = () => {
        setLoading(true);
        Promise.all([
            listAll('planes_alimentacion_biblioteca', { sort: 'nombre' }),
            listAll('alimentos', { sort: 'nombre' }),
            listAll('alumnos', { filters: { activo: true }, sort: 'nombre' }),
            listAll('planes_alimentacion'),
        ])
            .then(([p, a, al, asignados]) => {
                setPlanes(p);
                setAlimentos(a);
                setAlumnosActivos(al);
                setPlanesAlumnos(asignados);
                setError('');
            })
            .catch(() => setError('No se pudo cargar la biblioteca de planes de alimentación.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    const visibles = planes.filter(
        (p) => !busqueda.trim() || p.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase()),
    );

    const abrirNuevo = () => {
        setNombre('');
        setComidas([comidaVacia(COMIDAS_TIPICAS[0])]);
        setNotas('');
        setFiltros({});
        setEditId(null);
        setFormError('');
        setOpen(true);
    };

    const abrirEditar = (p) => {
        setNombre(p.nombre || '');
        setComidas(p.items?.length ? p.items : [comidaVacia(COMIDAS_TIPICAS[0])]);
        setNotas(p.notas || '');
        setFiltros({});
        setEditId(p.id);
        setFormError('');
        setOpen(true);
    };

    const agregarComida = () => {
        const usados = comidas.map((c) => c.nombre);
        const siguiente = COMIDAS_TIPICAS.find((n) => !usados.includes(n)) || `Comida ${comidas.length + 1}`;
        setComidas((prev) => [...prev, comidaVacia(siguiente)]);
    };

    const quitarComida = (key) => setComidas((prev) => prev.filter((c) => c.key !== key));

    const moverComida = (key, direccion) =>
        setComidas((prev) => {
            const i = prev.findIndex((c) => c.key === key);
            const j = i + direccion;
            if (j < 0 || j >= prev.length) return prev;
            const copia = [...prev];
            [copia[i], copia[j]] = [copia[j], copia[i]];
            return copia;
        });

    const renombrarComida = (key, nuevoNombre) =>
        setComidas((prev) => prev.map((c) => (c.key === key ? { ...c, nombre: nuevoNombre } : c)));

    const agregarAlimentoAComida = (comidaKey, alimento) => {
        setComidas((prev) =>
            prev.map((c) =>
                c.key === comidaKey
                    ? {
                          ...c,
                          alimentos: [
                              ...c.alimentos,
                              {
                                  alimentoId: alimento.id,
                                  nombre: alimento.nombre,
                                  cantidad: alimento.unidad || '',
                                  grupo: null,
                                  opcional: false,
                              },
                          ],
                      }
                    : c,
            ),
        );
        setFiltros((f) => ({ ...f, [comidaKey]: '' }));
    };

    const quitarAlimentoDeComida = (comidaKey, alimentoId) =>
        setComidas((prev) =>
            prev.map((c) => {
                if (c.key !== comidaKey) return c;
                const restantes = c.alimentos.filter((it) => it.alimentoId !== alimentoId);
                // Si un grupo queda con un solo alimento, ya no es una
                // alternativa de nada -- se desarma solo para no mostrar un
                // cartel de "Elegí uno" con una sola opción adentro.
                const grupoQuitado = c.alimentos.find((it) => it.alimentoId === alimentoId)?.grupo;
                const quedanEnGrupo = grupoQuitado
                    ? restantes.filter((it) => it.grupo === grupoQuitado).length
                    : 0;
                const alimentos =
                    grupoQuitado && quedanEnGrupo === 1
                        ? restantes.map((it) => (it.grupo === grupoQuitado ? { ...it, grupo: null } : it))
                        : restantes;
                return { ...c, alimentos };
            }),
        );

    const editarCantidad = (comidaKey, alimentoId, cantidad) =>
        setComidas((prev) =>
            prev.map((c) =>
                c.key === comidaKey
                    ? {
                          ...c,
                          alimentos: c.alimentos.map((it) =>
                              it.alimentoId === alimentoId ? { ...it, cantidad } : it,
                          ),
                      }
                    : c,
            ),
        );

    const toggleOpcional = (comidaKey, alimentoId) =>
        setComidas((prev) =>
            prev.map((c) =>
                c.key === comidaKey
                    ? {
                          ...c,
                          alimentos: c.alimentos.map((it) =>
                              it.alimentoId === alimentoId ? { ...it, opcional: !it.opcional } : it,
                          ),
                      }
                    : c,
            ),
        );

    const toggleSeleccion = (comidaKey, alimentoId) =>
        setSeleccion((prev) => {
            const actual = new Set(prev[comidaKey] || []);
            if (actual.has(alimentoId)) actual.delete(alimentoId);
            else actual.add(alimentoId);
            return { ...prev, [comidaKey]: actual };
        });

    // Junta los alimentos tildados de esta comida en un mismo grupo
    // ("elegí uno: X o Y o Z") -- un id nuevo cada vez, así agrupar de
    // nuevo con una selección distinta no mezcla grupos viejos.
    const agruparSeleccionados = (comidaKey) => {
        const idsElegidos = seleccion[comidaKey] || new Set();
        if (idsElegidos.size < 2) return;
        const grupoId = `grupo-${Date.now()}`;
        setComidas((prev) =>
            prev.map((c) =>
                c.key === comidaKey
                    ? {
                          ...c,
                          alimentos: c.alimentos.map((it) =>
                              idsElegidos.has(it.alimentoId) ? { ...it, grupo: grupoId } : it,
                          ),
                      }
                    : c,
            ),
        );
        setSeleccion((prev) => ({ ...prev, [comidaKey]: new Set() }));
    };

    const desagrupar = (comidaKey, grupoId) =>
        setComidas((prev) =>
            prev.map((c) =>
                c.key === comidaKey
                    ? {
                          ...c,
                          alimentos: c.alimentos.map((it) => (it.grupo === grupoId ? { ...it, grupo: null } : it)),
                      }
                    : c,
            ),
        );

    // Pedido de Nalux (04/09/2026): "si alguna comida no esta en la
    // biblioteca que se pueda escribir de ahi tambien y de paso se cargue a
    // la biblioteca automaticamente" -- crea el alimento (mínimo, solo con
    // el nombre) y lo agrega a esta comida en el mismo paso. El profesor
    // puede ir después a Alimentos a cargarle calorías/macros si quiere,
    // no hace falta pedírselo acá para no trabar el armado del plan.
    const crearYAgregarAlimento = async (comidaKey, nombreNuevo) => {
        setCreandoAlimento(true);
        setFormError('');
        try {
            const nuevo = await createRec('alimentos', { nombre: nombreNuevo });
            setAlimentos((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
            agregarAlimentoAComida(comidaKey, nuevo);
        } catch (_) {
            setFormError('No se pudo crear ese alimento nuevo.');
        } finally {
            setCreandoAlimento(false);
        }
    };

    const guardar = async (e) => {
        e.preventDefault();
        const comidasConAlimentos = comidas.filter((c) => c.alimentos.length > 0);
        if (comidasConAlimentos.length === 0) {
            setFormError('Agregá al menos un alimento en alguna comida.');
            return;
        }
        setSaving(true);
        setFormError('');
        const payload = { nombre, items: comidasConAlimentos, notas: notas.trim() || null };
        try {
            if (editId) await updateRec('planes_alimentacion_biblioteca', editId, payload);
            else await createRec('planes_alimentacion_biblioteca', payload);
            setOpen(false);
            cargar();
        } catch (_) {
            setFormError('No se pudo guardar el plan.');
        } finally {
            setSaving(false);
        }
    };

    const eliminar = async (id) => {
        setEliminandoId(null);
        await removeRec('planes_alimentacion_biblioteca', id);
        cargar();
    };

    // Duplicar sirve para versionar sin miedo: se copia tal cual con
    // "(copia)" en el nombre y nadie queda asignado a la copia -- las
    // asignaciones son del plan original, así que el profe puede tocar la
    // copia tranquilo. Mismo criterio que duplicar() en RutinasPage.jsx.
    const duplicar = async (p) => {
        try {
            await createRec('planes_alimentacion_biblioteca', {
                nombre: `${p.nombre} (copia)`,
                notas: p.notas,
                items: (p.items || []).map((c, i) => ({
                    ...JSON.parse(JSON.stringify(c)),
                    key: `comida-copia-${Date.now()}-${i}`,
                })),
            });
            cargar();
        } catch (_) {
            setError('No se pudo duplicar el plan.');
        }
    };

    const abrirAsignar = (p) => {
        setPlanAsignando(p);
        setSeleccionados(new Set());
        setAsignarMsg('');
        setFechaInicioAsig(hoy());
        setFechaFinAsig('');
        setConfirmandoQuitarId(null);
        setConflictoAlumnos(null);
        setAsignarOpen(true);
    };

    const toggleAlumno = (alumnoId) => {
        // Cualquier cambio en la selección invalida el cartel de conflicto:
        // se recalcula de cero al tocar "Asignar" de nuevo.
        setConflictoAlumnos(null);
        setSeleccionados((prev) => {
            const next = new Set(prev);
            if (next.has(alumnoId)) next.delete(alumnoId);
            else next.add(alumnoId);
            return next;
        });
    };

    // Una fila de planes_alimentacion por alumno tildado, todas con la misma
    // fecha. Como es 1-a-1 por alumno, al que ya tenía un plan se le
    // reemplaza el contenido de su fila (update), no se le crea otra.
    const ejecutarAsignacion = async (ids, reemplazos = new Map()) => {
        setAsignando(true);
        setAsignarMsg('');
        try {
            await Promise.all(
                ids.map((alumnoId) => {
                    const payload = asignacionDesdePlan(planAsignando, {
                        alumno_id: alumnoId,
                        fecha_inicio: fechaInicioAsig || hoy(),
                        fecha_fin: fechaFinAsig || null,
                    });
                    const existenteId = reemplazos.get(alumnoId);
                    return existenteId
                        ? updateRec('planes_alimentacion', existenteId, payload)
                        : createRec('planes_alimentacion', payload);
                }),
            );
            setAsignarMsg(`Plan asignado a ${ids.length} alumno${ids.length === 1 ? '' : 's'}.`);
            setSeleccionados(new Set());
            setConflictoAlumnos(null);
            cargar();
        } catch (_) {
            setAsignarMsg('No se pudo completar la asignación. Intentar de nuevo.');
        } finally {
            setAsignando(false);
        }
    };

    // Primer click en "Asignar": si entre los tildados hay alguno con OTRO
    // plan asignado, corta y muestra el cartel en vez de asignar derecho.
    const iniciarAsignacion = () => {
        if (!planAsignando || seleccionados.size === 0) return;
        const conflictos = Array.from(seleccionados)
            .map((alumnoId) => {
                const otro = planesAlumnos.find(
                    (x) => x.alumno_id === alumnoId && !esEstePlan(x, planAsignando),
                );
                if (!otro) return null;
                return {
                    alumnoId,
                    planId: otro.id,
                    nombreAlumno: alumnosActivos.find((a) => a.id === alumnoId)?.nombre || 'Este alumno',
                    nombrePlan: otro.nombre || 'otro plan',
                };
            })
            .filter(Boolean);
        if (conflictos.length > 0) {
            setConflictoAlumnos(conflictos);
            return;
        }
        ejecutarAsignacion(Array.from(seleccionados));
    };

    const reemplazarConflictos = () => {
        ejecutarAsignacion(
            Array.from(seleccionados),
            new Map(conflictoAlumnos.map((c) => [c.alumnoId, c.planId])),
        );
    };

    // "Dejarles el que tienen": los saca de la tanda y asigna solo al resto.
    const omitirConflictos = () => {
        const idsConflicto = new Set(conflictoAlumnos.map((c) => c.alumnoId));
        const restantes = Array.from(seleccionados).filter((id) => !idsConflicto.has(id));
        setSeleccionados(new Set(restantes));
        setConflictoAlumnos(null);
        if (restantes.length > 0) ejecutarAsignacion(restantes);
    };

    // A diferencia de rutinas (que desactiva la asignación y la deja como
    // historial), planes_alimentacion es 1-a-1 y no tiene columna `activa`:
    // quitar es borrar esa fila, igual que "Quitar plan" en la ficha.
    const quitarAsignacion = async (planAsignadoId) => {
        setConfirmandoQuitarId(null);
        setQuitandoId(planAsignadoId);
        setAsignarMsg('');
        try {
            await removeRec('planes_alimentacion', planAsignadoId);
            cargar();
        } catch (_) {
            setAsignarMsg('No se pudo quitar la asignación. Intentar de nuevo.');
        } finally {
            setQuitandoId(null);
        }
    };

    const abrirPdfModal = (p) => {
        setPdfModalPlan(p);
        setPdfModo('alumno');
        setPdfAlumnoId('');
        setPdfAlumnoNombre('');
        setPdfFechaInicio(hoy());
        setPdfFechaFin('');
        setPdfError('');
        setPdfConflicto(null);
    };

    // Mismo criterio que confirmarPdf() en RutinasPage.jsx: en modo "alumno
    // registrado", generar el PDF también asigna de verdad el plan (copia
    // nombre/items/notas en planes_alimentacion, con las fechas puestas
    // acá). Como planes_alimentacion es 1-a-1 por alumno (sin FK de vuelta a
    // la biblioteca), no hay forma de distinguir "ya tiene ESTE plan" de
    // "tiene otro" -- cualquier fila ya existente corta acá y muestra el
    // cartel de conflicto antes de reemplazarla.
    const confirmarPdf = async () => {
        if (pdfModo === 'alumno' && !pdfAlumnoId) return;
        setPdfError('');

        if (pdfModo === 'alumno') {
            const existente = planesAlumnos.find((x) => x.alumno_id === pdfAlumnoId);
            // Si ya tiene OTRO plan, primero el cartel. Si el que tiene salió de
            // este mismo plan, no hay nada que preguntar: se le actualizan las
            // fechas y listo (mismo criterio que rutinas: "si ya la tenía
            // asignada, no se duplica").
            if (existente && !esEstePlan(existente, pdfModalPlan) && !pdfConflicto) {
                setPdfConflicto({ id: existente.id, nombre: existente.nombre || 'otro plan' });
                return;
            }
            setPdfAsignando(true);
            try {
                const payload = asignacionDesdePlan(pdfModalPlan, {
                    alumno_id: pdfAlumnoId,
                    fecha_inicio: pdfFechaInicio || hoy(),
                    fecha_fin: pdfFechaFin || null,
                });
                if (existente) await updateRec('planes_alimentacion', existente.id, payload);
                else await createRec('planes_alimentacion', payload);
                cargar();
            } catch (_) {
                setPdfAsignando(false);
                setPdfError('No se pudo asignar el plan a ese alumno. Intentar de nuevo.');
                return;
            }
            setPdfAsignando(false);
        }

        setPdfConflicto(null);
        setPlanImprimiendo(pdfModalPlan);
        setPdfModalPlan(null);
        requestAnimationFrame(async () => {
            await esperarImagenesCargadas('.alimentacion-pdf-hoja img');
            window.print();
            setPlanImprimiendo(null);
        });
    };

    return (
        <AppLayout
            title={
                <span className="inline-flex flex-wrap items-center gap-3">
                    Planes de alimentación
                    <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
                        {planes.length} {planes.length === 1 ? 'plan' : 'planes'}
                    </span>
                </span>
            }
            subtitle='Armar un plan una sola vez y asignarlo a cualquier alumno (o descargar el PDF) desde acá. Si una comida es opcional, marcar "Opcional" para que quede bien claro.'
            actions={
                <Btn onClick={abrirNuevo}>
                    <Plus className="h-4 w-4" /> Nuevo plan de alimentación
                </Btn>
            }
        >
            <Helmet>
                <title>Planes de alimentación | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Biblioteca de planes de comidas reutilizables para armar el plan de cualquier alumno."
                />
            </Helmet>

            <div className="relative mb-6 max-w-md">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar plan por nombre..."
                    className="pl-9"
                    aria-label="Buscar plan de alimentación por nombre"
                />
            </div>

            {error && (
                <div className="mb-4">
                    <ErrorBox>{error}</ErrorBox>
                </div>
            )}

            {loading ? (
                <Loading rows={4} />
            ) : visibles.length === 0 ? (
                <Empty>
                    {planes.length === 0
                        ? 'Todavía no armaste ningún plan de alimentación reutilizable.'
                        : 'Ningún plan coincide con esta búsqueda.'}
                </Empty>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {visibles.map((p) => (
                        <div key={p.id} className="rounded-2xl border border-border bg-card p-5">
                            <h3 className="font-display text-lg font-bold">{p.nombre}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {(p.items || []).length} comida{(p.items || []).length === 1 ? '' : 's'}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {(p.items || []).map((c) => (
                                    <Badge key={c.key} className="border-border text-muted-foreground">
                                        {c.nombre}
                                    </Badge>
                                ))}
                            </div>
                            {eliminandoId === p.id ? (
                                <div className="mt-4 flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-muted-foreground">¿Seguro?</span>
                                    <Btn variant="danger" className="px-3 py-2 text-xs" onClick={() => eliminar(p.id)}>
                                        Sí, eliminar
                                    </Btn>
                                    <Btn
                                        variant="ghost"
                                        className="px-3 py-2 text-xs"
                                        onClick={() => setEliminandoId(null)}
                                    >
                                        Cancelar
                                    </Btn>
                                </div>
                            ) : (
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirEditar(p)}>
                                        Editar
                                    </Btn>
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirAsignar(p)}>
                                        <UserPlus className="h-3.5 w-3.5" /> Asignar a alumnos
                                    </Btn>
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => duplicar(p)}>
                                        <Copy className="h-3.5 w-3.5" /> Duplicar
                                    </Btn>
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirPdfModal(p)}>
                                        <Printer className="h-3.5 w-3.5" /> PDF
                                    </Btn>
                                    <Btn
                                        variant="danger"
                                        className="px-3 py-2 text-xs"
                                        onClick={() => setEliminandoId(p.id)}
                                    >
                                        Eliminar
                                    </Btn>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* PDF de la plantilla: como desde la biblioteca no hay ningún
                alumno asignado en firme (un mismo plan puede estar en uso por
                varios), el modal de abajo pregunta para quién es esta copia y
                sus fechas antes de generarlo. */}
            {planImprimiendo && (
                <PlanAlimentacionImprimiblePDF
                    nombre={planImprimiendo.nombre}
                    items={planImprimiendo.items}
                    notas={planImprimiendo.notas}
                    color={gimnasio?.color_principal}
                    logoUrl={gimnasio?.logo_url}
                    alumnoNombre={pdfAlumnoNombre}
                    fechaInicio={pdfFechaInicio}
                    fechaFin={pdfFechaFin}
                />
            )}
            <style>{ESTILOS_IMPRESION_ALIMENTACION}</style>

            <Modal
                open={asignarOpen}
                onClose={() => setAsignarOpen(false)}
                title={planAsignando ? `Asignar "${planAsignando.nombre}" a alumnos` : 'Asignar a alumnos'}
            >
                <div className="space-y-4">
                    {alumnosActivos.length === 0 ? (
                        <Empty>No hay alumnos activos para asignar.</Empty>
                    ) : (
                        <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
                            <ul className="divide-y divide-border">
                                {alumnosActivos.map((a) => {
                                    const asignado = planesAlumnos.find(
                                        (x) => x.alumno_id === a.id && esEstePlan(x, planAsignando),
                                    );
                                    // Otro plan asignado -- no bloquea el tilde, solo avisa: el
                                    // cartel de "reemplazar o dejar" recién sale al confirmar.
                                    const otro = !asignado
                                        ? planesAlumnos.find((x) => x.alumno_id === a.id)
                                        : null;
                                    return (
                                        <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                                            <input
                                                type="checkbox"
                                                id={`asignar-plan-alumno-${a.id}`}
                                                checked={seleccionados.has(a.id)}
                                                disabled={!!asignado}
                                                onChange={() => toggleAlumno(a.id)}
                                                className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))] disabled:opacity-40"
                                            />
                                            <label
                                                htmlFor={`asignar-plan-alumno-${a.id}`}
                                                className={`flex-1 text-sm ${asignado ? 'text-muted-foreground' : 'cursor-pointer'}`}
                                            >
                                                {a.nombre}
                                                {asignado && (
                                                    <span className="ml-2 text-xs">
                                                        (ya lo tiene
                                                        {asignado.fecha_inicio
                                                            ? `, desde el ${fmtFecha(asignado.fecha_inicio)}`
                                                            : ''}
                                                        {asignado.fecha_fin ? ` hasta el ${fmtFecha(asignado.fecha_fin)}` : ''})
                                                    </span>
                                                )}
                                                {otro && (
                                                    <span className="ml-2 text-xs text-warn">
                                                        (ya tiene: {otro.nombre})
                                                    </span>
                                                )}
                                            </label>
                                            {asignado && confirmandoQuitarId === asignado.id ? (
                                                <div className="flex shrink-0 items-center gap-1.5">
                                                    <span className="text-xs text-muted-foreground">¿Seguro?</span>
                                                    <Btn
                                                        type="button"
                                                        variant="danger"
                                                        className="px-2 py-1.5 text-xs"
                                                        disabled={quitandoId === asignado.id}
                                                        onClick={() => quitarAsignacion(asignado.id)}
                                                    >
                                                        {quitandoId === asignado.id ? 'Quitando...' : 'Sí, quitar'}
                                                    </Btn>
                                                    <Btn
                                                        type="button"
                                                        variant="ghost"
                                                        className="px-2 py-1.5 text-xs"
                                                        onClick={() => setConfirmandoQuitarId(null)}
                                                    >
                                                        Cancelar
                                                    </Btn>
                                                </div>
                                            ) : (
                                                asignado && (
                                                    <Btn
                                                        type="button"
                                                        variant="ghost"
                                                        className="shrink-0 px-2 py-1.5 text-xs text-primary"
                                                        onClick={() => setConfirmandoQuitarId(asignado.id)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                        Quitar
                                                    </Btn>
                                                )
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {seleccionados.size > 0 && !conflictoAlumnos && (
                        <div className="space-y-3 border-t border-border pt-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Para {seleccionados.size} alumno{seleccionados.size === 1 ? '' : 's'} elegido
                                {seleccionados.size === 1 ? '' : 's'}
                            </p>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Fecha de inicio">
                                    <Input
                                        type="date"
                                        value={fechaInicioAsig}
                                        onChange={(e) => setFechaInicioAsig(e.target.value)}
                                    />
                                </Field>
                                <Field label="Fecha de fin (opcional)">
                                    <Input
                                        type="date"
                                        value={fechaFinAsig}
                                        onChange={(e) => setFechaFinAsig(e.target.value)}
                                    />
                                </Field>
                            </div>
                            <span className="block text-xs text-muted-foreground">
                                Con fecha de fin, van a aparecer en el panel general cuando se les esté por
                                vencer o se les venza el plan. Sin fecha de fin, no hay aviso.
                            </span>
                        </div>
                    )}

                    {conflictoAlumnos && (
                        <div className="space-y-3 rounded-xl border border-warn bg-warn/10 p-4">
                            <p className="text-sm font-semibold">
                                {conflictoAlumnos.length === 1
                                    ? `${conflictoAlumnos[0].nombreAlumno} ya tiene un plan asignado: "${conflictoAlumnos[0].nombrePlan}".`
                                    : `${conflictoAlumnos.length} alumnos ya tienen otro plan asignado:`}
                            </p>
                            {conflictoAlumnos.length > 1 && (
                                <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                                    {conflictoAlumnos.map((c) => (
                                        <li key={c.alumnoId}>
                                            {c.nombreAlumno} — <span className="italic">{c.nombrePlan}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <p className="text-xs text-muted-foreground">
                                ¿Les dejamos el plan que ya tienen, o se lo reemplazamos por &ldquo;
                                {planAsignando?.nombre}&rdquo;?
                            </p>
                            <div className="flex flex-wrap justify-end gap-2 pt-1">
                                <Btn variant="ghost" disabled={asignando} onClick={omitirConflictos}>
                                    Dejarles el que tienen
                                </Btn>
                                <Btn disabled={asignando} onClick={reemplazarConflictos}>
                                    {asignando ? 'Reemplazando...' : 'Reemplazar por este'}
                                </Btn>
                            </div>
                        </div>
                    )}

                    {asignarMsg && <p className="text-sm text-muted-foreground">{asignarMsg}</p>}

                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setAsignarOpen(false)}>
                            Cerrar
                        </Btn>
                        {!conflictoAlumnos && (
                            <Btn onClick={iniciarAsignacion} disabled={asignando || seleccionados.size === 0}>
                                {asignando
                                    ? 'Asignando...'
                                    : `Asignar${seleccionados.size > 0 ? ` a ${seleccionados.size} alumno${seleccionados.size === 1 ? '' : 's'}` : ''}`}
                            </Btn>
                        )}
                    </div>
                </div>
            </Modal>

            <Modal
                open={!!pdfModalPlan}
                onClose={() => setPdfModalPlan(null)}
                title={pdfModalPlan ? `PDF de "${pdfModalPlan.nombre}"` : 'PDF'}
            >
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {[
                            { valor: 'alumno', label: 'Alumno registrado' },
                            { valor: 'libre', label: 'Nombre libre' },
                        ].map((op) => (
                            <button
                                key={op.valor}
                                type="button"
                                onClick={() => {
                                    setPdfModo(op.valor);
                                    setPdfError('');
                                    setPdfConflicto(null);
                                }}
                                aria-pressed={pdfModo === op.valor}
                                className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                                    pdfModo === op.valor
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-border text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {op.label}
                            </button>
                        ))}
                    </div>

                    {pdfModo === 'alumno' ? (
                        alumnosActivos.length === 0 ? (
                            <Empty>No hay alumnos activos cargados. Usar "Nombre libre" para esta copia.</Empty>
                        ) : (
                            <Field label="Alumno">
                                <Select
                                    value={pdfAlumnoId}
                                    onChange={(e) => {
                                        const id = e.target.value;
                                        setPdfAlumnoId(id);
                                        setPdfAlumnoNombre(alumnosActivos.find((a) => a.id === id)?.nombre || '');
                                        setPdfConflicto(null);
                                    }}
                                >
                                    <option value="">Elegir un alumno...</option>
                                    {alumnosActivos.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.nombre}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        )
                    ) : (
                        <Field label="Nombre del alumno (opcional)">
                            <Input
                                value={pdfAlumnoNombre}
                                onChange={(e) => setPdfAlumnoNombre(e.target.value)}
                                placeholder="Para quién es esta copia"
                            />
                        </Field>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Fecha de inicio">
                            <Input
                                type="date"
                                value={pdfFechaInicio}
                                onChange={(e) => setPdfFechaInicio(e.target.value)}
                            />
                        </Field>
                        <Field label="Fecha de fin (opcional)">
                            <Input
                                type="date"
                                value={pdfFechaFin}
                                onChange={(e) => setPdfFechaFin(e.target.value)}
                            />
                        </Field>
                    </div>

                    {!pdfConflicto && (
                        <span className="block text-xs text-muted-foreground">
                            {pdfModo === 'alumno'
                                ? 'Al generar el PDF, el plan queda asignado a ese alumno con estas fechas (si ya tenía uno, se reemplaza).'
                                : 'Nombre libre: el PDF sale con ese nombre, pero no queda asignado a nadie ni con seguimiento.'}
                        </span>
                    )}

                    {pdfConflicto && (
                        <div className="space-y-3 rounded-xl border border-warn bg-warn/10 p-4">
                            <p className="text-sm font-semibold">
                                {pdfAlumnoNombre || 'Este alumno'} ya tiene un plan asignado: &ldquo;
                                {pdfConflicto.nombre}&rdquo;.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                ¿Le dejamos el que tiene, o se lo reemplazamos por &ldquo;{pdfModalPlan?.nombre}&rdquo;?
                            </p>
                            <div className="flex flex-wrap justify-end gap-2 pt-1">
                                <Btn variant="ghost" disabled={pdfAsignando} onClick={() => setPdfConflicto(null)}>
                                    Dejarle el que tiene
                                </Btn>
                                <Btn disabled={pdfAsignando} onClick={confirmarPdf}>
                                    {pdfAsignando ? 'Reemplazando...' : 'Reemplazar y generar PDF'}
                                </Btn>
                            </div>
                        </div>
                    )}

                    {pdfError && <p className="text-sm text-destructive">{pdfError}</p>}

                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setPdfModalPlan(null)}>
                            Cancelar
                        </Btn>
                        {!pdfConflicto && (
                            <Btn
                                onClick={confirmarPdf}
                                disabled={pdfAsignando || (pdfModo === 'alumno' && !pdfAlumnoId)}
                            >
                                <Printer className="h-4 w-4" /> {pdfAsignando ? 'Asignando...' : 'Generar PDF'}
                            </Btn>
                        )}
                    </div>
                </div>
            </Modal>

            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title={editId ? 'Editar plan de alimentación' : 'Nuevo plan de alimentación'}
                wide
            >
                <form onSubmit={guardar} className="space-y-5">
                    <Field label="Nombre del plan">
                        <Input
                            value={nombre}
                            onChange={(e) => setNombre(e.target.value)}
                            placeholder="Bajo en carbohidratos"
                            required
                        />
                    </Field>

                    <div className="space-y-4">
                        {comidas.map((c, i) => {
                            const filtro = filtros[c.key] || '';
                            const yaElegidos = new Set(c.alimentos.map((it) => it.alimentoId));
                            const filtrados = alimentos
                                .filter((a) => !yaElegidos.has(a.id))
                                .filter(
                                    (a) =>
                                        !filtro.trim() ||
                                        a.nombre?.toLowerCase().includes(filtro.trim().toLowerCase()),
                                );
                            const hayExacto = alimentos.some(
                                (a) => a.nombre?.toLowerCase() === filtro.trim().toLowerCase(),
                            );
                            const seleccionComida = seleccion[c.key] || new Set();

                            return (
                                <Card key={c.key}>
                                    <div className="mb-3 flex items-center justify-between gap-2">
                                        <Input
                                            value={c.nombre}
                                            onChange={(e) => renombrarComida(c.key, e.target.value)}
                                            className="max-w-[220px] font-display text-base font-bold"
                                            aria-label="Nombre de esta comida"
                                        />
                                        <div className="flex shrink-0 gap-1">
                                            <button
                                                type="button"
                                                aria-label="Subir comida"
                                                disabled={i === 0}
                                                onClick={() => moverComida(c.key, -1)}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border disabled:opacity-30"
                                            >
                                                <ArrowUp className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label="Bajar comida"
                                                disabled={i === comidas.length - 1}
                                                onClick={() => moverComida(c.key, 1)}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border disabled:opacity-30"
                                            >
                                                <ArrowDown className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Quitar ${c.nombre}`}
                                                disabled={comidas.length === 1}
                                                onClick={() => quitarComida(c.key)}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-primary disabled:opacity-30"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {c.alimentos.length > 1 && (
                                        <p className="mb-2 text-xs text-muted-foreground">
                                            Marcar dos o más para agruparlos como alternativas -- el alumno elige
                                            uno solo, no tiene que comer todos.
                                        </p>
                                    )}

                                    {c.alimentos.length > 0 && (
                                        <div className="mb-3 space-y-2">
                                            {renglonesDe(c.alimentos).map((r) =>
                                                r.tipo === 'grupo' ? (
                                                    <div
                                                        key={r.grupoId}
                                                        className="rounded-xl border-2 border-primary/60 bg-primary/5 p-2.5"
                                                    >
                                                        <div className="mb-1.5 flex items-center justify-between px-1">
                                                            <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                                                                Elegir uno
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => desagrupar(c.key, r.grupoId)}
                                                                className="text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                                                            >
                                                                Desagrupar
                                                            </button>
                                                        </div>
                                                        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                                                            {r.items.map((it) => (
                                                                <li
                                                                    key={it.alimentoId}
                                                                    className="flex flex-wrap items-center gap-3 px-3 py-2"
                                                                >
                                                                    <span className="min-w-0 basis-full text-sm font-medium sm:basis-auto sm:flex-1">
                                                                        {it.nombre}
                                                                    </span>
                                                                    <Input
                                                                        value={it.cantidad}
                                                                        onChange={(e) =>
                                                                            editarCantidad(
                                                                                c.key,
                                                                                it.alimentoId,
                                                                                e.target.value,
                                                                            )
                                                                        }
                                                                        placeholder="Cantidad"
                                                                        className="w-24 shrink-0"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        aria-label={`Quitar ${it.nombre}`}
                                                                        onClick={() =>
                                                                            quitarAlimentoDeComida(c.key, it.alimentoId)
                                                                        }
                                                                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-primary"
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </button>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                ) : (
                                                    // Checkbox+nombre agrupados con basis-full en mobile: el
                                                    // renglón completo (checkbox + nombre + cantidad + Opcional +
                                                    // eliminar) no entra en una fila de celular sin que el campo
                                                    // de cantidad quede ilegible -- con flex-wrap y este grupo
                                                    // ocupando toda la línea, cantidad/Opcional/eliminar bajan a
                                                    // su propia fila en vez de comprimirse (bug encontrado en
                                                    // revisión mobile, 04/09/2026).
                                                    <div
                                                        key={r.item.alimentoId}
                                                        className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2"
                                                    >
                                                        <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
                                                            <input
                                                                type="checkbox"
                                                                aria-label={`Elegir ${r.item.nombre} para agrupar como alternativa`}
                                                                checked={seleccionComida.has(r.item.alimentoId)}
                                                                onChange={() =>
                                                                    toggleSeleccion(c.key, r.item.alimentoId)
                                                                }
                                                                className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                                                            />
                                                            <span className="min-w-0 flex-1 text-sm font-medium">
                                                                {r.item.nombre}
                                                                {r.item.opcional && (
                                                                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                                                        (opcional)
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </div>
                                                        <Input
                                                            value={r.item.cantidad}
                                                            onChange={(e) =>
                                                                editarCantidad(c.key, r.item.alimentoId, e.target.value)
                                                            }
                                                            placeholder="Cantidad"
                                                            className="w-24 shrink-0"
                                                        />
                                                        <button
                                                            type="button"
                                                            aria-pressed={r.item.opcional}
                                                            onClick={() => toggleOpcional(c.key, r.item.alimentoId)}
                                                            className={`shrink-0 rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition ${
                                                                r.item.opcional
                                                                    ? 'border-primary bg-primary text-primary-foreground'
                                                                    : 'border-border text-muted-foreground hover:text-foreground'
                                                            }`}
                                                        >
                                                            Opcional
                                                        </button>
                                                        <button
                                                            type="button"
                                                            aria-label={`Quitar ${r.item.nombre}`}
                                                            onClick={() =>
                                                                quitarAlimentoDeComida(c.key, r.item.alimentoId)
                                                            }
                                                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-primary"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                ),
                                            )}
                                            {seleccionComida.size >= 2 && (
                                                <Btn
                                                    variant="ghost"
                                                    className="px-3 py-1.5 text-xs"
                                                    onClick={() => agruparSeleccionados(c.key)}
                                                >
                                                    Agrupar los {seleccionComida.size} tildados como alternativas
                                                </Btn>
                                            )}
                                        </div>
                                    )}

                                    <div className="relative">
                                        <Search
                                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                            aria-hidden="true"
                                        />
                                        <Input
                                            value={filtro}
                                            onChange={(e) => setFiltros((f) => ({ ...f, [c.key]: e.target.value }))}
                                            placeholder="Buscar o escribir un alimento nuevo..."
                                            className="pl-9"
                                        />
                                    </div>
                                    {(filtrados.length > 0 || filtro.trim()) && (
                                        <div className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-border">
                                            <ul className="divide-y divide-border">
                                                {filtrados.map((a) => (
                                                    <li key={a.id}>
                                                        <button
                                                            type="button"
                                                            onClick={() => agregarAlimentoAComida(c.key, a)}
                                                            className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-secondary"
                                                        >
                                                            <span>{a.nombre}</span>
                                                            <span className="text-xs text-primary">Agregar</span>
                                                        </button>
                                                    </li>
                                                ))}
                                                {filtro.trim() && !hayExacto && (
                                                    <li>
                                                        <button
                                                            type="button"
                                                            disabled={creandoAlimento}
                                                            onClick={() =>
                                                                crearYAgregarAlimento(c.key, filtro.trim())
                                                            }
                                                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-primary hover:bg-secondary disabled:opacity-50"
                                                        >
                                                            <Plus className="h-3.5 w-3.5 shrink-0" />
                                                            {creandoAlimento
                                                                ? 'Creando...'
                                                                : `Crear "${filtro.trim()}" y agregarlo a tu biblioteca`}
                                                        </button>
                                                    </li>
                                                )}
                                            </ul>
                                        </div>
                                    )}
                                </Card>
                            );
                        })}
                    </div>

                    <Btn variant="ghost" onClick={agregarComida}>
                        <Plus className="h-4 w-4" /> Agregar comida
                    </Btn>

                    <Field label="Notas (opcional)">
                        <Textarea
                            value={notas}
                            onChange={(e) => setNotas(e.target.value)}
                            placeholder="Preparación, aclaraciones..."
                        />
                    </Field>

                    {formError && <ErrorBox>{formError}</ErrorBox>}

                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpen(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Btn>
                    </div>
                </form>
            </Modal>
        </AppLayout>
    );
};

export default PlanesAlimentacionPage;
