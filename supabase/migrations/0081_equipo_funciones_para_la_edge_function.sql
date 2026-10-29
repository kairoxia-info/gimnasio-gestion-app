-- ============================================================================
-- 0081_equipo_funciones_para_la_edge_function.sql
--
-- Correccion de la 0080 (28/10/2026, al probar "Agregar persona" en la pantalla Equipo:
-- "No se pudo sumar a la persona al equipo").
--
-- CAUSA: la Edge Function "equipo" leia y escribia las tablas membresias y profiles con la
-- clave de servicio, pero en este proyecto la cuenta service_role NO tiene permisos sobre esas
-- tablas (comprobado con has_table_privilege). La funcion creaba el usuario en Supabase Auth,
-- fallaba al sumarlo al gimnasio y lo borraba (por eso no quedo ninguna cuenta a medias).
--
-- SOLUCION (sin darle permisos nuevos a service_role): la funcion usa estas 4 funciones SQL,
-- que se ejecutan con la sesion de quien llama y verifican en la base que sea ADMINISTRADOR del
-- gimnasio abierto. La clave de servicio queda solo para lo que no se puede hacer de otra forma:
-- crear, cambiar la contrasena y borrar usuarios en Supabase Auth (su API propia, no las tablas).
--
--  * equipo_buscar(email): id de la cuenta con ese correo, o NULL. (Solo admin.)
--  * equipo_sumar(user_id): da acceso de staff al gimnasio abierto; tope 20, sin duplicar.
--  * equipo_info(user_id): si es staff de ESTE gimnasio, a cuantos gimnasios tiene acceso, nombre y correo.
--  * equipo_quitar(user_id): le saca el acceso a ESTE gimnasio (solo staff); devuelve cuantos
--    gimnasios le quedan y, si ninguno, borra tambien su perfil (la cuenta de Auth la borra la funcion).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.equipo_buscar(p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL OR public.get_mi_gimnasio_id() IS NULL OR public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar el equipo';
  END IF;
  -- Igualdad exacta (no LIKE): los comodines % y _ no pueden coincidir con una cuenta ajena.
  SELECT id INTO v_id FROM public.profiles WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.equipo_sumar(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gim UUID := public.get_mi_gimnasio_id();
BEGIN
  IF auth.uid() IS NULL OR v_gim IS NULL OR public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar el equipo';
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

CREATE OR REPLACE FUNCTION public.equipo_quitar(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gim UUID := public.get_mi_gimnasio_id();
  v_quedan INTEGER;
BEGIN
  IF auth.uid() IS NULL OR v_gim IS NULL OR public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar el equipo';
  END IF;

  DELETE FROM public.membresias WHERE user_id = p_user_id AND gimnasio_id = v_gim AND rol = 'staff';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró a esa persona en el equipo';
  END IF;

  SELECT count(*) INTO v_quedan FROM public.membresias WHERE user_id = p_user_id;
  IF v_quedan = 0 THEN
    DELETE FROM public.profiles WHERE id = p_user_id;
  END IF;
  RETURN v_quedan;
END;
$function$;

REVOKE ALL ON FUNCTION public.equipo_buscar(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.equipo_sumar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.equipo_info(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.equipo_quitar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipo_buscar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.equipo_sumar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.equipo_info(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.equipo_quitar(uuid) TO authenticated;
