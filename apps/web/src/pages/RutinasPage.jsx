import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ClipboardList, Copy, Plus, Printer, Search, Trash2, UserPlus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { ESTILOS_IMPRESION_RUTINA, RutinaImprimiblePDF, esperarImagenesCargadas } from '@/components/RutinaPDF';
import { useAuth } from '@/contexts/AuthContext';
import { createRec, listAll, removeRec, snapshotRutina, updateRec } from '@/lib/data';
import { DIAS, agruparPorBloque, fmtFecha, hoy, semanaDeItem } from '@/lib/format';
import { tipoDePreview } from '@/lib/mediaEjercicio';

// Días que ya usa una rutina, en el orden de DIAS. Si algún item tuviera un
// día fuera de la lista (no debería, siempre salen del selector), igual se
// respeta y va al final en vez de desaparecer.
const diasUsados = (items) => {
    const enItems = [...new Set((items || []).map((it) => it.dia).filter(Boolean))];
    const ordenados = [
        ...DIAS.filter((d) => enItems.includes(d)),
        ...enItems.filter((d) => !DIAS.includes(d)),
    ];
    return ordenados.length > 0 ? ordenados : [DIAS[0]];
};

// Agrupa una lista (ya filtrada a un mismo bloque) por comboId consecutivo,
// SIN fusionar los valores de cada ejercicio -- es solo para dibujar una
// caja visual alrededor de los que van juntos en el armador, que sigue
// editando cada ejercicio por separado (series/reps/peso propios). Distinto
// de agruparCombos() en format.js, que sí fusiona los valores para mostrar
// una sola tarjeta combinada en las pantallas de solo lectura.
const agruparPorCombo = (lista) => {
    const grupos = [];
    lista.forEach((it) => {
        const ultimo = grupos[grupos.length - 1];
        if (it.comboId && ultimo?.length && ultimo[0].comboId === it.comboId) ultimo.push(it);
        else grupos.push([it]);
    });
    return grupos;
};

const vacio = { nombre: '', descripcion: '', duracion_semanas: 4 };

// Bloques sugeridos dentro de un día (entrada en calor, bloque principal,
// etc.). Es solo un <datalist>: el campo es de texto libre, esto nada más
// evita tener que tipear los cuatro o cinco de siempre.
const BLOQUES_SUGERIDOS = [
    'Entrada en calor',
    'Movilidad',
    'Activación',
    'Bloque principal',
    'Bloque 1',
    'Bloque 2',
    'Superserie',
    'Zona media',
    'Cardio final',
    'Elongación',
];

