-- ============================================================================
-- 0082_aviso_de_acceso_pausado.sql
--
-- Hallazgo de la prueba real de cuentas de staff (28/10/2026): cuando el administrador PAUSA a un
-- empleado, la app lo mandaba a "Crear el gimnasio", como si fuera un profesor nuevo. La base ya
-- le impide crearlo (create_gimnasio rechaza a una cuenta que solo sea staff, 0080), pero el
-- mensaje era equivocado y confuso.
--
-- mi_contexto() suma 'acceso_pausado': true cuando la persona NO tiene ningun gimnasio activo pero
-- si una membresia de staff pausada. El cliente muestra entonces "Tu acceso está pausado" en vez de
-- la pantalla de crear gimnasio. El resto de la funcion queda igual que en la 0077.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mi_contexto()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'gimnasio_id', public.get_mi_gimnasio_id(),
    'organizacion_id', public.get_mi_organizacion_id(),
    'rol', public.get_mi_rol(),
    'acceso_pausado', (
      NOT EXISTS (SELECT 1 FROM public.membresias m WHERE m.user_id = auth.uid() AND m.activo)
      AND EXISTS (SELECT 1 FROM public.membresias m WHERE m.user_id = auth.uid() AND m.rol = 'staff' AND NOT m.activo)
    ),
    'gimnasio', (
      SELECT jsonb_build_object(
               'nombre', g.nombre, 'logo_url', g.logo_url, 'color_principal', g.color_principal,
               'dias_abiertos', g.dias_abiertos, 'zona_horaria', g.zona_horaria)
        FROM public.gimnasios g WHERE g.id = public.get_mi_gimnasio_id()
    ),
    'gimnasios', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'id', g.id, 'nombre', g.nombre, 'logo_url', g.logo_url, 'rol', m.rol,
                 'unico_admin', (m.rol = 'admin' AND NOT EXISTS (
                     SELECT 1 FROM public.membresias o
                      WHERE o.gimnasio_id = m.gimnasio_id AND o.rol = 'admin' AND o.activo
                        AND o.user_id <> m.user_id)),
                 'otros_en_organizacion', EXISTS (
                     SELECT 1 FROM public.gimnasios g2
                      WHERE g2.organizacion_id = g.organizacion_id AND g2.id <> g.id)
               ) ORDER BY g.nombre)
        FROM public.membresias m
        JOIN public.gimnasios g ON g.id = m.gimnasio_id
       WHERE m.user_id = auth.uid() AND m.activo
    ), '[]'::jsonb)
  )
$function$;
