// data.js es un módulo plano (no un hook de React) que necesita saber el
// gimnasio_id del staff logueado para poder mandarlo en cada INSERT (las
// tablas de negocio no tienen default/trigger que lo complete solo). En vez
// de que data.js vuelva a golpear `profiles`, AuthContext.jsx escribe acá
// cada vez que cambia `profile`, y data.js sólo lee esta variable de módulo.
let currentGimnasioId = null;

export const setCurrentGimnasioId = (id) => {
    currentGimnasioId = id ?? null;
};

export const getCurrentGimnasioId = () => currentGimnasioId;
