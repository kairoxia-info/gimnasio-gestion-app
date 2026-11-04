-- ============================================================================
-- 0092_telegram_avisos.sql
--
-- Pedido de Nalux (03/11/2026): un bot de Telegram que le avise solo si pasa algo (cuenta nueva, pago
-- aprobado o rechazado, cancelación, errores) y al que le pueda preguntar cómo está todo. Es la parte 2
-- del Control de RutNail (migración 0091).
--
-- CÓMO FUNCIONA:
--   evento en la base -> trigger -> fila en avisos_telegram (la cola)
--   pg_cron cada minuto -> telegram_despachar() -> si hay algo en la cola llama a la Edge Function
--   "telegram-bot" -> manda los mensajes a Telegram.
--   Lo que Nalux le escribe al bot entra por el webhook de Telegram a esa misma función.
--
-- DECISIONES DE DISEÑO:
--
-- 1. Los triggers NO hablan con Telegram: solo anotan en la cola. Y están envueltos en EXCEPTION WHEN
--    OTHERS, porque cuelgan de tablas críticas (suscripcion_eventos es el camino de los pagos,
--    organizaciones el del registro): que falle un aviso NUNCA puede frenar un pago ni un alta.
--
-- 2. El chat de Nalux no se adivina con "el primero que escriba": se vincula con un código de un solo
--    uso que genera el panel (solo la dueña de la plataforma) y que vence en 10 minutos. El bot ignora
--    cualquier otro chat. Sin chat vinculado la cola no crece (los triggers no anotan nada).
--
-- 3. Los textos NO llevan correos, ni datos de alumnos, ni la ruta del error (la de /mi-plan/ tiene el
--    código de acceso del alumno): van por los servidores de Telegram. Solo el nombre del gimnasio.
--
-- 4. La llamada de pg_cron a la función se autentica con clave_despacho, generada acá al azar; nunca
--    sale de la base salvo en esa llamada, y la función no acepta "despachar" sin ella.
--
-- 5. Errores de pantalla y del servidor: un aviso por mensaje cada 30 minutos (un error en bucle no
--    llena el teléfono). Los avisos del nivel 'aviso' (firmas inválidas, etc.) no suenan: se ven en el
--    panel y en el resumen semanal.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 — Configuración (una sola fila) y cola
-- ----------------------------------------------------------------------------
CREATE TABLE public.telegram_config (
  id             BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  chat_id        BIGINT,
  codigo         TEXT,
  codigo_vence   TIMESTAMPTZ,
  clave_despacho TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.telegram_config IS
  'Una sola fila: chat de Telegram de la dueña de RutNail, código de vinculación y clave de pg_cron. Sin políticas ni GRANT (migración 0092).';

ALTER TABLE public.telegram_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_config FROM anon, authenticated;

INSERT INTO public.telegram_config DEFAULT VALUES;

CREATE TABLE public.avisos_telegram (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo       TEXT NOT NULL,
  texto      TEXT NOT NULL DEFAULT '',
  intentos   INTEGER NOT NULL DEFAULT 0,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_en TIMESTAMPTZ
);

CREATE INDEX idx_avisos_telegram_pendientes ON public.avisos_telegram (id) WHERE enviado_en IS NULL;

COMMENT ON TABLE public.avisos_telegram IS
  'Cola de avisos para el bot de Telegram. La llenan los triggers y pg_cron; la vacía la Edge Function telegram-bot (migración 0092).';

ALTER TABLE public.avisos_telegram ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avisos_telegram FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 — Vincular el chat
-- ----------------------------------------------------------------------------
-- Desde el panel: solo la dueña de la plataforma. Devuelve el código de un solo uso.
CREATE FUNCTION public.telegram_preparar_vinculo()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_codigo TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF NOT public.es_admin_plataforma() THEN
    RAISE EXCEPTION 'NO_AUTORIZADO' USING ERRCODE = '42501';
  END IF;

  UPDATE public.telegram_config
  SET codigo = v_codigo, codigo_vence = now() + INTERVAL '10 minutes', actualizado_en = now();

  RETURN v_codigo;
END;
$function$;

CREATE FUNCTION public.telegram_conectado()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.es_admin_plataforma() AND EXISTS (SELECT 1 FROM public.telegram_config WHERE chat_id IS NOT NULL)
$function$;

-- Desde la Edge Function, con lo que llegó en "/start <código>".
CREATE FUNCTION public.telegram_vincular(p_codigo TEXT, p_chat_id BIGINT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filas INTEGER;
BEGIN
  IF p_codigo IS NULL OR p_codigo = '' OR p_chat_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.telegram_config
  SET chat_id = p_chat_id, codigo = NULL, codigo_vence = NULL, actualizado_en = now()
  WHERE codigo = p_codigo AND codigo_vence > now();

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas = 1;
END;
$function$;

CREATE FUNCTION public.telegram_chat()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT chat_id FROM public.telegram_config
$function$;

-- ----------------------------------------------------------------------------
-- SECCIÓN 3 — La cola
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.telegram_encolar(p_tipo TEXT, p_texto TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.telegram_config WHERE chat_id IS NOT NULL) THEN
    INSERT INTO public.avisos_telegram (tipo, texto) VALUES (p_tipo, left(coalesce(p_texto, ''), 1000));
  END IF;
END;
$function$;

-- Toma hasta 20 avisos pendientes. Los marca enviados acá mismo para que dos corridas que se pisen no
-- manden lo mismo dos veces; si Telegram falla, telegram_reponer() los devuelve a la cola.
CREATE FUNCTION public.telegram_tomar_pendientes(p_clave TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_filas JSONB;
BEGIN
  IF p_clave IS DISTINCT FROM (SELECT clave_despacho FROM public.telegram_config) THEN
    RAISE EXCEPTION 'NO_AUTORIZADO' USING ERRCODE = '42501';
  END IF;

  WITH tomados AS (
    SELECT id FROM public.avisos_telegram
    WHERE enviado_en IS NULL
    ORDER BY id
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  ), marcados AS (
    UPDATE public.avisos_telegram a
    SET enviado_en = now()
    FROM tomados t
    WHERE a.id = t.id
    RETURNING a.id, a.tipo, a.texto
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'texto', texto) ORDER BY id), '[]'::jsonb)
  INTO v_filas
  FROM marcados;

  RETURN v_filas;
END;
$function$;

-- Hasta 5 intentos por aviso: después queda como enviado para no reintentar para siempre.
CREATE FUNCTION public.telegram_reponer(p_ids BIGINT[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.avisos_telegram
  SET intentos = intentos + 1,
      enviado_en = CASE WHEN intentos + 1 >= 5 THEN enviado_en ELSE NULL END
  WHERE id = ANY (p_ids)
$function$;

-- ----------------------------------------------------------------------------
-- SECCIÓN 4 — Tareas programadas
-- ----------------------------------------------------------------------------
-- Cada minuto: solo llama a la función si hay algo para mandar.
CREATE FUNCTION public.telegram_despachar()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_clave TEXT;
BEGIN
  SELECT clave_despacho INTO v_clave FROM public.telegram_config WHERE chat_id IS NOT NULL;
  IF v_clave IS NULL OR NOT EXISTS (SELECT 1 FROM public.avisos_telegram WHERE enviado_en IS NULL) THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://fftdmpqbemcnxdnfnvhd.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-despacho', v_clave),
    body := jsonb_build_object('accion', 'despachar'),
    timeout_milliseconds := 20000
  );
END;
$function$;

-- Los lunes: el resumen de la semana (el texto lo arma la Edge Function con plataforma_resumen) y limpieza.
CREATE FUNCTION public.telegram_chequeo_semanal()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.telegram_encolar('resumen', '');

  -- Bloque aparte: si la limpieza falla, el resumen de la semana igual sale.
  BEGIN
    DELETE FROM public.avisos_telegram WHERE enviado_en < now() - INTERVAL '30 days';
    DELETE FROM cron.job_run_details WHERE end_time < now() - INTERVAL '7 days';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

SELECT cron.schedule('telegram-despachar', '* * * * *', 'SELECT public.telegram_despachar()');
-- 12:00 UTC = 9:00 de Argentina.
SELECT cron.schedule('telegram-chequeo-semanal', '0 12 * * 1', 'SELECT public.telegram_chequeo_semanal()');

-- ----------------------------------------------------------------------------
-- SECCIÓN 5 — Triggers
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.telegram_aviso_organizacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.telegram_encolar('cuenta_nueva', format('🆕 Cuenta nueva: %s', NEW.nombre));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- un aviso nunca frena un alta
END;
$function$;

CREATE TRIGGER telegram_aviso_organizacion
  AFTER INSERT ON public.organizaciones
  FOR EACH ROW EXECUTE FUNCTION public.telegram_aviso_organizacion();

CREATE FUNCTION public.telegram_aviso_suscripcion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cuenta TEXT;
  v_monto  TEXT;
  v_texto  TEXT;
BEGIN
  SELECT nombre INTO v_cuenta FROM public.organizaciones WHERE id = NEW.organizacion_id;
  v_cuenta := coalesce(v_cuenta, 'Cuenta sin nombre');
  v_monto := CASE WHEN NEW.monto IS NULL THEN ''
                  ELSE ' $' || replace(to_char(round(NEW.monto), 'FM999,999,999,990'), ',', '.') END;

  v_texto := CASE
    WHEN NEW.tipo = 'pago' AND NEW.estado = 'approved' THEN format('💰 Pago aprobado: %s%s', v_cuenta, v_monto)
    WHEN NEW.tipo = 'pago' AND NEW.estado NOT IN ('pending', 'in_process', 'authorized')
      THEN format('❌ Pago rechazado: %s%s', v_cuenta, v_monto)
    WHEN NEW.tipo = 'suscripcion' AND NEW.estado = 'authorized' THEN format('✅ Cobro automático activado: %s', v_cuenta)
    WHEN NEW.tipo = 'suscripcion' AND NEW.estado = 'cancelled' THEN format('🚫 Cobro automático cancelado: %s', v_cuenta)
  END;

  IF v_texto IS NOT NULL THEN
    PERFORM public.telegram_encolar('mercado_pago', v_texto);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- un aviso nunca frena un pago
END;
$function$;

CREATE TRIGGER telegram_aviso_suscripcion
  AFTER INSERT ON public.suscripcion_eventos
  FOR EACH ROW EXECUTE FUNCTION public.telegram_aviso_suscripcion();

CREATE FUNCTION public.telegram_aviso_error_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gimnasio TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.errores_cliente
    WHERE mensaje = NEW.mensaje AND id <> NEW.id AND created_at > now() - INTERVAL '30 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT nombre INTO v_gimnasio FROM public.gimnasios WHERE id = NEW.gimnasio_id;
  PERFORM public.telegram_encolar(
    'error_pantalla',
    format('⚠️ Error en una pantalla (%s): %s', coalesce(v_gimnasio, 'sin gimnasio'), left(NEW.mensaje, 200))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

CREATE TRIGGER telegram_aviso_error_cliente
  AFTER INSERT ON public.errores_cliente
  FOR EACH ROW EXECUTE FUNCTION public.telegram_aviso_error_cliente();

CREATE FUNCTION public.telegram_aviso_evento_sistema()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.nivel <> 'error' OR EXISTS (
    SELECT 1 FROM public.eventos_sistema
    WHERE origen = NEW.origen AND mensaje = NEW.mensaje AND id <> NEW.id
      AND creado_en > now() - INTERVAL '30 minutes'
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.telegram_encolar('error_servidor', format('🔴 Problema del servidor: %s', left(NEW.mensaje, 300)));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

CREATE TRIGGER telegram_aviso_evento_sistema
  AFTER INSERT ON public.eventos_sistema
  FOR EACH ROW EXECUTE FUNCTION public.telegram_aviso_evento_sistema();

-- ----------------------------------------------------------------------------
-- SECCIÓN 6 — Permisos
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.telegram_preparar_vinculo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_preparar_vinculo() TO authenticated;

REVOKE ALL ON FUNCTION public.telegram_conectado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_conectado() TO authenticated;

REVOKE ALL ON FUNCTION public.telegram_vincular(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_vincular(TEXT, BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.telegram_chat() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_chat() TO service_role;

REVOKE ALL ON FUNCTION public.telegram_tomar_pendientes(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_tomar_pendientes(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.telegram_reponer(BIGINT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_reponer(BIGINT[]) TO service_role;

-- Solo las usan los triggers y pg_cron (corren como dueño): nadie más.
REVOKE ALL ON FUNCTION public.telegram_encolar(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_despachar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_chequeo_semanal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_aviso_organizacion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_aviso_suscripcion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_aviso_error_cliente() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_aviso_evento_sistema() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Fin de la migración 0092.
-- ============================================================================
