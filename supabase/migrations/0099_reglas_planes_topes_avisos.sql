-- ============================================================================
-- 0099_reglas_planes_topes_avisos.sql
--
-- Reglas de la auditoría del 05/11/2026:
--   1. Cambio de plan: los días que quedan se convierten según el precio (no se regalan ni se pierden).
--   2. Autorregistro: tope de solicitudes pendientes por gimnasio y de altas por IP.
--   3. Contraseña de alumno: política más exigente (la misma que valida el frontend).
--   4. Telegram: los textos de los avisos no llevan enlaces ni menciones, y los avisos que pueden
--      inundarse (errores de pantalla, cuentas nuevas) tienen tope por hora.
--   5. ejercicios.media_url: solo enlaces http(s).
--   6. alumnos: el navegador no escribe codigo_acceso, usuario ni user_id.
--
-- Desde la 0098 las funciones nuevas quedan cerradas por defecto: cada una lleva su REVOKE/GRANT explícito.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. suscripcion_aplicar_evento: conversión de días al cambiar de plan
-- ----------------------------------------------------------------------------
-- Cuerpo de la 0087 con un único cambio: en la rama de pago aprobado, si el plan es DISTINTO, la
-- suscripción no está en prueba ni es de cortesía y todavía tiene días pagos, los días que quedan se
-- convierten con el precio mensual efectivo de cada lado (monto / meses del período). Así pasar a un plan
-- más caro no regala días, ni uno más barato los pierde. Si algún precio no se puede calcular, o el plan es
-- el mismo, se suma como hasta ahora. Una cuenta de cortesía nunca se convierte: conserva su vencimiento.
CREATE OR REPLACE FUNCTION public.suscripcion_aplicar_evento(
  p_org uuid, p_plan text, p_periodo text,
  p_preapproval_id text, p_preapproval_estado text, p_payer_email text,
  p_pago_id text, p_pago_estado text, p_pago_monto numeric, p_crudo jsonb)
 RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_s            public.suscripciones%ROWTYPE;
  v_meses        integer;
  v_tipo         text;
  v_mp_id        text;
  v_estado       text;
  v_nuevo        integer;
  v_base         timestamptz;
  v_meses_viejo  integer;
  v_precio_viejo numeric;
  v_precio_nuevo numeric;
