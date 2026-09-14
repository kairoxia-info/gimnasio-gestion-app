-- ============================================================================
-- 0050_alumno_escribe_progreso.sql
--
-- Fases 2.6 (Tareas) + 2.7 (historial de cargas), 13/09/2026. Decisión
-- explícita de Nalux, preguntada antes de tocar código: el alumno puede por
-- primera vez ESCRIBIR algo desde /mi-plan/:codigo, con el diseño más
-- simple posible -- "Marcar como hecho" en el entrenamiento del día, y un
-- campo chico para cargar el peso de hoy. Hasta acá, /mi-plan/:codigo era
-- 100% de solo lectura.
--
-- Dos funciones públicas nuevas (SECURITY DEFINER, mismo patrón que
-- ver_plan_por_codigo/iniciar_sesion_alumno): resuelven el alumno por
-- codigo_acceso + activo=true, nunca por un ID que venga del cliente, y
-- comparten un rate limit propio (escritura_intentos_*) -- 30 acciones cada
-- 5 minutos, separado del de "ver el plan" (60/5min) y del de "login"
-- (20/5min): son acciones distintas, no tiene sentido que gastarle a un
-- alumno el contador de una bloquee la otra (mismo error que ya se corrigió
-- en la migración 0042 compartiendo el contador de "ver plan" con "login").
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 — Tablas y columnas nuevas
-- ----------------------------------------------------------------------------

-- Un registro por cada vez que el alumno marca "hice el entrenamiento de
-- este día". El UNIQUE evita duplicados si toca el botón varias veces el
-- mismo día para el mismo día de rutina -- no sirve de nada guardar 5 filas
-- idénticas.
CREATE TABLE public.entrenamientos_completados (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id         UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  alumno_id           UUID NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  rutina_asignada_id  UUID REFERENCES public.rutinas_asignadas(id) ON DELETE CASCADE,
  semana              INTEGER NOT NULL DEFAULT 1,
  dia                 TEXT NOT NULL,
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (alumno_id, rutina_asignada_id, semana, dia, fecha)
);

CREATE INDEX idx_entrenamientos_completados_alumno_id ON public.entrenamientos_completados (alumno_id);
CREATE INDEX idx_entrenamientos_completados_gimnasio_id ON public.entrenamientos_completados (gimnasio_id);

ALTER TABLE public.entrenamientos_completados ENABLE ROW LEVEL SECURITY;

-- El alumno NUNCA toca esta tabla directo (no tiene sesión de auth.users
-- para que RLS lo identifique) -- solo entra por la función SECURITY
-- DEFINER de más abajo, que ya resuelve el alumno por código. Esta policy
-- es para que el PROFESOR la vea/gestione desde el panel, mismo criterio de
-- siempre.
CREATE POLICY "entrenamientos_completados_tenant_isolation" ON public.entrenamientos_completados
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entrenamientos_completados TO authenticated;
REVOKE ALL ON public.entrenamientos_completados FROM anon;

-- origen distingue quién cargó cada registro de progreso -- hasta ahora
-- SIEMPRE lo cargaba el profesor; a partir de esta migración también puede
-- venir del alumno (alumno_cargar_peso() más abajo). Sirve para que el
-- profesor entienda, mirando el historial, qué es dato propio y qué le
-- llegó del alumno.
ALTER TABLE public.progreso
    ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'profesor'
      CHECK (origen IN ('profesor', 'alumno'));

-- Rate limit propio para las dos funciones de escritura de esta migración.
ALTER TABLE public.alumnos
    ADD COLUMN IF NOT EXISTS escritura_intentos_contador INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS escritura_intentos_ventana_inicio TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 — marcar_entrenamiento_hecho()
