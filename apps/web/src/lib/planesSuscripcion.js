// Planes de suscripción de RutNail (definidos por Nalux el 29/10/2026; precios confirmados el 03/11/2026).
// Un solo lugar con los límites y los precios que muestra la página de presentación. Lo que se cobra y se
// controla de verdad sale de la base (tabla `planes_suscripcion`, migración 0086): si se cambia un número
// acá, hay que cambiarlo allá también. Importes en pesos argentinos por mes, con el pago mensual.

// Prueba gratis (decidida por Nalux el 29/10/2026): arranca sola al crear la cuenta, dura estos días, sin
// tarjeta (la base crea la suscripción en estado "prueba" para toda organización nueva).
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