BEGIN
  SELECT * INTO v_s FROM public.suscripciones WHERE organizacion_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organización sin suscripción';
  END IF;
  PERFORM 1 FROM public.planes_suscripcion WHERE clave = p_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan inválido';
  END IF;
  SELECT per.meses INTO v_meses FROM public.suscripcion_periodo(p_periodo) per;
  IF v_meses IS NULL THEN
    RAISE EXCEPTION 'Período inválido';
  END IF;

  v_tipo   := CASE WHEN p_pago_id IS NOT NULL THEN 'pago' ELSE 'suscripcion' END;
  v_mp_id  := COALESCE(p_pago_id, p_preapproval_id);
  v_estado := COALESCE(p_pago_estado, p_preapproval_estado, '');
  IF v_mp_id IS NULL THEN
    RAISE EXCEPTION 'Aviso sin identificador';
  END IF;

  -- Cada aviso (mismo pago o suscripción en el mismo estado) se aplica una sola vez.
  INSERT INTO public.suscripcion_eventos (organizacion_id, tipo, mp_id, estado, monto, crudo)
  VALUES (p_org, v_tipo, v_mp_id, v_estado, p_pago_monto, p_crudo)
  ON CONFLICT (tipo, mp_id, estado) DO NOTHING;
  GET DIAGNOSTICS v_nuevo = ROW_COUNT;
  IF v_nuevo = 0 THEN
    RETURN 'repetido';
  END IF;

  -- Pago aprobado: activa el plan y suma el período (desde hoy si estaba en prueba o vencida; si
  -- todavía tenía días pagos, se suman a continuación).
  IF v_tipo = 'pago' AND p_pago_estado IN ('approved', 'processed') THEN
    v_base := CASE WHEN v_s.estado = 'prueba' THEN now() ELSE greatest(v_s.vence_en, now()) END;

    -- Cambio de plan con días pagos: se convierten según el precio mensual efectivo de cada plan.
    IF v_s.plan IS DISTINCT FROM p_plan
       AND v_s.estado NOT IN ('prueba', 'cortesia')
       AND v_s.vence_en > now() THEN
      SELECT per.meses INTO v_meses_viejo FROM public.suscripcion_periodo(v_s.periodo) per;
      IF v_meses_viejo IS NOT NULL THEN
        v_precio_viejo := public.suscripcion_monto(v_s.plan, v_s.periodo)::numeric / v_meses_viejo;
        v_precio_nuevo := public.suscripcion_monto(p_plan, p_periodo)::numeric / v_meses;
        IF v_precio_viejo > 0 AND v_precio_nuevo > 0 THEN
          v_base := now() + (v_s.vence_en - now()) * (v_precio_viejo / v_precio_nuevo)::double precision;
        END IF;
      END IF;
    END IF;

    UPDATE public.suscripciones
       SET plan = p_plan, periodo = p_periodo, estado = 'activa',
           vence_en = v_base + make_interval(months => v_meses),
           mp_preapproval_id = COALESCE(p_preapproval_id, mp_preapproval_id),
           mp_payer_email = COALESCE(p_payer_email, mp_payer_email),
           ultimo_pago_en = now(), updated_at = now()
     WHERE organizacion_id = p_org;
    RETURN 'activada';
  END IF;

  -- Cobro automático cancelado: sigue con acceso hasta el vencimiento ya pagado.
  IF v_tipo = 'suscripcion' AND p_preapproval_estado = 'cancelled'
     AND (v_s.mp_preapproval_id IS NULL OR v_s.mp_preapproval_id = p_preapproval_id) THEN
    UPDATE public.suscripciones
       SET estado = 'cancelada', updated_at = now()
     WHERE organizacion_id = p_org AND estado <> 'prueba';
    RETURN 'cancelada';
  END IF;

  -- Suscripción autorizada (todavía sin pago aprobado): solo se guarda el vínculo. Si estaba cancelada
  -- pasa a 'pendiente'; si estaba en prueba, sigue en prueba hasta que entre el pago.
  IF v_tipo = 'suscripcion' AND p_preapproval_estado = 'authorized' THEN
    UPDATE public.suscripciones
       SET mp_preapproval_id = p_preapproval_id,
           mp_payer_email = COALESCE(p_payer_email, mp_payer_email),
           estado = CASE WHEN estado = 'cancelada' THEN 'pendiente' ELSE estado END,
           updated_at = now()
     WHERE organizacion_id = p_org;
    RETURN 'autorizada';
  END IF;

  RETURN 'registrado';
END;
$$;

