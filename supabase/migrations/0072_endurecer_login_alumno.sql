-- ============================================================================
-- 0072_endurecer_login_alumno.sql
--
-- Endurecimiento del login del alumno (auditoria pre-lanzamiento, 28/10/2026).
-- Segunda parte despues del hotfix 0071 (contrasena NULL). Problemas de la
-- 0042 que esto resuelve:
--
-- 1. BLOQUEO POR UN TERCERO. El tope era por cuenta: 20 intentos malos en 5
--    minutos dejaban afuera al alumno real, y el usuario suele ser un primer
--    nombre. Ahora el tope duro es por PAR (usuario + IP del que intenta): quien
--    ataca se bloquea a si mismo, no al alumno. Se suma un tope por IP (solo
--    fallos, para frenar el barrido de usuarios) y un tope por cuenta mas alto
--    (contra un ataque repartido entre muchas IP).
-- 2. CONTADOR NO ATOMICO. Leia el contador, comparaba y recien despues sumaba:
--    pedidos simultaneos pasaban todos el chequeo. Ahora se suma ANTES de
--    verificar con un solo INSERT ... ON CONFLICT (atomico), el mismo criterio
--    que ya usan las demas RPC del alumno (0052).
-- 3. USUARIOS DISTINGUIBLES. Lanzaba 'Demasiados intentos' solo para usuarios
--    que existen, y un usuario inexistente volvia sin correr bcrypt. Ahora NUNCA
--    lanza: bloqueado, usuario inexistente y contrasena mala son la misma
--    respuesta (NULL), y los dos ultimos corren un hash falso para igualar
--    tiempos. (Mientras queden hashes viejos de costo 6 hay una diferencia de
--    milisegundos residual; desaparece cuando cada alumno entra una vez.)
-- 4. HASH DEBIL. gen_salt('bf') sin costo usa 6 iteraciones. crear_acceso_alumno
--    pasa a costo 10, y el login rehashea solo, tras un login correcto, los
--    hashes que tengan menos de 10. No hace falta que nadie cambie su clave.
-- 5. SIN TOPE DE LARGO. crear_acceso_alumno acepta ahora hasta 50 caracteres de
--    usuario y 72 de contrasena (bcrypt ignora lo que pase de 72).
--
-- La IP sale del header cf-connecting-ip que agrega Cloudflare (delante de
-- Supabase) y que el cliente no puede falsificar. Si por algun motivo no esta,
-- los topes por IP y por par se omiten (NO se agrupa a todos en "sin IP", eso
-- bloquearia a todo el mundo) y queda solo el tope por cuenta.
--
-- Las columnas login_intentos_contador / login_intentos_ventana_inicio de
-- alumnos quedan sin uso (se borran en una limpieza aparte).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabla de contadores. Sin ningun acceso desde la API: solo la funcion (que
-- corre como su duenio) la toca.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_alumno_intentos (
  clave          TEXT PRIMARY KEY,
  contador       INTEGER NOT NULL,
  ventana_inicio TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_alumno_intentos_ventana
  ON public.login_alumno_intentos (ventana_inicio);

COMMENT ON TABLE public.login_alumno_intentos IS
  'Contadores del tope de intentos del login del alumno (0072). Claves: p:<usuario>|<ip> (par), i:<ip> (fallos por IP), u:<usuario> (cuenta). Solo la toca iniciar_sesion_alumno() / crear_acceso_alumno().';

ALTER TABLE public.login_alumno_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_alumno_intentos FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Auxiliares internas (nadie las llama desde la API).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._login_alumno_ip()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v text;
BEGIN
  v := NULLIF(current_setting('request.headers', true), '');
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN NULLIF(left(btrim(COALESCE((v::json) ->> 'cf-connecting-ip', '')), 64), '');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- Suma 1 al contador de la clave (reinicia la ventana si ya vencio) y devuelve
-- el valor nuevo. Un solo statement: atomico aunque lleguen pedidos juntos.
CREATE OR REPLACE FUNCTION public._login_alumno_contar(p_clave text, p_ventana interval)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.login_alumno_intentos AS t (clave, contador, ventana_inicio)
  VALUES (p_clave, 1, now())
  ON CONFLICT (clave) DO UPDATE SET
    contador = CASE WHEN t.ventana_inicio < now() - p_ventana THEN 1 ELSE t.contador + 1 END,
    ventana_inicio = CASE WHEN t.ventana_inicio < now() - p_ventana THEN now() ELSE t.ventana_inicio END
  RETURNING contador;
$function$;

REVOKE ALL ON FUNCTION public._login_alumno_ip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._login_alumno_contar(text, interval) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- iniciar_sesion_alumno
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iniciar_sesion_alumno(p_usuario text, p_contrasena text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario      TEXT;
  v_ip           TEXT;
  v_id           UUID;
  v_hash         TEXT;
  v_codigo       TEXT;
  v_bloq_ip      BOOLEAN := false;
  v_bloq_cuenta  BOOLEAN := false;
  v_ok           BOOLEAN := false;
BEGIN
  v_usuario := lower(left(btrim(COALESCE(p_usuario, '')), 100));
  p_contrasena := left(p_contrasena, 200);
  v_ip := public._login_alumno_ip();

  -- Mantenimiento: de vez en cuando se borran contadores viejos.
  IF random() < 0.02 THEN
    DELETE FROM public.login_alumno_intentos WHERE ventana_inicio < now() - INTERVAL '2 hours';
  END IF;

  -- Tope por IP (cuenta SOLO fallos, asi que cien alumnos entrando bien desde el
  -- wifi del gimnasio no se bloquean entre si). Aca solo se mira.
  IF v_ip IS NOT NULL THEN
    SELECT (contador >= 40 AND ventana_inicio > now() - INTERVAL '5 minutes')
      INTO v_bloq_ip
    FROM public.login_alumno_intentos
    WHERE clave = 'i:' || v_ip;
    v_bloq_ip := COALESCE(v_bloq_ip, false);
  END IF;

  SELECT id, password_hash, codigo_acceso
    INTO v_id, v_hash, v_codigo
  FROM public.alumnos
  WHERE lower(usuario) = v_usuario AND activo = true;

  -- Topes por par (usuario + IP) y por cuenta: solo para usuarios que existen
  -- (no se crean filas por cada nombre inventado) y se suman ANTES de verificar.
  IF NOT v_bloq_ip AND v_id IS NOT NULL AND v_hash IS NOT NULL THEN
    IF v_ip IS NOT NULL THEN
      IF public._login_alumno_contar('p:' || v_usuario || '|' || v_ip, INTERVAL '5 minutes') > 10 THEN
        v_bloq_cuenta := true;
      END IF;
    END IF;
    IF NOT v_bloq_cuenta THEN
      IF public._login_alumno_contar('u:' || v_usuario, INTERVAL '60 minutes') > 200 THEN
        v_bloq_cuenta := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_bloq_ip AND NOT v_bloq_cuenta
     AND v_id IS NOT NULL AND v_hash IS NOT NULL AND p_contrasena IS NOT NULL THEN
    v_ok := (extensions.crypt(p_contrasena, v_hash) = v_hash);
  ELSE
    -- Mismo trabajo que una verificacion real, para que bloqueado / inexistente /
    -- contrasena nula no se distingan por el tiempo de respuesta.
    PERFORM extensions.crypt(COALESCE(p_contrasena, ''), extensions.gen_salt('bf', 10));
  END IF;

  IF NOT v_ok THEN
    IF v_ip IS NOT NULL AND NOT v_bloq_ip THEN
      PERFORM public._login_alumno_contar('i:' || v_ip, INTERVAL '5 minutes');
    END IF;
    RETURN NULL;
  END IF;

  -- Login correcto: se limpian los contadores de ESTE usuario.
  DELETE FROM public.login_alumno_intentos
   WHERE clave = 'u:' || v_usuario
      OR (v_ip IS NOT NULL AND clave = 'p:' || v_usuario || '|' || v_ip);

  -- Hashes viejos (costo menor a 10): se mejoran ahora que se conoce la contrasena.
  IF v_hash ~ '^\$2[aby]\$[0-9]{2}\$' AND substring(v_hash FROM 5 FOR 2)::int < 10 THEN
    UPDATE public.alumnos
       SET password_hash = extensions.crypt(p_contrasena, extensions.gen_salt('bf', 10))
     WHERE id = v_id;
  END IF;

  RETURN v_codigo;
END;
$function$;

-- ----------------------------------------------------------------------------
-- crear_acceso_alumno: costo 10, topes de largo, y limpia los contadores del
-- usuario (asi el profesor puede destrabar a un alumno poniendole clave nueva).
-- El texto del error de usuario repetido conserva 'ya lo tiene otro alumno'
-- (lib/accesoAlumno.js lo busca) pero sin voseo.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_acceso_alumno(p_alumno_id uuid, p_usuario text, p_contrasena text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  p_usuario := btrim(COALESCE(p_usuario, ''));

  IF length(p_usuario) < 3 THEN
    RAISE EXCEPTION 'El usuario tiene que tener al menos 3 caracteres.';
  END IF;

  IF length(p_usuario) > 50 THEN
    RAISE EXCEPTION 'El usuario puede tener hasta 50 caracteres.';
  END IF;

  IF length(COALESCE(p_contrasena, '')) < 8 THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos 8 caracteres.';
  END IF;

  IF length(p_contrasena) > 72 THEN
    RAISE EXCEPTION 'La contraseña puede tener hasta 72 caracteres.';
  END IF;

  IF p_contrasena !~ '[A-Z]' THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos una letra mayúscula.';
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
