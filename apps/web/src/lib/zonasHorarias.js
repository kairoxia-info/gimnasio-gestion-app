// Zonas horarias que se pueden elegir para un gimnasio (Configuración). Son
// nombres IANA, los mismos que reconoce Postgres (pg_timezone_names) y el
// navegador (Intl): la base valida el valor con zona_horaria_valida() (0074).
//
// Se listan los países de habla hispana (la app es para todo ese mundo, ver la
// regla de español neutro) y las zonas de EE. UU. con más población hispana. Si
// el gimnasio ya tiene guardada una que no está acá, el selector igual la
// muestra (ver opcionesDeZona).
export const ZONAS_HORARIAS = [
    ['America/Argentina/Buenos_Aires', 'Argentina'],
    ['America/La_Paz', 'Bolivia'],
    ['America/Santiago', 'Chile'],
    ['America/Bogota', 'Colombia'],
    ['America/Costa_Rica', 'Costa Rica'],
    ['America/Havana', 'Cuba'],
    ['America/Guayaquil', 'Ecuador'],
    ['America/El_Salvador', 'El Salvador'],
    ['Europe/Madrid', 'España (península y Baleares)'],
    ['Atlantic/Canary', 'España (Canarias)'],
    ['America/New_York', 'Estados Unidos (este)'],
    ['America/Chicago', 'Estados Unidos (centro)'],
    ['America/Denver', 'Estados Unidos (montaña)'],
    ['America/Los_Angeles', 'Estados Unidos (Pacífico)'],
    ['America/Guatemala', 'Guatemala'],
    ['Africa/Malabo', 'Guinea Ecuatorial'],
    ['America/Tegucigalpa', 'Honduras'],
    ['America/Mexico_City', 'México (centro)'],
    ['America/Cancun', 'México (Cancún)'],
    ['America/Mazatlan', 'México (Pacífico)'],
    ['America/Tijuana', 'México (noroeste)'],
    ['America/Managua', 'Nicaragua'],
    ['America/Panama', 'Panamá'],
    ['America/Asuncion', 'Paraguay'],
    ['America/Lima', 'Perú'],
    ['America/Puerto_Rico', 'Puerto Rico'],
    ['America/Santo_Domingo', 'República Dominicana'],
    ['America/Montevideo', 'Uruguay'],
    ['America/Caracas', 'Venezuela'],
];

export const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires';

// Un mismo lugar puede tener varios nombres IANA ("America/Argentina/Buenos_Aires"
// y el alias antiguo "America/Buenos_Aires"): Chrome informa la zona del
// dispositivo con el alias. Se comparan por su forma canónica según el propio
// navegador, así el aviso "este dispositivo está en otra zona" no sale cuando es
// la misma, y un gimnasio nuevo guarda el nombre de nuestra lista.
const canonica = (zona) => {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).resolvedOptions().timeZone;
    } catch (_) {
        return null;
    }
};

export const mismaZona = (a, b) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const ca = canonica(a);
    return ca !== null && ca === canonica(b);
};

// La zona que tiene el dispositivo, solo si este navegador la reconoce; si es
// equivalente a una de la lista, devuelve el nombre de la lista.
export const zonaDelDispositivo = () => {
    try {
        const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!zona || !canonica(zona)) return null;
        const enLista = ZONAS_HORARIAS.find(([valor]) => mismaZona(valor, zona));
        return enLista ? enLista[0] : zona;
    } catch (_) {
        return null;
    }
};

// Opciones del selector: la lista fija, más la zona actual del gimnasio y la del
// dispositivo si no están en la lista (así nunca se "pierde" un valor guardado).
export const opcionesDeZona = (zonaActual) => {
    const opciones = [...ZONAS_HORARIAS];
    const yaEsta = (z) => opciones.some(([valor]) => mismaZona(valor, z));
    if (zonaActual && !yaEsta(zonaActual)) opciones.unshift([zonaActual, zonaActual]);
    const dispositivo = zonaDelDispositivo();
    if (dispositivo && !yaEsta(dispositivo)) opciones.push([dispositivo, `${dispositivo} (este dispositivo)`]);
    return opciones;
};
