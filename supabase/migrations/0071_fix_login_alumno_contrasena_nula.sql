-- ============================================================================
-- 0071_fix_login_alumno_contrasena_nula.sql
--
-- BUG DE SEGURIDAD CRITICO (28/10/2026, auditoria pre-lanzamiento, confirmado
-- reproduciendolo con un alumno descartable): iniciar_sesion_alumno() dejaba
-- entrar con p_contrasena = NULL.
--
-- Causa: extensions.crypt() es STRICT -- con un argumento NULL devuelve NULL
-- sin calcular nada. Entonces `crypt(NULL, v_hash) <> v_hash` da NULL, el IF
-- trata NULL como falso, NO entra al bloque de "contrasena incorrecta" y la
-- funcion sigue de largo hasta el final: pone el contador en 0 y devuelve el
-- codigo_acceso REAL del alumno. Cualquiera con la clave anon (publica, va en
-- el bundle) y un usuario valido llamaba al RPC con {"p_contrasena": null}
-- y se llevaba el codigo al portador: rutina, fecha de nacimiento, cuota, y
-- la posibilidad de cargar peso y marcar entrenamientos. El bug venia de la
-- 0028 y se arrastro por la 0042.
--
-- Arreglo MINIMO, nada mas que eso: NULL se rechaza como contrasena incorrecta
-- (y cuenta como intento fallido en el contador) y la comparacion pasa a
-- IS DISTINCT FROM, que nunca devuelve NULL. El resto de la funcion queda
-- exactamente igual a la de la 0042. Los demas pendientes que dejo la auditoria
-- sobre este login (contador no atomico, bloqueo de la cuenta por un tercero,
-- usuarios distinguibles, costo del hash) son una decision aparte.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.iniciar_sesion_alumno(p_usuario text, p_contrasena text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_hash TEXT;
  v_codigo TEXT;
  v_intentos INTEGER;
  v_ventana TIMESTAMPTZ;
BEGIN
  p_usuario := left(btrim(COALESCE(p_usuario, '')), 100);

  SELECT id, password_hash, codigo_acceso,
         login_intentos_contador, login_intentos_ventana_inicio
    INTO v_id, v_hash, v_codigo, v_intentos, v_ventana
  FROM public.alumnos
  WHERE lower(usuario) = lower(p_usuario) AND activo = true;

  IF v_id IS NULL OR v_hash IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_ventana IS NOT NULL
     AND v_ventana > now() - INTERVAL '5 minutes'
     AND v_intentos >= 20 THEN
    RAISE EXCEPTION 'Demasiados intentos. Probá de nuevo en unos minutos.';
  END IF;

  IF p_contrasena IS NULL
     OR extensions.crypt(p_contrasena, v_hash) IS DISTINCT FROM v_hash THEN
    UPDATE public.alumnos
       SET login_intentos_contador = CASE
             WHEN login_intentos_ventana_inicio IS NULL
               OR login_intentos_ventana_inicio < now() - INTERVAL '5 minutes'
             THEN 1
             ELSE login_intentos_contador + 1
           END,
           login_intentos_ventana_inicio = CASE
             WHEN login_intentos_ventana_inicio IS NULL
               OR login_intentos_ventana_inicio < now() - INTERVAL '5 minutes'
             THEN now()
             ELSE login_intentos_ventana_inicio
           END
     WHERE id = v_id;
    RETURN NULL;
  END IF;

  UPDATE public.alumnos
     SET login_intentos_contador = 0,
         login_intentos_ventana_inicio = NULL
   WHERE id = v_id;

  RETURN v_codigo;
END;
$function$;
