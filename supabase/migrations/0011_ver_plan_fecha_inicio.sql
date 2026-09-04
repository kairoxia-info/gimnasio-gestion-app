-- Nalux trajo un PDF de ejemplo con el rango de fechas de la rutina
-- ("11/08 – 10/09") arriba de todo. rutinas_asignadas.fecha_inicio ya existe
-- (0001) y ya se usa en AlumnoPage.jsx, pero ver_plan_por_codigo() nunca la
-- devolvía -- se agrega como rutina_fecha_inicio para que el PDF de
-- MiPlanPage.jsx pueda calcular el rango (fecha_inicio -> fecha_inicio +
-- duracion_semanas). DROP FUNCTION + CREATE OR REPLACE porque cambia la
-- firma de RETURNS TABLE (agregar una columna a un RETURNS TABLE existente
-- no se puede con un simple CREATE OR REPLACE, mismo motivo que 0007).
--
-- Resto de la lógica (rate limit, segmento, avisos, enriquecido de
-- mediaUrl) sin tocar -- comparado línea por línea contra 0007 antes de
-- aplicar.

DROP FUNCTION IF EXISTS public.ver_plan_por_codigo(text);

CREATE FUNCTION public.ver_plan_por_codigo(p_codigo text)
 RETURNS TABLE(
   alumno_nombre text,
   gimnasio_nombre text,
   gimnasio_logo_url text,
   gimnasio_color_principal text,
   rutina_nombre text,
   rutina_descripcion text,
   rutina_duracion_semanas integer,
   rutina_fecha_inicio date,
   rutina_items jsonb,
   plan_nombre text,
   plan_notas text,
   plan_items jsonb,
   aviso_id uuid,
   aviso_titulo text,
   aviso_mensaje text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alumno_id     UUID;
  v_gimnasio_id   UUID;
  v_alumno_nombre TEXT;
  v_gim_nombre    TEXT;
  v_gim_logo      TEXT;
  v_gim_color     TEXT;
  v_rut_nombre    TEXT;
  v_rut_desc      TEXT;
  v_rut_semanas   INTEGER;
  v_rut_inicio    DATE;
  v_rut_items     JSONB;
  v_plan_nombre   TEXT;
  v_plan_notas    TEXT;
  v_plan_items    JSONB;
  v_contador      INTEGER;
  v_periodo_hasta  DATE;
  v_monto_adeudado NUMERIC;
  v_dias           INTEGER;
  v_segmento       TEXT;
  v_aviso_id       UUID;
  v_aviso_titulo   TEXT;
  v_aviso_mensaje  TEXT;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id, nombre
    INTO v_alumno_id, v_gimnasio_id, v_alumno_nombre
  FROM public.alumnos
  WHERE codigo_acceso = p_codigo AND activo = true;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'Código de acceso inválido';
  END IF;

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

  SELECT nombre, logo_url, color_principal
    INTO v_gim_nombre, v_gim_logo, v_gim_color
  FROM public.gimnasios
  WHERE id = v_gimnasio_id;

  SELECT r.nombre, r.descripcion, r.duracion_semanas, ra.fecha_inicio, r.items
    INTO v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_inicio, v_rut_items
  FROM public.rutinas_asignadas ra
  JOIN public.rutinas r ON r.id = ra.rutina_id
  WHERE ra.alumno_id = v_alumno_id
    AND ra.gimnasio_id = v_gimnasio_id
    AND ra.activa = true
  ORDER BY ra.created_at DESC
  LIMIT 1;

  IF v_rut_items IS NOT NULL AND jsonb_typeof(v_rut_items) = 'array' THEN
    SELECT COALESCE(jsonb_agg(s.item_con_media ORDER BY s.ord), '[]'::jsonb)
      INTO v_rut_items
    FROM (
      SELECT
        t.ord,
        t.item || jsonb_build_object(
          'mediaUrl',
          (SELECT e.media_url
             FROM public.ejercicios e
            WHERE e.gimnasio_id = v_gimnasio_id
              AND e.id::text = t.item->>'ejercicioId')
        ) AS item_con_media
      FROM jsonb_array_elements(v_rut_items) WITH ORDINALITY AS t(item, ord)
    ) s;
  END IF;

  SELECT pa.nombre, pa.notas, pa.items
    INTO v_plan_nombre, v_plan_notas, v_plan_items
  FROM public.planes_alimentacion pa
  WHERE pa.alumno_id = v_alumno_id
    AND pa.gimnasio_id = v_gimnasio_id
  ORDER BY pa.created_at DESC
  LIMIT 1;

  -- Segmento del alumno, mismo criterio que DashboardPage.jsx/format.js
  -- (estadoDesdeVencimiento), mas con_deuda/sin_cuota. Desempate por
  -- created_at si dos pagos comparten periodo_hasta (fix de auditoria).
  SELECT p.periodo_hasta, p.monto_adeudado
    INTO v_periodo_hasta, v_monto_adeudado
  FROM public.pagos p
  WHERE p.alumno_id = v_alumno_id
    AND p.gimnasio_id = v_gimnasio_id
  ORDER BY p.periodo_hasta DESC NULLS LAST, p.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    v_segmento := 'sin_cuota';
  ELSIF COALESCE(v_monto_adeudado, 0) > 0 THEN
    v_segmento := 'con_deuda';
  ELSIF v_periodo_hasta IS NULL THEN
    v_segmento := 'vencido';
  ELSE
    v_dias := v_periodo_hasta - CURRENT_DATE;
    IF v_dias < 0 THEN
      v_segmento := 'vencido';
    ELSIF v_dias <= 7 THEN
      v_segmento := 'proximo';
    ELSE
      v_segmento := 'al_dia';
    END IF;
  END IF;

  SELECT n.id, n.titulo, n.mensaje
    INTO v_aviso_id, v_aviso_titulo, v_aviso_mensaje
  FROM public.notificaciones n
  WHERE n.gimnasio_id = v_gimnasio_id
    AND n.activa = true
    AND (n.segmento = 'todos' OR n.segmento = v_segmento)
    AND NOT EXISTS (
      SELECT 1
      FROM public.notificaciones_leidas nl
      WHERE nl.notificacion_id = n.id
        AND nl.alumno_id = v_alumno_id
    )
  ORDER BY n.created_at DESC
  LIMIT 1;

  RETURN QUERY
    SELECT
      v_alumno_nombre,
      v_gim_nombre, v_gim_logo, v_gim_color,
      v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_inicio, v_rut_items,
      v_plan_nombre, v_plan_notas, v_plan_items,
      v_aviso_id, v_aviso_titulo, v_aviso_mensaje;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ver_plan_por_codigo(text) TO anon, authenticated;
