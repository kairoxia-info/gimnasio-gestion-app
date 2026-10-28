-- ============================================================================
-- 0076_multi_gimnasio_membresias.sql
--
-- ETAPA A1 del plan "varios gimnasios por profesor" (decisiones de Nalux del
-- 28/10/2026, ver CONTEXT.md): un mismo login puede ser dueno de VARIOS
-- gimnasios (cada uno con sus propios alumnos) y elegir en cual esta trabajando.
-- La biblioteca compartida (rutinas y ejercicios) es la etapa A2, los empleados
-- con cuenta propia la etapa B.
--
-- COMO FUNCIONA (y por que asi)
--  * Hoy toda la seguridad pregunta a UNA funcion: get_mi_gimnasio_id(), que
--    devolvia profiles.gimnasio_id (un gimnasio por usuario). Se cambia lo que
--    devuelve esa funcion y las ~30 politicas de RLS y las de Storage siguen
--    funcionando sin tocarlas.
--  * membresias(usuario, gimnasio, rol admin|staff, activo): quien puede entrar
--    a que gimnasio. Es la fuente de verdad; profiles.gimnasio_id/role quedan
--    como "ultimo gimnasio usado" / rol de ese gimnasio.
--  * El gimnasio ABIERTO se guarda POR SESION (sesion_gimnasio) usando el claim
--    session_id que ya trae el token. Se descarto el "Custom Access Token Hook"
--    de Supabase: hay que activarlo a mano en el Dashboard (no se puede por
--    migracion) y un valor por usuario haria que el refresco de token de OTRO
--    dispositivo cambiara el gimnasio solo. Cada navegador tiene el suyo.
--  * get_mi_gimnasio_id() verifica la membresia VIVA en cada llamada: sacar a
--    alguien de un gimnasio corta su acceso al instante, no cuando vence el token.
--  * Sin fila de sesion (token anterior a esta migracion) se usa el gimnasio de
--    profiles, y si no el unico que tenga: NADIE queda desconectado al aplicarla.
--  * organizaciones: el "dueno" por encima de los gimnasios (invisible para el
--    usuario). Hoy solo agrupa los gimnasios de una misma persona; en la etapa A2
--    la biblioteca compartida cuelga de ahi (si colgara del gimnasio, borrar el
--    que la creo se llevaria rutinas que usan los demas).
--
-- NO cambia: alumnos, pagos, rutinas, etc. (siguen por gimnasio), ni nada del
-- portal del alumno. Nada se pierde: cada gimnasio existente recibe su organizacion
-- y cada perfil con gimnasio su membresia, con el mismo rol que ya tenia.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Organizaciones (el "dueno") y su vinculo con los gimnasios
-- ----------------------------------------------------------------------------
CREATE TABLE public.organizaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  creada_por  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organizaciones IS
  'Dueno por encima de los gimnasios (0076). Invisible para el usuario: solo la tocan funciones SECURITY DEFINER. Agrupa los gimnasios de una misma persona; la biblioteca compartida (A2) cuelga de aca.';

ALTER TABLE public.organizaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizaciones FROM PUBLIC, anon, authenticated;

ALTER TABLE public.gimnasios
  ADD COLUMN organizacion_id UUID REFERENCES public.organizaciones(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 2. Membresias: quien entra a que gimnasio
-- ----------------------------------------------------------------------------
CREATE TABLE public.membresias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gimnasio_id  UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  rol          TEXT NOT NULL CHECK (rol IN ('admin', 'staff')),
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, gimnasio_id)
);

CREATE INDEX idx_membresias_gimnasio_id ON public.membresias (gimnasio_id);

ALTER TABLE public.membresias ENABLE ROW LEVEL SECURITY;

-- Cada uno ve solo sus propias membresias. Nadie escribe directo: todo pasa por
-- las funciones de abajo (que validan el rol).
CREATE POLICY "membresias_select_propias" ON public.membresias
  FOR SELECT USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.membresias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.membresias TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Gimnasio abierto en cada sesion
