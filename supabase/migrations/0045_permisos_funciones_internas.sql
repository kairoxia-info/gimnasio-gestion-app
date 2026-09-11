-- 0045: se les saca el permiso de ejecucion publico a las funciones que nunca
-- deberian poder llamarse desde afuera, y se les fija el search_path a las
-- que no lo tenian.
--
-- Sale de los advisors de seguridad de Supabase, verificado contra la base
-- (11/09/2026). Ninguna de estas es explotable hoy tal como esta el codigo
-- -- eliminar_mi_cuenta(), por ejemplo, corta con "No hay sesion activa" si
-- la llama un anonimo, y las de trigger fallan fuera de su contexto. Pero
-- estaban accesibles en /rest/v1/rpc/... para cualquiera, y alcanza con que
-- una de ellas cambie en el futuro para que eso deje de ser inofensivo. Es
-- cerrar la puerta ahora que es gratis.

-- 1. Funciones internas: de trigger, de event trigger, y las de uso interno.
--    Ninguna la llama el cliente: no tienen por que estar publicadas.
REVOKE ALL ON FUNCTION public.asignar_numero_comprobante() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable()            FROM PUBLIC, anon, authenticated;

-- 2. eliminar_mi_cuenta() borra el gimnasio entero: solo con sesion.
REVOKE ALL ON FUNCTION public.eliminar_mi_cuenta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_mi_cuenta() TO authenticated;

-- 3. get_mi_gimnasio_id() la usan las policies (corren como el dueño, no
--    necesitan GRANT) y alguna funcion SECURITY DEFINER. Para un anonimo
--    devuelve NULL, no filtra nada, pero no hay motivo para exponerla.
REVOKE ALL ON FUNCTION public.get_mi_gimnasio_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mi_gimnasio_id() TO authenticated;

-- 4. Funciones del panel: son SECURITY INVOKER (RLS ya las tapa), pero PUBLIC
--    incluye cualquier rol. Se deja solo `authenticated`, que es quien las usa.
REVOKE ALL ON FUNCTION public.archivar_pagos_hasta(date)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ingresos_por_mes(integer)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crear_acceso_alumno(uuid, text, text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quitar_acceso_alumno(uuid)                    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archivar_pagos_hasta(date)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingresos_por_mes(integer)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_acceso_alumno(uuid, text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.quitar_acceso_alumno(uuid)                 TO authenticated;

-- 5. ver_plan_por_codigo la tiene que poder llamar el alumno sin sesion, pero
--    tampoco hace falta que este abierta a PUBLIC entero.
REVOKE ALL ON FUNCTION public.ver_plan_por_codigo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_plan_por_codigo(text) TO anon, authenticated;

-- 6. search_path fijo en las 4 que no lo tenian. Todas ya escriben los
--    nombres completos (public.pagos, extensions.crypt), asi que fijarlo no
--    les cambia el comportamiento; lo que evita es que alguien pueda colarles
--    una tabla o funcion propia por delante manipulando el search_path.
ALTER FUNCTION public.archivar_pagos_hasta(date)               SET search_path = public, extensions;
ALTER FUNCTION public.ingresos_por_mes(integer)                SET search_path = public, extensions;
ALTER FUNCTION public.crear_acceso_alumno(uuid, text, text)    SET search_path = public, extensions;
ALTER FUNCTION public.quitar_acceso_alumno(uuid)               SET search_path = public, extensions;
-- 7. listar_planes_para_codigo() era un endpoint publico que devolvia nombre,
--    precio y periodo de los planes activos de un gimnasio. Dejo de usarse en
--    la 0038, cuando el autorregistro dejo de pedirle el plan al alumno.
--    Confirmado que no lo llama nadie en apps/web/src: se cierra.
REVOKE ALL ON FUNCTION public.listar_planes_para_codigo(text) FROM PUBLIC, anon, authenticated;
