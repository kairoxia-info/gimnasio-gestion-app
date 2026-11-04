-- ============================================================================
-- 0091_control_plataforma.sql
--
-- Pedido de Nalux (03/11/2026): un panel para ella, la dueña de RutNail, donde ver de un vistazo cómo
-- están TODAS las cuentas (cuentas nuevas, suscripciones, pagos de Mercado Pago, errores) y hacer un
-- chequeo cada semana, sin entrar al SQL Editor. Más adelante lo va a consultar también un bot de
-- Telegram (por eso plataforma_resumen() acepta service_role).
--
-- DECISIONES DE DISEÑO:
--
-- 1. Quién es "dueña de la plataforma" lo dice la tabla admins_plataforma, no un rol de gimnasio: el
--    administrador de un gimnasio (profiles/membresias rol 'admin') es un CLIENTE y nunca debe ver datos
--    de otras cuentas. La tabla no tiene políticas ni GRANT: solo se lee desde funciones SECURITY DEFINER.
--    Se carga con la cuenta de Nalux (nadiatecera13@gmail.com, la de Mi GYM FIT).
--
-- 2. eventos_sistema guarda los problemas del lado del servidor (hoy: los avisos de Mercado Pago que
--    fallan o no se reconocen). Los registros propios de Supabase duran 1 día en el plan gratis; esto
--    queda hasta que se borre. Solo escribe registrar_evento_sistema(), concedida únicamente a
--    service_role (las Edge Functions), con tope anti-bucle: el mismo mensaje del mismo origen no se
--    guarda más de 20 veces cada 10 minutos (alguien martillando el webhook con firmas falsas no llena
--    la tabla).
--
-- 3. plataforma_resumen() devuelve todo en un solo jsonb (una sola consulta por carga del panel). No
--    expone datos de alumnos: de cada cuenta solo cantidades. Sí expone el correo del dueño de cada
--    cuenta (es el cliente de RutNail, Nalux necesita poder contactarlo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 — Dueños de la plataforma
-- ----------------------------------------------------------------------------
CREATE TABLE public.admins_plataforma (
  user_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admins_plataforma IS
  'Dueños de RutNail (no de un gimnasio): ven el panel Control de RutNail. Sin políticas ni GRANT; solo la leen funciones SECURITY DEFINER (migración 0091).';

ALTER TABLE public.admins_plataforma ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admins_plataforma FROM anon, authenticated;

INSERT INTO public.admins_plataforma (user_id)
SELECT id FROM auth.users WHERE lower(email) = 'nadiatecera13@gmail.com'
ON CONFLICT DO NOTHING;

CREATE FUNCTION public.es_admin_plataforma()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.admins_plataforma WHERE user_id = auth.uid())
$function$;

REVOKE ALL ON FUNCTION public.es_admin_plataforma() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.es_admin_plataforma() FROM anon;
GRANT EXECUTE ON FUNCTION public.es_admin_plataforma() TO authenticated;

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 — Problemas del servidor
-- ----------------------------------------------------------------------------
CREATE TABLE public.eventos_sistema (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origen          TEXT NOT NULL,
  nivel           TEXT NOT NULL CHECK (nivel IN ('error', 'aviso')),
  mensaje         TEXT NOT NULL,
  detalle         JSONB,
  organizacion_id UUID REFERENCES public.organizaciones(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_eventos_sistema_creado_en ON public.eventos_sistema (creado_en DESC);

COMMENT ON TABLE public.eventos_sistema IS
  'Problemas del lado del servidor (Edge Functions). Escribe solo registrar_evento_sistema() (service_role); se lee desde plataforma_resumen() (migración 0091).';

ALTER TABLE public.eventos_sistema ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.eventos_sistema FROM anon, authenticated;

CREATE FUNCTION public.registrar_evento_sistema(
    p_origen  TEXT,
    p_nivel   TEXT,
    p_mensaje TEXT,
    p_detalle JSONB DEFAULT NULL,
    p_org     UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_origen    TEXT := left(btrim(coalesce(p_origen, '')), 60);
  v_mensaje   TEXT := left(btrim(coalesce(p_mensaje, '')), 500);
  v_recientes INTEGER;
BEGIN
  IF v_origen = '' OR v_mensaje = '' OR p_nivel NOT IN ('error', 'aviso') THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_recientes
  FROM public.eventos_sistema
  WHERE origen = v_origen AND mensaje = v_mensaje AND creado_en > now() - INTERVAL '10 minutes';

  IF v_recientes >= 20 THEN
    RETURN;  -- tope anti-bucle, sin fallar
  END IF;

  INSERT INTO public.eventos_sistema (origen, nivel, mensaje, detalle, organizacion_id)
  VALUES (
    v_origen,
    p_nivel,
    v_mensaje,
    CASE WHEN p_detalle IS NULL OR pg_column_size(p_detalle) <= 8000 THEN p_detalle
         ELSE jsonb_build_object('recortado', true) END,
    CASE WHEN EXISTS (SELECT 1 FROM public.organizaciones WHERE id = p_org) THEN p_org END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_evento_sistema(TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_evento_sistema(TEXT, TEXT, TEXT, JSONB, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.registrar_evento_sistema(TEXT, TEXT, TEXT, JSONB, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_evento_sistema(TEXT, TEXT, TEXT, JSONB, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- SECCIÓN 3 — plataforma_resumen()
-- ----------------------------------------------------------------------------
-- p_dias: período del resumen (7 = la semana; entre 1 y 90).
CREATE FUNCTION public.plataforma_resumen(p_dias INTEGER DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_desde TIMESTAMPTZ;
BEGIN
  IF NOT (public.es_admin_plataforma() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'NO_AUTORIZADO' USING ERRCODE = '42501';
  END IF;

  v_desde := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 7), 90)));

  RETURN jsonb_build_object(
    'generado_en', now(),
    'desde', v_desde,

    'periodo', jsonb_build_object(
      'cuentas_nuevas', (SELECT count(*) FROM public.organizaciones WHERE created_at >= v_desde),
      'pruebas_por_vencer', (
        SELECT count(*) FROM public.suscripciones
        WHERE estado = 'prueba' AND vence_en BETWEEN now() AND now() + INTERVAL '3 days'),
      'solo_lectura', (
        SELECT count(*) FROM public.suscripciones s
        WHERE s.estado <> 'cortesia' AND public.suscripcion_acceso(s.organizacion_id) = 'solo_lectura'),
      'bloqueadas', (
        SELECT count(*) FROM public.suscripciones s
        WHERE s.estado <> 'cortesia' AND public.suscripcion_acceso(s.organizacion_id) = 'bloqueado'),
      'pagos_aprobados', (
        SELECT count(*) FROM public.suscripcion_eventos
        WHERE tipo = 'pago' AND estado = 'approved' AND creado_en >= v_desde),
      'monto_aprobado', (
        SELECT coalesce(sum(monto), 0) FROM public.suscripcion_eventos
        WHERE tipo = 'pago' AND estado = 'approved' AND creado_en >= v_desde),
      'pagos_rechazados', (
        SELECT count(*) FROM public.suscripcion_eventos
        WHERE tipo = 'pago' AND estado NOT IN ('approved', 'pending', 'in_process', 'authorized')
          AND creado_en >= v_desde),
      'cancelaciones', (
        SELECT count(*) FROM public.suscripcion_eventos
        WHERE tipo = 'suscripcion' AND estado = 'cancelled' AND creado_en >= v_desde),
      'errores', (SELECT count(*) FROM public.errores_cliente WHERE created_at >= v_desde),
      'problemas_servidor', (
        SELECT count(*) FROM public.eventos_sistema WHERE nivel = 'error' AND creado_en >= v_desde),
      'avisos_servidor', (
        SELECT count(*) FROM public.eventos_sistema WHERE nivel = 'aviso' AND creado_en >= v_desde)
    ),

    -- Una fila por cuenta (organización), la más nueva primero.
    'cuentas', (
      SELECT coalesce(jsonb_agg(c.fila ORDER BY c.creada_en DESC), '[]'::jsonb)
      FROM (
        SELECT
          o.created_at AS creada_en,
          jsonb_build_object(
            'id', o.id,
            'nombre', o.nombre,
            'dueno_email', u.email,
            'creada_en', o.created_at,
            'gimnasios', (
              SELECT coalesce(jsonb_agg(g.nombre ORDER BY g.created_at), '[]'::jsonb)
              FROM public.gimnasios g WHERE g.organizacion_id = o.id),
            'plan', s.plan,
            'plan_nombre', ps.nombre,
            'estado', s.estado,
            'vence_en', s.vence_en,
            'ultimo_pago_en', s.ultimo_pago_en,
            'acceso', public.suscripcion_acceso(o.id),
            'alumnos_activos', (
              SELECT count(*) FROM public.alumnos a JOIN public.gimnasios g ON g.id = a.gimnasio_id
              WHERE g.organizacion_id = o.id AND a.activo),
            'alumnos', (
              SELECT count(*) FROM public.alumnos a JOIN public.gimnasios g ON g.id = a.gimnasio_id
              WHERE g.organizacion_id = o.id),
            'equipo', (
              SELECT count(DISTINCT m.user_id) FROM public.membresias m JOIN public.gimnasios g ON g.id = m.gimnasio_id
              WHERE g.organizacion_id = o.id AND m.rol <> 'admin'),
            -- Última vez que alguien de la cuenta abrió la app: la sesión fija su gimnasio en cada carga
            -- (sesion_gimnasio, 0076); el último inicio de sesión cubre a quien no volvió a abrirla.
            'ultima_actividad', greatest(
              (SELECT max(sg.actualizado_en) FROM public.sesion_gimnasio sg JOIN public.gimnasios g ON g.id = sg.gimnasio_id
               WHERE g.organizacion_id = o.id),
              (SELECT max(au.last_sign_in_at) FROM auth.users au
               WHERE au.id = o.creada_por
                  OR au.id IN (SELECT m.user_id FROM public.membresias m JOIN public.gimnasios g ON g.id = m.gimnasio_id
                               WHERE g.organizacion_id = o.id))),
            'errores', (
              SELECT count(*) FROM public.errores_cliente e JOIN public.gimnasios g ON g.id = e.gimnasio_id
              WHERE g.organizacion_id = o.id AND e.created_at >= v_desde)
          ) AS fila
        FROM public.organizaciones o
        LEFT JOIN auth.users u ON u.id = o.creada_por
        LEFT JOIN public.suscripciones s ON s.organizacion_id = o.id
        LEFT JOIN public.planes_suscripcion ps ON ps.clave = s.plan
      ) c
    ),

    -- Errores del navegador del período, agrupados por mensaje (los más recientes primero).
    'errores', (
      SELECT coalesce(jsonb_agg(t.fila ORDER BY t.ultima_vez DESC), '[]'::jsonb)
      FROM (
        SELECT
          max(e.created_at) AS ultima_vez,
          jsonb_build_object(
            'mensaje', e.mensaje,
            'veces', count(*),
            'cuentas', count(DISTINCT g.organizacion_id),
            'ultima_vez', max(e.created_at),
            'ultimo', (
              SELECT jsonb_build_object(
                'ruta', e2.ruta,
                'detalle', left(e2.detalle, 1500),
                'user_agent', e2.user_agent,
                'gimnasio', g2.nombre)
              FROM public.errores_cliente e2
              LEFT JOIN public.gimnasios g2 ON g2.id = e2.gimnasio_id
              WHERE e2.mensaje = e.mensaje
              ORDER BY e2.created_at DESC
              LIMIT 1)
          ) AS fila
        FROM public.errores_cliente e
        LEFT JOIN public.gimnasios g ON g.id = e.gimnasio_id
        WHERE e.created_at >= v_desde
        GROUP BY e.mensaje
        ORDER BY max(e.created_at) DESC
        LIMIT 30
      ) t
    ),

    'eventos', (
      SELECT coalesce(jsonb_agg(t.fila ORDER BY t.creado_en DESC), '[]'::jsonb)
      FROM (
        SELECT
          ev.creado_en,
          jsonb_build_object(
            'id', ev.id,
            'origen', ev.origen,
            'nivel', ev.nivel,
            'mensaje', ev.mensaje,
            'detalle', ev.detalle,
            'cuenta', o.nombre,
            'creado_en', ev.creado_en
          ) AS fila
        FROM public.eventos_sistema ev
        LEFT JOIN public.organizaciones o ON o.id = ev.organizacion_id
        WHERE ev.creado_en >= v_desde
        ORDER BY ev.creado_en DESC
        LIMIT 50
      ) t
    ),

    'pagos', (
      SELECT coalesce(jsonb_agg(t.fila ORDER BY t.creado_en DESC), '[]'::jsonb)
      FROM (
        SELECT
          se.creado_en,
          jsonb_build_object(
            'tipo', se.tipo,
            'estado', se.estado,
            'monto', se.monto,
            'cuenta', o.nombre,
            'creado_en', se.creado_en
          ) AS fila
        FROM public.suscripcion_eventos se
        LEFT JOIN public.organizaciones o ON o.id = se.organizacion_id
        WHERE se.creado_en >= v_desde
        ORDER BY se.creado_en DESC
        LIMIT 30
      ) t
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.plataforma_resumen(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plataforma_resumen(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.plataforma_resumen(INTEGER) TO authenticated, service_role;

-- ============================================================================
-- Fin de la migración 0091.
-- ============================================================================
