import supabase from '@/lib/supabaseClient';
import { getCurrentGimnasioId } from '@/lib/currentGimnasio';
import { esErrorDeRed, guardarEnCache, leerDeCache } from '@/lib/offline';

// Traduce el string de sort heredado del cliente anterior ('-created_at' |
// 'nombre') a los args de .order() de supabase-js. Sin sort => sin .order(): varias
// tablas de negocio (asistencias, configuracion_precios) no tienen
// created_at, así que NO hay default global de orden acá — cada página pide
// el que necesita.
const aplicarSort = (query, sort) => {
    if (!sort) return query;
    const ascending = !sort.startsWith('-');
    const columna = ascending ? sort : sort.slice(1);
    return query.order(columna, { ascending });
};

// Columnas que el panel del profesor SÍ puede pedir, por colección
// (repaso de seguridad del 14/09/2026). Hasta acá todo pedía `select('*')`,
// y eso hacía que el navegador recibiera de cada alumno el hash bcrypt de su
// contraseña, los contadores internos de tope de intentos y el DNI -- datos
// que NINGUNA pantalla usa (verificado buscándolos en todo `src/`). No era
// una fuga hacia afuera (RLS sigue limitando a los alumnos del propio
// gimnasio), pero un secreto que no hace falta en el cliente no tiene por qué
// viajar hasta ahí: con esto, un XSS futuro, una extensión de navegador
// metida, o la compu del profesor abierta ya no alcanzan para llevarse hashes
// que después se puedan romper offline.
//
// Ojo al tocar esto: la migración 0051 recorta los permisos a nivel de COLUMNA
// en Postgres, y ahí `SELECT *` no filtra en silencio -- falla entero con
// "permission denied for column". O sea que esta lista y la de la migración
// tienen que decir lo mismo; si se agrega una columna nueva a `alumnos` que el
// panel necesite, hay que sumarla en los DOS lados.
//
// Las funciones SECURITY DEFINER (iniciar_sesion_alumno, crear_acceso_alumno,
// ver_plan_por_codigo, etc.) no se ven afectadas: corren con los permisos de
// su dueño, así que siguen leyendo y escribiendo password_hash y contadores
// como siempre. Solo cambia lo que puede pedir el navegador.
const COLUMNAS_POR_COLECCION = {
    alumnos:
        'id, gimnasio_id, nombre, contacto, email, fecha_alta, fecha_nacimiento, foto_url, ' +
        'activo, observaciones_salud, plan_precio_nombre, user_id, created_at, origen, ' +
        'codigo_acceso, contacto_emergencia, objetivo, pendiente, usuario, notas_internas',
};

export const columnasDe = (collection) => COLUMNAS_POR_COLECCION[collection] || '*';

// filters: objeto plano { columna: valor } -> encadena .eq(columna, valor).
// Alcanza para todo lo que hoy filtran las páginas (siempre por igualdad,
// nunca por rango/like), y RLS ya se encarga de gimnasio_id, así que nunca
// hace falta pasarlo acá.
const aplicarFiltros = (query, filters) => {
    let q = query;
    Object.entries(filters || {}).forEach(([columna, valor]) => {
        q = q.eq(columna, valor);
    });
    return q;
};

// Pedido de Nalux (04/09/2026): que el panel se pueda seguir viendo si se
// corta el wifi del gimnasio. Cada resultado que trae con éxito se guarda
// en lib/offline.js; si la próxima vez falla por error de RED (no por
// RLS/permiso -- esos se re-lanzan tal cual, mostrar "sin conexión" sería
// mentir), cae a lo último guardado en vez de romper la pantalla. Sin cache
// todavía para esa consulta puntual (primera vez que se pide, sin conexión
// desde el arranque), no hay nada que devolver: se re-lanza el error de red
// como siempre.
export const listAll = async (collection, options = {}) => {
    const { sort, filters } = options;
    let query = supabase.from(collection).select(columnasDe(collection));
    query = aplicarFiltros(query, filters);
    query = aplicarSort(query, sort);
    try {
        const { data, error } = await query;
        if (error) throw error;
        const resultado = data ?? [];
        guardarEnCache(collection, options, resultado);
        return resultado;
    } catch (err) {
        if (esErrorDeRed(err)) {
            const cacheado = leerDeCache(collection, options);
            if (cacheado) return cacheado;
        }
        throw err;
    }
};

export const createRec = async (collection, data) => {
    const gimnasio_id = getCurrentGimnasioId();
    if (!gimnasio_id) {
        throw new Error(
            'No hay un gimnasio activo para este usuario todavía: no se puede crear el registro.',
        );
    }
    const { data: creado, error } = await supabase
        .from(collection)
        .insert({ ...data, gimnasio_id })
        .select(columnasDe(collection))
        .single();
    if (error) throw error;
    return creado;
};

export const updateRec = async (collection, id, data) => {
    const { data: actualizado, error } = await supabase
        .from(collection)
        .update(data)
        .eq('id', id)
        .select(columnasDe(collection))
        .single();
    if (error) throw error;
    return actualizado;
};

export const removeRec = async (collection, id) => {
    const { error } = await supabase.from(collection).delete().eq('id', id);
    if (error) throw error;
};

// Fila de rutinas_asignadas a partir de una rutina de la biblioteca: además
// del vínculo (rutina_id), se COPIA el contenido dentro de la asignación
// (migración 0026). Pedido de Nalux (04/09/2026): editar después esa rutina
// en la biblioteca no tiene que cambiarle nada al alumno que ya la tiene
// asignada -- para actualizársela hay que reasignársela a propósito.
//
// La copia es profunda (JSON.parse/stringify) para que ningún cambio
// posterior en el objeto de la biblioteca que quedó en memoria se filtre a
// lo que ya se guardó. Mismo criterio que ya usa planes_alimentacion.
export const snapshotRutina = (rutina, extra = {}) => ({
    rutina_id: rutina.id,
    rutina_nombre: rutina.nombre,
    rutina_descripcion: rutina.descripcion ?? null,
    rutina_duracion_semanas: rutina.duracion_semanas ?? null,
    items: JSON.parse(JSON.stringify(rutina.items || [])),
    ...extra,
});
