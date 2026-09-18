-- ============================================================================
-- 0061_aceptacion_terminos_alumno.sql
--
-- Punto 2 de los gaps legales antes de vender a un segundo gimnasio (pedido
-- de Nalux, 18/09/2026): un solo punto de aceptación para CUALQUIER alumno
-- (se haya autorregistrado o lo haya cargado el profesor a mano), la primera
-- vez que entra de verdad a ver su plan -- no en el alta, que hoy no
-- garantiza que el alumno mismo haya leído nada.
--
-- Dos consentimientos DISTINTOS, con su propio timestamp cada uno (nunca un
-- "acepto todo" genérico): tratamiento de datos personales (Ley 25.326,
-- referencia al texto de /terminos) y asunción de riesgo/exoneración de
-- responsabilidad por lesiones (cláusula civil, jurisprudencia de gimnasios
-- en Argentina). Guardar esto reemplaza al checkbox de UnirsePage.jsx
-- (11/09/2026), que a propósito no persistía nada -- esa pantalla sigue
-- mostrando su aviso, pero la aceptación con valor legal real pasa a vivir
-- acá.
--
-- Si es menor de edad, dos campos de texto sueltos (nombre y DNI del tutor,
-- SIN verificación de identidad -- no hace falta más para esta etapa), y el
-- modal en el cliente arma el texto "Yo, [tutor], en representación de
-- [alumno]...". No se agregan a los permisos por columna de la migración
-- 0051 (GRANT SELECT/UPDATE/INSERT a `authenticated`): ninguna pantalla del
-- profesor los lee todavía, mismo criterio que esa migración ya usó para
-- dejar afuera columnas sin uso (dni, los contadores) -- si el día de mañana
-- se quiere mostrar "Términos aceptados" en la ficha del alumno, se suma ahí
-- con su propia migración chica.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 — Columnas nuevas
-- ----------------------------------------------------------------------------
ALTER TABLE public.alumnos
  ADD COLUMN aceptacion_datos_en     TIMESTAMPTZ,
  ADD COLUMN aceptacion_deslinde_en  TIMESTAMPTZ,
  ADD COLUMN aceptacion_tutor_nombre TEXT,
  ADD COLUMN aceptacion_tutor_dni    TEXT;

COMMENT ON COLUMN public.alumnos.aceptacion_datos_en IS
  'Cuándo aceptó el alumno (o su tutor) el tratamiento de sus datos personales (Ley 25.326). NULL = todavía no aceptó -- MiPlanPage.jsx muestra el modal bloqueante mientras sea NULL.';
COMMENT ON COLUMN public.alumnos.aceptacion_deslinde_en IS
  'Cuándo aceptó el alumno (o su tutor) la cláusula de asunción de riesgo / exoneración de responsabilidad por lesiones. Consentimiento DISTINTO de aceptacion_datos_en a propósito -- son de naturaleza jurídica distinta.';
COMMENT ON COLUMN public.alumnos.aceptacion_tutor_nombre IS
  'Si el alumno es menor de edad, nombre de quien aceptó en su representación (madre/padre/tutor). NULL si aceptó el propio alumno.';
