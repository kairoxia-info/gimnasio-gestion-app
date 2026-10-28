-- ============================================================================
-- 0077_biblioteca_compartida_por_organizacion.sql
--
-- ETAPA A2 del plan "varios gimnasios por profesor" (decisiones de Nalux del
-- 28/10/2026, ver CONTEXT.md): las RUTINAS y los EJERCICIOS propios se comparten
-- entre todos los gimnasios del mismo dueno, pero las PERSONAS asignadas a cada
-- rutina siguen siendo de cada gimnasio y no se ven entre gimnasios.
--
-- COMO FUNCIONA (y por que asi)
--  * rutinas y ejercicios ganan organizacion_id (el dueno, tabla creada en la
--    0076) y sus politicas pasan de "mi gimnasio" a "mi organizacion". La
--    biblioteca base (ejercicios con organizacion_id NULL) sigue siendo de todos.
--  * La biblioteca CUELGA DEL DUENO, no del gimnasio: gimnasio_id queda solo como
--    "creado en" y su FK pasa a ON DELETE SET NULL. Si siguiera en CASCADE, borrar
--    el gimnasio que creo una rutina se la llevaria a los otros gimnasios. Cuando
--    se borra el ULTIMO gimnasio, la 0076 ya borra la organizacion y, por la FK
--    ON DELETE CASCADE de organizacion_id, se va con ella toda su biblioteca.
--  * Las personas NO se comparten: rutinas_asignadas sigue por gimnasio (con copia
--    congelada de la rutina). Asignar la rutina compartida en el gimnasio B crea la
--    asignacion de B; el gimnasio A no la ve (RLS por gimnasio, sin tocar).
--  * Nuevo trigger en rutinas_asignadas: la rutina que se asigna tiene que ser de
--    la organizacion de ese gimnasio (antes la FK aceptaba el id de cualquiera).
--  * organizacion_id se completa solo (DEFAULT) con la del gimnasio abierto, asi
--    el cliente no cambia al crear. Un trigger impide mover una fila de dueno.
--  * Archivos de ejercicios (bucket ejercicios-media): los nuevos van a la carpeta
--    de la ORGANIZACION (<organizacion_id>/<ejercicio_id>.<ext>) y no a la del
--    gimnasio, porque un ejercicio compartido tiene que seguir teniendo su archivo
--    si se borra el gimnasio que lo subio. Las politicas aceptan tambien la carpeta
--    de un gimnasio de la organizacion (archivos viejos y clientes sin actualizar).
--  * El portal del alumno (ver_plan_por_codigo) buscaba la demostracion del
--    ejercicio solo entre los del gimnasio del alumno: ahora tambien los de su
--    organizacion, o el alumno del gimnasio B no veria el video de un ejercicio
--    creado en el A.
--
-- NO cambia: biblioteca_ocultos (cada gimnasio oculta lo que quiere), alimentos y
-- planes de alimentacion (siguen por gimnasio; no se pidio compartirlos todavia).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Organizacion del gimnasio abierto
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mi_organizacion_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT g.organizacion_id FROM public.gimnasios g WHERE g.id = public.get_mi_gimnasio_id()
$function$;

REVOKE ALL ON FUNCTION public.get_mi_organizacion_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mi_organizacion_id() TO authenticated;

