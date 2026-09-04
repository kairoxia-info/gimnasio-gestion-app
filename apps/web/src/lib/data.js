import supabase from '@/lib/supabaseClient';
import { getCurrentGimnasioId } from '@/lib/currentGimnasio';

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

export const listAll = async (collection, options = {}) => {
    const { sort, filters } = options;
    let query = supabase.from(collection).select('*');
    query = aplicarFiltros(query, filters);
    query = aplicarSort(query, sort);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
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
        .select()
        .single();
    if (error) throw error;
    return creado;
};

export const updateRec = async (collection, id, data) => {
    const { data: actualizado, error } = await supabase
        .from(collection)
        .update(data)
        .eq('id', id)
        .select()
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