-- Solo la usa mp-webhook con la clave de servicio.
REVOKE ALL ON FUNCTION public.suscripcion_aplicar_evento(uuid, text, text, text, text, text, text, text, numeric, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suscripcion_aplicar_evento(uuid, text, text, text, text, text, text, text, numeric, jsonb)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 2. join_gimnasio_por_codigo: topes del autorregistro
-- ----------------------------------------------------------------------------
-- Parte de la última versión viva (firma con p_dni intacta, control de suscripción y fecha del gimnasio) y suma dos topes:
--   a) un gimnasio no acumula más de 200 solicitudes pendientes (la tabla no crece sin límite);
--   b) una misma IP no hace más de 20 altas cada 10 minutos (clave 'a:<ip>' en login_alumno_intentos).
-- Si no hay IP (sin el header de Cloudflare) el tope por IP se omite, igual que en el login (0072).
-- Si el alta se rechaza, el rechazo deshace también el conteo de ese intento: el contador solo suma altas.
CREATE OR REPLACE FUNCTION public.join_gimnasio_por_codigo(
    p_codigo TEXT,
    p_nombre TEXT,
    p_contacto TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_dni TEXT DEFAULT NULL,
    p_fecha_nacimiento DATE DEFAULT NULL,
    p_contacto_emergencia TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gimnasio_id UUID;
  v_ip          TEXT;
BEGIN
  PERFORM public.suscripcion_exigir_invitacion(p_codigo, true);
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id INTO v_gimnasio_id
  FROM public.gimnasios
  WHERE codigo_invitacion = p_codigo AND autorregistro_activo = true;

  IF v_gimnasio_id IS NULL THEN
    RAISE EXCEPTION 'Código de invitación inválido';
  END IF;

  IF (
    SELECT count(*) FROM (
      SELECT 1 FROM public.alumnos
      WHERE gimnasio_id = v_gimnasio_id
        AND origen = 'autorregistro'
        AND created_at > now() - INTERVAL '5 minutes'
      LIMIT 50
    ) reciente
  ) >= 50 THEN
    RAISE EXCEPTION 'Demasiadas solicitudes de autorregistro en poco tiempo, probar de nuevo en unos minutos';
  END IF;

  -- Tope total: un gimnasio con 200 solicitudes sin resolver no recibe más hasta que las revise.
  IF (
    SELECT count(*) FROM (
      SELECT 1 FROM public.alumnos
      WHERE gimnasio_id = v_gimnasio_id AND pendiente = true
      LIMIT 200
    ) pendientes
  ) >= 200 THEN
    RAISE EXCEPTION 'Este gimnasio tiene demasiadas solicitudes pendientes. Avísale al gimnasio.';
  END IF;

  IF p_nombre IS NULL OR btrim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;

  p_nombre              := left(btrim(p_nombre), 200);
  p_contacto            := left(p_contacto, 200);
  p_email               := left(p_email, 200);
  p_contacto_emergencia := left(p_contacto_emergencia, 200);

  -- Tope por IP: 20 altas cada 10 minutos. Se suma justo antes de insertar.
  v_ip := public._login_alumno_ip();
  IF v_ip IS NOT NULL THEN
    -- Mantenimiento: de vez en cuando se borran contadores viejos (mismo criterio que el login).
    IF random() < 0.02 THEN
      DELETE FROM public.login_alumno_intentos WHERE ventana_inicio < now() - INTERVAL '2 hours';
    END IF;
    IF public._login_alumno_contar('a:' || v_ip, INTERVAL '10 minutes') > 20 THEN
      RAISE EXCEPTION 'Demasiadas solicitudes de autorregistro en poco tiempo, probar de nuevo en unos minutos';
    END IF;
  END IF;

  -- p_dni se recibe y se DESCARTA a proposito (ver la 0046).

  INSERT INTO public.alumnos (
    gimnasio_id, nombre, contacto, email, fecha_nacimiento,
    contacto_emergencia, fecha_alta, activo, pendiente, origen
  ) VALUES (
    v_gimnasio_id,
    p_nombre,
    p_contacto,
    p_email,
    p_fecha_nacimiento,
    p_contacto_emergencia,
    public.fecha_del_gimnasio(v_gimnasio_id),
    false,
    true,
    'autorregistro'
  );
END;
$function$;

COMMENT ON TABLE public.login_alumno_intentos IS
  'Contadores de topes del portal del alumno (0072, 0099). Claves: p:<usuario>|<ip> (par), i:<ip> (fallos por IP), u:<usuario> (cuenta), a:<ip> (altas de autorregistro por IP), e:<usuario> (búsquedas de equipo, 0098). Solo la tocan las funciones SECURITY DEFINER.';

-- Los permisos de la función no cambian (anon y authenticated, como el resto del portal público).
REVOKE ALL ON FUNCTION public.join_gimnasio_por_codigo(text, text, text, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_gimnasio_por_codigo(text, text, text, text, text, date, text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. crear_acceso_alumno: política de contraseña
-- ----------------------------------------------------------------------------
-- Es de la 0072 más el control de suscripción de la 0086. La contraseña pasa de 8 a 10 caracteres y exige
-- mayúscula, minúscula y número, no puede contener el usuario ni estar en la lista de las más comunes.
-- Es la misma regla que valida el frontend (lib/validacionPassword.js). Es la única función que fija
-- contraseñas de alumno (iniciar_sesion_alumno solo vuelve a hashear la que ya existe), por eso no hay helper.
CREATE OR REPLACE FUNCTION public.crear_acceso_alumno(p_alumno_id uuid, p_usuario text, p_contrasena text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.suscripcion_exigir_mi_org(true);
  p_usuario := btrim(COALESCE(p_usuario, ''));

  IF length(p_usuario) < 3 THEN
    RAISE EXCEPTION 'El usuario tiene que tener al menos 3 caracteres.';
  END IF;

  IF length(p_usuario) > 50 THEN
    RAISE EXCEPTION 'El usuario puede tener hasta 50 caracteres.';
  END IF;

  IF length(COALESCE(p_contrasena, '')) < 10 THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos 10 caracteres.';
  END IF;

  IF length(p_contrasena) > 72 THEN
    RAISE EXCEPTION 'La contraseña puede tener hasta 72 caracteres.';
  END IF;

  IF p_contrasena !~ '[A-Z]' THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos una letra mayúscula.';
  END IF;

  IF p_contrasena !~ '[a-z]' THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos una letra minúscula.';
  END IF;

  IF p_contrasena !~ '[0-9]' THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos un número.';
  END IF;

  -- strpos (no LIKE): los caracteres del usuario no actúan como comodines.
  IF strpos(lower(p_contrasena), lower(p_usuario)) > 0 THEN
    RAISE EXCEPTION 'La contraseña no puede contener el usuario.';
  END IF;

  IF lower(p_contrasena) = ANY (ARRAY[
       'password123', 'contrasena1', 'contrasena123', 'gimnasio123', 'gimnasio2026',
       'rutnail123', 'alumno1234', 'alumno12345', 'qwerty12345', 'entrenar123']) THEN
    RAISE EXCEPTION 'Esa contraseña es muy fácil de adivinar. Elige otra.';
  END IF;

  UPDATE public.alumnos
     SET usuario = p_usuario,
         password_hash = extensions.crypt(p_contrasena, extensions.gen_salt('bf', 10)),
         codigo_acceso = encode(extensions.gen_random_bytes(16), 'hex')
   WHERE id = p_alumno_id
     AND gimnasio_id = public.get_mi_gimnasio_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el alumno.';
  END IF;

  DELETE FROM public.login_alumno_intentos
   WHERE clave = 'u:' || lower(p_usuario)
      OR starts_with(clave, 'p:' || lower(p_usuario) || '|');
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ese usuario ya lo tiene otro alumno -- prueba con otro.';
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_acceso_alumno(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_acceso_alumno(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Telegram
-- ----------------------------------------------------------------------------
-- 4a. Limpia un texto que viene de un usuario antes de mandarlo a Telegram: sin saltos de línea y sin
--     enlaces ni menciones (nombres de gimnasio y mensajes de error los puede escribir cualquiera, y el
--     aviso llega al teléfono de la dueña). Después recorta al largo pedido.
CREATE FUNCTION public.telegram_limpiar_texto(p_texto text, p_largo integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT left(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(COALESCE(p_texto, ''), '[\r\n]+', ' ', 'g'),
                'https?://\S+', '[enlace quitado]', 'gi'),
              't\.me/\S*', '[enlace quitado]', 'gi'),
            '\mwww\.\S+', '[enlace quitado]', 'gi'),
          '\m[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|ar|io|me|ly|co|link|xyz|app)\M(/\S*)?', '[enlace quitado]', 'gi'),
        '@[a-z0-9_]+', '[enlace quitado]', 'gi')
    ),
    GREATEST(COALESCE(p_largo, 0), 0))
$function$;

-- Solo la usan los triggers de aviso (SECURITY DEFINER).
REVOKE ALL ON FUNCTION public.telegram_limpiar_texto(text, integer) FROM PUBLIC, anon, authenticated;

-- 4b. Los tres triggers usan el texto limpio. Conservan el EXCEPTION WHEN OTHERS: un aviso nunca frena
--     un alta ni un pago.
CREATE OR REPLACE FUNCTION public.telegram_aviso_organizacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.telegram_encolar(
    'cuenta_nueva',
    format('🆕 Cuenta nueva: %s', public.telegram_limpiar_texto(NEW.nombre, 60))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- un aviso nunca frena un alta
END;
$function$;

CREATE OR REPLACE FUNCTION public.telegram_aviso_suscripcion()
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
  v_cuenta := coalesce(nullif(public.telegram_limpiar_texto(v_cuenta, 60), ''), 'Cuenta sin nombre');
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

CREATE OR REPLACE FUNCTION public.telegram_aviso_error_cliente()
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
    format('⚠️ Error en una pantalla (%s): %s',
           coalesce(nullif(public.telegram_limpiar_texto(v_gimnasio, 60), ''), 'sin gimnasio'),
           public.telegram_limpiar_texto(NEW.mensaje, 200))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

-- 4c. Tope por hora en los avisos que cualquiera puede provocar. Al llegar al tope se manda UN aviso de
--     "demasiados avisos" y se descarta el resto hasta que pase la hora. Los demás tipos no tienen tope.
CREATE INDEX IF NOT EXISTS idx_avisos_telegram_tipo_creado ON public.avisos_telegram (tipo, creado_en);

CREATE OR REPLACE FUNCTION public.telegram_encolar(p_tipo TEXT, p_texto TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tope   INTEGER;
  v_cuenta INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM public.telegram_config WHERE chat_id IS NOT NULL) THEN
    v_tope := CASE p_tipo WHEN 'error_pantalla' THEN 10 WHEN 'cuenta_nueva' THEN 20 END;

    IF v_tope IS NOT NULL THEN
      SELECT count(*) INTO v_cuenta
        FROM public.avisos_telegram
       WHERE tipo = p_tipo AND creado_en > now() - INTERVAL '1 hour';

      IF v_cuenta > v_tope THEN
        RETURN;   -- ya se avisó del exceso: no se encola nada más esta hora
      END IF;
      IF v_cuenta = v_tope THEN
        INSERT INTO public.avisos_telegram (tipo, texto)
        VALUES (p_tipo, '⚠️ Llegaron demasiados avisos de este tipo en la última hora. Míralos en el panel de Control.');
        RETURN;
      END IF;
    END IF;

    INSERT INTO public.avisos_telegram (tipo, texto) VALUES (p_tipo, left(coalesce(p_texto, ''), 1000));
  END IF;
END;
$function$;

-- Las funciones reemplazadas conservan sus permisos (cerradas); se repite el REVOKE por claridad.
REVOKE ALL ON FUNCTION public.telegram_encolar(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_aviso_organizacion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_aviso_suscripcion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_aviso_error_cliente() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. ejercicios.media_url: solo enlaces http(s)
-- ----------------------------------------------------------------------------
-- El enlace del ejercicio se muestra como link en el panel y el portal: no puede ser javascript: ni data:.
ALTER TABLE public.ejercicios
  ADD CONSTRAINT ejercicios_media_url_http_chk
  CHECK (media_url IS NULL OR media_url = '' OR media_url ~* '^https?://');

-- ----------------------------------------------------------------------------
-- 6. alumnos: el navegador no escribe el acceso del alumno
-- ----------------------------------------------------------------------------
-- codigo_acceso, usuario y user_id los fijan las funciones SECURITY DEFINER (crear_acceso_alumno,
-- regenerar_codigo_acceso_alumno, quitar_acceso_alumno, autorregistro). Con permiso directo, un miembro
-- del equipo podría asignar a un alumno un código o usuario elegido por él. SELECT sigue igual (0051);
-- el DEFAULT de codigo_acceso se aplica sin necesitar el permiso de INSERT.
REVOKE INSERT (codigo_acceso, usuario, user_id), UPDATE (codigo_acceso, usuario, user_id)
  ON public.alumnos FROM authenticated;
