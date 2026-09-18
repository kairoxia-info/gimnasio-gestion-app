-- ============================================================================
-- 0063_fix_contador_aceptar_terminos.sql
--
-- Otro bug real de la 0061, encontrado probando en local junto con el de la
-- 0062: aceptar_terminos_alumno() usaba las columnas compartidas
-- escritura_intentos_contador/_ventana_inicio, copiadas del patrón de la
-- migración 0050 -- pero esas columnas ya NO EXISTEN, la migración 0052
-- (14/09/2026) las eliminó a propósito porque un contador compartido entre
-- acciones distintas hace que agotar el tope de una trabe a la otra (mismo
-- error que ya se había corregido antes, en la 0042, para otro par de
-- funciones). 0052 las reemplazó por un par de columnas POR ACCIÓN
-- (marcar_entreno_*, cargar_peso_*). aceptar_terminos_alumno() necesita su
-- propio par, siguiendo ese mismo criterio -- nunca reusar el compartido que
-- ya se sacó, aunque el comentario de la 0050 todavía lo mencione (quedó
-- desactualizado, no se toca esa migración vieja).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 — Contador propio de esta acción
-- ----------------------------------------------------------------------------
ALTER TABLE public.alumnos
    ADD COLUMN IF NOT EXISTS aceptar_terminos_contador INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS aceptar_terminos_ventana_inicio TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 — aceptar_terminos_alumno(): mismo cuerpo de la 0061, cambiando
-- solo las columnas del rate limit.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aceptar_terminos_alumno(
    p_codigo         TEXT,
    p_acepta_datos   BOOLEAN,
    p_acepta_deslinde BOOLEAN,
    p_tutor_nombre   TEXT DEFAULT NULL,
    p_tutor_dni      TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alumno_id   UUID;
  v_tutor_nombre TEXT;
  v_tutor_dni    TEXT;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id INTO v_alumno_id
  FROM public.alumnos
  WHERE codigo_acceso = p_codigo AND activo = true;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'Codigo de acceso invalido';
  END IF;

  UPDATE public.alumnos
    SET aceptar_terminos_contador = CASE
          WHEN aceptar_terminos_ventana_inicio IS NULL
            OR aceptar_terminos_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN 1
          ELSE aceptar_terminos_contador + 1
        END,
        aceptar_terminos_ventana_inicio = CASE
          WHEN aceptar_terminos_ventana_inicio IS NULL
            OR aceptar_terminos_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN now()
          ELSE aceptar_terminos_ventana_inicio
        END
    WHERE id = v_alumno_id
      AND (
        aceptar_terminos_ventana_inicio IS NULL
        OR aceptar_terminos_ventana_inicio < now() - INTERVAL '5 minutes'
        OR aceptar_terminos_contador < 30
      );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demasiadas acciones en poco tiempo, proba de nuevo en unos minutos';
  END IF;

  IF NOT COALESCE(p_acepta_datos, false) OR NOT COALESCE(p_acepta_deslinde, false) THEN
    RAISE EXCEPTION 'Hay que aceptar los dos puntos para continuar';
  END IF;

  v_tutor_nombre := NULLIF(left(btrim(COALESCE(p_tutor_nombre, '')), 200), '');
  v_tutor_dni    := NULLIF(left(btrim(COALESCE(p_tutor_dni, '')), 50), '');

  IF (v_tutor_nombre IS NULL) <> (v_tutor_dni IS NULL) THEN
    RAISE EXCEPTION 'Si acepta un tutor, hacen falta su nombre y su DNI';
  END IF;

  UPDATE public.alumnos
    SET aceptacion_datos_en     = now(),
        aceptacion_deslinde_en  = now(),
        aceptacion_tutor_nombre = v_tutor_nombre,
        aceptacion_tutor_dni    = v_tutor_dni
    WHERE id = v_alumno_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.aceptar_terminos_alumno(TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aceptar_terminos_alumno(TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- Fin de la migración 0063.
-- ============================================================================
