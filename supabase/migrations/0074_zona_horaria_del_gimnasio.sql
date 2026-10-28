-- ============================================================================
-- 0074_zona_horaria_del_gimnasio.sql
--
-- Zona horaria por gimnasio (auditoria pre-lanzamiento, 28/10/2026; criterio de
-- Nalux: "la app tiene que andar bien para todos los login").
--
-- EL PROBLEMA. El servidor corre en UTC y todas las funciones medían "hoy" con
-- CURRENT_DATE (fecha UTC). En Argentina (UTC-3), de 21:00 a medianoche el
-- servidor creia que ya era mañana: a un alumno cuya cuota vence HOY se le
-- restringia la rutina a las 21:00, una asistencia o un entrenamiento marcado a
-- la noche quedaba con la fecha de mañana, y el grafico de ingresos cambiaba de
-- mes unas horas antes de tiempo. Con gimnasios de otros paises (Mexico UTC-6,
-- Chile, Espana UTC+1/+2) el desfase es distinto en cada uno.
--
-- LA SOLUCION.
-- 1. gimnasios.zona_horaria (nombre IANA, validado contra pg_timezone_names, por
--    defecto America/Argentina/Buenos_Aires: todos los gimnasios actuales son
--    argentinos, asi que NADA cambia para ellos). El admin la elige en
--    Configuracion; los gimnasios nuevos toman la del dispositivo que los crea.
-- 2. fecha_del_gimnasio(gimnasio_id): la fecha de hoy en esa zona.
-- 3. Las 6 funciones que usaban CURRENT_DATE pasan a usarla:
--      alumno_cargar_peso, ingresos_por_mes, join_gimnasio_por_codigo,
--      marcar_entrenamiento_hecho, ver_plan_por_codigo, ver_progreso_alumno.
--    Se reescriben a partir de su definicion ACTUAL en la base (pg_get_functiondef)
--    cambiando SOLO ese token, a proposito: copiar a mano 6 funciones largas
--    arriesga errores, y asi el resto de cada una queda exactamente igual.
-- 4. Las columnas entrenamientos_completados.fecha y rutinas_asignadas.fecha_inicio
--    tenian DEFAULT CURRENT_DATE: se reemplaza por un trigger que usa la zona del
--    gimnasio solo cuando el INSERT no trae la fecha.
-- 5. El cliente usa la MISMA zona en hoy() (lib/format.js), asi cliente y servidor
--    siempre coinciden aunque el profesor viaje o su dispositivo este mal puesto.
--
-- De paso (hallazgo de la 0073): el trigger de numero de comprobante GASTABA un
-- numero cuando la cola sin conexion reenviaba un pago duplicado (corre antes de
-- detectar el conflicto con ON CONFLICT DO NOTHING) y dejaba un hueco en la
-- numeracion. Ahora no numera si ya existe un pago con ese client_id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columna y validacion
-- ----------------------------------------------------------------------------
-- Solo nombres IANA reales (Postgres tambien acepta cosas como 'UTC-3', que en
-- notacion POSIX significa UTC+3, y el navegador las rechaza: serian distintas
-- en cliente y servidor).
CREATE OR REPLACE FUNCTION public.zona_horaria_valida(p_zona text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_zona);
$function$;

ALTER TABLE public.gimnasios
  ADD COLUMN IF NOT EXISTS zona_horaria TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';

ALTER TABLE public.gimnasios
  ADD CONSTRAINT gimnasios_zona_horaria_valida CHECK (public.zona_horaria_valida(zona_horaria));

COMMENT ON COLUMN public.gimnasios.zona_horaria IS
  'Zona horaria IANA del gimnasio (0074). Define que dia es "hoy" para cuotas, asistencia, pagos, avisos y el portal del alumno.';