-- ----------------------------------------------------------------------------
CREATE TABLE public.sesion_gimnasio (
  session_id      UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gimnasio_id     UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sesion_gimnasio IS
  'Gimnasio abierto en cada sesion de login (0076), por session_id del token. Solo la tocan funciones SECURITY DEFINER.';

ALTER TABLE public.sesion_gimnasio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sesion_gimnasio FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Datos que ya existen: una organizacion por gimnasio y una membresia por perfil
-- ----------------------------------------------------------------------------
DO $migrar$
DECLARE
  g record;
  o uuid;
BEGIN
  FOR g IN SELECT id, nombre FROM public.gimnasios WHERE organizacion_id IS NULL LOOP
    INSERT INTO public.organizaciones (nombre, creada_por)
    VALUES (g.nombre,
            (SELECT p.id FROM public.profiles p WHERE p.gimnasio_id = g.id AND p.role = 'admin' ORDER BY p.id LIMIT 1))
    RETURNING id INTO o;
    UPDATE public.gimnasios SET organizacion_id = o WHERE id = g.id;
  END LOOP;
END
$migrar$;

INSERT INTO public.membresias (user_id, gimnasio_id, rol, activo)
SELECT p.id, p.gimnasio_id, CASE WHEN p.role = 'admin' THEN 'admin' ELSE 'staff' END, p.active
  FROM public.profiles p
 WHERE p.gimnasio_id IS NOT NULL
ON CONFLICT (user_id, gimnasio_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. get_mi_gimnasio_id() y get_mi_rol()
-- ----------------------------------------------------------------------------
-- Orden: (1) el gimnasio elegido en ESTA sesion, (2) el ultimo usado (profiles),
-- (3) el unico gimnasio que tenga. En los tres casos exige membresia activa.
CREATE OR REPLACE FUNCTION public.get_mi_gimnasio_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT s.gimnasio_id
       FROM public.sesion_gimnasio s
       JOIN public.membresias m
         ON m.user_id = s.user_id AND m.gimnasio_id = s.gimnasio_id AND m.activo
      WHERE s.user_id = auth.uid()
        AND s.session_id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid),
    (SELECT p.gimnasio_id
       FROM public.profiles p
       JOIN public.membresias m
         ON m.user_id = p.id AND m.gimnasio_id = p.gimnasio_id AND m.activo
      WHERE p.id = auth.uid()),
    (SELECT m.gimnasio_id
       FROM public.membresias m
      WHERE m.user_id = auth.uid() AND m.activo
        AND (SELECT count(*) FROM public.membresias m2
              WHERE m2.user_id = m.user_id AND m2.activo) = 1
      LIMIT 1)
  )
$function$;

CREATE OR REPLACE FUNCTION public.get_mi_rol()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.rol
    FROM public.membresias m
   WHERE m.user_id = auth.uid()
     AND m.gimnasio_id = public.get_mi_gimnasio_id()
     AND m.activo
$function$;

REVOKE ALL ON FUNCTION public.get_mi_rol() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mi_rol() TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Todo lo que miraba el rol en profiles pasa a mirar la membresia del gimnasio abierto
-- ----------------------------------------------------------------------------
-- 6a. Politicas (gimnasios y el logo en Storage). Se reescribe SOLO el fragmento
--     EXISTS(... profiles ... role = 'admin'): el resto de cada politica (carpeta,
--     nombre del archivo, etc.) queda exactamente como esta.
DO $politicas$
DECLARE
  r record;
  v_q text;
  v_c text;
  v_patron text := '\(EXISTS \( SELECT 1\s+FROM profiles\s+WHERE \(\(profiles\.id = auth\.uid\(\)\) AND \(profiles\.role = ''admin''::text\)\)\)\)';
  v_nuevo text := '(public.get_mi_rol() = ''admin''::text)';
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE policyname IN ('gimnasios_update_admin', 'gimnasio_logos_insert_admin',
                          'gimnasio_logos_update_admin', 'gimnasio_logos_delete_admin')
  LOOP
    v_q := CASE WHEN r.qual IS NULL THEN NULL ELSE regexp_replace(r.qual, v_patron, v_nuevo) END;
    v_c := CASE WHEN r.with_check IS NULL THEN NULL ELSE regexp_replace(r.with_check, v_patron, v_nuevo) END;
    IF (r.qual IS NOT NULL AND v_q = r.qual) OR (r.with_check IS NOT NULL AND v_c = r.with_check) THEN
      RAISE EXCEPTION 'No se pudo reescribir la politica % (el texto no coincide con lo esperado)', r.policyname;
    END IF;
    EXECUTE format('ALTER POLICY %I ON %I.%I %s %s',
                   r.policyname, r.schemaname, r.tablename,
                   CASE WHEN v_q IS NOT NULL THEN 'USING (' || v_q || ')' ELSE '' END,
                   CASE WHEN v_c IS NOT NULL THEN 'WITH CHECK (' || v_c || ')' ELSE '' END);
  END LOOP;
