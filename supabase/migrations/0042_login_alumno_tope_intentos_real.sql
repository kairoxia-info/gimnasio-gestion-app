-- 0042: el tope de intentos del login del alumno ahora funciona de verdad,
-- y deja de compartir contador con "ver mi plan".
--
-- DOS problemas encontrados en el repaso de seguridad (11/09/2026):
--
-- 1) EL TOPE NO FRENABA NADA. iniciar_sesion_alumno() sumaba 1 al contador y
--    DESPUES verificaba la contraseña; si estaba mal hacia RAISE EXCEPTION.
--    En Postgres esa excepcion aborta la transaccion entera, asi que la suma
--    al contador se revertia junto con ella. Resultado: cada intento fallido
--    borraba su propia marca y se podian probar contraseñas sin limite. Lo
--    unico que el tope llegaba a contar eran los logins CORRECTOS, o sea
--    exactamente al reves de lo que hace falta.
--    (Comprobado sobre una tabla de prueba: 5 fallos seguidos dejaban el
--    contador en 0.)
--    Se arregla devolviendo NULL en vez de lanzar excepcion cuando la
--    contraseña esta mal: sin excepcion no hay rollback, y la suma queda.
--
-- 2) CONTADOR COMPARTIDO. iniciar_sesion_alumno() y ver_plan_por_codigo()
--    escribian LAS MISMAS dos columnas (plan_consultas_*) con topes distintos
--    (20 y 60). Un alumno que recargaba su plan 20 veces en 5 minutos (pasa
--    con mala señal en el gimnasio) despues no podia entrar, y le decia
--    "Demasiados intentos" sin haber escrito ninguna contraseña mal. Ahora el
--    login tiene sus propias columnas.
--
-- De paso: se cuentan solo los intentos FALLIDOS, y entrar bien pone el
-- contador en cero, asi los fallos viejos no le quedan pesando al alumno.

ALTER TABLE public.alumnos
    ADD COLUMN IF NOT EXISTS login_intentos_contador INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS login_intentos_ventana_inicio TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.iniciar_sesion_alumno(p_usuario TEXT, p_contrasena TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_hash TEXT;
  v_codigo TEXT;
  v_intentos INTEGER;
  v_ventana TIMESTAMPTZ;
BEGIN
  p_usuario := left(btrim(COALESCE(p_usuario, '')), 100);

  SELECT id, password_hash, codigo_acceso,
         login_intentos_contador, login_intentos_ventana_inicio
    INTO v_id, v_hash, v_codigo, v_intentos, v_ventana
  FROM public.alumnos
  WHERE lower(usuario) = lower(p_usuario) AND activo = true;

  -- Usuario que no existe: se devuelve NULL, lo mismo que una contraseña
  -- equivocada. Si se distinguieran los dos casos se podria averiguar que
  -- usuarios existen probando nombres.
  IF v_id IS NULL OR v_hash IS NULL THEN
    RETURN NULL;
  END IF;

  -- Tope: 20 intentos FALLIDOS por alumno cada 5 minutos. Aca si se lanza
  -- excepcion, porque en esta rama no hay nada escrito que perder y conviene
  -- que el alumno vea un mensaje distinto ("esperá unos minutos") al de
  -- contraseña equivocada.
  IF v_ventana IS NOT NULL
     AND v_ventana > now() - INTERVAL '5 minutes'
     AND v_intentos >= 20 THEN
    RAISE EXCEPTION 'Demasiados intentos. Probá de nuevo en unos minutos.';
  END IF;

  IF extensions.crypt(p_contrasena, v_hash) <> v_hash THEN
    UPDATE public.alumnos
       SET login_intentos_contador = CASE
             WHEN login_intentos_ventana_inicio IS NULL
               OR login_intentos_ventana_inicio < now() - INTERVAL '5 minutes'
             THEN 1
             ELSE login_intentos_contador + 1
           END,
           login_intentos_ventana_inicio = CASE
             WHEN login_intentos_ventana_inicio IS NULL
               OR login_intentos_ventana_inicio < now() - INTERVAL '5 minutes'
             THEN now()
             ELSE login_intentos_ventana_inicio
           END
     WHERE id = v_id;
    RETURN NULL;
  END IF;

  UPDATE public.alumnos
     SET login_intentos_contador = 0,
         login_intentos_ventana_inicio = NULL
   WHERE id = v_id;

  RETURN v_codigo;
END;
$function$;

-- PUBLIC incluye a cualquier rol; se deja solo a los dos que usa la app.
REVOKE ALL ON FUNCTION public.iniciar_sesion_alumno(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iniciar_sesion_alumno(TEXT, TEXT) TO anon, authenticated;
