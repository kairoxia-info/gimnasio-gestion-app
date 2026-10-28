import supabase from '@/lib/supabaseClient';

// Archivos que un alumno deja en Storage:
//  - alumnos-fotos: UNA foto de perfil por alumno, en <gimnasio_id>/<alumno_id>.<ext>
//    (bucket público: quien tenga la URL la ve, por eso no puede quedar suelta).
//  - progreso-fotos: una foto por registro de progreso (foto del cuerpo = dato
//    de salud), el path crudo está en progreso.foto_path (bucket privado).
//
// Hasta el 28/10/2026 "Eliminar alumno" borraba solo la fila y la base borraba
// en cascada el progreso, pero NINGUNA de estas fotos: quedaban en el storage
// para siempre, la de perfil incluso pública. Choca con el derecho de
// supresión (art. 16 Ley 25.326) -- auditoría pre-lanzamiento.
//
// Por qué una consulta directa y no listAll(): listAll() cae a la caché local
// si falla la red, y acá una lista vieja dejaría fotos nuevas sin borrar.
// Si no se puede consultar, se lanza el error y NO se borra nada.

const EXTENSIONES_FOTO = ['png', 'jpg', 'jpeg', 'webp'];
const LOTE = 100;

// La foto se sube con la extensión del tipo de archivo, y al reemplazarla por
// una de otro formato (jpg -> png) la anterior queda con otro nombre. Por eso
// se prueban todas las extensiones posibles: borrar un path que no existe no
// da error, solo devuelve una lista vacía.
export const pathsFotoPerfil = (gimnasioId, alumnoId) =>
    EXTENSIONES_FOTO.map((ext) => `${gimnasioId}/${alumnoId}.${ext}`);

const borrarEnLotes = async (bucket, paths) => {
    for (let i = 0; i < paths.length; i += LOTE) {
        const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + LOTE));
        if (error) throw error;
    }
};

// Borra la foto de perfil y todas las fotos de progreso del alumno. Lanza si
// algo falla, para que quien llama NO borre la fila y el profesor pueda
// reintentar (con la fila borrada ya no habría forma de encontrar los archivos).
export const borrarArchivosDeAlumno = async (gimnasioId, alumnoId) => {
    if (!gimnasioId || !alumnoId) throw new Error('Faltan datos para borrar los archivos del alumno.');

    const { data: registros, error } = await supabase
        .from('progreso')
        .select('foto_path')
        .eq('alumno_id', alumnoId)
        .not('foto_path', 'is', null);
    if (error) throw error;

    const pathsProgreso = (registros || []).map((r) => r.foto_path).filter(Boolean);

    await borrarEnLotes('alumnos-fotos', pathsFotoPerfil(gimnasioId, alumnoId));
    await borrarEnLotes('progreso-fotos', pathsProgreso);
};

// Al subir una foto nueva: saca las versiones con OTRA extensión que hubieran
// quedado de una foto anterior. Mejor esfuerzo -- si falla, la foto nueva ya
// está subida y guardada, no hay por qué mostrarle un error al profesor.
export const borrarFotoPerfilAnterior = async (gimnasioId, alumnoId, pathNuevo) => {
    try {
        const viejas = pathsFotoPerfil(gimnasioId, alumnoId).filter((p) => p !== pathNuevo);
        await supabase.storage.from('alumnos-fotos').remove(viejas);
    } catch (_) {
        // mejor esfuerzo
    }
};
