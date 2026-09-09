// Generación automática de usuario y contraseña para un alumno, usada al
// aprobar una cuenta autorregistrada (pedido de Nalux, 09/09/2026: "que el
// alumno con su nombre ponga el usuario y una contraseña... sino no tiene
// sentido mandarle para que se registre y no tenga acceso al panel" -- se
// aprueba y de una tiene con qué entrar, sin que el profesor tenga que
// pensar un usuario y una contraseña a mano).
import supabase from './supabaseClient';

// Primer nombre, sin acentos ni espacios, en minúsculas -- mismo estilo que
// ya usa Nalux a mano ("nadia1"). Si el nombre es muy corto (o viene vacío),
// se completa para no chocar con el mínimo de 3 caracteres que exige
// crear_acceso_alumno().
export const usuarioBaseDesdeNombre = (nombreCompleto) => {
    const primerNombre = String(nombreCompleto || '').trim().split(/\s+/)[0] || 'alumno';
    const limpio = primerNombre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
    return limpio.length >= 3 ? limpio : `${limpio}alu`.slice(0, Math.max(3, limpio.length));
};

// Sin caracteres ambiguos (l/1/I, 0/O) a propósito: se dicta o se tipea a
// mano en el celular de alguien. 8 caracteres con mayúscula, regla de Nalux
// (09/09/2026): 1 mayúscula + 3 minúsculas + 4 números.
export const generarContrasenaAlumno = () => {
    const letrasMayus = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    const letrasMinus = 'abcdefghjkmnpqrstuvwxyz';
    const numeros = '23456789';
    const al = (set) => set[Math.floor(Math.random() * set.length)];
    const minusculas = Array.from({ length: 3 }, () => al(letrasMinus)).join('');
    const digitos = Array.from({ length: 4 }, () => al(numeros)).join('');
    return `${al(letrasMayus)}${minusculas}${digitos}`;
};

// Crea el acceso completo a partir del nombre del alumno, reintentando con
// un número al final del usuario si ya lo tiene otro alumno del gimnasio
// (crear_acceso_alumno() lo rechaza con unique_violation -- se atrapa por el
// texto del mensaje, que es el mismo que usa esa función). Devuelve
// { usuario, contrasena } ya guardados.
export const crearAccesoAutomatico = async (alumno) => {
    const base = usuarioBaseDesdeNombre(alumno.nombre);
    const contrasena = generarContrasenaAlumno();
    const TOPE_INTENTOS = 20;
    for (let intento = 0; intento < TOPE_INTENTOS; intento++) {
        const usuario = intento === 0 ? base : `${base}${intento + 1}`;
        const { error } = await supabase.rpc('crear_acceso_alumno', {
            p_alumno_id: alumno.id,
            p_usuario: usuario,
            p_contrasena: contrasena,
        });
        if (!error) return { usuario, contrasena };
        if (!error.message?.includes('ya lo tiene otro alumno')) throw error;
        // Colisión de usuario: sigue el loop y prueba con el próximo número.
    }
    throw new Error('No se pudo generar un usuario único para este alumno. Probar creándolo a mano.');
};
