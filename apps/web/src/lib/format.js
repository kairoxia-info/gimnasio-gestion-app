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

export const ESTADOS_PAGO = {
    al_dia: { label: 'Al día', className: 'text-ok border-current' },
    proximo: { label: 'Próximo a vencer', className: 'text-warn border-current' },
    vencido: { label: 'Vencido / en mora', className: 'text-primary border-current' },
};

export const estadoDesdeVencimiento = (hasta) => {
    if (!hasta) return 'vencido';
    const fin = new Date(String(hasta).slice(0, 10) + 'T00:00:00').getTime();
    const dias = Math.round((fin - Date.now()) / 86400000);
    if (dias < 0) return 'vencido';
    if (dias <= 7) return 'proximo';
    return 'al_dia';
};