// Biblioteca de rutinas reutilizables: se arman UNA vez acá y se asignan a
// N alumnos (rutinas_asignadas). Reemplaza al viejo modelo "un plan por
// alumno" que vivía embebido en AlumnoPage — ver PLAN.md, Decisión 4.
const RutinasPage = () => {
    const { gimnasio } = useAuth();
    const [rutinas, setRutinas] = useState([]);
    const [ejercicios, setEjercicios] = useState([]);
    const [asignadasActivas, setAsignadasActivas] = useState([]);
    const [alumnosActivos, setAlumnosActivos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busqueda, setBusqueda] = useState('');

    // Modal "Nueva rutina" / "Editar rutina"
    const [open, setOpen] = useState(false);
    const [editId, setEditId] = useState(null);
    const [form, setForm] = useState(vacio);
    const [items, setItems] = useState([]);
    // Conjunto de ejercicios tildados para agregar de una. Se eligen varios
    // a la vez sobre todo para superseries: van todos al mismo día y al mismo
    // bloque, uno detrás del otro.
    const [ejsElegidos, setEjsElegidos] = useState(new Set());
    const [filtroEj, setFiltroEj] = useState('');
    // Preview flotante al pasar el mouse por un ejercicio de la lista (pedido
    // de Nalux 03/09/2026: ver la foto/video del ejercicio sin tener que
    // abrir nada). Guarda el ejercicio + la posición ya calculada en píxeles
    // de viewport (position: fixed, así no lo recorta el overflow-y-auto de
    // la lista ni el propio Modal). null = no se está mostrando ninguno.
    const [previewHover, setPreviewHover] = useState(null);
    const [dia, setDia] = useState(DIAS[0]);
    // Días que tiene esta rutina. Antes eran implícitos (aparecían solos al
    // agregar un ejercicio con ese día elegido en un desplegable); ahora se
    // ven y se manejan como botones, con "Agregar día" para sumar el que
    // sigue. Un día sin ejercicios no se guarda: rutinas.items es lo único
    // que persiste, y un día vacío no significa nada para el alumno.
    const [diasRutina, setDiasRutina] = useState([DIAS[0]]);
    const [semana, setSemana] = useState(1);
    // Reportado por Nalux (03/09/2026): con "Duración (semanas)" en 4 por
    // default, el selector de "Semana 1/2/3/4" aparecía SIEMPRE, apenas se
    // abría "Nueva rutina" -- pegado justo debajo de "Día de la rutina", muy
    // fácil de confundir uno con el otro. El caso común es "estos mismos 4
    // días se repiten las 4 semanas", no "cada semana tiene ejercicios
    // distintos" -- eso pasa a ser una opción aparte, apagada por default,
    // en vez de algo que se prende solo por poner una duración mayor a 1.
    const [semanasDistintas, setSemanasDistintas] = useState(false);
    const [bloque, setBloque] = useState('');
    const [saving, setSaving] = useState(false);

    // Modal "Asignar a alumnos" (asignación masiva)
    const [asignarOpen, setAsignarOpen] = useState(false);
    const [rutinaAsignando, setRutinaAsignando] = useState(null);
    const [seleccionados, setSeleccionados] = useState(new Set());
    const [asignando, setAsignando] = useState(false);
    const [asignarMsg, setAsignarMsg] = useState('');
    const [fechaInicioAsig, setFechaInicioAsig] = useState(hoy());
    const [fechaFinAsig, setFechaFinAsig] = useState('');
    // Pedido de Nalux (03/09/2026): si entre los tildados hay alumnos que YA
    // tienen otra rutina activa (una distinta a la que se está por asignar),
    // no se los pisa en silencio -- se corta acá, se muestra el cartel con
    // quiénes son y qué rutina tienen, y el profe elige "dejarles la que
    // tienen" (se los saca de la tanda) o "reemplazar por esta" (se
    // desactiva la vieja y se crea la nueva, mismo criterio que "Cambiar
    // rutina" en AlumnoPage.jsx). null = no hay conflicto pendiente.
    const [conflictoAlumnos, setConflictoAlumnos] = useState(null);

    // Rutina que se está mandando a imprimir (queda montada en la vista de
    // solo impresión mientras el navegador arma el PDF).
    const [rutinaImprimiendo, setRutinaImprimiendo] = useState(null);

    // Modal "Datos para el PDF": desde la biblioteca no hay ningún alumno en
    // particular (una misma rutina puede estar asignada a varios, cada uno
    // con sus fechas) -- reportado por Nalux (03/09/2026) que antes de
    // imprimir hace falta preguntar para quién es esta copia y desde/hasta
    // cuándo, así el PDF sale con nombre y fechas en vez de en blanco.
    // pdfModalRutina es la rutina que se está por imprimir (o null si el
    // modal está cerrado); las otras son los datos que se piden ahí.
    //
    // pdfModo: nuevo pedido de Nalux (03/09/2026) -- por default el PDF es
    // para un alumno YA registrado (pdfModo 'alumno'), elegido de una lista
    // en vez de tipeado a mano, y al generar el PDF de paso se lo asigna de
    // verdad (una fila en rutinas_asignadas), así queda con seguimiento en
    // vez de ser solo un papel suelto. "Nombre libre" (pdfModo 'libre') es
    // el escape para alguien que todavía no es alumno cargado en el sistema
    // -- ahí no se guarda nada, es el comportamiento de antes.
    const [pdfModalRutina, setPdfModalRutina] = useState(null);
    const [pdfModo, setPdfModo] = useState('alumno');
    const [pdfAlumnoId, setPdfAlumnoId] = useState('');
    const [pdfAlumnoNombre, setPdfAlumnoNombre] = useState('');
    const [pdfFechaInicio, setPdfFechaInicio] = useState('');
    const [pdfFechaFin, setPdfFechaFin] = useState('');
    const [pdfAsignando, setPdfAsignando] = useState(false);
    const [pdfError, setPdfError] = useState('');
    // Mismo cartel de conflicto que "Asignar a alumnos", pero para un solo
    // alumno: {asignacionId, nombreRutina} de la rutina activa que ya tiene
    // (distinta a esta), o null si no hay conflicto (o todavía no se
    // comprobó). Se limpia solo si cambia el alumno o el modo elegido.
    const [pdfConflicto, setPdfConflicto] = useState(null);

    const cargar = () => {
        setLoading(true);
        Promise.all([
            listAll('rutinas', { sort: 'nombre' }),
            listAll('ejercicios', { sort: 'nombre' }),
            listAll('rutinas_asignadas', { filters: { activa: true } }),
            listAll('alumnos', { filters: { activo: true }, sort: 'nombre' }),
        ])
            .then(([r, e, asig, al]) => {
                setRutinas(r);
                setEjercicios(e);
                setAsignadasActivas(asig);
                setAlumnosActivos(al);
                setError('');
            })
            .catch(() => setError('No se pudo cargar la biblioteca de rutinas.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);


    // Conteo client-side de alumnos activos asignados a cada rutina — no hace
    // falta una vista SQL nueva para algo tan simple.
    const contarAsignados = (rutinaId) => asignadasActivas.filter((a) => a.rutina_id === rutinaId).length;

    const abrirNueva = () => {
        setForm(vacio);
        setEditId(null);
        setItems([]);
        setEjsElegidos(new Set());
        setFiltroEj('');
        setDiasRutina([DIAS[0]]);
        setDia(DIAS[0]);
        setSemana(1);
        setSemanasDistintas(false);
        setBloque('');
        setOpen(true);
    };

    const abrirEditar = (r) => {
        setForm({
            nombre: r.nombre || '',
            descripcion: r.descripcion || '',
            duracion_semanas: r.duracion_semanas || 4,
        });
        setEditId(r.id);
        setItems(r.items || []);
        setEjsElegidos(new Set());
        setFiltroEj('');
        const dias = diasUsados(r.items);
        setDiasRutina(dias);
        setDia(dias[0]);
        setSemana(1);
        // Si la rutina que ya existía de verdad usa más de una semana
        // distinta, el toggle arranca prendido -- no hay que esconder
        // contenido real que el profesor ya armó a propósito.
        setSemanasDistintas(new Set((r.items || []).map(semanaDeItem)).size > 1);
        setBloque('');
        setOpen(true);
    };

    // Suma el siguiente día de DIAS que todavía no esté en la rutina y lo
    // deja seleccionado, listo para cargarle ejercicios.
    const agregarDia = () => {
        const siguiente = DIAS.find((d) => !diasRutina.includes(d));
        if (!siguiente) return;
        setDiasRutina((prev) => [...prev, siguiente]);
        setDia(siguiente);
        setBloque('');
    };

    const toggleEjercicio = (id) =>
        setEjsElegidos((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    // Ancho/alto fijos de la cajita de preview, para calcular dónde entra sin
    // salirse de la pantalla: al costado (derecha, o izquierda si no entra)
    // cuando hay ancho de sobra al lado de la fila; si la fila ocupa casi
    // todo el ancho (pantallas angostas, celular) ningún costado alcanza, así
    // que ahí se muestra debajo de la fila en vez de taparla.
    const PREVIEW_ANCHO = 176;
    const PREVIEW_ALTO = 160;
    const PREVIEW_MARGEN = 8;

    const mostrarPreview = (ev, ej) => {
        const tipo = tipoDePreview(ej.media_url);
        if (!tipo) {
            setPreviewHover(null);
            return;
        }
        const rect = ev.currentTarget.getBoundingClientRect();
        const entraADerecha = rect.right + PREVIEW_MARGEN + PREVIEW_ANCHO <= window.innerWidth - PREVIEW_MARGEN;
        const entraAIzquierda = rect.left - PREVIEW_MARGEN - PREVIEW_ANCHO >= PREVIEW_MARGEN;

        let left;
        let top;
        if (entraADerecha) {
            left = rect.right + PREVIEW_MARGEN;
            top = rect.top;
        } else if (entraAIzquierda) {
            left = rect.left - PREVIEW_ANCHO - PREVIEW_MARGEN;
            top = rect.top;
        } else {
            // No hay lugar a ningún costado (fila casi tan ancha como la
            // pantalla): mostrar debajo, pegado al borde izquierdo de la fila.
            left = rect.left;
            top = rect.bottom + PREVIEW_MARGEN;
        }

        left = Math.max(PREVIEW_MARGEN, Math.min(left, window.innerWidth - PREVIEW_ANCHO - PREVIEW_MARGEN));
        top = Math.max(PREVIEW_MARGEN, Math.min(top, window.innerHeight - PREVIEW_ALTO - PREVIEW_MARGEN));

        setPreviewHover({ ej, tipo, top, left });
    };

    const ocultarPreview = () => setPreviewHover(null);

    // Agrega de una todos los ejercicios tildados, en el orden en que se ven
    // en la lista (alfabético) para que sea predecible; después se pueden
    // reordenar con las flechas. El índice va en la key porque Date.now()
    // devuelve lo mismo para todos los del mismo click y React necesita
    // keys distintas.
    const agregarItems = () => {
        const elegidos = ejercicios.filter((e) => ejsElegidos.has(e.id));
        if (elegidos.length === 0) return;
        const ahora = Date.now();
        // Si se tildó más de uno, van con el mismo comboId: es la señal de
        // que se cargaron juntos a propósito (ej. una superserie) y las
        // pantallas de solo lectura (MiPlanPage, AlumnoPage, el PDF) los
        // combinan en una sola tarjeta — ver agruparCombos() en format.js.
        // Cargar uno solo, o los mismos ejercicios pero en clicks
        // separados, NO genera combo: quedan como tarjetas independientes,
        // aunque compartan el mismo bloque.
        const comboId = elegidos.length > 1 ? `combo-${ahora}` : null;
        setItems((prev) => [
            ...prev,
            ...elegidos.map((ej, i) => ({
                key: `${ej.id}-${ahora}-${i}`,
                ejercicioId: ej.id,
                nombre: ej.nombre,
                // Copia ya "aplanada" a string: rutinas.items es una foto fija
                // tomada al armar la rutina (no un join en vivo contra
                // ejercicios), así que MiPlanPage/AlumnoPage siguen mostrando
                // `it.grupo` como texto sin enterarse de que ahora puede ser
                // más de un grupo.
                grupo: (ej.grupo_muscular || []).join(', '),
                semana: Number(semana) || 1,
                dia,
                bloque: bloque.trim(),
                comboId,
                series: 4,
                reps: 10,
                peso: '',
                descanso: '60 s',
                intensidad: '',
                comentario: '',
            })),
        ]);
        // Se limpia la selección para no agregar dos veces sin querer, pero se
        // dejan semana/día/bloque: lo normal es seguir cargando el mismo día.
        setEjsElegidos(new Set());
    };
    // Descanso/intensidad/bloque/comentario son del combo entero, no de cada
    // ejercicio (el descanso pasa una sola vez, al terminar los dos
    // ejercicios de la vuelta) — así que en un combo se editan como un solo
    // campo compartido y el cambio se propaga a todos los que tengan el
    // mismo comboId. Series/reps/peso siguen siendo por ejercicio: son
    // justo lo que puede diferir (Búlgara 8 reps c/pierna, Peso Muerto 10).
    const CAMPOS_COMPARTIDOS_EN_COMBO = ['descanso', 'intensidad', 'bloque', 'comentario'];

    const editarItem = (key, campo, valor) =>
        setItems((prev) => {
            const item = prev.find((it) => it.key === key);
            const propagar = item?.comboId && CAMPOS_COMPARTIDOS_EN_COMBO.includes(campo);
            return prev.map((it) => {
                if (it.key === key) return { ...it, [campo]: valor };
                if (propagar && it.comboId === item.comboId) return { ...it, [campo]: valor };
                return it;
            });
        });

    // Mueve un ejercicio dentro de su propio día (y semana): busca el vecino
    // en ese grupo y los intercambia en el array plano. Si ya es el primero
    // o el último del día, no hace nada.
    const moverItem = (key, direccion) => {
        setItems((prev) => {
            const item = prev.find((x) => x.key === key);
            if (!item) return prev;
            const grupo = prev.filter((x) => semanaDeItem(x) === semanaDeItem(item) && x.dia === item.dia);
            const pos = grupo.findIndex((x) => x.key === key);
            const vecino = grupo[pos + direccion];
            if (!vecino) return prev;
            const copia = [...prev];
            const i = copia.findIndex((x) => x.key === key);
            const j = copia.findIndex((x) => x.key === vecino.key);
            [copia[i], copia[j]] = [copia[j], copia[i]];
            return copia;
        });
    };

    const ejerciciosFiltrados = useMemo(
        () =>
            filtroEj.trim()
                ? ejercicios.filter((e) => e.nombre?.toLowerCase().includes(filtroEj.trim().toLowerCase()))
                : ejercicios,
        [ejercicios, filtroEj],
    );

    // Los ejercicios del día (y semana, si la rutina usa varias) que se está
    // editando ahora mismo — es lo que arma la card de "día activo": lista +
    // buscador para seguir sumando, todo en un solo lugar.
    const itemsDelDiaActivo = useMemo(
        () => items.filter((it) => it.dia === dia && semanaDeItem(it) === Number(semana)),
        [items, dia, semana],
    );
    const totalSemanas = Math.max(1, Number(form.duracion_semanas) || 1);
    // NO alcanza con "dura más de una semana" -- eso solo significa que el
    // mismo día se repite esa cantidad de semanas. El selector de semana
    // (y filtrar los items por semana) solo aparece si además se prendió
    // "cada semana tiene ejercicios distintos" a propósito.
    const usaSemanas = totalSemanas > 1 && semanasDistintas;

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                nombre: form.nombre,
                descripcion: form.descripcion,
                duracion_semanas: Number(form.duracion_semanas || 0),
                items,
            };
            if (editId) await updateRec('rutinas', editId, payload);
            else await createRec('rutinas', payload);
            setOpen(false);
            cargar();
        } catch (_) {
            setError('No se pudo guardar la rutina.');
        } finally {
            setSaving(false);
        }
    };

    // Duplicar sirve para versionar sin miedo: se copia tal cual con "(copia)"
    // en el nombre y NADIE queda asignado a la copia — las asignaciones son de
    // la rutina original, así que el profe puede tocar la copia tranquilo.
    const duplicar = async (r) => {
        try {
            await createRec('rutinas', {
                nombre: `${r.nombre} (copia)`,
                descripcion: r.descripcion,
                duracion_semanas: r.duracion_semanas,
                items: (r.items || []).map((it, i) => ({ ...it, key: `${it.ejercicioId}-copia-${Date.now()}-${i}` })),
            });
            cargar();
        } catch (_) {
            setError('No se pudo duplicar la rutina.');
        }
    };

    const abrirPdfModal = (r) => {
        setPdfModalRutina(r);
        setPdfModo('alumno');
        setPdfAlumnoId('');
        setPdfAlumnoNombre('');
        setPdfFechaInicio(hoy());
        setPdfFechaFin('');
        setPdfError('');
        setPdfConflicto(null);
    };

    // Se dispara print() en el mismo click que cierra el modal (con
    // requestAnimationFrame para que el DOM ya tenga la rutina montada), no
    // desde un useEffect, así no depende de que 'afterprint' llegue a
    // dispararse. Antes de imprimir, si el modo es "alumno registrado" y
    // todavía no tiene esta rutina asignada, se crea la asignación de
    // verdad -- eso es lo que pidió Nalux (03/09/2026): elegir un alumno ya
    // cargado no es solo para el nombre del PDF, también lo deja
    // registrado con seguimiento. Si ya la tenía asignada, no se duplica.
    //
    // Si tiene OTRA rutina activa, no se pisa en silencio: el primer click
    // corta acá y muestra el cartel de conflicto (pdfConflicto) en vez de
    // asignar e imprimir -- recién con "Reemplazar y generar PDF" (que
    // vuelve a llamar a esta misma función, ya con pdfConflicto puesto) se
    // desactiva la vieja y sigue.
    const confirmarPdf = async () => {
        if (pdfModo === 'alumno' && !pdfAlumnoId) return;
        setPdfError('');

        if (pdfModo === 'alumno') {
            const yaAsignado = asignadasActivas.some(
                (x) => x.rutina_id === pdfModalRutina.id && x.alumno_id === pdfAlumnoId,
            );
            if (!yaAsignado) {
                if (!pdfConflicto) {
                    const otra = asignadasActivas.find(
                        (x) => x.alumno_id === pdfAlumnoId && x.rutina_id !== pdfModalRutina.id,
                    );
                    if (otra) {
                        setPdfConflicto({
                            asignacionId: otra.id,
                            // El nombre sale de la copia de la asignación: es lo que el
                            // alumno tiene de verdad hoy, aunque esa rutina se haya
                            // renombrado o borrado de la biblioteca desde entonces.
                            nombreRutina: otra.rutina_nombre || 'otra rutina',
                        });
                        return;
                    }
                }
                setPdfAsignando(true);
                try {
                    if (pdfConflicto) {
                        await updateRec('rutinas_asignadas', pdfConflicto.asignacionId, { activa: false });
                    }
                    await createRec('rutinas_asignadas', snapshotRutina(pdfModalRutina, {
                        alumno_id: pdfAlumnoId,
                        fecha_inicio: pdfFechaInicio || hoy(),
                        fecha_fin: pdfFechaFin || null,
                    }));
                    cargar();
                } catch (_) {
                    setPdfAsignando(false);
                    setPdfError('No se pudo asignar la rutina a ese alumno. Intentar de nuevo.');
                    return;
                }
                setPdfAsignando(false);
            }
        }

        setPdfConflicto(null);
        setRutinaImprimiendo(pdfModalRutina);
        setPdfModalRutina(null);
        requestAnimationFrame(async () => {
            await esperarImagenesCargadas('.rutina-pdf-hoja img');
            window.print();
            setRutinaImprimiendo(null);
        });
    };

    // Desde la migración 0026 el FK es ON DELETE SET NULL y cada asignación
    // tiene su propia copia del contenido: borrar la plantilla de la
    // biblioteca ya NO le saca la rutina al alumno que la tenía, la sigue
    // viendo igual. Se avisa igual a cuántos alcanza, porque a partir de ahí
    // esa rutina deja de poder asignarse a alguien nuevo.
    const borrar = async (r) => {
        const asignados = contarAsignados(r.id);
        const plural = asignados === 1 ? '' : 's';
        const mensaje =
            asignados > 0
                ? `Esta rutina está asignada a ${asignados} alumno${plural} activo${plural}. Ese${plural} alumno${plural} la sigue${asignados === 1 ? '' : 'n'} teniendo tal como está hoy, pero la rutina desaparece de la biblioteca y no se va a poder asignar de nuevo. ¿Igual se quiere borrar?`
                : '¿Seguro que se quiere borrar esta rutina?';
        if (!window.confirm(mensaje)) return;
        await removeRec('rutinas', r.id);
        cargar();
    };

    const abrirAsignar = (r) => {
        setRutinaAsignando(r);
        setSeleccionados(new Set());
        setAsignarMsg('');
        setFechaInicioAsig(hoy());
        setFechaFinAsig('');
        setConfirmandoQuitarId(null);
        setConflictoAlumnos(null);
        setAsignarOpen(true);
    };

    const toggleAlumno = (alumnoId) => {
        // Si venía mostrando el cartel de conflicto, cualquier cambio en la
        // selección lo invalida -- se recalcula de cero al tocar "Asignar"
        // de nuevo, así nunca queda desactualizado.
        setConflictoAlumnos(null);
        setSeleccionados((prev) => {
            const next = new Set(prev);
            if (next.has(alumnoId)) next.delete(alumnoId);
            else next.add(alumnoId);
            return next;
        });
    };

    // Asignación masiva real: una fila en rutinas_asignadas por cada alumno
    // tildado, todas en paralelo, todas con la misma fecha de inicio/fin —
    // es una sola acción, tiene sentido que arranquen juntos. fecha_fin es
    // opcional (Nalux pidió poder ponerla para que el dashboard avise
    // cuando se acerca o se pasa, pero no todos los planes tienen fecha de
    // corte fija) — si se deja vacía, esa asignación nunca cuenta como
    // "por vencer" ni "vencida", no se inventa una fecha por default.
    //
    // idsAReemplazar: asignaciones viejas (de otra rutina) que hay que
    // desactivar primero -- si no, el alumno queda con dos rutinas activas
    // a la vez.
    const ejecutarAsignacion = async (ids, idsAReemplazar = []) => {
        setAsignando(true);
        setAsignarMsg('');
        try {
            if (idsAReemplazar.length > 0) {
                await Promise.all(
                    idsAReemplazar.map((asignacionId) =>
                        updateRec('rutinas_asignadas', asignacionId, { activa: false }),
                    ),
                );
            }
            await Promise.all(
                ids.map((alumnoId) =>
                    createRec('rutinas_asignadas', snapshotRutina(rutinaAsignando, {
                        alumno_id: alumnoId,
                        fecha_inicio: fechaInicioAsig || hoy(),
                        fecha_fin: fechaFinAsig || null,
                    })),
                ),
            );
            setAsignarMsg(`Rutina asignada a ${ids.length} alumno${ids.length === 1 ? '' : 's'}.`);
            setSeleccionados(new Set());
            setConflictoAlumnos(null);
            cargar();
        } catch (_) {
            setAsignarMsg('No se pudo completar la asignación. Intentar de nuevo.');
        } finally {
            setAsignando(false);
        }
    };

    // Primer click en "Asignar": si entre los tildados hay alguno con otra
    // rutina activa, corta y muestra el cartel en vez de asignar derecho.
    const iniciarAsignacion = () => {
        if (!rutinaAsignando || seleccionados.size === 0) return;
        const conflictos = Array.from(seleccionados)
            .map((alumnoId) => {
                const otra = asignadasActivas.find(
                    (x) => x.alumno_id === alumnoId && x.rutina_id !== rutinaAsignando.id,
                );
                if (!otra) return null;
                return {
                    alumnoId,
                    asignacionId: otra.id,
                    nombreAlumno: alumnosActivos.find((a) => a.id === alumnoId)?.nombre || 'Este alumno',
                    nombreRutina: otra.rutina_nombre || 'otra rutina',
                };
            })
            .filter(Boolean);
        if (conflictos.length > 0) {
            setConflictoAlumnos(conflictos);
            return;
        }
        ejecutarAsignacion(Array.from(seleccionados));
    };

    // "Reemplazar por esta": desactiva la rutina vieja de cada uno en
    // conflicto y asigna la nueva a TODOS los tildados (conflicto o no).
    const reemplazarConflictos = () => {
        ejecutarAsignacion(
            Array.from(seleccionados),
            conflictoAlumnos.map((c) => c.asignacionId),
        );
    };

    // "Dejarles la que tienen": los saca de la tanda (no se tocan) y asigna
    // solo al resto, si queda alguien.
    const omitirConflictos = () => {
        const idsConflicto = new Set(conflictoAlumnos.map((c) => c.alumnoId));
        const restantes = Array.from(seleccionados).filter((id) => !idsConflicto.has(id));
        setSeleccionados(new Set(restantes));
        setConflictoAlumnos(null);
        if (restantes.length > 0) ejecutarAsignacion(restantes);
    };

    // Reportado por Nalux (03/09/2026): en el modal de asignar no había forma
    // de deshacer un tilde equivocado, quedaba trabado como "ya la tiene
    // asignada" para siempre. Igual que "Quitar rutina" en AlumnoPage, NO se
    // borra la fila -- se desactiva (activa=false), así el historial de esa
    // asignación (aunque haya sido un error) no desaparece de la nada. Al
    // quedar inactiva, el checkbox de esa fila se vuelve a habilitar solo
    // (asignadasActivas ya no la incluye), lista para asignar de nuevo con
    // otras fechas si hacía falta "editarla".
    //
    // "Quitar" primero solo pide confirmación (confirmandoQuitarId) en vez de
    // usar window.confirm(): reportado por Nalux que el botón "no hacía
    // nada" -- el diálogo nativo del navegador puede quedar bloqueado o
    // suprimido según el navegador/dispositivo, y ahí un window.confirm()
    // que nunca se resuelve en true es indistinguible de "no pasa nada". Una
    // confirmación propia, dibujada por la app, no depende de eso.
    const [confirmandoQuitarId, setConfirmandoQuitarId] = useState(null);
    const [quitandoId, setQuitandoId] = useState(null);
    const quitarAsignacion = async (asignacionId) => {
        setConfirmandoQuitarId(null);
        setQuitandoId(asignacionId);
        setAsignarMsg('');
        try {
            await updateRec('rutinas_asignadas', asignacionId, { activa: false });
            cargar();
        } catch (_) {
            setAsignarMsg('No se pudo quitar la asignación. Intentar de nuevo.');
        } finally {
            setQuitandoId(null);
        }
    };

    const visibles = busqueda.trim()
        ? rutinas.filter((r) => r.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase()))
        : rutinas;

    return (
        <AppLayout
            title={
                <span className="inline-flex flex-wrap items-center gap-3">
                    Biblioteca de rutinas
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-bold normal-case text-primary">
                        {rutinas.length} {rutinas.length === 1 ? 'rutina' : 'rutinas'}
                    </span>
                </span>
            }
            subtitle="Armar cada rutina una sola vez y asignarla a todos los alumnos que la necesiten."
            actions={
                <Btn onClick={abrirNueva}>
                    <Plus className="h-4 w-4" /> Nueva rutina
                </Btn>
            }
        >
            <Helmet>
                <title>Biblioteca de rutinas | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Rutinas de entrenamiento reutilizables por gimnasio, con asignación masiva a alumnos."
                />
            </Helmet>

            {/* Imprimir UNA rutina sin tocar el resto de la página: se esconde
                todo y se deja visible solo la hoja. Es el truco clásico de
                visibility en vez de display, porque display:none en el body
                rompería el layout de lo que sí queremos imprimir. */}
            <style>{ESTILOS_IMPRESION_RUTINA}</style>

            <div className="mb-6 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar rutina por nombre"
                    aria-label="Buscar rutina por nombre"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
            </div>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={4} />
            ) : visibles.length === 0 ? (
                <Empty>
                    {rutinas.length === 0 ? (
                        <>Todavía no hay rutinas cargadas. Empezar con el botón &ldquo;Nueva rutina&rdquo;.</>
                    ) : (
                        'No hay rutinas que coincidan con la búsqueda.'
                    )}
                </Empty>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {visibles.map((r) => {
                        const asignados = contarAsignados(r.id);
                        const cantItems = (r.items || []).length;
                        const semanasUsadas = new Set((r.items || []).map(semanaDeItem)).size;
                        return (
                            <Card key={r.id}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                                            <ClipboardList className="h-5 w-5 text-primary" strokeWidth={2} />
                                        </span>
                                        <div>
                                            <p className="font-display text-base font-bold">{r.nombre}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {r.duracion_semanas
                                                    ? `${r.duracion_semanas} semana${r.duracion_semanas === 1 ? '' : 's'}`
                                                    : 'Duración libre'}
                                            </p>
                                        </div>
                                    </div>
                                    <Badge className={asignados > 0 ? 'text-ok border-current' : 'border-border text-muted-foreground'}>
                                        {asignados} alumno{asignados === 1 ? '' : 's'}
                                    </Badge>
                                </div>
                                {r.descripcion && (
                                    <p className="mt-3 text-sm text-muted-foreground">{r.descripcion}</p>
                                )}
                                <p className="mt-3 text-xs text-muted-foreground">
                                    {cantItems} ejercicio{cantItems === 1 ? '' : 's'} cargado{cantItems === 1 ? '' : 's'}
                                    {semanasUsadas > 1 ? ` · ${semanasUsadas} semanas distintas` : ''}
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirEditar(r)}>
                                        Editar
                                    </Btn>
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirAsignar(r)}>
                                        <UserPlus className="h-3.5 w-3.5" /> Asignar a alumnos
                                    </Btn>
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => duplicar(r)}>
                                        <Copy className="h-3.5 w-3.5" /> Duplicar
                                    </Btn>
                                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirPdfModal(r)}>
                                        <Printer className="h-3.5 w-3.5" /> PDF
                                    </Btn>
                                    <Btn variant="danger" className="px-3 py-2 text-xs" onClick={() => borrar(r)}>
                                        Eliminar
                                    </Btn>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* PDF de la plantilla: como desde la biblioteca no hay ningún
                alumno asignado en firme (una misma rutina puede estar en uso
                por varios, cada uno con sus propias fechas), el modal de
                abajo pregunta para quién es esta copia y sus fechas antes de
                generarlo -- si se deja todo en blanco, sale como plantilla
                genérica, sin nombre ni fechas. */}
            {rutinaImprimiendo && (
                <RutinaImprimiblePDF
                    nombre={rutinaImprimiendo.nombre}
                    items={rutinaImprimiendo.items}
                    color={gimnasio?.color_principal}
                    logoUrl={gimnasio?.logo_url}
                    alumnoNombre={pdfAlumnoNombre}
                    fechaInicio={pdfFechaInicio}
                    fechaFin={pdfFechaFin}
                    duracionSemanas={rutinaImprimiendo.duracion_semanas}
                />
            )}

            <Modal
                open={!!pdfModalRutina}
                onClose={() => setPdfModalRutina(null)}
                title={pdfModalRutina ? `PDF de "${pdfModalRutina.nombre}"` : 'PDF'}
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
                                ? 'Al generar el PDF, la rutina queda asignada a ese alumno con estas fechas (si ya la tenía asignada, no se duplica).'
                                : 'Nombre libre: el PDF sale con ese nombre, pero no queda asignado a nadie ni con seguimiento.'}
                        </span>
                    )}

                    {/* Mismo cartel de conflicto que "Asignar a alumnos", para un solo
                        alumno: pedido de Nalux (03/09/2026). */}
                    {pdfConflicto && (
                        <div className="space-y-3 rounded-xl border border-warn bg-warn/10 p-4">
                            <p className="text-sm font-semibold">
                                {pdfAlumnoNombre || 'Este alumno'} ya tiene una rutina asignada: "
                                {pdfConflicto.nombreRutina}".
                            </p>
                            <p className="text-xs text-muted-foreground">
                                ¿Le dejamos la que tiene, o se la reemplazamos por "{pdfModalRutina?.nombre}"?
                            </p>
                            <div className="flex flex-wrap justify-end gap-2 pt-1">
                                <Btn variant="ghost" disabled={pdfAsignando} onClick={() => setPdfConflicto(null)}>
                                    Dejarle la que tiene
                                </Btn>
                                <Btn disabled={pdfAsignando} onClick={confirmarPdf}>
                                    {pdfAsignando ? 'Reemplazando...' : 'Reemplazar y generar PDF'}
                                </Btn>
                            </div>
                        </div>
                    )}

                    {pdfError && <p className="text-sm text-destructive">{pdfError}</p>}

                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setPdfModalRutina(null)}>
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

            <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Editar rutina' : 'Nueva rutina'} wide>
                <form onSubmit={guardar} className="space-y-5">
                    {/* Desde la migración 0026 la asignación guarda su propia copia
                        (pedido de Nalux, 04/09/2026) -- editar acá ya no le cambia
                        la rutina a nadie sin avisar, pero justamente por eso hay
                        que decir cómo se le actualiza a un alumno si se quiere. */}
                    {editId && contarAsignados(editId) > 0 && (
                        <p className="rounded-xl border border-border bg-secondary px-4 py-3 text-xs text-muted-foreground">
                            Esta rutina la tienen {contarAsignados(editId)} alumno
                            {contarAsignados(editId) === 1 ? '' : 's'}. Lo que se cambie acá{' '}
                            <span className="font-semibold text-foreground">no les cambia la rutina</span> que ya
                            están haciendo: para pasarles esta versión, hay que volver a asignársela.
                        </p>
                    )}
                    <Card>
                        <div className="grid gap-4 sm:grid-cols-[2fr,1fr]">
                            <Field label="Nombre de la rutina">
                                <Input
                                    value={form.nombre}
                                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                                    required
                                />
                            </Field>
                            <Field label="Duración (semanas)">
                                <Input
                                    type="number"
                                    min="1"
                                    value={form.duracion_semanas}
                                    onChange={(e) => setForm({ ...form, duracion_semanas: e.target.value })}
                                />
                                <span className="text-xs text-muted-foreground">
                                    Los mismos días se repiten esa cantidad de semanas.
                                </span>
                            </Field>
                        </div>

                        {totalSemanas > 1 && (
                            <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                                <input
                                    type="checkbox"
                                    checked={semanasDistintas}
                                    onChange={(e) => setSemanasDistintas(e.target.checked)}
                                    className="h-4 w-4 rounded border-border"
                                />
                                Cada semana tiene ejercicios distintos
                            </label>
                        )}

                        <div className="mt-4">
                            <Field label="Descripción">
                                <Textarea
                                    value={form.descripcion}
                                    onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                                />
                            </Field>
                        </div>

                        {ejercicios.length === 0 ? (
                            <div className="mt-4">
                                <Empty>
                                    Primero cargar ejercicios en la{' '}
                                    <Link to="/ejercicios" className="font-semibold text-primary">
                                        biblioteca
                                    </Link>
                                    .
                                </Empty>
                            </div>
                        ) : (
                            <div className="mt-4 space-y-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Día de la rutina
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {diasRutina.map((d) => {
                                        const cuantos = items.filter(
                                            (it) => it.dia === d && semanaDeItem(it) === Number(semana),
                                        ).length;
                                        return (
                                            <button
                                                key={d}
                                                type="button"
                                                onClick={() => {
                                                    setDia(d);
                                                    setBloque('');
                                                }}
                                                aria-pressed={dia === d}
                                                className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                                                    dia === d
                                                        ? 'border-primary bg-primary text-primary-foreground'
                                                        : 'border-border text-muted-foreground hover:text-foreground'
                                                }`}
                                            >
                                                {d}
                                                {cuantos > 0 ? ` (${cuantos})` : ''}
                                            </button>
                                        );
                                    })}
                                    {diasRutina.length < DIAS.length && (
                                        <button
                                            type="button"
                                            onClick={agregarDia}
                                            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"
                                        >
                                            <Plus className="h-3.5 w-3.5" /> Agregar día
                                        </button>
                                    )}
                                </div>

                                {usaSemanas && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Semana
                                        </p>
                                        {Array.from({ length: totalSemanas }, (_, i) => i + 1).map((s) => (
                                            <button
                                                key={s}
                                                type="button"
                                                onClick={() => setSemana(s)}
                                                aria-pressed={semana === s}
                                                className={`h-8 w-8 rounded-full border text-xs font-semibold transition ${
                                                    semana === s
                                                        ? 'border-primary bg-primary text-primary-foreground'
                                                        : 'border-border text-muted-foreground hover:text-foreground'
                                                }`}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>

                    {ejercicios.length > 0 && (
                        <Card>
                            <div className="mb-4 flex items-center justify-between">
                                <h3 className="font-display text-lg font-bold uppercase">
                                    {dia}
                                    {usaSemanas ? ` · Semana ${semana}` : ''}
                                </h3>
                                <Badge className="border-border text-muted-foreground">
                                    {itemsDelDiaActivo.length} ejercicio{itemsDelDiaActivo.length === 1 ? '' : 's'}
                                </Badge>
                            </div>

                            {/* Ejercicios ya cargados para el día (y semana) activos, agrupados
                                por bloque. El buscador para seguir agregando queda pegado justo
                                debajo de esto, en la misma tarjeta — a medida que se suman
                                ejercicios, el buscador se corre hacia abajo con ellos, nunca queda
                                separado arriba del bloque que se está armando. */}
                            {itemsDelDiaActivo.length > 0 && (
                                <div className="mb-5 space-y-4">
                                    {agruparPorBloque(itemsDelDiaActivo).map(([nombreBloque, delBloque], iBloque) => (
                                        <div key={`${nombreBloque}-${iBloque}`} className="space-y-3">
                                            {nombreBloque && (
                                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                    {nombreBloque}
                                                </p>
                                            )}
                                            {agruparPorCombo(delBloque).map((grupoCombo) =>
                                                grupoCombo.length === 1 ? (
                                                    (() => {
                                                        const it = grupoCombo[0];
                                                        const enGrupo = itemsDelDiaActivo.findIndex(
                                                            (x) => x.key === it.key,
                                                        );
                                                        return (
                                                            <div key={it.key} className="rounded-xl border border-border p-3">
                                                                <div className="grid items-end gap-3 sm:grid-cols-[2fr,repeat(4,minmax(0,1fr)),auto]">
                                                                    <div>
                                                                        <p className="text-sm font-bold">{it.nombre}</p>
                                                                        <p className="text-xs text-muted-foreground">
                                                                            {it.grupo}
                                                                        </p>
                                                                    </div>
                                                                    <Field label="Series">
                                                                        <Input
                                                                            type="number"
                                                                            value={it.series}
                                                                            onChange={(e) =>
                                                                                editarItem(it.key, 'series', e.target.value)
                                                                            }
                                                                        />
                                                                    </Field>
                                                                    <Field label="Reps">
                                                                        <Input
                                                                            value={it.reps}
                                                                            onChange={(e) =>
                                                                                editarItem(it.key, 'reps', e.target.value)
                                                                            }
                                                                        />
                                                                    </Field>
                                                                    <Field label="Peso">
                                                                        <Input
                                                                            value={it.peso}
                                                                            onChange={(e) =>
                                                                                editarItem(it.key, 'peso', e.target.value)
                                                                            }
                                                                            placeholder="kg"
                                                                        />
                                                                    </Field>
                                                                    <Field label="Descanso">
                                                                        <Input
                                                                            value={it.descanso}
                                                                            onChange={(e) =>
                                                                                editarItem(it.key, 'descanso', e.target.value)
                                                                            }
                                                                        />
                                                                    </Field>
                                                                    <div className="mb-1 flex gap-1">
                                                                        <button
                                                                            type="button"
                                                                            aria-label="Subir ejercicio"
                                                                            disabled={enGrupo === 0}
                                                                            onClick={() => moverItem(it.key, -1)}
                                                                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border disabled:opacity-30"
                                                                        >
                                                                            <ArrowUp className="h-4 w-4" />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            aria-label="Bajar ejercicio"
                                                                            disabled={enGrupo === itemsDelDiaActivo.length - 1}
                                                                            onClick={() => moverItem(it.key, 1)}
                                                                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border disabled:opacity-30"
                                                                        >
                                                                            <ArrowDown className="h-4 w-4" />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            aria-label="Quitar ejercicio"
                                                                            onClick={() =>
                                                                                setItems(items.filter((x) => x.key !== it.key))
                                                                            }
                                                                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-primary"
                                                                        >
                                                                            <Trash2 className="h-4 w-4" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr,1fr,2fr]">
                                                                    <Field label="Intensidad">
                                                                        <Input
                                                                            value={it.intensidad || ''}
                                                                            onChange={(e) =>
                                                                                editarItem(it.key, 'intensidad', e.target.value)
                                                                            }
                                                                            placeholder="RPE 8, suave..."
                                                                        />
                                                                    </Field>
                                                                    <Field label="Bloque">
                                                                        <Input
                                                                            list="bloques-sugeridos"
                                                                            value={it.bloque || ''}
                                                                            onChange={(e) =>
                                                                                editarItem(it.key, 'bloque', e.target.value)
                                                                            }
                                                                            placeholder="Sin bloque"
                                                                        />
                                                                    </Field>
                                                                    <Field label="Comentario para el alumno">
                                                                        <Input
                                                                            value={it.comentario || ''}
                                                                            onChange={(e) =>
                                                                                editarItem(it.key, 'comentario', e.target.value)
                                                                            }
                                                                            placeholder="Bajar despacio, sin trabar los codos..."
                                                                        />
                                                                    </Field>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()
                                                ) : (
                                                    // Superserie: cada ejercicio en su propia caja chica, uno al lado
                                                    // del otro (Nalux fue explícita con esto: "un ejercicio al lado
                                                    // del otro", cajas chicas para que entre todo). Series/reps/peso
                                                    // son de cada uno; descanso/intensidad/bloque/comentario se editan
                                                    // una sola vez para todo el combo (editarItem() ya lo propaga a
                                                    // los dos vía comboId).
                                                    //
                                                    // Ancho fijo + flex-wrap, NO flex-1: reportado por Nalux
                                                    // (03/09/2026) que al agregar 4 ejercicios "solo se ven 3" en
                                                    // pantalla grande -- con flex-1, el ejercicio que sobra solo en
                                                    // la última fila se estira para ocupar TODA la fila (una caja
                                                    // gigante rota, nada que ver con sus hermanas chicas). Sin
                                                    // grow, cada caja mide siempre lo mismo entren las que entren
                                                    // por fila. Se volvió de grid a flex (04/09/2026) para poder
                                                    // meter el "+" entre caja y caja, como pidió Nalux: "que se vea
                                                    // igual que en la ficha del alumno" (ver AlumnoPage.jsx).
                                                    //
                                                    // El "+" y la caja que lo sigue van en un mismo hijo del flex
                                                    // (no dos hijos sueltos) -- si no, al saltar de línea el "+"
                                                    // puede quedar solo, colgando al final de la fila de arriba, y
                                                    // la caja que le correspondía arranca la fila de abajo sin
                                                    // separador visible (bug encontrado en revisión, 04/09/2026).
                                                    <div
                                                        key={grupoCombo[0].comboId}
                                                        className="space-y-3 rounded-xl border-2 border-primary/30 p-3"
                                                    >
                                                        <p className="text-xs font-bold uppercase tracking-wide text-primary">
                                                            Superserie
                                                        </p>
                                                        <div className="flex flex-wrap items-stretch gap-2">
                                                            {grupoCombo.map((it, iCombo) => (
                                                                <div key={it.key} className="flex shrink-0 items-stretch gap-2">
                                                                {iCombo > 0 && (
                                                                    <span
                                                                        className="flex shrink-0 items-center text-sm font-bold text-primary"
                                                                        aria-hidden="true"
                                                                    >
                                                                        +
                                                                    </span>
                                                                )}
                                                                <div className="w-[9.5rem] max-w-full shrink-0 grow-0 rounded-lg border border-border p-2">
                                                                    <div className="mb-1.5 flex items-start justify-between gap-1">
                                                                        <p className="text-xs font-bold leading-tight">
                                                                            {it.nombre}
                                                                        </p>
                                                                        <button
                                                                            type="button"
                                                                            aria-label={`Quitar ${it.nombre}`}
                                                                            onClick={() =>
                                                                                setItems(
                                                                                    items.filter((x) => x.key !== it.key),
                                                                                )
                                                                            }
                                                                            className="shrink-0 text-primary"
                                                                        >
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-1">
                                                                        <Field label="Series">
                                                                            <Input
                                                                                type="number"
                                                                                value={it.series}
                                                                                onChange={(e) =>
                                                                                    editarItem(
                                                                                        it.key,
                                                                                        'series',
                                                                                        e.target.value,
                                                                                    )
                                                                                }
                                                                                className="px-2 py-1.5 text-xs"
                                                                            />
                                                                        </Field>
                                                                        <Field label="Reps">
                                                                            <Input
                                                                                value={it.reps}
                                                                                onChange={(e) =>
                                                                                    editarItem(it.key, 'reps', e.target.value)
                                                                                }
                                                                                className="px-2 py-1.5 text-xs"
                                                                            />
                                                                        </Field>
                                                                        <Field label="Peso">
                                                                            <Input
                                                                                value={it.peso}
                                                                                onChange={(e) =>
                                                                                    editarItem(it.key, 'peso', e.target.value)
                                                                                }
                                                                                placeholder="kg"
                                                                                className="px-2 py-1.5 text-xs"
                                                                            />
                                                                        </Field>
                                                                    </div>
                                                                </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="grid gap-3 sm:grid-cols-[1fr,1fr,2fr]">
                                                            <Field label="Descanso (compartido)">
                                                                <Input
                                                                    value={grupoCombo[0].descanso}
                                                                    onChange={(e) =>
                                                                        editarItem(
                                                                            grupoCombo[0].key,
                                                                            'descanso',
                                                                            e.target.value,
                                                                        )
                                                                    }
                                                                />
                                                            </Field>
                                                            <Field label="Intensidad (compartida)">
                                                                <Input
                                                                    value={grupoCombo[0].intensidad || ''}
                                                                    onChange={(e) =>
                                                                        editarItem(
                                                                            grupoCombo[0].key,
                                                                            'intensidad',
                                                                            e.target.value,
                                                                        )
                                                                    }
                                                                    placeholder="RPE 8, suave..."
                                                                />
                                                            </Field>
                                                            <Field label="Comentario para el alumno">
                                                                <Input
                                                                    value={grupoCombo[0].comentario || ''}
                                                                    onChange={(e) =>
                                                                        editarItem(
                                                                            grupoCombo[0].key,
                                                                            'comentario',
                                                                            e.target.value,
                                                                        )
                                                                    }
                                                                    placeholder="Sin descanso entre los dos, después de la vuelta..."
                                                                />
                                                            </Field>
                                                        </div>
                                                    </div>
                                                ),
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Buscador para seguir sumando ejercicios a ESTE día (y bloque).
                                A propósito vive acá abajo, no arriba de todo el formulario: es lo
                                que se toca una y otra vez mientras se arma el día, así que
                                conviene que quede pegado a lo que se está armando. */}
                            <div className="space-y-3 border-t border-border pt-4">
                                <Field label="Agregar ejercicios a este día">
                                    <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2">
                                        <Search
                                            className="h-4 w-4 shrink-0 text-muted-foreground"
                                            aria-hidden="true"
                                        />
                                        <input
                                            value={filtroEj}
                                            onChange={(e) => setFiltroEj(e.target.value)}
                                            placeholder="Buscar ejercicio"
                                            aria-label="Buscar ejercicio en la biblioteca"
                                            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                                        />
                                    </div>
                                    <div className="max-h-48 overflow-y-auto rounded-xl border border-border">
                                        {ejerciciosFiltrados.length === 0 ? (
                                            <p className="px-3 py-4 text-sm text-muted-foreground">
                                                Ningún ejercicio coincide con esa búsqueda.
                                            </p>
                                        ) : (
                                            <ul className="divide-y divide-border">
                                                {ejerciciosFiltrados.map((e) => (
                                                    <li
                                                        key={e.id}
                                                        className="flex items-center gap-3 px-3 py-2"
                                                        onMouseEnter={(ev) => mostrarPreview(ev, e)}
                                                        onMouseLeave={ocultarPreview}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            id={`ej-${e.id}`}
                                                            checked={ejsElegidos.has(e.id)}
                                                            onChange={() => toggleEjercicio(e.id)}
                                                            className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                                                        />
                                                        <label
                                                            htmlFor={`ej-${e.id}`}
                                                            className="flex-1 cursor-pointer text-sm"
                                                        >
                                                            {e.nombre}
                                                            {(e.grupo_muscular || []).length > 0 && (
                                                                <span className="text-muted-foreground">
                                                                    {' · '}
                                                                    {(e.grupo_muscular || []).join(', ')}
                                                                </span>
                                                            )}
                                                        </label>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                        Marcar varios para agregarlos todos juntos, uno detrás del otro — si van
                                        en superserie, ponerlos en el mismo bloque.
                                    </span>
                                </Field>
                                <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
                                    <Field label="Bloque (opcional)">
                                        <Input
                                            list="bloques-sugeridos"
                                            value={bloque}
                                            onChange={(e) => setBloque(e.target.value)}
                                            placeholder="Entrada en calor, Superserie..."
                                        />
                                        <datalist id="bloques-sugeridos">
                                            {BLOQUES_SUGERIDOS.map((b) => (
                                                <option key={b} value={b} />
                                            ))}
                                        </datalist>
                                    </Field>
                                    <div className="flex items-end">
                                        <Btn
                                            type="button"
                                            onClick={agregarItems}
                                            disabled={ejsElegidos.size === 0}
                                            className="w-full sm:w-auto"
                                        >
                                            <Plus className="h-4 w-4" />
                                            {ejsElegidos.size > 0 ? `Agregar (${ejsElegidos.size})` : 'Agregar'}
                                        </Btn>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpen(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar rutina'}
                        </Btn>
                    </div>
                </form>
            </Modal>

            {open && previewHover && (
                <div
                    className="pointer-events-none fixed z-[60] w-44 overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
                    style={{ top: previewHover.top, left: previewHover.left }}
                >
                    {previewHover.tipo === 'imagen' ? (
                        <img
                            src={previewHover.ej.media_url}
                            alt=""
                            className="h-32 w-full object-cover"
                        />
                    ) : (
                        <video
                            src={previewHover.ej.media_url}
                            className="h-32 w-full object-cover"
                            muted
                            autoPlay
                            loop
                            playsInline
                        />
                    )}
                    <p className="truncate px-2 py-1.5 text-xs font-semibold">{previewHover.ej.nombre}</p>
                </div>
            )}

            <Modal
                open={asignarOpen}
                onClose={() => setAsignarOpen(false)}
                title={rutinaAsignando ? `Asignar "${rutinaAsignando.nombre}" a alumnos` : 'Asignar a alumnos'}
            >
                <div className="space-y-4">
                    {/* Reportado por Nalux (03/09/2026): las fechas arriba de todo,
                        antes de elegir a quién, confundían a los profes -- no quedaba
                        claro que esas fechas eran "para el/los que tildes abajo". Ahora
                        primero se elige alumno(s) y recién ahí (una vez tildado al
                        menos uno) se abren los campos de fecha, justo antes de guardar
                        todo junto con "Asignar". */}
                    {alumnosActivos.length === 0 ? (
                        <Empty>No hay alumnos activos para asignar.</Empty>
                    ) : (
                        <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
                            <ul className="divide-y divide-border">
                                {alumnosActivos.map((a) => {
                                    const asignacion = asignadasActivas.find(
                                        (x) => x.rutina_id === rutinaAsignando?.id && x.alumno_id === a.id,
                                    );
                                    // Otra rutina activa (distinta a esta) -- no bloquea el
                                    // tilde, solo avisa antes de que el profe lo elija: el
                                    // cartel de "reemplazar o dejar" recién sale al confirmar.
                                    const otra = !asignacion
                                        ? asignadasActivas.find(
                                              (x) => x.alumno_id === a.id && x.rutina_id !== rutinaAsignando?.id,
                                          )
                                        : null;
                                    const nombreOtra = otra ? otra.rutina_nombre : null;
                                    return (
                                        <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                                            <input
                                                type="checkbox"
                                                id={`asignar-alumno-${a.id}`}
                                                checked={seleccionados.has(a.id)}
                                                disabled={!!asignacion}
                                                onChange={() => toggleAlumno(a.id)}
                                                className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))] disabled:opacity-40"
                                            />
                                            <label
                                                htmlFor={`asignar-alumno-${a.id}`}
                                                className={`flex-1 text-sm ${asignacion ? 'text-muted-foreground' : 'cursor-pointer'}`}
                                            >
                                                {a.nombre}
                                                {asignacion && (
                                                    <span className="ml-2 text-xs">
                                                        (ya la tiene, desde el {fmtFecha(asignacion.fecha_inicio)}
                                                        {asignacion.fecha_fin ? ` hasta el ${fmtFecha(asignacion.fecha_fin)}` : ''})
                                                    </span>
                                                )}
                                                {nombreOtra && (
                                                    <span className="ml-2 text-xs text-warn">
                                                        (ya tiene: {nombreOtra})
                                                    </span>
                                                )}
                                            </label>
                                            {asignacion && confirmandoQuitarId === asignacion.id ? (
                                                <div className="flex shrink-0 items-center gap-1.5">
                                                    <span className="text-xs text-muted-foreground">¿Seguro?</span>
                                                    <Btn
                                                        type="button"
                                                        variant="danger"
                                                        className="px-2 py-1.5 text-xs"
                                                        disabled={quitandoId === asignacion.id}
                                                        onClick={() => quitarAsignacion(asignacion.id)}
                                                    >
                                                        {quitandoId === asignacion.id ? 'Quitando...' : 'Sí, quitar'}
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
                                                asignacion && (
                                                    <Btn
                                                        type="button"
                                                        variant="ghost"
                                                        className="shrink-0 px-2 py-1.5 text-xs text-primary"
                                                        onClick={() => setConfirmandoQuitarId(asignacion.id)}
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
                                vencer o se les venza la rutina. Sin fecha de fin, no hay aviso.
                            </span>
                        </div>
                    )}

                    {/* Cartel de conflicto: pedido de Nalux (03/09/2026) -- si algún
                        tildado ya tiene otra rutina activa, no se pisa en silencio. */}
                    {conflictoAlumnos && (
                        <div className="space-y-3 rounded-xl border border-warn bg-warn/10 p-4">
                            <p className="text-sm font-semibold">
                                {conflictoAlumnos.length === 1
                                    ? `${conflictoAlumnos[0].nombreAlumno} ya tiene una rutina asignada: "${conflictoAlumnos[0].nombreRutina}".`
                                    : `${conflictoAlumnos.length} alumnos ya tienen otra rutina asignada:`}
                            </p>
                            {conflictoAlumnos.length > 1 && (
                                <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                                    {conflictoAlumnos.map((c) => (
                                        <li key={c.alumnoId}>
                                            {c.nombreAlumno} — <span className="italic">{c.nombreRutina}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <p className="text-xs text-muted-foreground">
                                ¿Les dejamos la rutina que ya tienen, o se la reemplazamos por "
                                {rutinaAsignando?.nombre}"?
                            </p>
                            <div className="flex flex-wrap justify-end gap-2 pt-1">
                                <Btn variant="ghost" disabled={asignando} onClick={omitirConflictos}>
                                    Dejarles la que tienen
                                </Btn>
                                <Btn disabled={asignando} onClick={reemplazarConflictos}>
                                    {asignando ? 'Reemplazando...' : 'Reemplazar por esta'}
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
        </AppLayout>
    );
};

export default RutinasPage;
