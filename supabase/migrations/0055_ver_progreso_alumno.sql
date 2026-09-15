-- ============================================================================
-- 0055_ver_progreso_alumno.sql
--
-- 15/09/2026, pedido de Nalux: separar el panel del alumno (/mi-plan/:codigo)
-- en pestañas -- rutina, alimentación, y una nueva de "progreso" que sirva
-- como motivación. Hasta acá el alumno solo podía CARGAR su peso de hoy
-- (alumno_cargar_peso(), migración 0050) -- no había ninguna forma de que
-- viera su propia evolución ni un empujón para seguir entrenando. Esta
-- función es de solo lectura, exclusiva para esa pestaña nueva: nunca antes
-- existió una función pública que le devolviera al alumno su propio
-- historial.
--
-- Devuelve dos cosas en un solo viaje:
--   - Los últimos 10 registros de progreso.peso (de cualquier origen --
--     tanto lo que cargó el alumno como lo que midió el profesor: el
--     alumno tiene derecho a ver su propia evolución completa, no solo la
--     mitad que cargó él mismo).
--   - Cuántos entrenamientos marcó como hechos en los últimos 7 días (la
--     "racha" -- entrenamientos_completados, migración 0050).
--
-- Mismo patrón de siempre: resuelve el alumno por codigo_acceso + activo,
-- nunca por un ID que venga del cliente. Comparte el contador de "ver el
-- plan" (60 cada 5 minutos) en vez de sumar un cuarto contador -- es la
-- misma acción de fondo ("el alumno está mirando su pantalla"), no una
-- escritura nueva que necesite su propio límite.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ver_progreso_alumno(p_codigo TEXT)
RETURNS TABLE(
    historial_peso JSONB,
    entrenamientos_ultima_semana INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alumno_id     UUID;
  v_gimnasio_id   UUID;
  v_contador      INTEGER;
  v_historial     JSONB;
  v_entrenamientos INTEGER;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id INTO v_alumno_id, v_gimnasio_id
  FROM public.alumnos
  WHERE codigo_acceso = p_codigo AND activo = true;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'Codigo de acceso invalido';
  END IF;

  -- Mismo contador y mismo límite que ver_plan_por_codigo() (migración
  -- 0006/0042: 60 consultas cada 5 minutos) -- ver el comentario de arriba
  -- sobre por qué comparte el bucket en vez de tener uno propio.
  UPDATE public.alumnos
    SET
      plan_consultas_contador = CASE
        WHEN plan_consultas_ventana_inicio IS NULL
          OR plan_consultas_ventana_inicio < now() - INTERVAL '5 minutes'
        THEN 1
        ELSE plan_consultas_contador + 1
      END,
      plan_consultas_ventana_inicio = CASE
        WHEN plan_consultas_ventana_inicio IS NULL
          OR plan_consultas_ventana_inicio < now() - INTERVAL '5 minutes'
        THEN now()
        ELSE plan_consultas_ventana_inicio
      END
    WHERE id = v_alumno_id
      AND (
        plan_consultas_ventana_inicio IS NULL
        OR plan_consultas_ventana_inicio < now() - INTERVAL '5 minutes'
        OR plan_consultas_contador < 60
      )
    RETURNING plan_consultas_contador INTO v_contador;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demasiadas consultas en poco tiempo, proba de nuevo en unos minutos';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('fecha', f, 'peso', pe) ORDER BY f), '[]'::jsonb)
    INTO v_historial
  FROM (
    SELECT fecha AS f, peso AS pe
    FROM public.progreso
    WHERE alumno_id = v_alumno_id AND peso IS NOT NULL
    ORDER BY fecha DESC
    LIMIT 10
  ) ultimos;

  SELECT count(*) INTO v_entrenamientos
  FROM public.entrenamientos_completados
  WHERE alumno_id = v_alumno_id
    AND fecha >= CURRENT_DATE - INTERVAL '6 days';

  RETURN QUERY SELECT v_historial, v_entrenamientos;
END;
$function$;

REVOKE ALL ON FUNCTION public.ver_progreso_alumno(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_progreso_alumno(TEXT) TO anon, authenticated;

-- ============================================================================
-- Fin de la migración 0055.
-- ============================================================================
