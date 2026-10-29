// A qué pantalla de ingreso se vuelve al cerrar sesión (o cuando la sesión vence).
//
// Hay dos: "/login" (el profesor) y "/ingreso-equipo" (el personal que el profesor dio de alta desde
// Equipo, migración 0080). Pedido de Nalux (29/10/2026): un empleado que cierra sesión tiene que volver
// al ingreso del equipo, no al del profesor.
//
// Al cargar el perfil se recuerda qué tipo de cuenta es (en este navegador) y, al quedar sin sesión, ya no
// hay forma de preguntarlo: por eso se guarda. Es solo una preferencia de pantalla, no un permiso: las
// reglas de verdad están en la base. Si el navegador no deja guardar, se cae al ingreso del profesor.
const CLAVE = 'rutnail:ingreso';

// Cuenta de equipo = sin ningún gimnasio donde sea administradora y con acceso de staff (activo o pausado).
export const recordarTipoDeIngreso = ({ misGimnasios = [], accesoPausado = false } = {}) => {
    const esAdmin = misGimnasios.some((g) => g.rol === 'admin');
    const esEquipo = !esAdmin && (accesoPausado || misGimnasios.some((g) => g.rol === 'staff'));
    try {
        window.localStorage.setItem(CLAVE, esEquipo ? 'equipo' : 'profesor');
    } catch (_) {
        // navegador sin almacenamiento: se usa el ingreso del profesor
    }
};

export const rutaDeIngreso = () => {
    try {
        return window.localStorage.getItem(CLAVE) === 'equipo' ? '/ingreso-equipo' : '/login';
    } catch (_) {
        return '/login';
    }
};
