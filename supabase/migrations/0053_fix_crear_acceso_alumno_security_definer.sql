-- ============================================================================
-- 0053_fix_crear_acceso_alumno_security_definer.sql
--
-- Bug reportado por Nalux (14/09/2026), probado en la URL real: "hubo un
-- error al darle el permiso a un alumno" y "ya hay otro error al crear el
-- login para el panel del alumno" -- las dos pantallas mostraban
-- "permission denied for table alumnos".
--
-- CAUSA RAÍZ: `crear_acceso_alumno()` y `quitar_acceso_alumno()` (migración
-- 0028) NUNCA fueron SECURITY DEFINER -- corrían con los permisos del
-- profesor logueado (SECURITY INVOKER, el default), a propósito, según el
-- comentario original de esa migración: "así el UPDATE de abajo sigue
-- pasando por la política RLS de alumnos". El comentario de la migración
-- 0051 (repaso de seguridad de ayer) asumió mal que estas dos funciones YA
-- eran SECURITY DEFINER, y les sacó -- correctamente para el resto de la
-- tabla, pero rompiendo justo estas dos -- el permiso de columna sobre
-- `password_hash` y `codigo_acceso` para el rol `authenticated`. Sin ese
-- permiso, el UPDATE que hacen estas dos funciones (que necesita escribir
-- exactamente esas dos columnas) falla con "permission denied for table
-- alumnos" apenas se ejecuta con la sesión real de una profesora.
--
-- FIX: se convierten las dos a SECURITY DEFINER (mismo patrón ya usado en
-- toda la app: regenerar_codigo_acceso_alumno, iniciar_sesion_alumno,
-- marcar_entrenamiento_hecho...), agregando el chequeo explícito
-- `AND gimnasio_id = get_mi_gimnasio_id()` en el WHERE del UPDATE -- lo
-- mismo que antes hacía la policy de RLS de forma automática, ahora hecho a
-- mano porque SECURITY DEFINER bypasea RLS. Sin este chequeo, cualquier
-- profesor podría tocar el acceso de un alumno de OTRO gimnasio con solo
-- adivinar su UUID -- por eso no alcanza con sacarle SECURITY INVOKER a
-- secas, hace falta sumar la validación que RLS hacía gratis.
--
-- Se usa CREATE OR REPLACE (no DROP+CREATE): la firma no cambia (mismos
-- parámetros, mismo RETURNS void), solo el cuerpo y la propiedad de
-- seguridad -- así se preservan los GRANT EXECUTE que ya tenían, no hace
-- falta re-otorgarlos.
--
-- Verificado que no hay más funciones en esta misma situación: de las 11
-- funciones SECURITY DEFINER/INVOKER que tocan `alumnos`, estas eran las
-- únicas 2 con prosecdef=false que escriben columnas fuera de la lista
-- blanca de la 0051 (chequeado contra pg_proc antes de escribir esta
-- migración). Tampoco hay ningún `supabase.from('alumnos').update(...)`
-- directo en el frontend que toque columnas fuera de esa lista -- todos
-- pasan por `columnasDe()` en `lib/data.js` o por una RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crear_acceso_alumno(
  p_alumno_id UUID,
  p_usuario TEXT,
  p_contrasena TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  p_usuario := btrim(COALESCE(p_usuario, ''));

  IF length(p_usuario) < 3 THEN
    RAISE EXCEPTION 'El usuario tiene que tener al menos 3 caracteres.';
  END IF;

  IF length(COALESCE(p_contrasena, '')) < 8 THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos 8 caracteres.';
  END IF;

  IF p_contrasena !~ '[A-Z]' THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos una letra mayúscula.';
  END IF;

  UPDATE public.alumnos
     SET usuario = p_usuario,
         password_hash = extensions.crypt(p_contrasena, extensions.gen_salt('bf')),
         codigo_acceso = encode(extensions.gen_random_bytes(16), 'hex')
   WHERE id = p_alumno_id
     AND gimnasio_id = public.get_mi_gimnasio_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el alumno.';
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ese usuario ya lo tiene otro alumno -- probá con otro.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.quitar_acceso_alumno(p_alumno_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.alumnos
     SET usuario = NULL,
         password_hash = NULL,
         codigo_acceso = encode(extensions.gen_random_bytes(16), 'hex')
   WHERE id = p_alumno_id
     AND gimnasio_id = public.get_mi_gimnasio_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el alumno.';
  END IF;
END;
$function$;

-- ============================================================================
-- Fin de la migración 0053.
-- ============================================================================
