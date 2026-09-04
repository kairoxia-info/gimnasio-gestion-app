-- Nalux pidió que "Pendiente" también se pueda marcar a mano (ej. "se anotó
-- pero todavía no arrancó"), no solo automático por autorregistro vía QR. Se
-- agrega una columna booleana propia en vez de derivarlo de `origen`, para
-- que el profesor pueda ponerla/sacarla en CUALQUIER alumno, manual o
-- autorregistrado. Regla de lectura (ver estadoAlumno() en format.js):
-- `activo` siempre gana -- un alumno activo nunca se muestra "pendiente"
-- aunque el flag haya quedado prendido.

ALTER TABLE public.alumnos
  ADD COLUMN pendiente BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.alumnos.pendiente IS
  'Alumno cargado pero todavía no activado -- por autorregistro (esperando aprobación) o cargado a mano por el profesor a propósito (ej. "se anotó pero no arrancó"). Sin efecto si activo=true: ese siempre gana en la UI (ver estadoAlumno() en apps/web/src/lib/format.js).';

-- join_gimnasio_por_codigo(): la única función que ya insertaba alumnos con
-- origen='autorregistro' -- se actualiza para dejarlos también en
-- pendiente=true (antes esto se inferia de origen; ahora hace falta
-- setearlo explícito porque el default de la columna es false). Sin cambios
-- en el resto de la lógica (rate limit, validación de código, etc.) --
-- comparar contra 0004_autorregistro_alumnos.sql línea por línea.
CREATE OR REPLACE FUNCTION public.join_gimnasio_por_codigo(p_codigo text, p_nombre text, p_contacto text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_plan_precio_nombre text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gimnasio_id UUID;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id INTO v_gimnasio_id
  FROM public.gimnasios
  WHERE codigo_invitacion = p_codigo AND autorregistro_activo = true;

  IF v_gimnasio_id IS NULL THEN
    RAISE EXCEPTION 'Código de invitación inválido';
  END IF;

  IF (
    SELECT count(*) FROM (
      SELECT 1 FROM public.alumnos
      WHERE gimnasio_id = v_gimnasio_id
        AND origen = 'autorregistro'
        AND created_at > now() - INTERVAL '5 minutes'
      LIMIT 50
    ) reciente
  ) >= 50 THEN
    RAISE EXCEPTION 'Demasiadas solicitudes de autorregistro en poco tiempo, proba de nuevo en unos minutos';
  END IF;

  IF p_nombre IS NULL OR btrim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;

  p_nombre             := left(btrim(p_nombre), 200);
  p_contacto           := left(p_contacto, 200);
  p_email              := left(p_email, 200);
  p_plan_precio_nombre := left(p_plan_precio_nombre, 200);

  INSERT INTO public.alumnos (
    gimnasio_id, nombre, contacto, email, plan_precio_nombre,
    fecha_alta, activo, pendiente, origen
  ) VALUES (
    v_gimnasio_id,
    p_nombre,
    p_contacto,
    p_email,
    p_plan_precio_nombre,
    CURRENT_DATE,
    false,
    true,
    'autorregistro'
  );
END;
$function$;