COMMENT ON COLUMN public.alumnos.aceptacion_tutor_dni IS
  'DNI del tutor que aceptó en representación de un alumno menor, sin verificación de identidad. NULL si aceptó el propio alumno.';

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 — aceptar_terminos_alumno()
--
-- Mismo patrón que marcar_entrenamiento_hecho()/alumno_cargar_peso()
-- (migración 0050): resuelve el alumno por codigo_acceso + activo=true,
-- nunca por un ID que mande el cliente, SECURITY DEFINER, y comparte el
-- mismo rate limit de escritura (escritura_intentos_*, 30 cada 5 minutos) --
-- es una acción de escritura del alumno más, no hace falta un contador
-- aparte.
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.aceptar_terminos_alumno(
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
    SET escritura_intentos_contador = CASE
          WHEN escritura_intentos_ventana_inicio IS NULL
            OR escritura_intentos_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN 1
          ELSE escritura_intentos_contador + 1
        END,
        escritura_intentos_ventana_inicio = CASE
          WHEN escritura_intentos_ventana_inicio IS NULL
            OR escritura_intentos_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN now()
          ELSE escritura_intentos_ventana_inicio
        END
    WHERE id = v_alumno_id
      AND (
        escritura_intentos_ventana_inicio IS NULL
        OR escritura_intentos_ventana_inicio < now() - INTERVAL '5 minutes'
        OR escritura_intentos_contador < 30
      );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demasiadas acciones en poco tiempo, proba de nuevo en unos minutos';
  END IF;

  -- Los dos consentimientos son obligatorios para que este llamado tenga
  -- sentido: el modal del cliente ya no deja tocar "Aceptar y continuar"
  -- sin los dos tildados, pero se revalida acá porque el cliente nunca es
  -- confiable -- nada le impide a alguien llamar la RPC directo.
  IF NOT COALESCE(p_acepta_datos, false) OR NOT COALESCE(p_acepta_deslinde, false) THEN
    RAISE EXCEPTION 'Hay que aceptar los dos puntos para continuar';
  END IF;

  -- Tutor: los dos campos van juntos o ninguno -- un nombre sin DNI (o al
  -- revés) no sirve como identificación de quién aceptó.
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

-- ----------------------------------------------------------------------------
-- SECCIÓN 3 — ver_plan_por_codigo(): agrega fecha de nacimiento + los dos
-- timestamps de aceptación
--
-- MiPlanPage.jsx necesita los tres para decidir si tiene que mostrar el
-- modal bloqueante (cualquiera de los dos timestamps en NULL) y si ya se
-- sabe la fecha de nacimiento del alumno (para no volver a preguntar si es
-- menor cuando ya se cargó antes, en el alta o en el autorregistro).
--
-- DROP + CREATE porque cambia el RETURNS TABLE -- se agregan las 3 columnas
-- AL FINAL de la lista, mismo criterio que las migraciones anteriores de
-- esta función (dias_completados_hoy también se agregó al final en la
-- 0050), para no reordenar nada de lo que ya depende de la posición.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.ver_plan_por_codigo(TEXT);

CREATE FUNCTION public.ver_plan_por_codigo(p_codigo TEXT)
RETURNS TABLE(
    alumno_nombre TEXT,
    gimnasio_nombre TEXT,
    gimnasio_logo_url TEXT,
    gimnasio_color_principal TEXT,
    rutina_nombre TEXT,
    rutina_descripcion TEXT,
    rutina_duracion_semanas INTEGER,
    rutina_fecha_inicio DATE,
    rutina_fecha_fin DATE,
    rutina_items JSONB,
    plan_nombre TEXT,
    plan_notas TEXT,
    plan_fecha_inicio DATE,
    plan_fecha_fin DATE,
    plan_items JSONB,
    aviso_id UUID,
    aviso_titulo TEXT,
    aviso_mensaje TEXT,
    cuota_vence DATE,
    cuota_estado TEXT,
    cuota_aviso_titulo TEXT,
    cuota_aviso_mensaje TEXT,
    rutina_restringida BOOLEAN,
    alimentacion_restringida BOOLEAN,
    dias_completados_hoy JSONB,
    alumno_fecha_nacimiento DATE,
    aceptacion_datos_en TIMESTAMPTZ,
    aceptacion_deslinde_en TIMESTAMPTZ
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
  v_alumno_fnac   DATE;
  v_acept_datos   TIMESTAMPTZ;
  v_acept_deslinde TIMESTAMPTZ;
  v_gim_nombre    TEXT;
  v_gim_logo      TEXT;
  v_gim_color     TEXT;
  v_rut_nombre    TEXT;
  v_rut_desc      TEXT;
  v_rut_semanas   INTEGER;
  v_rut_inicio    DATE;
  v_rut_fin       DATE;
  v_rut_items     JSONB;
  v_rut_asignada_id UUID;
  v_plan_nombre   TEXT;
  v_plan_notas    TEXT;
  v_plan_inicio   DATE;
  v_plan_fin      DATE;
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
  v_gracia         INTEGER;
  v_politica       TEXT;
  v_restr_rutina   BOOLEAN;
  v_restr_alim     BOOLEAN;
  v_vencido_op     BOOLEAN;
  v_rut_bloqueada  BOOLEAN;
  v_alim_bloqueada BOOLEAN;
  v_dias_hoy       JSONB;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id, nombre, plan_precio_nombre, fecha_nacimiento,
         aceptacion_datos_en, aceptacion_deslinde_en
    INTO v_alumno_id, v_gimnasio_id, v_alumno_nombre, v_alumno_plan, v_alumno_fnac,
         v_acept_datos, v_acept_deslinde
  FROM public.alumnos
  WHERE codigo_acceso = p_codigo AND activo = true;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'Codigo de acceso invalido';
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

  SELECT ra.id,
         COALESCE(ra.rutina_nombre, r.nombre),
         COALESCE(ra.rutina_descripcion, r.descripcion),
         COALESCE(ra.rutina_duracion_semanas, r.duracion_semanas),
         ra.fecha_inicio,
         ra.fecha_fin,
         ra.items
    INTO v_rut_asignada_id, v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_inicio, v_rut_fin, v_rut_items
  FROM public.rutinas_asignadas ra
  LEFT JOIN public.rutinas r ON r.id = ra.rutina_id
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
            WHERE (e.gimnasio_id = v_gimnasio_id OR e.gimnasio_id IS NULL)
              AND e.id::text = t.item->>'ejercicioId')
        ) AS item_con_media
      FROM jsonb_array_elements(v_rut_items) WITH ORDINALITY AS t(item, ord)
    ) s;
  END IF;

  SELECT COALESCE(jsonb_agg(ec.semana || '|' || ec.dia), '[]'::jsonb)
    INTO v_dias_hoy
  FROM public.entrenamientos_completados ec
  WHERE ec.alumno_id = v_alumno_id
    AND ec.rutina_asignada_id = v_rut_asignada_id
    AND ec.fecha = CURRENT_DATE;

  SELECT pa.nombre, pa.notas, pa.fecha_inicio, pa.fecha_fin, pa.items
    INTO v_plan_nombre, v_plan_notas, v_plan_inicio, v_plan_fin, v_plan_items
  FROM public.planes_alimentacion pa
  WHERE pa.alumno_id = v_alumno_id
    AND pa.gimnasio_id = v_gimnasio_id
  ORDER BY pa.created_at DESC
  LIMIT 1;

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

  v_rut_bloqueada := v_politica = 'restringir' AND v_restr_rutina AND v_vencido_op;
  v_alim_bloqueada := v_politica = 'restringir' AND v_restr_alim AND v_vencido_op;

  IF v_rut_bloqueada THEN
    v_rut_nombre := NULL;
    v_rut_desc := NULL;
    v_rut_semanas := NULL;
    v_rut_inicio := NULL;
    v_rut_fin := NULL;
    v_rut_items := NULL;
  END IF;

  IF v_alim_bloqueada THEN
    v_plan_nombre := NULL;
    v_plan_notas := NULL;
    v_plan_inicio := NULL;
    v_plan_fin := NULL;
    v_plan_items := NULL;
  END IF;

  RETURN QUERY
    SELECT
      v_alumno_nombre,
      v_gim_nombre, v_gim_logo, v_gim_color,
      v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_inicio, v_rut_fin, v_rut_items,
      v_plan_nombre, v_plan_notas, v_plan_inicio, v_plan_fin, v_plan_items,
      v_aviso_id, v_aviso_titulo, v_aviso_mensaje,
      v_periodo_hasta, v_segmento, v_cuota_titulo, v_cuota_mensaje,
      v_rut_bloqueada, v_alim_bloqueada,
      v_dias_hoy,
      v_alumno_fnac, v_acept_datos, v_acept_deslinde;
END;
$function$;

REVOKE ALL ON FUNCTION public.ver_plan_por_codigo(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_plan_por_codigo(TEXT) TO anon, authenticated;

-- ============================================================================
-- Fin de la migración 0061.
-- ============================================================================
