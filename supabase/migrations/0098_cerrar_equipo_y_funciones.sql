-- ============================================================================
-- 0098_cerrar_equipo_y_funciones.sql
--
-- IMPORTANTE (regla nueva desde esta migración): toda función nueva del esquema public queda CERRADA
-- por defecto (sin EXECUTE para PUBLIC, anon ni authenticated). Cada migración que cree una función
-- tiene que poner el GRANT explícito a quien corresponda (authenticated, anon o service_role).
-- Si una función nueva "no responde" desde la app, lo primero que hay que mirar es su GRANT.
--
-- Qué cierra esta migración:
--   1. profiles.email deja de ser editable desde el navegador (el correo de acceso es el de Auth).
--   2. Equipo funciona como siempre, pero una cuenta solo se suma si su correo está comprobado: es de la
--      propia organización, o la persona confirmó su correo al registrarse. Las cuentas que creó el equipo
--      de otra organización no cuentan, porque ese correo nadie lo comprobó. REQUIERE "Confirm email"
--      activado en Supabase: sin eso, un correo "confirmado" no prueba nada.
--   3. Funciones internas (triggers, helpers de suscripción) dejan de ser ejecutables por la API.
--   4. Permisos por defecto cerrados para las funciones futuras.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Funciones futuras cerradas por defecto
-- ----------------------------------------------------------------------------
-- Lo concedido globalmente (a PUBLIC) y lo concedido por esquema (a anon/authenticated) son dos
-- entradas distintas: Postgres no deja revocar por esquema lo que se dio globalmente, hacen falta las dos.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. profiles.email no se edita desde el cliente
-- ----------------------------------------------------------------------------
-- El correo de profiles lo escribe el alta de la cuenta; si el usuario lo pudiera cambiar, las búsquedas
-- por correo del equipo podrían apuntar a otra persona. first_name y last_name siguen editables.
REVOKE UPDATE (email) ON public.profiles FROM authenticated;
REVOKE UPDATE (email) ON public.profiles FROM anon;

-- ----------------------------------------------------------------------------
-- 2. ¿Esta persona es de mi organización?
-- ----------------------------------------------------------------------------
-- Es de mi organización si tiene membresía en cualquier gimnasio de ella, o si su cuenta fue creada por
-- ella. Se usa raw_app_meta_data porque el usuario NO puede cambiarlo (raw_user_meta_data sí).
CREATE FUNCTION public.equipo_es_de_mi_organizacion(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org UUID := public.get_mi_organizacion_id();
BEGIN
  IF p_user_id IS NULL OR v_org IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1
                   FROM public.membresias m
                   JOIN public.gimnasios g ON g.id = m.gimnasio_id
                  WHERE m.user_id = p_user_id AND g.organizacion_id = v_org)
      OR EXISTS (SELECT 1
                   FROM auth.users u
                  WHERE u.id = p_user_id
                    AND u.raw_app_meta_data ->> 'creada_por_organizacion' = v_org::text);
END;
$function$;

-- Solo la llaman otras funciones SECURITY DEFINER (corren como dueño).
REVOKE ALL ON FUNCTION public.equipo_es_de_mi_organizacion(uuid) FROM PUBLIC, anon, authenticated;

