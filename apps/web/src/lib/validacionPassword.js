// Regla mínima de contraseña, pedida por Nalux (09/09/2026): "que al menos
// tenga una mayúscula", tanto cuando el profesor se registra como cuando le
// crea el usuario/contraseña a un alumno. Un solo lugar para no repetir la
// regla (y el mensaje) en cada formulario.
export const CONTRASENA_ERROR_MAYUSCULA = 'La contraseña tiene que tener al menos una letra mayúscula.';

export const tieneMayuscula = (contrasena) => /[A-Z]/.test(contrasena || '');

// Devuelve el mensaje de error si la contraseña no cumple, o '' si está bien.
// minLength es el mínimo de caracteres que ya exigía cada formulario (6 para
// el profesor, 4 para el alumno) -- se mantiene, esto solo suma la
// mayúscula.
export const validarContrasena = (contrasena, minLength) => {
    if (String(contrasena || '').length < minLength) {
        return `La contraseña tiene que tener al menos ${minLength} caracteres.`;
    }
    if (!tieneMayuscula(contrasena)) {
        return CONTRASENA_ERROR_MAYUSCULA;
    }
    return '';
};
