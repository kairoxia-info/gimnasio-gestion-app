-- ============================================================================
-- 0066_errores_cliente.sql
--
-- Pedido de Nalux (21/09/2026), antes de la semana de prueba con el primer
-- cliente real: hoy, si al cliente le queda una pantalla en blanco, ella se
-- entera SOLO si él avisa. El `ErrorBoundary` atrapa el crash y muestra una
-- pantalla amable, pero no lo guarda en ningún lado, y Vercel no sirve para
-- esto (la app es un SPA estático: un error de JavaScript nunca le llega).
--
-- Esto es la versión mínima que resuelve el problema: una tabla que ella pueda
-- mirar desde el SQL Editor durante la semana. Sin alertas, sin servicios de
-- terceros, sin dashboard.
--
-- DECISIONES DE DISEÑO (para no repensarlas después):
--
-- 1. Escribe SOLO una RPC `SECURITY DEFINER`, nunca el cliente directo. La
--    tabla no tiene GRANT de INSERT para nadie. Así el navegador no puede
--    elegir el `gimnasio_id` que se guarda: lo resuelve el servidor desde
--    `auth.uid()`, igual que el resto del proyecto.
--
-- 2. Solo `authenticated`, NO `anon`. Darle EXECUTE a `anon` significaría
--    abrir otra superficie de escritura pública en la base (justo lo que se
--    acaba de cerrar apagando el registro público de profesores). Consecuencia
--    a tener presente: un crash en el portal del alumno o en la pantalla de
--    login, donde no hay sesión, NO queda registrado. Cubre el panel del
--    profesor, que es lo que el cliente usa todo el día.
--
-- 3. Tope de 20 errores por usuario cada 5 minutos. Un crash en bucle (React
--    remonta, vuelve a romper, vuelve a reportar) podría escribir miles de
--    filas y comerse la cuota del plan Free. Pasado el tope, la RPC devuelve
--    sin escribir y sin fallar -- reportar un error nunca puede romper la
--    pantalla de error.
--
-- 4. Todo el texto se trunca en el servidor (mensaje 500, detalle 4000, ruta
--    300, user agent 300), mismo criterio defensivo que el resto de las RPC.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 — Tabla
-- ----------------------------------------------------------------------------
CREATE TABLE public.errores_cliente (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  UUID REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  mensaje      TEXT NOT NULL,
  detalle      TEXT,
  ruta         TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para la consulta típica de la semana de prueba: "¿qué rompió hoy?".
CREATE INDEX idx_errores_cliente_created_at ON public.errores_cliente (created_at DESC);
CREATE INDEX idx_errores_cliente_gimnasio_id ON public.errores_cliente (gimnasio_id);

COMMENT ON TABLE public.errores_cliente IS
  'Crashes de React atrapados por ErrorBoundary en el panel del profesor. Los escribe únicamente registrar_error_cliente() (SECURITY DEFINER); no hay INSERT directo para ningún rol. No cubre el portal del alumno ni la pantalla de login (sin sesión, ver migración 0066).';

ALTER TABLE public.errores_cliente ENABLE ROW LEVEL SECURITY;

-- Solo lectura, y solo de lo propio -- mismo aislamiento multi-tenant que el
-- resto. Nalux igual la va a leer desde el SQL Editor (que corre como
-- postgres y no pasa por RLS); esta policy está para que, si algún día una
-- pantalla de la app las muestra, un gimnasio no pueda ver los errores de otro.
CREATE POLICY "errores_cliente_tenant_isolation_select" ON public.errores_cliente
  FOR SELECT
  USING (gimnasio_id = public.get_mi_gimnasio_id());

GRANT SELECT ON public.errores_cliente TO authenticated;
REVOKE ALL ON public.errores_cliente FROM anon;

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 — registrar_error_cliente()
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.registrar_error_cliente(
    p_mensaje    TEXT,
    p_detalle    TEXT DEFAULT NULL,
    p_ruta       TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_gimnasio_id UUID;
  v_recientes   INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;  -- sin sesión no se registra nada (ver decisión 2 del encabezado)
  END IF;

  IF p_mensaje IS NULL OR btrim(p_mensaje) = '' THEN
    RETURN;  -- un error sin mensaje no aporta nada
  END IF;

  SELECT count(*) INTO v_recientes
  FROM public.errores_cliente
  WHERE user_id = v_user_id AND created_at > now() - INTERVAL '5 minutes';

  IF v_recientes >= 20 THEN
    RETURN;  -- tope anti crash-en-bucle, sin fallar
  END IF;

  SELECT gimnasio_id INTO v_gimnasio_id FROM public.profiles WHERE id = v_user_id;

  INSERT INTO public.errores_cliente (gimnasio_id, user_id, mensaje, detalle, ruta, user_agent)
  VALUES (
    v_gimnasio_id,
    v_user_id,
    left(btrim(p_mensaje), 500),
    left(p_detalle, 4000),
    left(p_ruta, 300),
    left(p_user_agent, 300)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_error_cliente(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_error_cliente(TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_error_cliente(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- CÓMO MIRARLA durante la semana de prueba (Supabase → SQL Editor):
--
--   SELECT created_at, mensaje, ruta, detalle
--   FROM public.errores_cliente
--   ORDER BY created_at DESC
--   LIMIT 50;
--
-- Y para ver solo los de un gimnasio puntual:
--
--   SELECT e.created_at, g.nombre AS gimnasio, e.mensaje, e.ruta
--   FROM public.errores_cliente e
--   LEFT JOIN public.gimnasios g ON g.id = e.gimnasio_id
--   ORDER BY e.created_at DESC;
-- ============================================================================
-- Fin de la migración 0066.
-- ============================================================================
