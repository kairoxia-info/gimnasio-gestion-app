-- ============================================================================
-- 0078_alimentacion_compartida_por_organizacion.sql
--
-- ETAPA A2 (segunda parte, pedido de Nalux del 28/10/2026: "compartilos"): los
-- ALIMENTOS propios y la biblioteca de PLANES DE ALIMENTACION se comparten entre
-- todos los gimnasios del mismo dueno, igual que ya se hizo con rutinas y
-- ejercicios (0077). Las personas NO se comparten: planes_alimentacion (el plan
-- asignado a cada alumno) sigue por gimnasio.
--
-- Mismo diseno que la 0077 (ver ahi el detalle):
--  * organizacion_id en alimentos y planes_alimentacion_biblioteca; la biblioteca
--    CUELGA DEL DUENO, gimnasio_id pasa a "creado en" con FK ON DELETE SET NULL, asi
--    borrar un gimnasio no borra para los demas lo que se creo en el. Al borrar el
--    ULTIMO gimnasio, la organizacion se borra (0076) y se va con toda su biblioteca.
--  * Los alimentos con organizacion_id NULL son la biblioteca base (de todos, sin editar).
--  * Se reutiliza el trigger biblioteca_fijar_dueno de la 0077 (la fila no cambia de dueno).
--  * Nuevo trigger en planes_alimentacion: el plan de biblioteca de origen (origen_id)
--    tiene que ser de la organizacion de ese gimnasio.
--  * biblioteca_ocultos queda por gimnasio (cada gimnasio oculta lo que quiere).
--  * No hay funciones ni vistas que lean estas tablas (comprobado), ni archivos de Storage.
-- ============================================================================

-- 1. Columnas, relleno y claves
ALTER TABLE public.alimentos
  ADD COLUMN organizacion_id UUID REFERENCES public.organizaciones(id) ON DELETE CASCADE;
ALTER TABLE public.planes_alimentacion_biblioteca
  ADD COLUMN organizacion_id UUID REFERENCES public.organizaciones(id) ON DELETE CASCADE;

UPDATE public.alimentos a SET organizacion_id = g.organizacion_id
  FROM public.gimnasios g WHERE g.id = a.gimnasio_id;
UPDATE public.planes_alimentacion_biblioteca p SET organizacion_id = g.organizacion_id
  FROM public.gimnasios g WHERE g.id = p.gimnasio_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.planes_alimentacion_biblioteca WHERE organizacion_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.alimentos WHERE gimnasio_id IS NOT NULL AND organizacion_id IS NULL) THEN
    RAISE EXCEPTION '0078: hay alimentos o planes de un gimnasio sin organizacion; revisar la 0076';
  END IF;
END $$;

ALTER TABLE public.planes_alimentacion_biblioteca ALTER COLUMN organizacion_id SET NOT NULL;
ALTER TABLE public.planes_alimentacion_biblioteca ALTER COLUMN gimnasio_id DROP NOT NULL;

ALTER TABLE public.alimentos
  ADD CONSTRAINT alimentos_ambito_check
  CHECK (organizacion_id IS NOT NULL OR (gimnasio_id IS NULL AND origen = 'global'));

ALTER TABLE public.alimentos ALTER COLUMN organizacion_id SET DEFAULT public.get_mi_organizacion_id();
ALTER TABLE public.planes_alimentacion_biblioteca ALTER COLUMN organizacion_id SET DEFAULT public.get_mi_organizacion_id();

ALTER TABLE public.alimentos DROP CONSTRAINT alimentos_gimnasio_id_fkey;
ALTER TABLE public.alimentos
  ADD CONSTRAINT alimentos_gimnasio_id_fkey FOREIGN KEY (gimnasio_id) REFERENCES public.gimnasios(id) ON DELETE SET NULL;
