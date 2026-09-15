// Helpers de UI (formato, constantes de dominio, estado de pagos). Separados
// de data.js a propósito: data.js es la capa de acceso a datos (Supabase),
// esto es presentación pura sin dependencias de red.

export const money = (n) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(
        Number(n || 0),
    );

export const hoy = () => new Date().toISOString().slice(0, 10);

export const fmtFecha = (v) => {
    if (!v) return '-';
    const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// "Sep '26" para las etiquetas del eje X del gráfico de ingresos mensuales
// (DashboardPage.jsx) -- corto a propósito, doce de estos en una fila no
// entran con el formato largo de fmtFecha(). v es "YYYY-MM-01" (lo que
// devuelve ingresos_por_mes() por cada mes de la serie).
export const fmtMes = (v) => {
    if (!v) return '';
    const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '';
    const mes = d.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '');
    const anio = d.toLocaleDateString('es-AR', { year: '2-digit' });
    return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} '${anio}`;
};

// "Lun 08" para las etiquetas del eje X del gráfico de asistencia diaria
// (DashboardPage.jsx, Fase 2.1). v es "YYYY-MM-DD". Corto a propósito, mismo
// criterio que fmtMes() -- 7 de estos en una fila no entran con fmtFecha().
export const fmtDiaCorto = (v) => {
    if (!v) return '';
    const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '';
    const dia = d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
    const num = d.toLocaleDateString('es-AR', { day: '2-digit' });
    return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${num}`;
};

// Texto que se usa como "opción" de una comida al elegir UNA comida (p. ej.
// "Desayuno") de un plan de la biblioteca reutilizable
// (PlanesAlimentacionPage.jsx, migración 0025) desde la ficha de un alumno
// (AlumnoPage.jsx, PlanAlimentacion) -- "Pollo (150g) + Arroz (100g)" en vez
// de guardar una referencia en vivo a la biblioteca: una vez elegido, queda
// como texto plano y el profesor lo puede seguir editando a mano para ESE
// alumno en particular, sin afectar el plan de la biblioteca ni el de otros
// alumnos que ya lo hayan usado. items = lista de alimentos de una sola
// comida (comida.alimentos), no el plan completo -- un plan de la
// biblioteca tiene varias comidas (Desayuno, Almuerzo...), cada una con su
// propia lista.
//
// Pedido de Nalux (04/09/2026): "si no sabemos que le gusta, le tenemos que
// poner arroz o atun o palta... tiene que estar bien aclarado" -- cada item
// puede tener `grupo` (varios alimentos con el mismo id de grupo son
// alternativas entre sí, el alumno elige uno) y/o `opcional` (ese alimento
// puntual no es obligatorio). Mismo criterio que comboId en rutinas.items
// para armar superseries -- un id compartido agrupa, no una estructura
// anidada, así se puede seguir reordenando/editando cada alimento suelto.
export const armarTextoAlimentos = (items) => {
    const lista = items || [];
    const gruposYaListados = new Set();
    const partes = [];
    lista.forEach((it) => {
        const conCantidad = (x) => (x.cantidad ? `${x.nombre} (${x.cantidad})` : x.nombre);
        if (it.grupo) {
            if (gruposYaListados.has(it.grupo)) return;
            gruposYaListados.add(it.grupo);
            const delGrupo = lista.filter((x) => x.grupo === it.grupo);
            partes.push(`elegir uno: ${delGrupo.map(conCantidad).join(' o ')}`);
        } else {
            const base = conCantidad(it);
            partes.push(it.opcional ? `${base} (opcional)` : base);
        }
    });
    return partes.filter(Boolean).join(' + ');
};

// ---------------------------------------------------------------------------
// Cálculo de macros de una comida (Fase 2.4, 13/09/2026). Se investigó
// primero: `alimentos.unidad` es texto TOTALMENTE libre en los datos reales
// ("100 g", "1 unidad", "1 cda", "1 scoop (30 g)"...), no una convención
// fija de "todo por 100g" -- así que estos helpers NO fuerzan ninguna
// conversión a gramos ni inventan equivalencias. En cambio, escalan los
// macros de CADA alimento contra SU PROPIA porción de referencia: si
// `unidad` empieza con un número (100 g -> 100), la cantidad que carga el
// profesor se toma en esas mismas unidades; si no tiene número (1 unidad,
// 1 scoop), se toma como "referencia = 1" y la cantidad es "cuántas veces
// esa porción". Nunca se calcula nada para un alimento sin macros cargados
// o un item sin cantidad numérica -- se cuenta aparte como "sin calcular"
// en vez de mostrar un número inventado.
// ---------------------------------------------------------------------------

// Primer número que aparece en un texto libre, coma o punto decimal. Mismo
// criterio que ya usa parsearDescanso() en MiPlanPage.jsx, separado acá
// porque hace falta en más de un lado.
export const primerNumero = (texto) => {
    if (texto === null || texto === undefined) return null;
    const m = String(texto).match(/(\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    const n = Number(m[1].replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

// Macros de UN item de comida, ya escalados a la cantidad que pidió el
// profesor. null si falta cualquier dato necesario -- alimento borrado de
// la biblioteca, sin macros cargados, o cantidad sin ningún número.
export const macrosDeItem = (item, alimentosPorId) => {
    const alimento = alimentosPorId?.get(item?.alimentoId);
    if (!alimento) return null;
    if (alimento.calorias === null || alimento.calorias === undefined) return null;
    const cantidadNum = primerNumero(item?.cantidad);
    if (cantidadNum === null) return null;
    const referencia = primerNumero(alimento.unidad) || 1;
    const factor = cantidadNum / referencia;
    return {
        kcal: Number(alimento.calorias || 0) * factor,
        proteinas: Number(alimento.proteinas || 0) * factor,
        carbohidratos: Number(alimento.carbohidratos || 0) * factor,
        grasas: Number(alimento.grasas || 0) * factor,
    };
};

// Macros de una comida entera: suma cada item calculable y cuenta cuántos
// quedaron afuera (para poder avisar "estimado, faltan N sin calcular" en
// vez de mostrar un total que parece exacto y no lo es). Los opcionales no
// suman -- no son parte necesaria de la comida. De un grupo de alternativas
// ("elegir uno: Pollo o Pescado") se toma solo la PRIMERA opción como
// estimación -- sumar todas contaría comida que el alumno no va a comer.
export const macrosDeComida = (comida, alimentosPorId) => {
    const gruposYaContados = new Set();
    const totales = { kcal: 0, proteinas: 0, carbohidratos: 0, grasas: 0 };
    let calculados = 0;
    let sinCalcular = 0;
    (comida?.alimentos || []).forEach((it) => {
        if (it.opcional) return;
        if (it.grupo) {
            if (gruposYaContados.has(it.grupo)) return;
            gruposYaContados.add(it.grupo);
        }
        const m = macrosDeItem(it, alimentosPorId);
        if (!m) {
            sinCalcular += 1;
            return;
        }
        calculados += 1;
        totales.kcal += m.kcal;
        totales.proteinas += m.proteinas;
        totales.carbohidratos += m.carbohidratos;
        totales.grasas += m.grasas;
    });
    if (calculados === 0) return null;
    return { ...totales, sinCalcular };
};

// Texto compacto para mostrar el resultado ("≈ 420 kcal · 35g prot · 45g
// carb · 12g grasas", con un "+ N sin calcular" si corresponde). Redondea a
// entero -- un decimal de proteína no aporta nada y hace más difícil leer
// rápido, que es para lo que sirve este resumen.
export const resumenMacros = (macros) => {
    if (!macros) return null;
    const r = (v) => Math.round(v);
    let texto = `≈ ${r(macros.kcal)} kcal · ${r(macros.proteinas)}g prot · ${r(macros.carbohidratos)}g carb · ${r(macros.grasas)}g grasas`;
    if (macros.sinCalcular > 0) {
        texto += ` (+ ${macros.sinCalcular} sin calcular)`;
    }
    return texto;
};

export const antiguedad = (fechaAlta) => {
    if (!fechaAlta) return 'Sin fecha de alta';
    const d = new Date(String(fechaAlta).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return 'Sin fecha de alta';
    const meses = Math.max(
        0,
        (new Date().getFullYear() - d.getFullYear()) * 12 + (new Date().getMonth() - d.getMonth()),
    );
    if (meses < 1) return 'Menos de 1 mes entrenando';
    if (meses < 12) return `${meses} ${meses === 1 ? 'mes' : 'meses'} entrenando`;
    const años = Math.floor(meses / 12);
    const resto = meses % 12;
    return `${años} ${años === 1 ? 'año' : 'años'}${resto ? ` y ${resto} m` : ''} entrenando`;
};

export const COMIDAS = ['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Colación'];

// Compartida entre el armador de rutinas (RutinasPage) y la vista de solo
// lectura del plan asignado (AlumnoPage) — mismo vocabulario de "día" en
// ambos lugares para que los items sean 100% compatibles entre sí.
export const DIAS = ['Día 1', 'Día 2', 'Día 3', 'Día 4', 'Día 5', 'Día 6'];

export const GRUPOS = ['Piernas', 'Espalda', 'Pecho', 'Hombros', 'Brazos', 'Core', 'Glúteos', 'Cardio'];

// Patrón de movimiento de un ejercicio (EjerciciosPage) — eje complementario
// al grupo muscular, no un reemplazo: un ejercicio tiene 1 sólo patrón
// principal (a diferencia de grupo_muscular, que puede ser varios), así que
// se guarda como un solo valor en ejercicios.clasificacion, no como array.
// A propósito no incluye músculos puntuales (Bíceps, Cuádriceps, etc.): eso
// ya lo cubre grupo_muscular, mezclar los dos ejes le sacaría el sentido a
// tener uno separado.
export const CLASIFICACIONES = [
    'Empuje horizontal',
    'Empuje vertical',
    'Tracción horizontal',
    'Tracción vertical',
    'Dominante de cadera',
    'Dominante de rodilla',
    'Dominante de tobillo',
    'Core',
    'Cardio',
    'Compuesto',
];

export const ESTADOS_PAGO = {
    al_dia: { label: 'Al día', className: 'text-ok border-current' },
    proximo: { label: 'Próximo a vencer', className: 'text-warn border-current' },
    en_gracia: { label: 'Venció, en plazo', className: 'text-warn border-current' },
    // text-destructive, no text-primary: "Atrasado" tiene que leerse siempre
    // como alerta, sin importar el color de marca que haya elegido el
    // gimnasio (--destructive es fijo, --primary es el que cada profesor
    // configura en Configuración -- ver colorTema.js). Bug real encontrado
    // en revisión (07/09/2026): con --primary, un gimnasio que eligiera
    // verde o celeste vería "Atrasado" en ese mismo tono amigable.
    vencido: { label: 'Atrasado', className: 'text-destructive border-current' },
    con_deuda: { label: 'Con deuda', className: 'text-warn border-current' },
    sin_cuota: { label: 'Sin cuota', className: 'border-border text-muted-foreground' },
};

// Estado visible de un alumno: Activo / Pendiente / Inactivo. "Activo" gana
// siempre — un alumno activo nunca se muestra "pendiente" aunque el flag
// haya quedado prendido de antes. "Pendiente" cubre dos orígenes distintos
// con el mismo significado para el profesor ("todavía no está entrenando de
// verdad"): alguien que se autorregistró por QR y falta aprobar, o alguien
// que el profesor cargó a mano a propósito como pendiente (ej. "se anotó
// pero no arrancó"). Centralizado acá porque lo usan AlumnosPage, AlumnoPage
// y DashboardPage — los 3 tienen que leer exactamente igual.
export const ESTADOS_ALUMNO = {
    activo: { label: 'Activo', className: 'text-ok border-current' },
    pendiente: { label: 'Pendiente', className: 'text-warn border-current' },
    inactivo: { label: 'Inactivo', className: 'border-border text-muted-foreground' },
};

export const estadoAlumno = (a) => (a.activo ? 'activo' : a.pendiente ? 'pendiente' : 'inactivo');

// Estado de cuota completo, con la configuración de vencimientos del gimnasio
// (migración 0013). Es la fuente de verdad de "¿quién debe?" en TODAS las
// pantallas del profesor: Pagos, Dashboard, la ficha del alumno y la
// campanita. (Antes DashboardPage usaba una función aparte de 3 estados que
// ignoraba la gracia y los saldos pendientes -- mostraba el mismo alumno
// distinto que el resto; se unificó el 09/09/2026).
//
// NO se usa para segmentar avisos: segmentoNotificacion() (más abajo) está
// espejada en SQL (ver_plan_por_codigo) y desincronizarlas haría mentir al
// contador de audiencia de los avisos.
//
//   pago   = último pago del alumno (el de periodo_hasta más alto), o nada.
//   config = { dias_gracia_cuota, dias_aviso_vencimiento } del gimnasio.
//
// "Con deuda" pasó a depender de la fecha (pedido de Nalux, 09/09/2026, con
// un caso real: una alumna con saldo pendiente pero cubierta hasta un mes
// después aparecía "Con deuda" ya mismo -- "tendría que ser pasada esa
// fecha, si no paga se le asigna con deuda"). Antes ganaba siempre que
// hubiera monto_adeudado, sin mirar el período. Ahora: mientras el período
// sigue vigente (al día / próximo), se ve igual que cualquier otro aunque
// tenga un saldo cargado -- la deuda (el monto en sí) sigue visible aparte,
// en el "Debe $X" de cada fila; recién se convierte en el ESTADO "Con deuda"
// una vez que ya pasó periodo_hasta (venció, esté o no todavía en el plazo
// de gracia) y ese saldo sigue sin saldarse.
export const estadoCuota = (pago, config) => {
    if (!pago) return 'sin_cuota';

    if (!pago.periodo_hasta) {
        // Sin fecha de cobertura no hay con qué comparar -- la deuda (si la
        // hay) es la única señal posible.
        return Number(pago.monto_adeudado || 0) > 0 ? 'con_deuda' : 'vencido';
    }

    const gracia = Number(config?.dias_gracia_cuota || 0);
    const aviso = Number(config?.dias_aviso_vencimiento ?? 7);

    const fin = new Date(String(pago.periodo_hasta).slice(0, 10) + 'T00:00:00').getTime();
    const inicio = new Date(`${hoy()}T00:00:00`).getTime();
    const dias = Math.round((fin - inicio) / 86400000);

    const debe = Number(pago.monto_adeudado || 0) > 0;

    if (dias < -gracia) return debe ? 'con_deuda' : 'vencido';
    if (dias < 0) return debe ? 'con_deuda' : 'en_gracia'; // ya venció (en gracia o no) y sigue sin saldarse
    if (dias <= aviso) return 'proximo';
    return 'al_dia';
};

// Lo que le tocaría pagar a un alumno cuya cuota venció, según el plan que
// tiene asignado (alumnos.plan_precio_nombre) y el interés por mora de ese
// plan (configuracion_precios.interes_mora).
//
// Es un CÁLCULO para mostrar, no un dato guardado: no se escribe ninguna fila
// de deuda en la base. Si el alumno no tiene plan asignado, o el plan no tiene
// precio cargado, devuelve null y la pantalla no muestra un número inventado.
//
// El recargo solo entra cuando ya se pasó el plazo de gracia — durante la
// gracia todavía puede pagar sin interés, que es justo para lo que sirve.
export const deudaEstimada = (alumno, estado, planes) => {
    if (estado !== 'vencido') return null;

    const plan = (planes || []).find((p) => p.nombre === alumno?.plan_precio_nombre);
    const base = Number(plan?.precio || 0);
    if (!base) return null;

    const recargo = (base * Number(plan?.interes_mora || 0)) / 100;
    return { base, recargo, total: base + recargo, plan: plan.nombre };
};

// Mapeo de segmento -> label legible para los badges de Avisos (Bloque G6).
// "Atrasados", no "morosos"/"en mora" -- se sacó esa palabra de toda la app a
// pedido del cliente (ver CONTEXT.md, historial).
export const SEGMENTOS_NOTIFICACION = {
    todos: 'Todos',
    al_dia: 'Al día',
    proximo: 'Por vencer',
    vencido: 'Atrasados',
    con_deuda: 'Con deuda',
    sin_cuota: 'Sin cuota',
};

// Segmento de cuota de UN alumno, para armar/leer avisos (AvisosPage,
// migración 0007). Tiene que coincidir EXACTO con lo que calcula
// ver_plan_por_codigo() en SQL (0007, SECCIÓN 5) -- si se desincroniza, el
// contador que ve el profesor ("X/Y leyeron") o el selector de audiencia al
// crear un aviso van a mentir sobre a quién le llega de verdad.
//
// A propósito NO es lo mismo que estadoCuota() (arriba): esta distingue
// "sin cuota" (nunca pagó) de "vencido"/"con deuda" porque son segmentos de
// audiencia reales ("mandale un aviso de bienvenida a quien nunca cargó una
// cuota" no es lo mismo que "recordale a un atrasado"), y además usa el
// "<= 7" hardcodeado en vez de la config, para no desincronizarse del SQL.
// Último pago de un alumno, mismo criterio que usa el SQL de
// ver_plan_por_codigo() (ORDER BY periodo_hasta DESC NULLS LAST, created_at
// DESC LIMIT 1): el de periodo_hasta más reciente, y ante empate el creado
// más reciente. null si nunca cargó ningún pago. Comparación de strings
// alcanza porque las dos columnas llegan en formato ISO (YYYY-MM-DD /
// timestamptz), que ordena igual lexicográfica que cronológicamente.
//
// Extraído acá (antes vivía inline en segmentoNotificacion) para poder
// reusarlo también desde AppLayout.jsx (chequeo de la política "dar de
// baja", migración 0020) sin duplicar el criterio de ordenamiento.
export const ultimoPagoDeAlumno = (alumnoId, pagos) => {
    const pagosAlumno = (pagos || []).filter((p) => p.alumno_id === alumnoId);
    if (pagosAlumno.length === 0) return null;
    return [...pagosAlumno].sort((a, b) => {
        const ha = a.periodo_hasta || '';
        const hb = b.periodo_hasta || '';
        if (ha !== hb) return hb > ha ? 1 : -1;
        const ca = a.created_at || '';
        const cb = b.created_at || '';
        return cb > ca ? 1 : -1;
    })[0];
};

// Rutinas y planes de comida por vencer o ya vencidos -- extraído (15/09/2026,
// pedido de Nalux: "que haya alertas cuando se vencen los planes de rutina
// de ejercicio y de alimentación") desde donde antes vivía SOLO
// DashboardPage.jsx, para poder reusarlo también en NotificacionesCampana.jsx
// (campanita del header) sin duplicar el criterio -- mismo motivo por el que
// ultimoPagoDeAlumno() se sacó de segmentoNotificacion() más arriba.
//
// Mismo criterio que ya tenía DashboardPage.jsx: sin fecha_fin cargada, ese
// plan simplemente no entra en la cuenta (no se inventa un vencimiento para
// algo al que nunca se le puso fecha). rutinasAsignadas/planesAlimentacion
// pueden traer más de una fila por alumno (una vieja desactivada, o por las
// dudas aunque en la práctica no debería) -- se toma la más reciente por
// created_at.
export const planesPorVencer = (alumnosActivos, rutinasAsignadas, planesAlimentacion, diasAviso = 7) => {
    const hoyMedianoche = new Date();
    hoyMedianoche.setHours(0, 0, 0, 0);
    const diasHasta = (fecha) => {
        const f = new Date(`${fecha}T00:00:00`);
        return Math.round((f - hoyMedianoche) / 86400000);
    };

    const rutinaPorAlumno = new Map();
    (rutinasAsignadas || []).forEach((r) => {
        if (!r.fecha_fin) return;
        const prev = rutinaPorAlumno.get(r.alumno_id);
        if (!prev || String(r.created_at) > String(prev.created_at)) rutinaPorAlumno.set(r.alumno_id, r);
    });
    const dietaPorAlumno = new Map();
    (planesAlimentacion || []).forEach((p) => {
        if (!p.fecha_fin) return;
        const prev = dietaPorAlumno.get(p.alumno_id);
        if (!prev || String(p.created_at) > String(prev.created_at)) dietaPorAlumno.set(p.alumno_id, p);
    });

    const resultado = [];
    (alumnosActivos || []).forEach((a) => {
        const rutina = rutinaPorAlumno.get(a.id);
        if (rutina) {
            const dias = diasHasta(rutina.fecha_fin);
            if (dias <= diasAviso) {
                resultado.push({ alumno: a, tipo: 'Rutina', fecha: rutina.fecha_fin, vencido: dias < 0 });
            }
        }
        const dieta = dietaPorAlumno.get(a.id);
        if (dieta) {
            const dias = diasHasta(dieta.fecha_fin);
            if (dias <= diasAviso) {
                resultado.push({ alumno: a, tipo: 'Plan de comida', fecha: dieta.fecha_fin, vencido: dias < 0 });
            }
        }
    });
    // Vencidos primero, y entre iguales el que vence/venció antes.
    resultado.sort((x, y) => {
        if (x.vencido !== y.vencido) return x.vencido ? -1 : 1;
        return String(x.fecha).localeCompare(String(y.fecha));
    });
    return resultado;
};

export const segmentoNotificacion = (alumno, pagos) => {
    const pago = ultimoPagoDeAlumno(alumno.id, pagos);
    if (!pago) return 'sin_cuota';

    if (Number(pago.monto_adeudado || 0) > 0) return 'con_deuda';
    if (!pago.periodo_hasta) return 'vencido';

    // Días de calendario (fecha contra fecha, sin componente de hora) -- igual
    // que el SQL (periodo_hasta - CURRENT_DATE, ambos DATE). Se usa hoy()
    // (arriba, basado en toISOString) en vez de Date.now() a propósito: acá
    // importa el día calendario, no el instante exacto.
    const fin = new Date(String(pago.periodo_hasta).slice(0, 10) + 'T00:00:00').getTime();
    const inicio = new Date(`${hoy()}T00:00:00`).getTime();
    const dias = Math.round((fin - inicio) / 86400000);

    if (dias < 0) return 'vencido';
    if (dias <= 7) return 'proximo';
    return 'al_dia';
};

// ---------------------------------------------------------------------------
// Lectura de los items de una rutina (rutinas.items, JSONB libre).
//
// Los items viejos no tienen semana/bloque/intensidad/comentario: se armaron
// antes de que existieran esos campos. Por eso TODO lo que los lee pasa por
// acá y usa defaults — una rutina armada hace un mes se tiene que seguir
// viendo igual que siempre, sin migrar nada.
//
// Compartido por las 3 pantallas que muestran una rutina (RutinasPage al
// armarla, AlumnoPage al leerla del lado del profe, MiPlanPage del lado del
// alumno) para que las tres agrupen exactamente igual.
// ---------------------------------------------------------------------------

export const semanaDeItem = (it) => Number(it?.semana) || 1;

// Agrupa un día por bloque respetando el orden en que están los ejercicios:
// bloques consecutivos con el mismo nombre quedan juntos, así mover un
// ejercicio de lugar también lo mueve de bloque. Los que no tienen bloque
// caen en un grupo con nombre '' que se renderiza sin encabezado.
export const agruparPorBloque = (lista) => {
    const grupos = [];
    (lista || []).forEach((it) => {
        const bloque = (it.bloque || '').trim();
        const ultimo = grupos[grupos.length - 1];
        if (ultimo && ultimo[0] === bloque) ultimo[1].push(it);
        else grupos.push([bloque, [it]]);
    });
    return grupos;
};

// ---------------------------------------------------------------------------
// Tipo de grupo (Fase 2.3, 13/09/2026): un bloque con nombre puede ser
// ademas un CIRCUITO (rondas de ejercicios en secuencia) o un INTERVALO
// (mismo circuito, pero con tiempos fijos de trabajo/descanso y un
// temporizador real del lado del alumno -- formato tabata). Un bloque
// normal (sin tipoGrupo) sigue funcionando exactamente igual que siempre.
//
// El dato vive REPETIDO en cada item del bloque (mismo criterio que ya usa
// `bloque` en sí, o `comboId`) en vez de en una entidad de grupo aparte,
// porque rutinas.items sigue siendo un array plano -- armar una estructura
// de "grupos" separada hubiera significado tocar el modelo entero. Se lee
// del PRIMER item del grupo porque todos comparten el mismo valor.
// ---------------------------------------------------------------------------

export const tipoDeGrupo = (delBloque) => delBloque?.[0]?.tipoGrupo || 'bloque';

// Texto listo para mostrar en las pantallas de solo lectura (ficha del
// profesor, plan del alumno, PDF). null si es un bloque normal -- ahí no
// hay nada nuevo que anunciar, sigue siendo el título de bloque de siempre.
export const resumenTipoGrupo = (delBloque) => {
    const tipo = tipoDeGrupo(delBloque);
    if (tipo === 'bloque') return null;
    const primero = delBloque[0] || {};
    const rondas = Number(primero.rondas) || 3;
    const rondasTxt = `${rondas} ronda${rondas === 1 ? '' : 's'}`;
    if (tipo === 'intervalo') {
        const trabajo = Number(primero.tiempoTrabajo) || 40;
        const descansoEj = Number(primero.tiempoDescansoEj) || 20;
        return `Intervalo · ${rondasTxt} · ${trabajo}s trabajo / ${descansoEj}s descanso`;
    }
    return `Circuito · ${rondasTxt}${primero.descansoRondas ? ` · descanso ${primero.descansoRondas} entre rondas` : ''}`;
};

// Semana -> Día -> ejercicios. Devuelve [[semana, [[dia, items], ...]], ...]
// ordenado por número de semana y por el orden de DIAS.
export const agruparItemsRutina = (items) => {
    const semanas = new Map();
    (items || []).forEach((it) => {
        const s = semanaDeItem(it);
        const d = it.dia || DIAS[0];
        if (!semanas.has(s)) semanas.set(s, new Map());
        const dias = semanas.get(s);
        if (!dias.has(d)) dias.set(d, []);
        dias.get(d).push(it);
    });
    return [...semanas.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([s, dias]) => [s, [...dias.entries()].sort((a, b) => DIAS.indexOf(a[0]) - DIAS.indexOf(b[0]))]);
};

// ---------------------------------------------------------------------------
// Desglose de series (Fase 2.3, 13/09/2026): pirámides, drop sets -- peso o
// reps distinto en cada serie de un mismo ejercicio. Por default un
// ejercicio sigue siendo "series x reps" uniforme (como siempre); si tiene
// `seriesDetalle` (array, una fila por serie) se usa eso en su lugar. Nunca
// se borra `series`/`reps`/`peso`/`descanso` al desglosar -- quedan como el
// valor que tenía ANTES de desglosar, así "Unificar" puede volver a mostrar
// algo razonable sin inventar nada.
// ---------------------------------------------------------------------------

export const tieneSeriesDetalle = (it) => Array.isArray(it?.seriesDetalle) && it.seriesDetalle.length > 0;

// Arma el array inicial al tocar "Desglosar": una fila por cada serie que el
// ejercicio ya tenía, todas con el mismo peso/reps/descanso de antes -- el
// profesor edita desde ahí, no arranca de cero.
export const desglosarSeries = (it) => {
    const n = Math.max(1, Math.round(Number(it?.series)) || 1);
    return Array.from({ length: n }, () => ({
        reps: it?.reps || '',
        peso: it?.peso || '',
    }));
};

// SIEMPRE devuelve un array de filas (una por serie), esté o no desglosado
// -- así el PDF, la ficha del alumno y el plan leen todos de acá y ninguno
// repite la lógica de "si hay seriesDetalle, uso eso; si no, repito
// series/reps/peso". `descanso` no varía por serie (es el tiempo hasta la
// SIGUIENTE, tiene sentido que sea uno solo para todo el ejercicio).
export const filasDeSeries = (it) => {
    if (tieneSeriesDetalle(it)) {
        return it.seriesDetalle.map((s, i) => ({
            numero: i + 1,
            reps: s?.reps || '',
            peso: s?.peso || '',
        }));
    }
    const n = Math.max(1, Math.round(Number(it?.series)) || 1);
    return Array.from({ length: n }, (_, i) => ({ numero: i + 1, reps: it?.reps || '', peso: it?.peso || '' }));
};

// Texto compacto para donde no entra la tabla completa (encabezados,
// resúmenes). "4x10" de siempre si no está desglosado; si está desglosado,
// muestra las reps de cada serie separadas por "/" -- que es lo que más
// varía en una pirámide -- y el rango de peso si no son todos iguales.
export const resumenSeries = (it) => {
    if (!tieneSeriesDetalle(it)) return `${it?.series ?? '—'}x${it?.reps || '—'}`;
    const filas = it.seriesDetalle;
    const reps = filas.map((s) => s?.reps || '—').join('/');
    const pesos = [...new Set(filas.map((s) => (s?.peso || '').trim()).filter(Boolean))];
    const pesoTxt = pesos.length === 1 ? ` · ${pesos[0]}kg` : pesos.length > 1 ? ' · peso variable' : '';
    return `${filas.length} series (${reps} reps${pesoTxt})`;
};

// ---------------------------------------------------------------------------
// Superseries / combos: 2+ ejercicios que se cargaron JUNTOS (mismo click de
// "Agregar (N)" en RutinasPage) comparten un `comboId`. NO se fusionan en un
// solo texto -- Nalux fue explícita: quiere cada ejercicio en su propia caja
// chica, uno al lado del otro ("Búlgara" y "Peso Muerto" cada uno con su
// nombre/series/reps propios), no un renglón con "Búlgara + Peso Muerto".
// Series/reps/peso quedan por ejercicio (`comboItems`, sin tocar). Descanso/
// intensidad/comentario sí se combinan, porque esos son del combo entero
// (el descanso pasa una sola vez, al terminar los dos ejercicios de la
// vuelta) -- y RutinasPage ya los edita como un campo compartido único, así
// que en la práctica siempre van a venir iguales; combinarValor() es solo
// por las dudas (datos viejos, o si se editan directo en la base).
//
// Un ejercicio cargado solo (o agregado sin compañía, sin comboId) no se
// toca: se sigue mostrando como siempre. Se usa en las pantallas de SOLO
// LECTURA (MiPlanPage, AlumnoPage) para agrupar visualmente -- el armador
// de RutinasPage tiene su propia versión sin fusionar nada
// (`agruparPorCombo`, ahí mismo) porque ahí cada ejercicio se sigue editando
// por separado.
// ---------------------------------------------------------------------------

const combinarValor = (valores) => {
    const limpios = valores.map((v) => (v ?? '').toString().trim());
    const todosIguales = limpios.every((v) => v === limpios[0]);
    return todosIguales ? limpios[0] || '—' : limpios.map((v) => v || '—').join(' + ');
};

export const agruparCombos = (lista) => {
    const grupos = [];
    (lista || []).forEach((it) => {
        const ultimo = grupos[grupos.length - 1];
        if (it.comboId && ultimo?.length && ultimo[0].comboId === it.comboId) ultimo.push(it);
        else grupos.push([it]);
    });

    return grupos.map((g) => {
        if (g.length === 1) return g[0];
        return {
            key: g.map((x) => x.key).join('+'),
            dia: g[0].dia,
            semana: g[0].semana,
            bloque: g[0].bloque,
            descanso: combinarValor(g.map((x) => x.descanso)),
            intensidad: combinarValor(g.map((x) => x.intensidad)),
            comentario: [...new Set(g.map((x) => x.comentario).filter(Boolean))].join(' · '),
            // Tipo de grupo (Fase 2.3, 13/09/2026): sin esto, un circuito o
            // intervalo armado con 2+ ejercicios agregados JUNTOS (que es el
            // caso normal -- se tildan varios y se agregan de una) perdía la
            // etiqueta y el timer en TODAS las pantallas de solo lectura,
            // porque tipoDeGrupo()/resumenTipoGrupo() leen del primer item
            // del grupo, y ese primer item pasaba a ser este objeto
            // sintético sin estos campos. Bug real, encontrado probando en
            // vivo. Son propiedades del bloque entero, iguales en todos los
            // ejercicios del combo -- se copian del primero, igual que
            // `bloque` ahí arriba.
            tipoGrupo: g[0].tipoGrupo,
            rondas: g[0].rondas,
            descansoRondas: g[0].descansoRondas,
            tiempoTrabajo: g[0].tiempoTrabajo,
            tiempoDescansoEj: g[0].tiempoDescansoEj,
            esCombo: true,
            comboItems: g,
        };
    });
};