-- Carpeta de Storage que me corresponde: la de mi organizacion o la de cualquier
-- gimnasio de mi organizacion (archivos subidos antes de esta migracion).
CREATE OR REPLACE FUNCTION public.carpeta_es_de_mi_organizacion(p_carpeta text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_carpeta IS NOT NULL
     AND public.get_mi_organizacion_id() IS NOT NULL
     AND (
       p_carpeta = public.get_mi_organizacion_id()::text
       OR EXISTS (SELECT 1 FROM public.gimnasios g
                   WHERE g.id::text = p_carpeta AND g.organizacion_id = public.get_mi_organizacion_id())
     )
$function$;

REVOKE ALL ON FUNCTION public.carpeta_es_de_mi_organizacion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carpeta_es_de_mi_organizacion(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Columnas, relleno y claves
-- ----------------------------------------------------------------------------
ALTER TABLE public.ejercicios
  ADD COLUMN organizacion_id UUID REFERENCES public.organizaciones(id) ON DELETE CASCADE;
ALTER TABLE public.rutinas
  ADD COLUMN organizacion_id UUID REFERENCES public.organizaciones(id) ON DELETE CASCADE;

UPDATE public.ejercicios e SET organizacion_id = g.organizacion_id
  FROM public.gimnasios g WHERE g.id = e.gimnasio_id;
UPDATE public.rutinas r SET organizacion_id = g.organizacion_id
  FROM public.gimnasios g WHERE g.id = r.gimnasio_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.rutinas WHERE organizacion_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.ejercicios WHERE gimnasio_id IS NOT NULL AND organizacion_id IS NULL) THEN
    RAISE EXCEPTION '0077: hay rutinas o ejercicios de un gimnasio sin organizacion; revisar la 0076';
  END IF;
END $$;

ALTER TABLE public.rutinas ALTER COLUMN organizacion_id SET NOT NULL;
ALTER TABLE public.rutinas ALTER COLUMN gimnasio_id DROP NOT NULL;

-- Un ejercicio es de una organizacion o es de la biblioteca base (sin dueno).
ALTER TABLE public.ejercicios
  ADD CONSTRAINT ejercicios_ambito_check
  CHECK (organizacion_id IS NOT NULL OR (gimnasio_id IS NULL AND origen = 'global'));

ALTER TABLE public.ejercicios ALTER COLUMN organizacion_id SET DEFAULT public.get_mi_organizacion_id();
ALTER TABLE public.rutinas   ALTER COLUMN organizacion_id SET DEFAULT public.get_mi_organizacion_id();

-- gimnasio_id pasa a ser "creado en": borrar ese gimnasio ya no borra la biblioteca.
ALTER TABLE public.ejercicios DROP CONSTRAINT ejercicios_gimnasio_id_fkey;
ALTER TABLE public.ejercicios
  ADD CONSTRAINT ejercicios_gimnasio_id_fkey FOREIGN KEY (gimnasio_id) REFERENCES public.gimnasios(id) ON DELETE SET NULL;
ALTER TABLE public.rutinas DROP CONSTRAINT rutinas_gimnasio_id_fkey;
ALTER TABLE public.rutinas
  ADD CONSTRAINT rutinas_gimnasio_id_fkey FOREIGN KEY (gimnasio_id) REFERENCES public.gimnasios(id) ON DELETE SET NULL;

CREATE INDEX ejercicios_organizacion_idx ON public.ejercicios (organizacion_id);
CREATE INDEX rutinas_organizacion_idx ON public.rutinas (organizacion_id);

-- ----------------------------------------------------------------------------
-- 3. Politicas: de "mi gimnasio" a "mi organizacion"
-- ----------------------------------------------------------------------------
DROP POLICY ejercicios_select ON public.ejercicios;
DROP POLICY ejercicios_insert ON public.ejercicios;
DROP POLICY ejercicios_update ON public.ejercicios;
DROP POLICY ejercicios_delete ON public.ejercicios;

CREATE POLICY ejercicios_select ON public.ejercicios FOR SELECT TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()) OR organizacion_id IS NULL);
CREATE POLICY ejercicios_insert ON public.ejercicios FOR INSERT TO authenticated
  WITH CHECK (organizacion_id = (SELECT public.get_mi_organizacion_id())
              AND gimnasio_id = (SELECT public.get_mi_gimnasio_id()));
CREATE POLICY ejercicios_update ON public.ejercicios FOR UPDATE TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()))
  WITH CHECK (organizacion_id = (SELECT public.get_mi_organizacion_id()));
CREATE POLICY ejercicios_delete ON public.ejercicios FOR DELETE TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()));

DROP POLICY rutinas_tenant_isolation ON public.rutinas;
-- El INSERT exige ademas que gimnasio_id ("creado en") sea el gimnasio abierto; el UPDATE no,
-- porque editar en el gimnasio B una rutina creada en el A deja gimnasio_id = A.
CREATE POLICY rutinas_select ON public.rutinas FOR SELECT TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()));
CREATE POLICY rutinas_insert ON public.rutinas FOR INSERT TO authenticated
  WITH CHECK (organizacion_id = (SELECT public.get_mi_organizacion_id())
              AND gimnasio_id = (SELECT public.get_mi_gimnasio_id()));
CREATE POLICY rutinas_update ON public.rutinas FOR UPDATE TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()))
  WITH CHECK (organizacion_id = (SELECT public.get_mi_organizacion_id()));
CREATE POLICY rutinas_delete ON public.rutinas FOR DELETE TO authenticated
  USING (organizacion_id = (SELECT public.get_mi_organizacion_id()));

-- ----------------------------------------------------------------------------
-- 4. Una fila no cambia de dueno
-- ----------------------------------------------------------------------------
-- organizacion_id nunca cambia. gimnasio_id solo puede pasar a NULL (lo hace la
-- propia FK cuando se borra el gimnasio donde se creo); nunca a otro gimnasio.
CREATE OR REPLACE FUNCTION public.biblioteca_fijar_dueno()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.organizacion_id := OLD.organizacion_id;
  IF NEW.gimnasio_id IS NOT NULL THEN
    NEW.gimnasio_id := OLD.gimnasio_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER ejercicios_fijar_dueno_trg BEFORE UPDATE ON public.ejercicios
  FOR EACH ROW EXECUTE FUNCTION public.biblioteca_fijar_dueno();
CREATE TRIGGER rutinas_fijar_dueno_trg BEFORE UPDATE ON public.rutinas
  FOR EACH ROW EXECUTE FUNCTION public.biblioteca_fijar_dueno();

