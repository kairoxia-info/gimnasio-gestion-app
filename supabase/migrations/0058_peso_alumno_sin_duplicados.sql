-- ============================================================================
-- Migración 0058 — alumno_cargar_peso() ya no puede crear dos filas del
-- mismo día
-- ============================================================================
-- Encontrado en la auditoría final del proyecto (15/09/2026, agente
-- database-architect): alumno_cargar_peso() (0052 SECCIÓN 3) resolvía "¿ya
-- cargó peso hoy?" con un SELECT y recién después decidía INSERT o UPDATE,
-- sin ningún lock ni constraint que lo respalde. Dos llamadas casi
-- simultáneas (doble toque en el botón, o dos pestañas del mismo alumno
-- abiertas) podían colarse las dos por el mismo SELECT antes de que
-- cualquiera de las dos llegara a escribir, y terminar en DOS filas de
-- progreso para el mismo alumno+día en vez de una. Impacto bajo (es el
-- propio dato del alumno, no cruza tenant), pero es un bug real y la
-- corrección es barata.
--
-- Se agrega un índice único PARCIAL (alumno_id, fecha) WHERE origen =
-- 'alumno' -- parcial porque NO se quiere restringir los registros que
-- carga el PROFESOR (esos ya funcionan sin este límite desde 0001 y no es
-- parte de este bug), solo los que el propio alumno carga a través de
-- alumno_cargar_peso(). Confirmado antes de aplicar que hoy no existe
-- ningún duplicado real en producción (ver verificación en el chat) -- el
-- índice se puede crear sin conflictos.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_progreso_alumno_fecha_origen_alumno
  ON public.progreso (alumno_id, fecha)
  WHERE origen = 'alumno';

-- Mismo cuerpo que 0052 SECCIÓN 3, cambiando el SELECT-y-después-decido por
-- un único INSERT ... ON CONFLICT atómico contra el índice de arriba: ya no
-- hay ninguna ventana entre "leer si existe" y "escribir" donde dos
-- llamadas puedan pisarse.
CREATE OR REPLACE FUNCTION public.alumno_cargar_peso(
    p_codigo TEXT,
    p_peso NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alumno_id   UUID;
  v_gimnasio_id UUID;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id INTO v_alumno_id, v_gimnasio_id
  FROM public.alumnos
  WHERE codigo_acceso = p_codigo AND activo = true;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'Codigo de acceso invalido';
  END IF;

  UPDATE public.alumnos
    SET cargar_peso_contador = CASE
          WHEN cargar_peso_ventana_inicio IS NULL
            OR cargar_peso_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN 1
          ELSE cargar_peso_contador + 1
        END,
        cargar_peso_ventana_inicio = CASE
          WHEN cargar_peso_ventana_inicio IS NULL
            OR cargar_peso_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN now()
          ELSE cargar_peso_ventana_inicio
        END
    WHERE id = v_alumno_id
      AND (
        cargar_peso_ventana_inicio IS NULL
        OR cargar_peso_ventana_inicio < now() - INTERVAL '5 minutes'
        OR cargar_peso_contador < 30
      );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demasiadas acciones en poco tiempo, proba de nuevo en unos minutos';
  END IF;

  IF p_peso IS NULL OR p_peso <= 0 OR p_peso > 400 THEN
    RAISE EXCEPTION 'Peso invalido';
  END IF;

  INSERT INTO public.progreso (gimnasio_id, alumno_id, fecha, peso, origen)
  VALUES (v_gimnasio_id, v_alumno_id, CURRENT_DATE, p_peso, 'alumno')
  ON CONFLICT (alumno_id, fecha) WHERE origen = 'alumno'
  DO UPDATE SET peso = EXCLUDED.peso;
END;
$function$;

REVOKE ALL ON FUNCTION public.alumno_cargar_peso(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.alumno_cargar_peso(TEXT, NUMERIC) TO anon, authenticated;
