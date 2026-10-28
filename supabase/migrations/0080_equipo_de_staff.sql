-- ============================================================================
-- 0080_equipo_de_staff.sql
--
-- ETAPA B del plan "varios gimnasios por profesor" (pedido de Nalux del 28/10/2026:
-- "hazlo a las dos"): CUENTAS DE STAFF. El administrador le crea a cada empleado su
-- propio usuario y contrasena, el empleado entra SOLO al gimnasio donde trabaja, y
-- cada cosa que toque plata queda registrada a su nombre (bitacora, 0079).
--
-- COMO FUNCIONA (y por que asi)
--  * La identidad del empleado es una cuenta propia (no una clave compartida): se
--    puede pausar o quitar a UNA persona sin afectar al resto, y la bitacora sabe quien fue.
--  * Crear el usuario, cambiarle la contrasena y borrarlo lo hace la Edge Function
--    "equipo" (necesita la clave de servicio de Supabase Auth, que nunca sale del
--    servidor). Esa funcion verifica en el servidor que quien llama es ADMINISTRADOR del
--    gimnasio abierto (get_mi_rol / get_mi_gimnasio_id con el token de quien llama): ni el
--    gimnasio ni el rol salen de datos que mande el cliente.
--  * Pausar / reactivar y listar el equipo son funciones SQL de esta migracion, solo para
--    administradores. Pausar corta el acceso al instante (get_mi_gimnasio_id exige la
--    membresia activa en cada consulta).
--  * Un empleado (rol 'staff') NO puede crear gimnasios propios: sin esto cualquier
--    empleado podria abrir uno nuevo y usar la aplicacion sin pagar (requisito de Nalux:
--    "que no se pueda meter nadie que no pague gratis"). El primer gimnasio de una persona
--    nueva sigue funcionando igual; el control de suscripcion llega con ese modulo.
--  * Lo que el staff NO puede (ya garantizado en la base desde la 0076): editar los datos
--    del gimnasio, el logo, regenerar el codigo de invitacion, eliminar el gimnasio. Ahora
--    ademas no ve Configuracion, Mis gimnasios, Equipo ni el Historial (la base ya le
--    oculta la bitacora).
-- ============================================================================

-- 1. Listar el equipo del gimnasio abierto (solo administradores)
CREATE OR REPLACE FUNCTION public.equipo_listar()
 RETURNS TABLE(user_id uuid, nombre text, email text, rol text, activo boolean, desde timestamptz, soy_yo boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.user_id,
         NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
         p.email,
         m.rol,
         m.activo,
         m.created_at,
         (m.user_id = auth.uid())
    FROM public.membresias m
    LEFT JOIN public.profiles p ON p.id = m.user_id
   WHERE m.gimnasio_id = public.get_mi_gimnasio_id()
     AND public.get_mi_rol() = 'admin'
   ORDER BY (m.rol = 'admin') DESC, p.first_name, p.email
$function$;

REVOKE ALL ON FUNCTION public.equipo_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipo_listar() TO authenticated;

-- 2. Pausar o reactivar a una persona del equipo (solo administradores, solo staff)
CREATE OR REPLACE FUNCTION public.equipo_cambiar_estado(p_user_id uuid, p_activo boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gim    UUID := public.get_mi_gimnasio_id();
  v_nombre TEXT;
BEGIN
  IF auth.uid() IS NULL OR v_gim IS NULL OR public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar el equipo';
  END IF;

  UPDATE public.membresias
     SET activo = p_activo
   WHERE user_id = p_user_id AND gimnasio_id = v_gim AND rol = 'staff';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró a esa persona en el equipo';
  END IF;

  SELECT COALESCE(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), p.email)
    INTO v_nombre FROM public.profiles p WHERE p.id = p_user_id;

  PERFORM public.equipo_anotar(CASE WHEN p_activo THEN 'reactivacion' ELSE 'pausa' END, v_nombre, NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.equipo_cambiar_estado(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipo_cambiar_estado(uuid, boolean) TO authenticated;

-- 3. Anotar en la bitacora un cambio del equipo (solo administradores; el texto lo arma la base)
CREATE OR REPLACE FUNCTION public.equipo_anotar(p_evento text, p_nombre text, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gim    UUID := public.get_mi_gimnasio_id();
  v_autor  TEXT;
  v_quien  TEXT;
  v_accion TEXT;
  v_texto  TEXT;
BEGIN
  IF auth.uid() IS NULL OR v_gim IS NULL OR public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar el equipo';
  END IF;

  v_quien := left(COALESCE(NULLIF(btrim(p_nombre), ''), NULLIF(btrim(p_email), ''), 'una persona'), 120);
  IF NULLIF(btrim(p_email), '') IS NOT NULL AND NULLIF(btrim(p_nombre), '') IS NOT NULL THEN
    v_quien := v_quien || ' (' || left(btrim(p_email), 120) || ')';
  END IF;

  CASE p_evento
    WHEN 'alta'         THEN v_accion := 'alta';     v_texto := 'Sumó al equipo a ';
    WHEN 'baja'         THEN v_accion := 'baja';     v_texto := 'Quitó del equipo a ';
    WHEN 'pausa'        THEN v_accion := 'edicion';  v_texto := 'Pausó el acceso de ';
    WHEN 'reactivacion' THEN v_accion := 'edicion';  v_texto := 'Reactivó el acceso de ';
    WHEN 'clave'        THEN v_accion := 'edicion';  v_texto := 'Cambió la contraseña de ';
    ELSE RAISE EXCEPTION 'Evento no válido';
  END CASE;

  SELECT COALESCE(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), p.email)
    INTO v_autor FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.bitacora (gimnasio_id, user_id, autor_nombre, autor_rol, accion, tabla, resumen)
  VALUES (v_gim, auth.uid(), v_autor, 'admin', v_accion, 'membresias', v_texto || v_quien);
END;
$function$;

REVOKE ALL ON FUNCTION public.equipo_anotar(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipo_anotar(text, text, text) TO authenticated;

-- 4. Un empleado no puede crear gimnasios propios
-- Se agrega UN control al principio de create_gimnasio (0076); el resto queda igual.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.create_gimnasio(text)'::regprocedure);
  v_viejo CONSTANT TEXT := E'  SELECT count(*) INTO v_cantidad\n    FROM public.membresias WHERE user_id = v_uid AND rol = ''admin'' AND activo;';
  v_nuevo CONSTANT TEXT := E'  IF EXISTS (SELECT 1 FROM public.membresias WHERE user_id = v_uid AND rol = ''staff'')\n     AND NOT EXISTS (SELECT 1 FROM public.membresias WHERE user_id = v_uid AND rol = ''admin'') THEN\n    RAISE EXCEPTION ''Una cuenta de staff no puede crear gimnasios'';\n  END IF;\n\n' || v_viejo;
BEGIN
  IF position(v_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION '0080: no se encontro el conteo de gimnasios en create_gimnasio; no se modifica nada';
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END $$;