-- ----------------------------------------------------------------------------
-- 5. Asignar solo rutinas de mi organizacion
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rutinas_asignadas_validar_rutina()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.rutina_id IS NOT NULL AND NOT EXISTS (
       SELECT 1
         FROM public.rutinas r
         JOIN public.gimnasios g ON g.organizacion_id = r.organizacion_id
        WHERE r.id = NEW.rutina_id AND g.id = NEW.gimnasio_id) THEN
    RAISE EXCEPTION 'La rutina no pertenece a este gimnasio';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER rutinas_asignadas_validar_rutina_trg
  BEFORE INSERT OR UPDATE OF rutina_id, gimnasio_id ON public.rutinas_asignadas
  FOR EACH ROW EXECUTE FUNCTION public.rutinas_asignadas_validar_rutina();

-- ----------------------------------------------------------------------------
-- 6. Storage: archivos de ejercicios por organizacion
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS ejercicios_media_insert_staff ON storage.objects;
DROP POLICY IF EXISTS ejercicios_media_update_staff ON storage.objects;
DROP POLICY IF EXISTS ejercicios_media_delete_staff ON storage.objects;

-- Subir: a la carpeta de la organizacion (lo nuevo) o a la del gimnasio abierto
-- (clientes sin actualizar), con nombre <ejercicio_id>.<ext> de un ejercicio de mi organizacion.
CREATE POLICY ejercicios_media_insert_staff ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ejercicios-media'
    AND ((storage.foldername(name))[1] = (public.get_mi_organizacion_id())::text
         OR (storage.foldername(name))[1] = (public.get_mi_gimnasio_id())::text)
    AND name ~ ('^' || (storage.foldername(name))[1]
                || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm|mov|png|jpe?g|webp)$')
    AND EXISTS (SELECT 1 FROM public.ejercicios e
                 WHERE e.organizacion_id = public.get_mi_organizacion_id()
                   AND e.id::text = split_part(split_part(objects.name, '/', 2), '.', 1))
  );

-- Reemplazar (upsert): el archivo puede estar en la carpeta de la organizacion o en la de
-- cualquiera de sus gimnasios; el resultado tiene que quedar en una carpeta permitida.
CREATE POLICY ejercicios_media_update_staff ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ejercicios-media'
    AND public.carpeta_es_de_mi_organizacion((storage.foldername(name))[1])
    AND name ~ ('^' || (storage.foldername(name))[1]
                || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm|mov|png|jpe?g|webp)$')
    AND EXISTS (SELECT 1 FROM public.ejercicios e
                 WHERE e.organizacion_id = public.get_mi_organizacion_id()
                   AND e.id::text = split_part(split_part(objects.name, '/', 2), '.', 1))
  )
  WITH CHECK (
    bucket_id = 'ejercicios-media'
    AND ((storage.foldername(name))[1] = (public.get_mi_organizacion_id())::text
         OR (storage.foldername(name))[1] = (public.get_mi_gimnasio_id())::text)
    AND name ~ ('^' || (storage.foldername(name))[1]
                || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm|mov|png|jpe?g|webp)$')
    AND EXISTS (SELECT 1 FROM public.ejercicios e
                 WHERE e.organizacion_id = public.get_mi_organizacion_id()
                   AND e.id::text = split_part(split_part(objects.name, '/', 2), '.', 1))
  );

CREATE POLICY ejercicios_media_delete_staff ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ejercicios-media'
    AND public.carpeta_es_de_mi_organizacion((storage.foldername(name))[1])
  );

-- ----------------------------------------------------------------------------
-- 7. Portal del alumno: demostracion de ejercicios compartidos
-- ----------------------------------------------------------------------------
-- Se cambia SOLO el fragmento del filtro; el resto de la funcion queda como esta.
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.ver_plan_por_codigo(text)'::regprocedure);
  v_viejo CONSTANT TEXT := '(e.gimnasio_id = v_gimnasio_id OR e.gimnasio_id IS NULL)';
  v_nuevo CONSTANT TEXT := '(e.organizacion_id IS NULL OR e.organizacion_id = (SELECT g2.organizacion_id FROM public.gimnasios g2 WHERE g2.id = v_gimnasio_id))';
BEGIN
  IF position(v_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION '0077: no se encontro el filtro de ejercicios en ver_plan_por_codigo; no se modifica nada';
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END $$;

-- ----------------------------------------------------------------------------
-- 8. mi_contexto: organizacion abierta y si el gimnasio comparte biblioteca
-- ----------------------------------------------------------------------------
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
                 -- "unico_admin": nadie mas puede administrarlo; si lo borra desaparece para todos
                 'unico_admin', (m.rol = 'admin' AND NOT EXISTS (
                     SELECT 1 FROM public.membresias o
                      WHERE o.gimnasio_id = m.gimnasio_id AND o.rol = 'admin' AND o.activo
                        AND o.user_id <> m.user_id)),
                 -- "otros_en_organizacion": hay mas gimnasios del mismo dueno; si es asi,
                 -- la biblioteca (rutinas, ejercicios y sus archivos) NO se borra con este
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