--
-- La asignación de rutina activa se resuelve DENTRO de la función (mismo
-- query que ya hace ver_plan_por_codigo), nunca a partir de un
-- rutina_asignada_id que mande el cliente -- así no hace falta confiar en
-- ningún ID que venga de afuera, alcanza con el código de acceso.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_entrenamiento_hecho(
    p_codigo TEXT,
    p_semana INTEGER,
    p_dia TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alumno_id           UUID;
  v_gimnasio_id         UUID;
  v_rutina_asignada_id  UUID;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id INTO v_alumno_id, v_gimnasio_id
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

  IF p_dia IS NULL OR btrim(p_dia) = '' THEN
    RAISE EXCEPTION 'Dia invalido';
  END IF;

  SELECT id INTO v_rutina_asignada_id
  FROM public.rutinas_asignadas
  WHERE alumno_id = v_alumno_id AND gimnasio_id = v_gimnasio_id AND activa = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_rutina_asignada_id IS NULL THEN
    RAISE EXCEPTION 'No hay una rutina activa para marcar';
  END IF;

  INSERT INTO public.entrenamientos_completados
    (gimnasio_id, alumno_id, rutina_asignada_id, semana, dia, fecha)
  VALUES (
    v_gimnasio_id, v_alumno_id, v_rutina_asignada_id,
    GREATEST(1, COALESCE(p_semana, 1)), left(btrim(p_dia), 50), CURRENT_DATE
  )
  ON CONFLICT (alumno_id, rutina_asignada_id, semana, dia, fecha) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_entrenamiento_hecho(TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_entrenamiento_hecho(TEXT, INTEGER, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- SECCIÓN 3 — alumno_cargar_peso()
--
-- Un solo registro de progreso por día con origen='alumno': si ya cargó hoy,
-- se actualiza en vez de acumular filas -- mismo criterio que "sin datos
-- basura" del resto de la app, no tiene sentido guardar 3 pesadas del mismo
-- día como si fueran mediciones distintas.
-- ----------------------------------------------------------------------------
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
  v_alumno_id       UUID;
  v_gimnasio_id     UUID;
  v_progreso_hoy_id UUID;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id INTO v_alumno_id, v_gimnasio_id
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

  IF p_peso IS NULL OR p_peso <= 0 OR p_peso > 400 THEN
    RAISE EXCEPTION 'Peso invalido';
  END IF;

  SELECT id INTO v_progreso_hoy_id
  FROM public.progreso
  WHERE alumno_id = v_alumno_id AND fecha = CURRENT_DATE AND origen = 'alumno'
  LIMIT 1;

  IF v_progreso_hoy_id IS NOT NULL THEN
    UPDATE public.progreso SET peso = p_peso WHERE id = v_progreso_hoy_id;
  ELSE
    INSERT INTO public.progreso (gimnasio_id, alumno_id, fecha, peso, origen)
    VALUES (v_gimnasio_id, v_alumno_id, CURRENT_DATE, p_peso, 'alumno');
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.alumno_cargar_peso(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.alumno_cargar_peso(TEXT, NUMERIC) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- SECCIÓN 4 — ver_plan_por_codigo(): agrega dias_completados_hoy
--
-- DROP + CREATE porque cambia el RETURNS TABLE (agrega una columna al
-- final) -- eso borra los GRANTs, por eso se re-otorgan al final (mismo
-- error ya evitado en migraciones anteriores de esta función).
--
-- dias_completados_hoy es un array de "semana|dia" (ej. ["1|Dia 1"]) de lo
-- que el alumno YA marco hoy -- asi el frontend pinta el boton como
-- "Completado" en vez de "Marcar como hecho" sin tener que llamar a otra
-- funcion aparte.
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
    rutina_items JSONB,
    plan_nombre TEXT,
    plan_notas TEXT,
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
    dias_completados_hoy JSONB
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
  v_rut_asignada_id UUID;
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

  SELECT id, gimnasio_id, nombre, plan_precio_nombre
    INTO v_alumno_id, v_gimnasio_id, v_alumno_nombre, v_alumno_plan
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
         ra.items
    INTO v_rut_asignada_id, v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_inicio, v_rut_items
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

  SELECT pa.nombre, pa.notas, pa.items
    INTO v_plan_nombre, v_plan_notas, v_plan_items
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
    v_rut_items := NULL;
  END IF;

  IF v_alim_bloqueada THEN
    v_plan_nombre := NULL;
    v_plan_notas := NULL;
    v_plan_items := NULL;
  END IF;

  RETURN QUERY
    SELECT
      v_alumno_nombre,
      v_gim_nombre, v_gim_logo, v_gim_color,
      v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_inicio, v_rut_items,
      v_plan_nombre, v_plan_notas, v_plan_items,
      v_aviso_id, v_aviso_titulo, v_aviso_mensaje,
      v_periodo_hasta, v_segmento, v_cuota_titulo, v_cuota_mensaje,
      v_rut_bloqueada, v_alim_bloqueada,
      v_dias_hoy;
END;
$function$;

REVOKE ALL ON FUNCTION public.ver_plan_por_codigo(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_plan_por_codigo(TEXT) TO anon, authenticated;

-- ============================================================================
-- Fin de la migración 0050.
-- ============================================================================
