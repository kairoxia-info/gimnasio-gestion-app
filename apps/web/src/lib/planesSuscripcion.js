// Planes de suscripción de RutNail (definidos por Nalux el 29/10/2026). Un solo lugar con los límites y
// los precios: la página de presentación los muestra desde acá y, cuando se construya el módulo de
// suscripción, el control de límites (en el servidor) tiene que usar estos mismos números.
//
// PRECIOS = BORRADOR. Son una propuesta para ajustar con Nalux; mientras `PRECIOS_BORRADOR` sea true la
// página lo avisa con una franja visible. Importes en pesos argentinos por mes, con el pago mensual.

export const PRECIOS_BORRADOR = true;

// Prueba gratis (decidida por Nalux el 29/10/2026): las cuentas las crea el equipo, así que se pide por
// WhatsApp. Cuando exista el módulo de suscripción, la prueba tiene que ser un estado de la suscripción.
export const DIAS_PRUEBA = 7;
const WHATSAPP_CONTACTO = '5493573430891'; // +54 9 357 343-0891
export const enlaceWhatsApp = (mensaje) =>
    `https://wa.me/${WHATSAPP_CONTACTO}?text=${encodeURIComponent(mensaje)}`;

// Descuento por pagar varios meses juntos (mismo criterio que otras apps del rubro).
export const PERIODOS_PAGO = [
    { clave: 'mensual', etiqueta: 'Mensual', meses: 1, descuento: 0 },
    { clave: 'trimestral', etiqueta: 'Trimestral', meses: 3, descuento: 0.1 },
    { clave: 'semestral', etiqueta: 'Semestral', meses: 6, descuento: 0.2 },
];

// `alumnos: null` = ilimitados. `alimentacion: false` = el plan no incluye Alimentos ni Planes de
// alimentación. Más gimnasios que `gimnasios` se acuerda hablando con el equipo.
export const PLANES = [
    {
        clave: 'basico',
        nombre: 'Básico',
        resumen: 'Para empezar con un solo gimnasio.',
        gimnasios: 1,
        alumnos: 50,
        alimentacion: false,
        precioMensual: 40000,
    },
    {
        clave: 'estandar',
        nombre: 'Estándar',
        resumen: 'Todo incluido para crecer.',
        gimnasios: 2,
        alumnos: 200,
        alimentacion: true,
        precioMensual: 80000,
        destacado: true,
    },
    {
        clave: 'pro',
        nombre: 'Pro',
        resumen: 'Sin tope de alumnos y con varias sedes.',
        gimnasios: 5,
        alumnos: null,
        alimentacion: true,
        precioMensual: 150000,
    },
];

// Precio mensual equivalente según el período elegido, redondeado a los 500 pesos más cercanos.
export const precioPorMes = (plan, periodo) =>
    Math.round((plan.precioMensual * (1 - periodo.descuento)) / 500) * 500;

export const formatoPesos = (n) => `$${n.toLocaleString('es-AR')}`;