-- El cliente la edita desde Configuracion (los permisos de gimnasios son por
-- columna desde la 0073, hay que sumarla a la lista).
GRANT UPDATE (zona_horaria) ON public.gimnasios TO authenticated;
GRANT EXECUTE ON FUNCTION public.zona_horaria_valida(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. La fecha de hoy de un gimnasio
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER: las funciones del portal del alumno la llaman desde dentro
-- de una SECURITY DEFINER (corren como duenio), e ingresos_por_mes (INVOKER) la
-- llama como el profesor, que por RLS solo ve su propio gimnasio. Si el
-- gimnasio no existe devuelve la fecha de la zona por defecto.
CREATE OR REPLACE FUNCTION public.fecha_del_gimnasio(p_gimnasio_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (now() AT TIME ZONE COALESCE(
            (SELECT g.zona_horaria FROM public.gimnasios g WHERE g.id = p_gimnasio_id),
            'America/Argentina/Buenos_Aires'))::date;
$function$;

REVOKE ALL ON FUNCTION public.fecha_del_gimnasio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fecha_del_gimnasio(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Las 6 funciones: CURRENT_DATE -> fecha del gimnasio
-- ----------------------------------------------------------------------------
-- Cinco tienen una variable v_gimnasio_id ya resuelta antes de usar la fecha;
-- ingresos_por_mes no (es SQL puro e INVOKER) y usa el gimnasio del profesor.
DO $reescribir$
DECLARE
  r record;
  v_def text;
  v_nuevo text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           CASE WHEN p.proname = 'ingresos_por_mes'
                THEN 'public.fecha_del_gimnasio(public.get_mi_gimnasio_id())'
                ELSE 'public.fecha_del_gimnasio(v_gimnasio_id)'
           END AS expresion
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('alumno_cargar_peso', 'ingresos_por_mes', 'join_gimnasio_por_codigo',
                         'marcar_entrenamiento_hecho', 'ver_plan_por_codigo', 'ver_progreso_alumno')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position('fecha_del_gimnasio' IN v_def) > 0 THEN
      CONTINUE; -- ya migrada (la migracion se puede volver a correr)
    END IF;
    v_nuevo := regexp_replace(v_def, 'CURRENT_DATE', r.expresion, 'gi');
    IF v_nuevo = v_def THEN
      RAISE EXCEPTION 'La funcion % no usa CURRENT_DATE: esta migracion esta desactualizada, revisarla', r.proname;
    END IF;
    EXECUTE v_nuevo;
  END LOOP;
END
$reescribir$;

-- ----------------------------------------------------------------------------
-- 4. Fechas por defecto de dos columnas
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fijar_fecha_por_defecto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'entrenamientos_completados' AND NEW.fecha IS NULL THEN
    NEW.fecha := public.fecha_del_gimnasio(NEW.gimnasio_id);
  ELSIF TG_TABLE_NAME = 'rutinas_asignadas' AND NEW.fecha_inicio IS NULL THEN
    NEW.fecha_inicio := public.fecha_del_gimnasio(NEW.gimnasio_id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fijar_fecha_por_defecto() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.entrenamientos_completados ALTER COLUMN fecha DROP DEFAULT;
ALTER TABLE public.rutinas_asignadas ALTER COLUMN fecha_inicio DROP DEFAULT;

DROP TRIGGER IF EXISTS entrenamientos_fijar_fecha_trg ON public.entrenamientos_completados;
CREATE TRIGGER entrenamientos_fijar_fecha_trg
  BEFORE INSERT ON public.entrenamientos_completados
  FOR EACH ROW EXECUTE FUNCTION public.fijar_fecha_por_defecto();

DROP TRIGGER IF EXISTS rutinas_asignadas_fijar_fecha_trg ON public.rutinas_asignadas;
CREATE TRIGGER rutinas_asignadas_fijar_fecha_trg
  BEFORE INSERT ON public.rutinas_asignadas
  FOR EACH ROW EXECUTE FUNCTION public.fijar_fecha_por_defecto();

-- ----------------------------------------------------------------------------
-- 5. Numero de comprobante: no gastar uno en un reenvio duplicado
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asignar_numero_comprobante()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero IS NULL
     AND COALESCE(NEW.monto, 0) > 0
     AND NOT (NEW.client_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.pagos WHERE client_id = NEW.client_id))
  THEN
    UPDATE public.gimnasios
       SET ultimo_comprobante = ultimo_comprobante + 1
     WHERE id = NEW.gimnasio_id
    RETURNING ultimo_comprobante INTO NEW.numero;
  END IF;
  RETURN NEW;
END;
$function$;