ALTER TABLE public.planes_alimentacion_biblioteca DROP CONSTRAINT planes_alimentacion_biblioteca_gimnasio_id_fkey;
ALTER TABLE public.planes_alimentacion_biblioteca
  ADD CONSTRAINT planes_alimentacion_biblioteca_gimnasio_id_fkey FOREIGN KEY (gimnasio_id) REFERENCES public.gimnasios(id) ON DELETE SET NULL;

CREATE INDEX alimentos_organizacion_idx ON public.alimentos (organizacion_id);
CREATE INDEX planes_alimentacion_biblioteca_organizacion_idx ON public.planes_alimentacion_biblioteca (organizacion_id);

-- 2. Politicas: de "mi gimnasio" a "mi organizacion"
DROP POLICY alimentos_select ON public.alimentos;
DROP POLICY alimentos_insert ON public.alimentos;
DROP POLICY alimentos_update ON public.alimentos;
DROP POLICY alimentos_delete ON public.alimentos;

CREATE POLICY alimentos_select ON public.alimentos FOR SELECT TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()) OR organizacion_id IS NULL);
CREATE POLICY alimentos_insert ON public.alimentos FOR INSERT TO authenticated
  WITH CHECK (organizacion_id = (SELECT public.get_mi_organizacion_id())
              AND gimnasio_id = (SELECT public.get_mi_gimnasio_id()));
CREATE POLICY alimentos_update ON public.alimentos FOR UPDATE TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()))
  WITH CHECK (organizacion_id = (SELECT public.get_mi_organizacion_id()));
CREATE POLICY alimentos_delete ON public.alimentos FOR DELETE TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()));

DROP POLICY planes_alimentacion_biblioteca_tenant_isolation ON public.planes_alimentacion_biblioteca;
-- El INSERT exige ademas que gimnasio_id ("creado en") sea el gimnasio abierto; el UPDATE no.
CREATE POLICY planes_alimentacion_biblioteca_select ON public.planes_alimentacion_biblioteca FOR SELECT TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()));
CREATE POLICY planes_alimentacion_biblioteca_insert ON public.planes_alimentacion_biblioteca FOR INSERT TO authenticated
  WITH CHECK (organizacion_id = (SELECT public.get_mi_organizacion_id())
              AND gimnasio_id = (SELECT public.get_mi_gimnasio_id()));
CREATE POLICY planes_alimentacion_biblioteca_update ON public.planes_alimentacion_biblioteca FOR UPDATE TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()))
  WITH CHECK (organizacion_id = (SELECT public.get_mi_organizacion_id()));
CREATE POLICY planes_alimentacion_biblioteca_delete ON public.planes_alimentacion_biblioteca FOR DELETE TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()));

-- 3. Una fila no cambia de dueno (funcion de la 0077)
CREATE TRIGGER alimentos_fijar_dueno_trg BEFORE UPDATE ON public.alimentos
  FOR EACH ROW EXECUTE FUNCTION public.biblioteca_fijar_dueno();
CREATE TRIGGER planes_alimentacion_biblioteca_fijar_dueno_trg BEFORE UPDATE ON public.planes_alimentacion_biblioteca
  FOR EACH ROW EXECUTE FUNCTION public.biblioteca_fijar_dueno();

-- 4. El plan de origen de un plan asignado tiene que ser de mi organizacion
CREATE OR REPLACE FUNCTION public.planes_alimentacion_validar_origen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.origen_id IS NOT NULL AND NOT EXISTS (
       SELECT 1
         FROM public.planes_alimentacion_biblioteca b
         JOIN public.gimnasios g ON g.organizacion_id = b.organizacion_id
        WHERE b.id = NEW.origen_id AND g.id = NEW.gimnasio_id) THEN
    RAISE EXCEPTION 'El plan de origen no pertenece a este gimnasio';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER planes_alimentacion_validar_origen_trg
  BEFORE INSERT OR UPDATE OF origen_id, gimnasio_id ON public.planes_alimentacion
  FOR EACH ROW EXECUTE FUNCTION public.planes_alimentacion_validar_origen();