END
$politicas$;

-- 6b. regenerar_codigo_invitacion: solo el admin DEL GIMNASIO ABIERTO
CREATE OR REPLACE FUNCTION public.regenerar_codigo_invitacion()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  nuevo_codigo TEXT;
  intentos INTEGER := 0;
BEGIN
  IF public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un admin puede regenerar el código de invitación';
  END IF;

  LOOP
    intentos := intentos + 1;
    nuevo_codigo := encode(extensions.gen_random_bytes(16), 'hex');

    BEGIN
      UPDATE public.gimnasios
        SET codigo_invitacion = nuevo_codigo
        WHERE id = public.get_mi_gimnasio_id();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontro un gimnasio asociado a este usuario';
      END IF;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF intentos >= 10 THEN
        RAISE EXCEPTION 'No se pudo generar un código de invitación único, reintentar';
      END IF;
    END;
  END LOOP;

  RETURN nuevo_codigo;
END;
$function$;

-- 6c. registrar_error_cliente: el gimnasio es el abierto en la sesion, no el de profiles
CREATE OR REPLACE FUNCTION public.registrar_error_cliente(
    p_mensaje    TEXT,
    p_detalle    TEXT DEFAULT NULL,
    p_ruta       TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     UUID := auth.uid();
  v_gimnasio_id UUID;
  v_recientes   INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  IF p_mensaje IS NULL OR btrim(p_mensaje) = '' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_recientes
  FROM public.errores_cliente
  WHERE user_id = v_user_id AND created_at > now() - INTERVAL '5 minutes';

  IF v_recientes >= 20 THEN
    RETURN;
  END IF;

  v_gimnasio_id := public.get_mi_gimnasio_id();

  INSERT INTO public.errores_cliente (gimnasio_id, user_id, mensaje, detalle, ruta, user_agent)
  VALUES (
    v_gimnasio_id,
    v_user_id,
    left(btrim(p_mensaje), 500),
    left(p_detalle, 4000),
    left(p_ruta, 300),
    left(p_user_agent, 300)
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 7. Lo que ve el cliente: gimnasio abierto, rol y lista de gimnasios
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mi_contexto()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'gimnasio_id', public.get_mi_gimnasio_id(),
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
                        AND o.user_id <> m.user_id))
               ) ORDER BY g.nombre)
        FROM public.membresias m
        JOIN public.gimnasios g ON g.id = m.gimnasio_id
       WHERE m.user_id = auth.uid() AND m.activo
    ), '[]'::jsonb)
  )
$function$;

