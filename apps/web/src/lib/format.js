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
    vencido: { label: 'Atrasado', className: 'text-primary border-current' },
};

export const estadoDesdeVencimiento = (hasta) => {
    if (!hasta) return 'vencido';
    const fin = new Date(String(hasta).slice(0, 10) + 'T00:00:00').getTime();
    const dias = Math.round((fin - Date.now()) / 86400000);
    if (dias < 0) return 'vencido';
    if (dias <= 7) return 'proximo';
    return 'al_dia';
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
export const segmentoNotificacion = (alumno, pagos) => {
    const pagosAlumno = (pagos || []).filter((p) => p.alumno_id === alumno.id);
    if (pagosAlumno.length === 0) return 'sin_cuota';

    // Mismo orden que el SQL: ORDER BY periodo_hasta DESC NULLS LAST,
    // created_at DESC LIMIT 1. Comparación de strings alcanza porque las dos
    // columnas llegan en formato ISO (YYYY-MM-DD / timestamptz), que ordena
    // igual lexicográfica que cronológicamente.
    const [pago] = [...pagosAlumno].sort((a, b) => {
        const ha = a.periodo_hasta || '';
        const hb = b.periodo_hasta || '';
        if (ha !== hb) return hb > ha ? 1 : -1;
        const ca = a.created_at || '';
        const cb = b.created_at || '';
        return cb > ca ? 1 : -1;
    });

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
