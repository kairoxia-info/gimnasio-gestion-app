-- ============================================================================
-- 0093_telegram_vinculo_where.sql
--
-- Arreglo de la 0092: "Conectar Telegram" daba "Esta cuenta no puede conectar el bot". El registro de
-- Postgres decía "UPDATE requires a WHERE clause": lo que entra por la API de Supabase pasa por
-- safeupdate, que rechaza un UPDATE sin WHERE aunque la tabla tenga una sola fila. No se vio al probar
-- la 0092 porque esa prueba corrió directo en SQL, donde safeupdate no está activo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.telegram_preparar_vinculo()
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
  SET codigo = v_codigo, codigo_vence = now() + INTERVAL '10 minutes', actualizado_en = now()
  WHERE id;

  RETURN v_codigo;
END;
$function$;

-- ============================================================================
-- Fin de la migración 0093.
-- ============================================================================
