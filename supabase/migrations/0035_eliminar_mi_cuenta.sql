-- Pedido de Nalux (08/09/2026): poder eliminar la cuenta de profesor, y que
-- al hacerlo se borre TAMBIÉN todo lo que estuvo cargado en esa cuenta
-- ("todo lo que estuvo en esa cuenta por ejemplo tiene que ser borrado").
--
-- Todas las tablas de negocio ya tienen ON DELETE CASCADE hacia gimnasios
-- (alumnos, rutinas, pagos, asistencias, ejercicios propios, planes de
-- alimentación, notificaciones, configuración, progreso -- confirmado
-- revisando information_schema antes de escribir esto). Borrar el gimnasio
-- ya arrastra todo eso solo; profiles es la única excepción a propósito
-- (ON DELETE SET NULL) porque un gimnasio puede tener más de un miembro de
-- staff, y borrar el gimnasio no tiene por qué borrarles la cuenta a todos.
--
-- Distinción admin / staff: si quien elimina su cuenta es el admin (el que
-- creó el gimnasio, o a quien se le asignó ese rol), se borra el GIMNASIO
-- ENTERO con todo lo que tiene adentro -- es su cuenta la que sostiene todos
-- esos datos. Si es staff (se sumó a un gimnasio de otro admin), solo se
-- borra su propio acceso: no correspondería que un empleado borre todo el
-- negocio del dueño solo por eliminar su cuenta personal.
--
-- Los archivos subidos (logo del gimnasio, fotos/videos de ejercicios) viven
-- en storage.objects, ordenados por bucket con el gimnasio_id como primer
-- segmento del path (mismo criterio que ya usan las policies de las
-- migraciones 0003/0005). No cuelgan de gimnasios por una foreign key, así
-- que el CASCADE no los toca solo -- PERO tampoco se pueden borrar acá: un
-- intento de DELETE FROM storage.objects directo por SQL (probado antes de
-- dejar esto así) lo rechaza un trigger de protección propio de Supabase
-- ("Direct deletion from storage tables is not allowed. Use the Storage
-- API instead") -- borrar solo la fila del catálogo dejaría el archivo
-- real huérfano en el storage. Por eso la limpieza de archivos se hace
-- del lado del cliente (eliminarMiCuenta() en supabaseClient.js), listando
-- y removiendo por la Storage API con la sesión del propio admin -- que ya
-- tiene permiso vía esas mismas policies -- ANTES de llamar a esta función.
--
-- Al final se borra de auth.users directamente (en vez del Admin API, que
-- no está disponible desde una función de Postgres): eso invalida la sesión
-- actual y libera el correo para que la persona pueda volver a registrarse
-- si quiere. Las tablas internas de auth (refresh_tokens, sessions,
-- identities, etc.) ya tienen su propio ON DELETE CASCADE hacia auth.users,
-- puesto por Supabase. Confirmado antes de escribir esto que el rol
-- 'postgres' (dueño de esta función) tiene privilegio DELETE directo sobre
-- auth.users en este proyecto.
CREATE OR REPLACE FUNCTION public.eliminar_mi_cuenta()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mi_user_id UUID := auth.uid();
  mi_gimnasio_id UUID;
  mi_rol TEXT;
BEGIN
  IF mi_user_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  SELECT gimnasio_id, role INTO mi_gimnasio_id, mi_rol
  FROM public.profiles
  WHERE id = mi_user_id;

  IF mi_gimnasio_id IS NOT NULL AND mi_rol = 'admin' THEN
    DELETE FROM public.gimnasios WHERE id = mi_gimnasio_id;
  END IF;

  DELETE FROM public.profiles WHERE id = mi_user_id;
  DELETE FROM auth.users WHERE id = mi_user_id;
END;
$function$;
