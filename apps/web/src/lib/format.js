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
    vencido: { label: 'Atrasado', className: 'text-primary border-current' },
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

export const estadoDesdeVencimiento = (hasta) => {
    if (!hasta) return 'vencido';
    const fin = new Date(String(hasta).slice(0, 10) + 'T00:00:00').getTime();
    const dias = Math.round((fin - Date.now()) / 86400000);
    if (dias < 0) return 'vencido';
    if (dias <= 7) return 'proximo';
    return 'al_dia';
};

// Estado de cuota completo, con la configuración de vencimientos del gimnasio
// (migración 0013). Reemplaza a estadoDesdeVencimiento() en Pagos, Dashboard y
// la ficha del alumno.
//
// NO se toca estadoDesdeVencimiento() ni segmentoNotificacion(): la segunda
// está espejada en SQL (ver_plan_por_codigo) y desincronizarlas haría mentir
// al contador de audiencia de los avisos. Esta función es para la parte
// operativa (¿quién debe?), no para segmentar avisos.
//
//   pago   = último pago del alumno (el de periodo_hasta más alto), o nada.
//   config = { dias_gracia_cuota, dias_aviso_vencimiento } del gimnasio.
//
// El orden importa: "con deuda" gana sobre las fechas, porque alguien puede
// tener el período al día y aun así deber plata (pagó una parte, o se lo
// activó sin cobrar).
export const estadoCuota = (pago, config) => {
    if (!pago) return 'sin_cuota';
    if (Number(pago.monto_adeudado || 0) > 0) return 'con_deuda';
    if (!pago.periodo_hasta) return 'vencido';

    const gracia = Number(config?.dias_gracia_cuota || 0);
    const aviso = Number(config?.dias_aviso_vencimiento ?? 7);

    const fin = new Date(String(pago.periodo_hasta).slice(0, 10) + 'T00:00:00').getTime();
    const inicio = new Date(`${hoy()}T00:00:00`).getTime();
    const dias = Math.round((fin - inicio) / 86400000);

    if (dias < -gracia) return 'vencido';
    if (dias < 0) return 'en_gracia'; // venció pero todavía está en el plazo extra
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
// A propósito NO es lo mismo que estadoDesdeVencimiento() (arriba): esa
// función es la lógica vieja de DashboardPage/PagosPage, que mete
// "sin pagos" y "con deuda" dentro de 'vencido' sin distinguirlos -- acá hace
// falta la distinción fina porque son segmentos de audiencia reales
// ("mandale un aviso de bienvenida a quien nunca cargó una cuota" no es lo
// mismo que "recordale a un atrasado").
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

export const segmentoNotificacion = (alumno, pagos) => {
    const pago = ultimoPagoDeAlumno(alumno.id, pagos);
    if (!pago) return 'sin_cuota';

    if (Number(pago.monto_adeudado || 0) > 0) return 'con_deuda';
    if (!pago.periodo_hasta) return 'vencido';

    // Días de calendario (fecha contra fecha, sin componente de hora) -- igual
    // que el SQL (periodo_hasta - CURRENT_DATE, ambos DATE). Se usa hoy()
    // (arriba, basado en toISOString) en vez de Date.now() a propósito: acá
    // importa el día calendario, no el instante exacto -- Date.now() es lo
    // que usa estadoDesdeVencimiento() y es justo la fuente de la pequeña
    // discrepancia documentada en la migración SQL.
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
            esCombo: true,
            comboItems: g,
        };
    });
};