-- ¿Se puede sumar esta cuenta al equipo? Sí si ya es de la organización, o si la persona se registró sola
-- y confirmó su correo. Una cuenta creada por el equipo de OTRA organización no: se crea con el correo ya
-- marcado como confirmado, sin que nadie lo haya comprobado, y quien la creó conoce su contraseña.
CREATE FUNCTION public.equipo_se_puede_sumar(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.equipo_es_de_mi_organizacion(p_user_id)
      OR EXISTS (SELECT 1
                   FROM auth.users u
                  WHERE u.id = p_user_id
                    AND u.email_confirmed_at IS NOT NULL
                    AND u.raw_app_meta_data ->> 'creada_por_organizacion' IS NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.equipo_se_puede_sumar(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. equipo_buscar: por correo de Auth, con tope de búsquedas
-- ----------------------------------------------------------------------------
-- Busca en Auth y no en profiles, y tiene tope para que no sirva como lista de quién usa la plataforma.
-- Es VOLATILE porque el tope escribe un contador.
CREATE OR REPLACE FUNCTION public.equipo_buscar(p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL OR public.get_mi_gimnasio_id() IS NULL OR public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar el equipo';
  END IF;
  IF public._login_alumno_contar('e:' || auth.uid()::text, INTERVAL '60 minutes') > 30 THEN
    RAISE EXCEPTION 'Demasiadas búsquedas en poco tiempo. Prueba de nuevo en unos minutos.';
  END IF;
  -- Igualdad exacta (no LIKE): los comodines % y _ no pueden coincidir con una cuenta ajena.
  SELECT u.id INTO v_id FROM auth.users u WHERE lower(u.email) = lower(btrim(p_email)) LIMIT 1;
  IF v_id IS NOT NULL AND public.equipo_se_puede_sumar(v_id) THEN
    RETURN v_id;
  END IF;
  RETURN NULL;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. equipo_sumar: conserva el control de suscripción de la 0086 y exige una cuenta que se pueda sumar
-- ----------------------------------------------------------------------------
-- El mensaje es el mismo que ya existía: no revela si la cuenta existe.
CREATE OR REPLACE FUNCTION public.equipo_sumar(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gim UUID := public.get_mi_gimnasio_id();
BEGIN
  PERFORM public.suscripcion_exigir_mi_org(true);
  IF auth.uid() IS NULL OR v_gim IS NULL OR public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar el equipo';
  END IF;
  IF NOT public.equipo_se_puede_sumar(p_user_id) THEN
    RAISE EXCEPTION 'No se encontró a esa persona';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'No se encontró a esa persona';
  END IF;
  IF EXISTS (SELECT 1 FROM public.membresias WHERE user_id = p_user_id AND gimnasio_id = v_gim) THEN
    RAISE EXCEPTION 'Esa persona ya está en el equipo de este gimnasio';
  END IF;
  IF (SELECT count(*) FROM public.membresias WHERE gimnasio_id = v_gim AND rol = 'staff') >= 20 THEN
    RAISE EXCEPTION 'Se alcanzó el máximo de 20 personas de staff por gimnasio';
  END IF;

  INSERT INTO public.membresias (user_id, gimnasio_id, rol) VALUES (p_user_id, v_gim, 'staff');
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. equipo_info: sin datos de personas ajenas a la organización
-- ----------------------------------------------------------------------------
-- Si no es de la organización no devuelve ninguna fila; la Edge Function lo toma como
-- es_staff = false y gimnasios = 0 (no encontró datos).
CREATE OR REPLACE FUNCTION public.equipo_info(p_user_id uuid)
 RETURNS TABLE(es_staff boolean, gimnasios integer, nombre text, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gim UUID := public.get_mi_gimnasio_id();
BEGIN
  IF auth.uid() IS NULL OR v_gim IS NULL OR public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar el equipo';
  END IF;
  IF NOT public.equipo_es_de_mi_organizacion(p_user_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT EXISTS (SELECT 1 FROM public.membresias m
                    WHERE m.user_id = p_user_id AND m.gimnasio_id = v_gim AND m.rol = 'staff'),
           (SELECT count(*)::integer FROM public.membresias m WHERE m.user_id = p_user_id),
           NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
           p.email
      FROM (SELECT 1) uno
      LEFT JOIN public.profiles p ON p.id = p_user_id;
END;
$function$;

-- Los permisos de las tres ya estaban bien (CREATE OR REPLACE los conserva); se repiten por claridad.
REVOKE ALL ON FUNCTION public.equipo_buscar(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.equipo_sumar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.equipo_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipo_buscar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.equipo_sumar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.equipo_info(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Funciones que no deben ser públicas
-- ----------------------------------------------------------------------------
-- anon hereda de PUBLIC, por eso se revoca también de PUBLIC.
--
-- (a) Triggers y ayudantes internos. Un trigger no necesita que el rol tenga EXECUTE al dispararse, y
--     las funciones SECURITY DEFINER que llaman a las suscripcion_* corren como dueño: ninguna política
--     RLS ni llamada directa de la app las usa (revisado en migraciones, Edge Functions y apps/web).
REVOKE ALL ON FUNCTION public.bitacora_registrar()                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.planes_alimentacion_validar_origen()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rutinas_asignadas_validar_rutina()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.biblioteca_fijar_dueno()                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pagos_fijar_registrado_por()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_crear_prueba()                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_validar_alumnos()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_validar_gimnasios()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_acceso(uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_exigir(uuid, boolean)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_exigir_codigo(text, boolean)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_exigir_invitacion(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_exigir_mi_org(boolean)           FROM PUBLIC, anon, authenticated;

-- (b) Se usan en políticas RLS (RESTRICTIVE de la 0086), que se evalúan como authenticated: se quita
--     lo público y se deja el permiso explícito.
REVOKE ALL ON FUNCTION public.suscripcion_puede_leer()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.suscripcion_puede_escribir()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.suscripcion_incluye_alimentacion()   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suscripcion_puede_leer()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suscripcion_puede_escribir()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suscripcion_incluye_alimentacion() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. suscripcion_periodo con search_path fijo
-- ----------------------------------------------------------------------------
ALTER FUNCTION public.suscripcion_periodo(text) SET search_path TO 'public';
