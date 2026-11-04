-- ============================================================================
-- 0096_errores_portal_alumno.sql
--
-- Pedido de Nalux (04/11/2026): que también queden registrados los errores del portal del alumno. La 0066
-- dejó afuera a quien no tiene sesión (decisión 2: no abrir una escritura pública a `anon`), y el alumno no
-- tiene sesión de Supabase: entra con su código. Justo los que más van a usar la app eran los únicos sin
-- registro.
--
-- DECISIONES DE DISEÑO:
--
-- 1. Sigue sin haber escritura pública libre: registrar_error_alumno() es para `anon`, pero exige un código
--    de acceso real. Con un código inventado no escribe nada y responde igual, así no sirve para adivinar
--    códigos. Es el mismo criterio de las otras RPC del portal (el código es la credencial del alumno).
--
-- 2. El código de acceso NUNCA se guarda: se borra del mensaje, del detalle y de la ruta antes de insertar.
--    Quien tiene ese código entra al plan del alumno, y estos textos se ven en el panel y salen por Telegram.
--    Por eso también se limpia la ruta del error viejo que ya estaba guardada con un código.
--
-- 3. Tope de 10 errores por gimnasio cada 5 minutos, y no por alumno: una versión rota afecta a todos los
--    alumnos a la vez y alcanza con enterarse una vez, y así un código filtrado no puede llenar la tabla ni
--    el teléfono de Nalux. Pasado el tope devuelve sin escribir y sin fallar.
--
-- 4. El mensaje se guarda con el prefijo "Portal del alumno:", así el panel y el bot lo muestran sin
--    tocar plataforma_resumen() ni el trigger de Telegram, y el tope lo encuentra sin una columna nueva.
--
-- Sigue sin cubrirse la pantalla de ingreso del alumno (/alumno): ahí todavía no hay código para validar.
-- ============================================================================

CREATE FUNCTION public.registrar_error_alumno(
    p_codigo     TEXT,
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
  v_codigo    TEXT := left(btrim(coalesce(p_codigo, '')), 200);
  v_gimnasio  UUID;
  v_recientes INTEGER;
BEGIN
  IF v_codigo = '' OR p_mensaje IS NULL OR btrim(p_mensaje) = '' THEN
    RETURN;
  END IF;

  SELECT gimnasio_id INTO v_gimnasio FROM public.alumnos WHERE codigo_acceso = v_codigo;
  IF v_gimnasio IS NULL THEN
    RETURN;  -- código inventado o de un alumno borrado: no se escribe nada
  END IF;

  SELECT count(*) INTO v_recientes
  FROM public.errores_cliente
  WHERE gimnasio_id = v_gimnasio
    AND mensaje LIKE 'Portal del alumno:%'
    AND created_at > now() - INTERVAL '5 minutes';

  IF v_recientes >= 10 THEN
    RETURN;  -- tope por gimnasio, sin fallar
  END IF;

  INSERT INTO public.errores_cliente (gimnasio_id, user_id, mensaje, detalle, ruta, user_agent)
  VALUES (
    v_gimnasio,
    NULL,
    left('Portal del alumno: ' || replace(btrim(p_mensaje), v_codigo, '(código)'), 500),
    left(replace(p_detalle, v_codigo, '(código)'), 4000),
    left(replace(p_ruta, v_codigo, '(código)'), 300),
    left(p_user_agent, 300)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_error_alumno(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_error_alumno(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

UPDATE public.errores_cliente
SET ruta = regexp_replace(ruta, '^/mi-plan/[^/?#]+', '/mi-plan/(código)')
WHERE ruta LIKE '/mi-plan/%';

COMMENT ON TABLE public.errores_cliente IS
  'Errores del navegador. Los escriben únicamente registrar_error_cliente() (panel, con sesión) y registrar_error_alumno() (portal, con el código del alumno, que nunca se guarda). No hay INSERT directo para ningún rol. No cubre las pantallas de ingreso (migraciones 0066 y 0096).';

-- ============================================================================
-- Fin de la migración 0096.
-- ============================================================================
