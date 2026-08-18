-- ============================================================================
-- 0002_grant_authenticated_privileges.sql
--
-- Hallazgo del test de aislamiento A6 (corrido contra la base real):
-- RLS filtra FILAS, pero Postgres exige además un GRANT a nivel de TABLA
-- antes de que las policies siquiera se evalúen. La migración 0001 habilitó
-- RLS en las 12 tablas pero nunca otorgó privilegios base al rol
-- 'authenticated' (el rol con el que corre cualquier request autenticado
-- vía PostgREST/Supabase Auth). Sin este GRANT, el error es "permission
-- denied for table X" — ni siquiera llega a evaluarse la policy. Esto se
-- detectó recién al simular un usuario real con SET ROLE authenticated;
-- una consulta corrida como el rol de administración (postgres) no lo
-- hubiera mostrado, porque ese rol bypassea RLS y grants por completo.
--
-- Deliberadamente SIN grants a 'anon': esta app requiere login para
-- cualquier operación de negocio, 'anon' no debe poder tocar estas tablas.
--
-- Aplicada y verificada contra gimnasio-gestion-app (fftdmpqbemcnxdnfnvhd)
-- el mismo día que la 0001, como parte del cierre de A6.
-- ============================================================================

-- profiles y gimnasios: solo SELECT/UPDATE, tal como reflejan sus policies
-- (el INSERT lo hacen únicamente el trigger y create_gimnasio(), ambos
-- SECURITY DEFINER; no hay policy de INSERT/DELETE directa para el cliente).
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, UPDATE ON public.gimnasios TO authenticated;

-- Las 10 tablas de negocio: policies FOR ALL, así que CRUD completo.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alumnos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ejercicios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alimentos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rutinas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rutinas_asignadas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planes_alimentacion TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asistencias TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.progreso TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracion_precios TO authenticated;

-- Confirmar explícitamente que anon sigue sin nada (no debería tener nada
-- por default, pero lo dejamos explícito para que quede documentado y no
-- dependa de un supuesto sobre el estado por defecto del proyecto).
REVOKE ALL ON public.profiles, public.gimnasios, public.alumnos, public.ejercicios,
  public.alimentos, public.rutinas, public.rutinas_asignadas,
  public.planes_alimentacion, public.asistencias, public.progreso,
  public.pagos, public.configuracion_precios
FROM anon;
