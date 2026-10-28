-- ============================================================================
-- 0075_fix_triggers_fecha_por_defecto.sql
--
-- CORRIGE UN ERROR DE LA 0074 (28/10/2026, detectado al probarla con gimnasios
-- descartables, minutos despues de aplicarla).
--
-- La 0074 reemplazo los DEFAULT CURRENT_DATE de entrenamientos_completados.fecha
-- y rutinas_asignadas.fecha_inicio por UN trigger compartido
-- (fijar_fecha_por_defecto) que decidia por TG_TABLE_NAME. PL/pgSQL resuelve los
-- campos de NEW al planificar la expresion, aunque la primera condicion del AND
-- sea falsa: al insertar en rutinas_asignadas fallaba con
--   record "new" has no field "fecha"
-- (y al reves en entrenamientos_completados). Resultado: NO SE PODIA asignar una
-- rutina a un alumno ni marcar un entrenamiento como hecho. Estuvo asi unos
-- minutos, hasta esta migracion.
--
-- Arreglo: una funcion por tabla, cada una toca solo su propio campo. No se edita
-- la 0074 (ya aplicada): convencion del proyecto, se corrige con una migracion
-- nueva (mismo criterio que 0056 -> 0057).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fijar_fecha_entrenamiento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.fecha IS NULL THEN
    NEW.fecha := public.fecha_del_gimnasio(NEW.gimnasio_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fijar_fecha_inicio_rutina_asignada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.fecha_inicio IS NULL THEN
    NEW.fecha_inicio := public.fecha_del_gimnasio(NEW.gimnasio_id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fijar_fecha_entrenamiento() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fijar_fecha_inicio_rutina_asignada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS entrenamientos_fijar_fecha_trg ON public.entrenamientos_completados;
CREATE TRIGGER entrenamientos_fijar_fecha_trg
  BEFORE INSERT ON public.entrenamientos_completados
  FOR EACH ROW EXECUTE FUNCTION public.fijar_fecha_entrenamiento();

DROP TRIGGER IF EXISTS rutinas_asignadas_fijar_fecha_trg ON public.rutinas_asignadas;
CREATE TRIGGER rutinas_asignadas_fijar_fecha_trg
  BEFORE INSERT ON public.rutinas_asignadas
  FOR EACH ROW EXECUTE FUNCTION public.fijar_fecha_inicio_rutina_asignada();

DROP FUNCTION IF EXISTS public.fijar_fecha_por_defecto();
