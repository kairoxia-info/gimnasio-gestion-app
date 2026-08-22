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
