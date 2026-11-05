// Regla mínima de contraseña, pedida por Nalux (09/09/2026): "que al menos
// tenga una mayúscula", tanto cuando el profesor se registra como cuando le
// crea el usuario/contraseña a un alumno. Un solo lugar para no repetir la
// regla (y el mensaje) en cada formulario.
export const CONTRASENA_ERROR_MAYUSCULA = 'La contraseña tiene que tener al menos una letra mayúscula.';
export const CONTRASENA_ERROR_MINUSCULA = 'La contraseña tiene que tener al menos una letra minúscula.';
export const CONTRASENA_ERROR_NUMERO = 'La contraseña tiene que tener al menos un número.';

export const tieneMayuscula = (contrasena) => /[A-Z]/.test(contrasena || '');
export const tieneMinuscula = (contrasena) => /[a-z]/.test(contrasena || '');
export const tieneNumero = (contrasena) => /[0-9]/.test(contrasena || '');

// Devuelve el mensaje de error si la contraseña no cumple, o '' si está bien.
// minLength es el mínimo de caracteres que exige cada formulario (8 para el
// profesor y el equipo). Las cuentas de alumno usan validarContrasenaAlumno()
// (más abajo), que tiene su propia regla.
//
// exigirMinusculaYNumero (14/09/2026, encontrado probando en vivo el apagado
// de "Confirm email"): las cuentas de PROFESOR pasan por Supabase Auth
// (signUp()/updateUser() en LoginPage.jsx/ResetPasswordPage.jsx), y ese
// proyecto tiene configurada del lado del SERVIDOR una política más estricta
// que la de acá (Dashboard → Authentication → Sign In / Providers → Email →
// Password Requirements: "Lowercase, uppercase letters and digits"). Esta
// validación de acá nunca se había actualizado para igualarla -- una
// contraseña como "123456789N" (números + 1 mayúscula, sin minúscula)
// pasaba este chequeo del cliente y después el servidor la rechazaba con un
// 422 y un mensaje que ni siquiera se traducía (caía al genérico "No se
// pudo crear la cuenta", sin decir por qué). Las cuentas de ALUMNO
// (crear_acceso_alumno(), hash propio con bcrypt, NUNCA pasan por Supabase
// Auth) no están sujetas a esa política del proyecto; por eso este chequeo
// extra es opcional y apagado por default, no una regla nueva para todos los
// formularios. (Desde el 05/11/2026 los alumnos tienen su propia función.)
export const validarContrasena = (contrasena, minLength, { exigirMinusculaYNumero = false } = {}) => {
    const c = String(contrasena || '');
    if (c.length < minLength) {
        return `La contraseña tiene que tener al menos ${minLength} caracteres.`;
    }
    if (!tieneMayuscula(c)) {
        return CONTRASENA_ERROR_MAYUSCULA;
    }
    if (exigirMinusculaYNumero) {
        if (!tieneMinuscula(c)) return CONTRASENA_ERROR_MINUSCULA;
        if (!tieneNumero(c)) return CONTRASENA_ERROR_NUMERO;
    }
    return '';
};

// Regla de las cuentas de ALUMNO (auditoría del 05/11/2026). crear_acceso_alumno()
// exige exactamente lo mismo del lado de la base (migración 0098); esto es solo
// el aviso inmediato, la base sigue siendo la que manda. NO cambia la regla de
// las cuentas de profesor (validarContrasena de arriba).
export const CONTRASENA_ALUMNO_MINIMO = 10;
export const CONTRASENA_ERROR_USUARIO = 'La contraseña no puede contener el usuario.';
export const CONTRASENA_ERROR_FACIL = 'Esa contraseña es muy fácil de adivinar. Elige otra.';

const CONTRASENAS_FACILES = new Set([
    'password123',
    'contrasena1',
    'contrasena123',
    'gimnasio123',
    'gimnasio2026',
    'rutnail123',
    'alumno1234',
    'alumno12345',
    'qwerty12345',
    'entrenar123',
]);

// Devuelve el mensaje de error si la contraseña no cumple, o '' si está bien.
export const validarContrasenaAlumno = (contrasena, usuario) => {
    const c = String(contrasena ?? '');
    if (c.length < CONTRASENA_ALUMNO_MINIMO) {
        return `La contraseña tiene que tener al menos ${CONTRASENA_ALUMNO_MINIMO} caracteres.`;
    }
    if (!tieneMayuscula(c)) return CONTRASENA_ERROR_MAYUSCULA;
    if (!tieneMinuscula(c)) return CONTRASENA_ERROR_MINUSCULA;
    if (!tieneNumero(c)) return CONTRASENA_ERROR_NUMERO;
    const u = String(usuario ?? '').trim().toLowerCase();
    const minus = c.toLowerCase();
    if (u && minus.includes(u)) return CONTRASENA_ERROR_USUARIO;
    if (CONTRASENAS_FACILES.has(minus)) return CONTRASENA_ERROR_FACIL;
    return '';
};
