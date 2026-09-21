-- ============================================================================
-- 0068_noticias.sql
--
-- Pedido de Nalux (21/09/2026), visto en un video de un competidor (Control
-- Gym): un banner con imagen en el portal del alumno. Módulo NUEVO, separado
-- de Avisos (que sigue igual: mensajes de texto con "Entendido" y control de
-- quién leyó). Una noticia es solo una imagen que el gimnasio sube, con un
-- interruptor activa/inactiva -- sin editor de tamaño, sin video, sin texto.
--
-- El alumno ve UNA sola: la activa más reciente, arriba de todo en su portal.
-- Si no hay ninguna activa, no ve nada. La trae ver_plan_por_codigo() (por
-- eso esa función se rehace acá, con `noticia_imagen_url` al final), nunca
-- lee la tabla directo -- el alumno no tiene sesión.
--
-- Tabla + bucket con el mismo patrón que ya se usa tres veces en el proyecto
-- (ejercicios-media 0005, alumnos-fotos 0036, gimnasio-logos 0003):
--   * el archivo se llama como el id de la fila ({gimnasio_id}/{uuid}.ext),
--     y la policy de INSERT del bucket exige que esa fila exista en el
--     gimnasio del que sube -- así nadie puede amontonar archivos sueltos;
--   * lectura pública del bucket (es contenido para mostrarle a alumnos sin
--     sesión, no hay datos personales), escritura solo del propio gimnasio;
--   * NUNCA tocar los GRANT de storage.objects (tabla compartida por todos
--     los buckets -- ver la advertencia larga en 0003).
--
-- `orden` queda en la tabla como pidió Nalux, pero hoy NO hay pantalla que lo
-- edite (todas quedan en 0, y desempata created_at). Está para que si algún
-- día se quiere elegir cuál se muestra primero, no haga falta migración.
--
-- Al borrar la cuenta (eliminar_mi_cuenta) la tabla se va sola por el ON
-- DELETE CASCADE; los archivos del bucket los limpia AuthContext.eliminarCuenta
-- -- ese archivo se actualiza en la misma tanda para incluir este bucket
-- (mismo bug que se corrigió el 16/09 para alumnos-fotos y progreso-fotos).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 — Tabla
-- ----------------------------------------------------------------------------
CREATE TABLE public.noticias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  imagen_url   TEXT,
  activa       BOOLEAN NOT NULL DEFAULT true,
  orden        INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_noticias_gimnasio_id ON public.noticias (gimnasio_id);

COMMENT ON TABLE public.noticias IS
  'Banners con imagen que el gimnasio muestra en el portal del alumno (una a la vez: la activa más reciente). Separado de notificaciones (Avisos), que son texto. imagen_url queda NULL entre crear la fila y terminar la subida -- ver_plan_por_codigo() ignora esas filas.';
COMMENT ON COLUMN public.noticias.orden IS
  'Reservado para ordenar a mano cuál se muestra primero. Hoy ninguna pantalla lo edita (todas en 0); desempata created_at DESC.';

ALTER TABLE public.noticias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "noticias_tenant_isolation" ON public.noticias
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.noticias TO authenticated;
REVOKE ALL ON public.noticias FROM anon;

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 — Bucket 'noticias-imagenes'
-- 5 MB (no 2 como el logo): un banner suele ser una foto del celular, que
-- pesa más que un logo chico. Igual se comprime poco: el alumno la baja en
-- datos móviles.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'noticias-imagenes',
  'noticias-imagenes',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "noticias_imagenes_select_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'noticias-imagenes');

-- INSERT: solo dentro de la carpeta del propio gimnasio, solo con el nombre
-- {uuid}.{png|jpg|jpeg|webp}, y solo si esa fila de noticias existe en el
-- gimnasio de quien sube -- mismo anclaje que ejercicios-media (0005).
CREATE POLICY "noticias_imagenes_insert_staff" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'noticias-imagenes'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(png|jpe?g|webp)$'
    )
    AND EXISTS (
      SELECT 1 FROM public.noticias n
      WHERE n.gimnasio_id = public.get_mi_gimnasio_id()
        AND n.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  );

-- UPDATE: para el upsert: true del SDK (re-subir al mismo path).
CREATE POLICY "noticias_imagenes_update_staff" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'noticias-imagenes'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(png|jpe?g|webp)$'
    )
  )
  WITH CHECK (
    bucket_id = 'noticias-imagenes'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(png|jpe?g|webp)$'
    )
  );

-- DELETE: cualquier archivo de la propia carpeta (sin anclar el nombre, para
-- poder limpiar huérfanos -- mismo criterio que 0003 2.4).
CREATE POLICY "noticias_imagenes_delete_staff" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'noticias-imagenes'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
  );

-- ----------------------------------------------------------------------------
-- SECCIÓN 3 — ver_plan_por_codigo(): agrega noticia_imagen_url (al final)
-- DROP + CREATE porque cambia el RETURNS TABLE. Cuerpo idéntico a la 0067
-- salvo el SELECT nuevo de la noticia y la columna de salida.
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
    aceptacion_deslinde_en TIMESTAMPTZ,
    alias_mercadopago TEXT,
    noticia_imagen_url TEXT
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
  v_gim_alias_mp  TEXT;
  v_noticia_url   TEXT;
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

  SELECT a.id, a.gimnasio_id, a.nombre, a.plan_precio_nombre, a.fecha_nacimiento,
         a.aceptacion_datos_en, a.aceptacion_deslinde_en
    INTO v_alumno_id, v_gimnasio_id, v_alumno_nombre, v_alumno_plan, v_alumno_fnac,
         v_acept_datos, v_acept_deslinde
  FROM public.alumnos a
  WHERE a.codigo_acceso = p_codigo AND a.activo = true;

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

  SELECT g.nombre, g.logo_url, g.color_principal, g.alias_mercadopago,
         g.aviso_cuota_activo, g.aviso_cuota_titulo, g.aviso_cuota_mensaje, g.dias_aviso_vencimiento,
         g.dias_gracia_cuota, g.politica_vencimiento_cuota, g.restringir_rutina, g.restringir_alimentacion
    INTO v_gim_nombre, v_gim_logo, v_gim_color, v_gim_alias_mp,
         v_cuota_activo, v_cuota_titulo, v_cuota_mensaje, v_dias_aviso,
         v_gracia, v_politica, v_restr_rutina, v_restr_alim
  FROM public.gimnasios g
  WHERE g.id = v_gimnasio_id;

  -- Noticia activa más reciente con imagen ya subida (imagen_url NULL = la
  -- fila se creó pero la subida no terminó o falló: no se muestra).
  SELECT n.imagen_url
    INTO v_noticia_url
  FROM public.noticias n
  WHERE n.gimnasio_id = v_gimnasio_id
    AND n.activa = true
    AND n.imagen_url IS NOT NULL
  ORDER BY n.orden DESC, n.created_at DESC
  LIMIT 1;

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
    IF v_periodo_hasta IS NULL THEN
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
      v_alumno_fnac, v_acept_datos, v_acept_deslinde,
      NULLIF(btrim(v_gim_alias_mp), ''),
      v_noticia_url;
END;
$function$;

REVOKE ALL ON FUNCTION public.ver_plan_por_codigo(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_plan_por_codigo(TEXT) TO anon, authenticated;

-- ============================================================================
-- Fin de la migración 0068.
-- ============================================================================
