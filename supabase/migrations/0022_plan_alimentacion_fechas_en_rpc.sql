-- PDF de plan de alimentación con la marca del gimnasio, pedido de Nalux
-- (04/09/2026): "lo mismo que hicimos con rutinas pero aplicarlo a
-- alimentación". planes_alimentacion ya tenía fecha_inicio/fecha_fin
-- (migración 0012_vencimiento_planes.sql) pero ver_plan_por_codigo() nunca
-- las seleccionaba -- por eso el PDF del alumno nunca podía mostrar desde
-- cuándo hasta cuándo es el plan, a diferencia de la rutina (que sí expone
-- rutina_fecha_inicio desde 0011_ver_plan_fecha_inicio.sql).
--
-- Mismo patrón de siempre para esta función: DROP + CREATE porque agrega
-- columnas al RETURNS TABLE (CREATE OR REPLACE no puede cambiar eso), y se
-- vuelve a otorgar el GRANT al final porque el DROP se lo lleva.
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
   plan_fecha_inicio date,
   plan_fecha_fin date,
   aviso_id uuid,
   aviso_titulo text,
   aviso_mensaje text,
   cuota_vence date,
   cuota_estado text,
   cuota_aviso_titulo text,
   cuota_aviso_mensaje text,
   rutina_restringida boolean,
   alimentacion_restringida boolean
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alumno_id     UUID;
  v_gimnasio_id   UUID;
  v_alumno_nombre TEXT;
  v_alumno_plan   TEXT;
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
  v_plan_inicio   DATE;
  v_plan_fin      DATE;
  v_contador      INTEGER;
  v_periodo_hasta  DATE;
  v_monto_adeudado NUMERIC;
  v_dias           INTEGER;
  v_segmento       TEXT;
  v_aviso_id       UUID;
  v_aviso_titulo   TEXT;
  v_aviso_mensaje  TEXT;
  v_cuota_activo   BOOLEAN;
  v_cuota_titulo   TEXT;
  v_cuota_mensaje  TEXT;
  v_dias_aviso     INTEGER;
  v_mostrar_cuota  BOOLEAN;
  v_gracia         INTEGER;
  v_politica       TEXT;
  v_restr_rutina   BOOLEAN;
  v_restr_alim     BOOLEAN;
  v_vencido_op     BOOLEAN;
  v_rut_bloqueada  BOOLEAN;
  v_alim_bloqueada BOOLEAN;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id, nombre, plan_precio_nombre
    INTO v_alumno_id, v_gimnasio_id, v_alumno_nombre, v_alumno_plan
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

  SELECT nombre, logo_url, color_principal,
         aviso_cuota_activo, aviso_cuota_titulo, aviso_cuota_mensaje, dias_aviso_vencimiento,
         dias_gracia_cuota, politica_vencimiento_cuota, restringir_rutina, restringir_alimentacion
    INTO v_gim_nombre, v_gim_logo, v_gim_color,
         v_cuota_activo, v_cuota_titulo, v_cuota_mensaje, v_dias_aviso,
         v_gracia, v_politica, v_restr_rutina, v_restr_alim
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

  SELECT pa.nombre, pa.notas, pa.items, pa.fecha_inicio, pa.fecha_fin
    INTO v_plan_nombre, v_plan_notas, v_plan_items, v_plan_inicio, v_plan_fin
  FROM public.planes_alimentacion pa
  WHERE pa.alumno_id = v_alumno_id
    AND pa.gimnasio_id = v_gimnasio_id
  ORDER BY pa.created_at DESC
  LIMIT 1;

  -- Segmento del alumno, mismo criterio que DashboardPage.jsx/format.js
  -- (estadoDesdeVencimiento), mas con_deuda/sin_cuota. Desempate por
  -- created_at si dos pagos comparten periodo_hasta (fix de auditoria).
  --
  -- OJO: el "<= 7" de abajo queda HARDCODEADO a proposito, aunque ahora
  -- exista gimnasios.dias_aviso_vencimiento. Este bloque esta espejado en
  -- segmentoNotificacion() (lib/format.js), que es lo que cuenta la audiencia
  -- de los avisos en la pantalla del profesor; si uno usara la config y el
  -- otro no, el contador "X / Y leyeron" mentiria. La config se usa mas abajo,
  -- solo para decidir si mostrar el recordatorio automatico.
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

  -- Recordatorio automatico de cuota. Se muestra si el gimnasio lo tiene
  -- prendido Y el alumno esta atrasado, debe plata, o le falta poco para
  -- vencer (esa ventana si sale de dias_aviso_vencimiento). Al alumno sin
  -- ninguna cuota cargada NO se le muestra: nunca pago, no es que se atraso.
  v_mostrar_cuota := COALESCE(v_cuota_activo, false)
    AND (
      v_segmento IN ('vencido', 'con_deuda')
      OR (
        v_periodo_hasta IS NOT NULL
        AND (v_periodo_hasta - CURRENT_DATE) BETWEEN 0 AND COALESCE(v_dias_aviso, 7)
      )
    )
    AND v_segmento <> 'sin_cuota';

  IF v_mostrar_cuota THEN
    v_cuota_titulo := replace(COALESCE(v_cuota_titulo, ''), '{nombre}', COALESCE(v_alumno_nombre, ''));
    v_cuota_titulo := replace(v_cuota_titulo, '{vence}', COALESCE(to_char(v_periodo_hasta, 'DD/MM/YYYY'), ''));
    v_cuota_titulo := replace(v_cuota_titulo, '{plan}', COALESCE(v_alumno_plan, ''));
    v_cuota_titulo := replace(v_cuota_titulo, '{gimnasio}', COALESCE(v_gim_nombre, ''));

    v_cuota_mensaje := replace(COALESCE(v_cuota_mensaje, ''), '{nombre}', COALESCE(v_alumno_nombre, ''));
    v_cuota_mensaje := replace(v_cuota_mensaje, '{vence}', COALESCE(to_char(v_periodo_hasta, 'DD/MM/YYYY'), ''));
    v_cuota_mensaje := replace(v_cuota_mensaje, '{plan}', COALESCE(v_alumno_plan, ''));
    v_cuota_mensaje := replace(v_cuota_mensaje, '{gimnasio}', COALESCE(v_gim_nombre, ''));
  ELSE
    v_cuota_titulo := NULL;
    v_cuota_mensaje := NULL;
  END IF;

  -- Vencido "de verdad" para decidir restricción: a diferencia de v_segmento
  -- (arriba, que NO usa el período de gracia a propósito, para no
  -- desincronizar el contador de audiencia de avisos), acá SÍ se respeta
  -- dias_gracia_cuota -- es la misma cuenta operativa que ya usa el
  -- profesor en Pagos/Dashboard (estadoCuota() en lib/format.js). "sin_cuota"
  -- (nunca cargó un pago) nunca cuenta como vencido acá: no se atrasó,
  -- nunca tuvo una fecha para atrasarse.
  v_vencido_op := FALSE;
  IF v_segmento <> 'sin_cuota' THEN
    IF COALESCE(v_monto_adeudado, 0) > 0 THEN
      v_vencido_op := TRUE;
    ELSIF v_periodo_hasta IS NULL THEN
      v_vencido_op := TRUE;
    ELSIF (CURRENT_DATE - v_periodo_hasta) > COALESCE(v_gracia, 0) THEN
      v_vencido_op := TRUE;
    END IF;
  END IF;

  -- Rutina y plan de alimentación se restringen CADA UNO por su cuenta
  -- (pedido de Nalux, 03/09/2026: "no restrinja las dos juntas" -- son dos
  -- casillas separadas en Configuración, restringir_rutina/
  -- restringir_alimentacion, ambas leídas más arriba). Las dos comparten el
  -- mismo disparador (cuota vencida, v_vencido_op) -- lo único que cambia es
  -- SI cada tipo de contenido participa de la restricción o no.
  v_rut_bloqueada := v_politica = 'restringir' AND v_restr_rutina AND v_vencido_op;
  v_alim_bloqueada := v_politica = 'restringir' AND v_restr_alim AND v_vencido_op;

  -- Bloqueada de verdad: ni la rutina ni el plan de comidas viajan en la
  -- respuesta cuando corresponde. No es solo un cartel tapando el contenido
  -- en el front -- acá no se manda, porque esta RPC no tiene sesión ni
  -- control de quién mira la respuesta cruda (es SECURITY DEFINER, pública
  -- por código).
  IF v_rut_bloqueada THEN
    v_rut_nombre := NULL;
    v_rut_desc := NULL;
    v_rut_semanas := NULL;
    v_rut_inicio := NULL;
    v_rut_items := NULL;
  END IF;

  IF v_alim_bloqueada THEN
    v_plan_nombre := NULL;
    v_plan_notas := NULL;
    v_plan_items := NULL;
    v_plan_inicio := NULL;
    v_plan_fin := NULL;
  END IF;

  RETURN QUERY
    SELECT
      v_alumno_nombre,
      v_gim_nombre, v_gim_logo, v_gim_color,
      v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_inicio, v_rut_items,
      v_plan_nombre, v_plan_notas, v_plan_items, v_plan_inicio, v_plan_fin,
      v_aviso_id, v_aviso_titulo, v_aviso_mensaje,
      v_periodo_hasta, v_segmento, v_cuota_titulo, v_cuota_mensaje,
      v_rut_bloqueada, v_alim_bloqueada;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ver_plan_por_codigo(text) TO anon, authenticated;
