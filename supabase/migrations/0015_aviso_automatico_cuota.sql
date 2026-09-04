-- Aviso automático de vencimiento de cuota, pedido por Nalux (03/09/2026).
--
-- Diseño: NO genera filas. No se crea un aviso por alumno por día -- eso
-- llenaría `notificaciones` de registros que nadie escribió (mismo criterio
-- que ya se aplicó en asistencia y en la deuda). Hay UNA plantilla por
-- gimnasio y `ver_plan_por_codigo()` la arma al vuelo, con las variables ya
-- reemplazadas, solo para el alumno al que le corresponde.
--
-- Por eso tampoco pasa por `notificaciones_leidas`: no hay acuse de lectura
-- de algo que no existe como fila. Es un recordatorio que aparece mientras la
-- condición se cumple y desaparece solo cuando el alumno paga.
--
-- Variables soportadas: {nombre} {vence} {plan} {gimnasio}

ALTER TABLE public.gimnasios
  ADD COLUMN aviso_cuota_activo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN aviso_cuota_titulo TEXT DEFAULT 'Tu cuota está por vencer',
  ADD COLUMN aviso_cuota_mensaje TEXT DEFAULT
    'Hola {nombre}, tu cuota del plan {plan} vence el {vence}. Pasá por {gimnasio} para renovarla y seguir entrenando.';

-- Firma nueva (4 columnas más), así que hay que DROP + CREATE: CREATE OR
-- REPLACE no puede cambiar el RETURNS TABLE. Ojo que el DROP se lleva los
-- GRANT puestos a mano -- se vuelven a otorgar al final, como en 0011.
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
   aviso_mensaje text,
   cuota_vence date,
   cuota_estado text,
   cuota_aviso_titulo text,
   cuota_aviso_mensaje text
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
         aviso_cuota_activo, aviso_cuota_titulo, aviso_cuota_mensaje, dias_aviso_vencimiento
    INTO v_gim_nombre, v_gim_logo, v_gim_color,
         v_cuota_activo, v_cuota_titulo, v_cuota_mensaje, v_dias_aviso
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

  RETURN QUERY
    SELECT
      v_alumno_nombre,
      v_gim_nombre, v_gim_logo, v_gim_color,
      v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_inicio, v_rut_items,
      v_plan_nombre, v_plan_notas, v_plan_items,
      v_aviso_id, v_aviso_titulo, v_aviso_mensaje,
      v_periodo_hasta, v_segmento, v_cuota_titulo, v_cuota_mensaje;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ver_plan_por_codigo(text) TO anon, authenticated;
