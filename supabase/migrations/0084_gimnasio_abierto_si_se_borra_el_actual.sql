-- ============================================================================
-- 0084_gimnasio_abierto_si_se_borra_el_actual.sql
--
-- Hallazgo de la prueba completa del 29/10/2026: si una persona con VARIOS gimnasios elimina el que
-- tiene abierto (o se lo quitan del equipo), get_mi_gimnasio_id() ya no encuentra ni la sesion ni el
-- "ultimo usado" y la tercera salida solo servia cuando tenia UN solo gimnasio. Con dos o mas devolvia
-- NULL y la app la mandaba a "Crear el gimnasio" (como si fuera una cuenta nueva) aunque conserva otros.
--
-- Se cambia SOLO esa tercera salida: si no hay gimnasio de sesion ni "ultimo usado" valido, se abre el
-- gimnasio mas antiguo de los que tiene activos. El cliente fija ese gimnasio en la sesion al cargar
-- (cambiar_gimnasio), asi que queda estable y se puede elegir otro desde el menu. Lo demas queda igual:
-- siempre exige membresia activa en el momento; un staff pausado (sin ninguna activa) sigue sin gimnasio.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_mi_gimnasio_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- 1. el gimnasio elegido en ESTA sesion
    (SELECT s.gimnasio_id
       FROM public.sesion_gimnasio s
       JOIN public.membresias m
         ON m.user_id = s.user_id AND m.gimnasio_id = s.gimnasio_id AND m.activo
      WHERE s.user_id = auth.uid()
        AND s.session_id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid),
    -- 2. el ultimo gimnasio usado
    (SELECT p.gimnasio_id
       FROM public.profiles p
       JOIN public.membresias m
         ON m.user_id = p.id AND m.gimnasio_id = p.gimnasio_id AND m.activo
      WHERE p.id = auth.uid()),
    -- 3. el gimnasio activo mas antiguo (antes: solo si tenia uno)
    (SELECT m.gimnasio_id
       FROM public.membresias m
      WHERE m.user_id = auth.uid() AND m.activo
      ORDER BY m.created_at, m.gimnasio_id
      LIMIT 1)
  )
$function$;