REVOKE ALL ON FUNCTION public.mi_contexto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_contexto() TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Cambiar de gimnasio (solo uno al que se pertenece)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cambiar_gimnasio(p_gimnasio_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_sid UUID := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  v_rol TEXT;
BEGIN
  IF v_uid IS NULL OR v_sid IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  SELECT rol INTO v_rol
    FROM public.membresias
   WHERE user_id = v_uid AND gimnasio_id = p_gimnasio_id AND activo;

  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'No hay acceso a ese gimnasio';
  END IF;

  INSERT INTO public.sesion_gimnasio (session_id, user_id, gimnasio_id)
  VALUES (v_sid, v_uid, p_gimnasio_id)
  ON CONFLICT (session_id) DO UPDATE
    SET gimnasio_id = EXCLUDED.gimnasio_id, actualizado_en = now();

  -- "Ultimo usado": es el que se abre solo en una sesion nueva. El trigger que
  -- congela role/gimnasio_id en profiles solo frena al cliente directo, no a esta
  -- funcion (corre como su duenio).
  UPDATE public.profiles SET gimnasio_id = p_gimnasio_id, role = v_rol WHERE id = v_uid;

  IF random() < 0.02 THEN
    DELETE FROM public.sesion_gimnasio WHERE actualizado_en < now() - INTERVAL '90 days';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.cambiar_gimnasio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cambiar_gimnasio(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Crear gimnasio: ahora se pueden tener varios
-- ----------------------------------------------------------------------------
-- La organizacion es la que ESTA persona creo (creada_por), no la de cualquier
-- gimnasio donde sea admin: asi un co-administrador invitado mas adelante nunca
-- mete su gimnasio nuevo en la organizacion de otro. Tope de 10 por cuenta
-- (cierra la parte "crear gimnasios sin limite" del hallazgo B1 de la auditoria;
-- el control por suscripcion llega con el modulo de cobro).
CREATE OR REPLACE FUNCTION public.create_gimnasio(nombre_gimnasio text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_sid UUID := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  v_org UUID;
  v_cantidad INTEGER;
  nueva_gimnasio_id UUID;
  nuevo_codigo TEXT;
  intentos INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  nombre_gimnasio := left(btrim(COALESCE(nombre_gimnasio, '')), 200);
  IF nombre_gimnasio = '' THEN
    RAISE EXCEPTION 'El nombre del gimnasio es obligatorio';
  END IF;

  SELECT count(*) INTO v_cantidad
    FROM public.membresias WHERE user_id = v_uid AND rol = 'admin' AND activo;
  IF v_cantidad >= 10 THEN
    RAISE EXCEPTION 'Se alcanzó el máximo de gimnasios por cuenta';
  END IF;

  SELECT o.id INTO v_org
    FROM public.organizaciones o
   WHERE o.creada_por = v_uid
   ORDER BY o.created_at
   LIMIT 1;

  IF v_org IS NULL THEN
    INSERT INTO public.organizaciones (nombre, creada_por)
    VALUES (nombre_gimnasio, v_uid)
    RETURNING id INTO v_org;
  END IF;

  LOOP
    intentos := intentos + 1;
    nuevo_codigo := encode(extensions.gen_random_bytes(16), 'hex');

    BEGIN
      INSERT INTO public.gimnasios (nombre, codigo_invitacion, organizacion_id)
        VALUES (nombre_gimnasio, nuevo_codigo, v_org)
        RETURNING id INTO nueva_gimnasio_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF intentos >= 10 THEN
        RAISE EXCEPTION 'No se pudo generar un código de invitación único, reintentar';
      END IF;
    END;
  END LOOP;

  INSERT INTO public.membresias (user_id, gimnasio_id, rol)
  VALUES (v_uid, nueva_gimnasio_id, 'admin');

  -- Queda abierto el gimnasio nuevo en esta sesion y como "ultimo usado".
  UPDATE public.profiles SET gimnasio_id = nueva_gimnasio_id, role = 'admin' WHERE id = v_uid;

  IF v_sid IS NOT NULL THEN
    INSERT INTO public.sesion_gimnasio (session_id, user_id, gimnasio_id)
    VALUES (v_sid, v_uid, nueva_gimnasio_id)
    ON CONFLICT (session_id) DO UPDATE
      SET gimnasio_id = EXCLUDED.gimnasio_id, actualizado_en = now();
  END IF;

  INSERT INTO public.configuracion_periodos (gimnasio_id, nombre, dias)
  VALUES
    (nueva_gimnasio_id, 'Clase suelta', 1),
    (nueva_gimnasio_id, 'Diario', 1),
    (nueva_gimnasio_id, 'Semanal', 7),
    (nueva_gimnasio_id, 'Mensual', 30),
    (nueva_gimnasio_id, 'Trimestral', 90),
    (nueva_gimnasio_id, 'Anual', 365);

  INSERT INTO public.configuracion_precios (gimnasio_id, nombre, precio, periodo, activo)
  VALUES
    (nueva_gimnasio_id, 'Mensual', 0, 'Mensual', true),
    (nueva_gimnasio_id, 'Trimestral', 0, 'Trimestral', true);

  RETURN nueva_gimnasio_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 10. Eliminar UN gimnasio (el abierto) y eliminar la cuenta
-- ----------------------------------------------------------------------------
-- Siempre el gimnasio ABIERTO: el cliente borra sus archivos de Storage antes
-- (las politicas de Storage solo dejan tocar la carpeta del gimnasio abierto) y
-- recien despues llama a esta funcion, para que no queden archivos huerfanos.
-- Borrar el gimnasio arrastra por cascada alumnos, pagos, rutinas asignadas,
-- membresias y sesiones; profiles.gimnasio_id pasa a NULL por su FK (ON DELETE SET
-- NULL) y get_mi_gimnasio_id() cae solo al otro gimnasio que tenga la persona.
CREATE OR REPLACE FUNCTION public.eliminar_gimnasio_activo()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gim UUID := public.get_mi_gimnasio_id();
  v_org UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;
  IF v_gim IS NULL OR public.get_mi_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un admin puede eliminar el gimnasio';
  END IF;

  SELECT organizacion_id INTO v_org FROM public.gimnasios WHERE id = v_gim;

  DELETE FROM public.gimnasios WHERE id = v_gim;

  -- Una organizacion sin gimnasios no sirve para nada.
  IF v_org IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.gimnasios WHERE organizacion_id = v_org) THEN
    DELETE FROM public.organizaciones WHERE id = v_org;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.eliminar_gimnasio_activo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_gimnasio_activo() TO authenticated;

-- eliminar_mi_cuenta: borra los gimnasios donde la persona es la UNICA admin y
-- quita sus membresias en los demas. Si es unica admin de MAS DE UNO exige borrarlos
-- de a uno antes (cada uno con su limpieza de Storage): el cliente solo puede
-- borrar los archivos del gimnasio abierto, y el resto quedaria huerfano.
CREATE OR REPLACE FUNCTION public.eliminar_mi_cuenta()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mi_user_id UUID := auth.uid();
  v_propios  UUID[];
  v_orgs     UUID[];
BEGIN
  IF mi_user_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  SELECT COALESCE(array_agg(m.gimnasio_id), '{}') INTO v_propios
    FROM public.membresias m
   WHERE m.user_id = mi_user_id AND m.rol = 'admin' AND m.activo
     AND NOT EXISTS (SELECT 1 FROM public.membresias o
                      WHERE o.gimnasio_id = m.gimnasio_id AND o.rol = 'admin' AND o.activo
                        AND o.user_id <> m.user_id);

  IF cardinality(v_propios) > 1 THEN
    RAISE EXCEPTION 'La cuenta administra más de un gimnasio: eliminar primero los otros gimnasios, de a uno';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT g.organizacion_id), '{}') INTO v_orgs
    FROM public.gimnasios g WHERE g.id = ANY (v_propios) AND g.organizacion_id IS NOT NULL;

  DELETE FROM public.gimnasios WHERE id = ANY (v_propios);

  DELETE FROM public.organizaciones o
   WHERE o.id = ANY (v_orgs)
     AND NOT EXISTS (SELECT 1 FROM public.gimnasios g WHERE g.organizacion_id = o.id);

  DELETE FROM public.profiles WHERE id = mi_user_id;
  DELETE FROM auth.users WHERE id = mi_user_id;
END;
$function$;
