-- ============================================================================
-- 0001_init_multitenant.sql
-- Kairox-style multi-tenant schema para "Gimnasio Gestión"
--
-- Cubre el Bloque A (pasos A2-A7) del checklist aprobado:
--   A2. Modelo de rutinas ya decidido: plantilla (rutinas) + asignación
--       (rutinas_asignadas), NO planes_entrenamiento 1-a-1 con el alumno.
--   A3. Campos faltantes agregados: alumnos.fecha_nacimiento,
--       ejercicios.origen/clasificacion, pagos.monto_adeudado + 4to estado.
--   A4. gimnasios, profiles, trigger handle_new_user, get_mi_gimnasio_id(),
--       create_gimnasio(), 10 tablas de negocio + índices.
--   A5. RLS habilitado + policy en TODAS las tablas de public (sin excepción).
--   A6. (paso siguiente, fuera de este archivo) probar aislación con 2 gimnasios.
--   A7. Siembra de configuracion_precios de ejemplo en create_gimnasio().
--
-- Pensado para pegarse ENTERO y de una sola vez en el SQL Editor de Supabase.
-- No requiere la Supabase CLI ni ejecución por partes.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 0 — Extensiones
-- ============================================================================
-- Convención moderna en Supabase: gen_random_uuid() de pgcrypto en vez de
-- uuid_generate_v4() de uuid-ossp. Es la que trae habilitada por defecto
-- cualquier proyecto nuevo de Supabase y es la recomendada en su
-- documentación actual. El resultado (UUID v4 aleatorio como default de la
-- PK) es equivalente; solo cambia la función. Se deja el CREATE EXTENSION
-- igual por las dudas de que el proyecto sea viejo y no la tenga.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================================
-- SECCIÓN 1 — Tenant raíz: gimnasios
-- ============================================================================
CREATE TABLE public.gimnasios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,
  logo_url        TEXT,
  color_principal TEXT DEFAULT '#E10600',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.gimnasios IS
  'Tenant raíz. Cada fila es un gimnasio cliente del SaaS. Todas las tablas de negocio cuelgan de acá vía gimnasio_id.';


-- ============================================================================
-- SECCIÓN 2 — Staff: profiles (vinculado 1 a 1 con auth.users)
-- ============================================================================
CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gimnasio_id UUID REFERENCES public.gimnasios(id) ON DELETE SET NULL,
  email       TEXT,
  first_name  TEXT,
  last_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  permissions JSONB DEFAULT '{}'::jsonb,
  active      BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON TABLE public.profiles IS
  'Staff del gimnasio (dueño/entrenadores). gimnasio_id es NULL hasta que el usuario crea o se une a un gimnasio.';

CREATE INDEX idx_profiles_gimnasio_id ON public.profiles (gimnasio_id);


-- ----------------------------------------------------------------------------
-- Trigger: cada alta en auth.users crea su profile vacío automáticamente
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- FIX CRÍTICO (AppSec review, previo a la primera ejecución de esta
  -- migración): el 'role' NUNCA debe salir de raw_user_meta_data. Antes
  -- decía COALESCE(NEW.raw_user_meta_data->>'role', 'staff'), pero ese
  -- campo lo llena el CLIENTE al hacer signUp() -
  --   supabase.auth.signUp({ email, password,
  --     options: { data: { role: 'admin' } } })
  -- - así que cualquiera podía autoasignarse role='admin' DESDE EL
  -- REGISTRO MISMO, sin necesitar explotar ningún otro gap (ni siquiera
  -- el de profiles_update_self, más abajo). first_name/last_name se
  -- dejan igual: son campos inofensivos, el usuario los puede editar de
  -- todas formas después. El único camino legítimo a role='admin' es
  -- create_gimnasio() (SECCIÓN 5), que promueve al creador del gimnasio.
  INSERT INTO public.profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    'staff'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ----------------------------------------------------------------------------
-- Función helper: rompe la recursión de RLS (SECURITY DEFINER bypassea
-- RLS de profiles internamente; por eso NO se puede resolver gimnasio_id
-- con un sub-SELECT directo contra profiles dentro de la policy misma,
-- eso dispara el error 42P17 "infinite recursion detected in policy").
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mi_gimnasio_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gimnasio_id FROM public.profiles WHERE id = auth.uid()
$$;

COMMENT ON FUNCTION public.get_mi_gimnasio_id() IS
  'SECURITY DEFINER a propósito: resuelve el gimnasio_id del usuario logueado sin pasar por RLS de profiles, evitando el loop 42P17. Usada por TODAS las policies de tablas de negocio.';


-- ============================================================================
-- SECCIÓN 3 — Tablas de negocio (10 tablas, con los 2 cambios obligatorios
-- ya aplicados: rutinas/rutinas_asignadas en vez de planes_entrenamiento,
-- y los campos nuevos en alumnos/ejercicios/pagos).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 3.1 alumnos
-- --------------------------------------------------------------------------
CREATE TABLE public.alumnos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id         UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  nombre              TEXT NOT NULL,
  contacto            TEXT,
  email               TEXT,
  fecha_alta          DATE,
  fecha_nacimiento    DATE,  -- NUEVO: aviso de cumpleaños del día en el dashboard
  foto_url            TEXT,
  activo              BOOLEAN DEFAULT true,
  observaciones_salud TEXT,
  plan_precio_nombre  TEXT,
  user_id             UUID REFERENCES auth.users(id),  -- NULL por ahora; se usa en Fase 2 para el login del alumno
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alumnos_gimnasio_id ON public.alumnos (gimnasio_id);

-- --------------------------------------------------------------------------
-- 3.2 ejercicios
-- --------------------------------------------------------------------------
CREATE TABLE public.ejercicios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  grupo_muscular TEXT,
  clasificacion  TEXT,  -- NUEVO: patrón de movimiento (ej. "Empuje horizontal", "Dominante de cadera")
  media_url      TEXT,
  descripcion    TEXT,
  origen         TEXT NOT NULL DEFAULT 'propio' CHECK (origen IN ('propio', 'global')),  -- NUEVO
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ejercicios_gimnasio_id ON public.ejercicios (gimnasio_id);

-- --------------------------------------------------------------------------
-- 3.3 alimentos
-- --------------------------------------------------------------------------
CREATE TABLE public.alimentos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id   UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  categoria     TEXT,
  unidad        TEXT,
  calorias      NUMERIC,
  proteinas     NUMERIC,
  carbohidratos NUMERIC,
  grasas        NUMERIC,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alimentos_gimnasio_id ON public.alimentos (gimnasio_id);

-- --------------------------------------------------------------------------
-- 3.4 rutinas (CAMBIO OBLIGATORIO 1: plantilla reutilizable, sin alumno_id)
-- --------------------------------------------------------------------------
CREATE TABLE public.rutinas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id       UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,
  descripcion       TEXT,
  duracion_semanas  INTEGER NOT NULL DEFAULT 4,  -- editable, NO forzada a 4
  items             JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.rutinas IS
  'Plantilla de rutina reutilizable, sin alumno_id. Se asigna a alumnos vía rutinas_asignadas. items en JSONB por ahora; normalizar a plan_items queda para más adelante.';

CREATE INDEX idx_rutinas_gimnasio_id ON public.rutinas (gimnasio_id);

-- --------------------------------------------------------------------------
-- 3.5 rutinas_asignadas (CAMBIO OBLIGATORIO 1: asignación rutina <-> alumno)
-- --------------------------------------------------------------------------
CREATE TABLE public.rutinas_asignadas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  rutina_id    UUID NOT NULL REFERENCES public.rutinas(id) ON DELETE CASCADE,
  alumno_id    UUID NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  fecha_inicio DATE DEFAULT CURRENT_DATE,
  activa       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Sin UNIQUE(rutina_id, alumno_id) a propósito: un alumno puede tener la
  -- misma rutina asignada más de una vez a lo largo del tiempo.
);

CREATE INDEX idx_rutinas_asignadas_gimnasio_id ON public.rutinas_asignadas (gimnasio_id);
CREATE INDEX idx_rutinas_asignadas_alumno_id ON public.rutinas_asignadas (alumno_id);
CREATE INDEX idx_rutinas_asignadas_rutina_id ON public.rutinas_asignadas (rutina_id);

-- --------------------------------------------------------------------------
-- 3.6 planes_alimentacion
-- --------------------------------------------------------------------------
CREATE TABLE public.planes_alimentacion (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  alumno_id   UUID NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  notas       TEXT,
  items       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_planes_alimentacion_gimnasio_id ON public.planes_alimentacion (gimnasio_id);
CREATE INDEX idx_planes_alimentacion_alumno_id ON public.planes_alimentacion (alumno_id);

-- --------------------------------------------------------------------------
-- 3.7 asistencias
-- --------------------------------------------------------------------------
CREATE TABLE public.asistencias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  alumno_id   UUID NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  presente    BOOLEAN DEFAULT true,
  UNIQUE (alumno_id, fecha)
);

CREATE INDEX idx_asistencias_gimnasio_id ON public.asistencias (gimnasio_id);
CREATE INDEX idx_asistencias_alumno_id ON public.asistencias (alumno_id);

-- --------------------------------------------------------------------------
-- 3.8 progreso
-- --------------------------------------------------------------------------
CREATE TABLE public.progreso (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id   UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  alumno_id     UUID NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  fecha         DATE NOT NULL,
  peso          NUMERIC,
  cintura       NUMERIC,
  pecho         NUMERIC,
  brazo         NUMERIC,
  observaciones TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_progreso_gimnasio_id ON public.progreso (gimnasio_id);
CREATE INDEX idx_progreso_alumno_id ON public.progreso (alumno_id);

-- --------------------------------------------------------------------------
-- 3.9 pagos (CAMBIO OBLIGATORIO 2: monto_adeudado + 4to estado 'con_deuda')
-- --------------------------------------------------------------------------
CREATE TABLE public.pagos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id     UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  alumno_id       UUID NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  monto           NUMERIC NOT NULL,
  monto_adeudado  NUMERIC NOT NULL DEFAULT 0,  -- NUEVO: saldo pendiente cuando el pago es parcial
  fecha_pago      DATE,
  periodo_desde   DATE,
  periodo_hasta   DATE,
  estado          TEXT CHECK (estado IN ('al_dia', 'proximo', 'vencido', 'con_deuda')),  -- ampliado
  descuento       NUMERIC DEFAULT 0,
  interes         NUMERIC DEFAULT 0,
  metodo          TEXT,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NOTA: 'sin_cuota' NO es un valor de este CHECK. Se calcula en la
-- aplicación cuando un alumno no tiene ninguna fila en pagos, no es un
-- estado persistido acá.

CREATE INDEX idx_pagos_gimnasio_id ON public.pagos (gimnasio_id);
CREATE INDEX idx_pagos_alumno_id ON public.pagos (alumno_id);

-- --------------------------------------------------------------------------
-- 3.10 configuracion_precios
-- --------------------------------------------------------------------------
CREATE TABLE public.configuracion_precios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  precio       NUMERIC,
  periodo      TEXT,
  dias_semana  INTEGER,
  descuento    NUMERIC DEFAULT 0,
  interes_mora NUMERIC DEFAULT 0,
  activo       BOOLEAN DEFAULT true,
  UNIQUE (gimnasio_id, nombre)
);

CREATE INDEX idx_configuracion_precios_gimnasio_id ON public.configuracion_precios (gimnasio_id);


-- ============================================================================
-- SECCIÓN 4 — Row Level Security
-- Regla de oro: RLS activo en TODAS las tablas de public, sin excepciones,
-- y el aislamiento es siempre por gimnasio_id (tenant), NUNCA por user_id
-- individual. Este es el bug exacto que ya se corrigió una vez en Kairox
-- Gestión: vigilar que no reaparezca acá.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 4.1 gimnasios
-- --------------------------------------------------------------------------
ALTER TABLE public.gimnasios ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier staff logueado puede ver el gimnasio al que pertenece.
CREATE POLICY "gimnasios_select" ON public.gimnasios
  FOR SELECT
  USING (id = public.get_mi_gimnasio_id());

-- UPDATE: solo admin del propio gimnasio puede editar datos del gimnasio
-- (nombre, logo, color). Un staff raso no debería poder recolorear la app.
CREATE POLICY "gimnasios_update_admin" ON public.gimnasios
  FOR UPDATE
  USING (
    id = public.get_mi_gimnasio_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    id = public.get_mi_gimnasio_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- INSERT: deliberadamente SIN policy de INSERT para el usuario autenticado
-- común. El alta de un gimnasio nuevo pasa exclusivamente por la función
-- create_gimnasio() (SECURITY DEFINER, más abajo), que bypassea RLS. Esto
-- evita que cualquier usuario inserte gimnasios sueltos por su cuenta desde
-- la API REST/PostgREST directamente.

-- DELETE: sin policy = sin DELETE posible vía API para nadie que no sea
-- service_role. Borrar un gimnasio es una operación administrativa, no de
-- producto; si en el futuro se necesita, se agrega explícitamente.

-- --------------------------------------------------------------------------
-- 4.2 profiles
-- --------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: auth.uid() DIRECTO, sin sub-SELECT contra profiles (evita el
-- loop 42P17 que dispararía usar get_mi_gimnasio_id() acá mismo).
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (id = auth.uid());

-- UPDATE: cada usuario puede editar su propia fila. Mismo patrón directo
-- que profiles_select (auth.uid() sin sub-SELECT contra profiles): un
-- sub-SELECT contra la misma tabla dentro del WITH CHECK de una policy
-- DE esa misma tabla es justamente el patrón que dispara 42P17 en el caso
-- general, y aunque acá el único riesgo real es de visibilidad MVCC del
-- valor "viejo" en pleno UPDATE (no de recursión infinita, porque
-- profiles_select no es recursiva), no vale la pena esa complejidad para
-- una policy opcional.
--
-- ADVERTENCIA DE ALCANCE (ver resumen): esta policy, tal cual está, NO
-- impide que un usuario se autoasigne role='admin' o cambie su propio
-- gimnasio_id vía UPDATE directo desde el cliente. RLS es por FILA, no por
-- COLUMNA, así que no puede resolver "podés editar tu fila pero no estos
-- dos campos" por sí sola. La forma correcta de blindar esas dos columnas
-- es un trigger BEFORE UPDATE con OLD/NEW (no un sub-SELECT en RLS), que
-- conviene sumar en una migración aparte junto con Bloque E (autorregistro
-- también va a tocar estas columnas vía SECURITY DEFINER).
--
-- CONFIRMACIÓN (AppSec review, previo a primera ejecución): el gap es
-- explotable YA, sin necesitar nada más, en su variante INTRA-tenant:
--   UPDATE profiles SET role='admin' WHERE id = auth.uid();
-- y listo, un staff pasa a admin de SU PROPIO gimnasio (le da acceso a
-- gimnasios_update_admin y a cualquier gate por role='admin' que la app
-- sume después). La variante CROSS-tenant (UPDATE ... SET gimnasio_id =
-- '<uuid de OTRO gimnasio>') requiere ADEMÁS conocer ese UUID: ninguna
-- policy de este archivo lo expone (gimnasios_select solo deja ver el
-- propio gimnasio), así que no es explotable por sí sola desde este
-- schema - pero tampoco hay que subestimarla: un UUID de gimnasio_id NO
-- es un secreto de autorización, y puede filtrarse por afuera de este
-- archivo (URLs compartidas, comprobantes, exports, logs, network tab
-- del navegador). Se mantiene la decisión de diferir el fix (trigger
-- BEFORE UPDATE con lógica OLD/NEW) a una migración aparte: es la
-- solución correcta y no conviene improvisarla acá. Alternativa más
-- barata a evaluar en esa migración aparte (NO aplicada en este archivo
-- porque hay que confirmar antes su comportamiento contra
-- PostgREST/Supabase): bloquear 'role' y 'gimnasio_id' a nivel de
-- PRIVILEGIO de columna, no solo de RLS por fila -
--   REVOKE UPDATE ON public.profiles FROM authenticated;
--   GRANT UPDATE (first_name, last_name, email)
--     ON public.profiles TO authenticated;
-- Postgres evalúa privilegios de columna ANTES que las policies de RLS,
-- así que un UPDATE que toque 'role' o 'gimnasio_id' fallaría con
-- "permission denied for column" sin siquiera llegar a evaluar RLS.
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Sin policy de INSERT: el alta de profiles la hace únicamente el trigger
-- handle_new_user() (SECURITY DEFINER), no el cliente.
-- Sin policy de DELETE: se maneja vía ON DELETE CASCADE desde auth.users,
-- no por el cliente directamente.

-- --------------------------------------------------------------------------
-- 4.3 - 4.12 Tablas de negocio: mismo patrón repetido en las 10.
-- FOR ALL cubre SELECT/INSERT/UPDATE/DELETE con la misma condición.
-- --------------------------------------------------------------------------
ALTER TABLE public.alumnos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alumnos_tenant_isolation" ON public.alumnos
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.ejercicios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ejercicios_tenant_isolation" ON public.ejercicios
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.alimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alimentos_tenant_isolation" ON public.alimentos
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.rutinas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rutinas_tenant_isolation" ON public.rutinas
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.rutinas_asignadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rutinas_asignadas_tenant_isolation" ON public.rutinas_asignadas
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.planes_alimentacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "planes_alimentacion_tenant_isolation" ON public.planes_alimentacion
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.asistencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asistencias_tenant_isolation" ON public.asistencias
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.progreso ENABLE ROW LEVEL SECURITY;
CREATE POLICY "progreso_tenant_isolation" ON public.progreso
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pagos_tenant_isolation" ON public.pagos
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.configuracion_precios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "configuracion_precios_tenant_isolation" ON public.configuracion_precios
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());


-- ============================================================================
-- SECCIÓN 5 — RPC de alta de gimnasio nuevo (create_gimnasio)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_gimnasio(
  nombre_gimnasio TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nueva_gimnasio_id UUID;
BEGIN
  INSERT INTO public.gimnasios (nombre) VALUES (nombre_gimnasio)
    RETURNING id INTO nueva_gimnasio_id;

  UPDATE public.profiles
    SET gimnasio_id = nueva_gimnasio_id, role = 'admin'
    WHERE id = auth.uid();

  -- Siembra de planes de ejemplo. Sin ON CONFLICT hoy porque el único
  -- UNIQUE de la tabla es (gimnasio_id, nombre) y nueva_gimnasio_id recién
  -- se creó en esta misma transacción, así que no puede haber choque.
  --
  -- ADVERTENCIA (lección de producción de Kairox Gestión, dejarla acá para
  -- el futuro): si más adelante se agrega un ÍNDICE ÚNICO PARCIAL a
  -- configuracion_precios (ej. UNIQUE(gimnasio_id, nombre) WHERE activo)
  -- y en algún momento se decide usar ON CONFLICT en esta siembra para
  -- hacerla idempotente, el predicado del ON CONFLICT tiene que repetir
  -- EXACTAMENTE el mismo WHERE que el índice parcial (mismas columnas Y
  -- mismo predicado), o el alta de gimnasio nuevo se rompe en silencio
  -- (Postgres no matchea el índice y el INSERT falla o duplica). Si eso
  -- pasa, actualizar este INSERT junto con el índice, no por separado.
  INSERT INTO public.configuracion_precios (gimnasio_id, nombre, precio, periodo, activo)
  VALUES
    (nueva_gimnasio_id, 'Mensual', 0, 'mensual', true),
    (nueva_gimnasio_id, 'Trimestral', 0, 'trimestral', true);

  RETURN nueva_gimnasio_id;
END;
$$;

COMMENT ON FUNCTION public.create_gimnasio(TEXT) IS
  'SECURITY DEFINER: crea el gimnasio, promueve al usuario actual a admin de ese gimnasio y siembra configuracion_precios de ejemplo. Es la ÚNICA vía de alta de un gimnasio nuevo (no hay policy de INSERT directa sobre gimnasios).';

-- FIX (AppSec review): Supabase, por defecto, otorga EXECUTE sobre
-- funciones NUEVAS del schema public tanto a 'anon' como a
-- 'authenticated' (ALTER DEFAULT PRIVILEGES a nivel de proyecto). Sin
-- este REVOKE/GRANT explícito, un usuario NO autenticado podría llamar
-- igual a create_gimnasio(): el INSERT INTO gimnasios no depende de
-- auth.uid() (solo el UPDATE de profiles sí depende, y con auth.uid()
-- NULL simplemente no actualiza ninguna fila), así que quedaba abierta
-- una vía de spam/DoS de datos - crear gimnasios vacíos sin límite y sin
-- login. No es fuga de datos entre tenants, pero sí abuso de recursos
-- gratis. Restringido acá para que solo un usuario logueado pueda
-- invocarla.
-- NOTA (revisión final): el REVOKE ... FROM PUBLIC de abajo saca el permiso
-- IMPLÍCITO que Postgres le da a PUBLIC sobre toda función nueva, pero NO
-- alcanza por sí solo: Supabase, además, concede EXECUTE de forma EXPLÍCITA
-- al rol 'anon' (vía ALTER DEFAULT PRIVILEGES del proyecto), y un REVOKE
-- dirigido a PUBLIC no toca un grant explícito a un rol nombrado. Por eso va
-- también el REVOKE ... FROM anon: sin esa línea, la función seguiría siendo
-- invocable sin login pese al revoke de PUBLIC.
REVOKE EXECUTE ON FUNCTION public.create_gimnasio(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_gimnasio(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_gimnasio(TEXT) TO authenticated;


-- ============================================================================
-- Fin de la migración 0001. Próximo paso (A6, fuera de este archivo):
-- crear gimnasio A y B de prueba, cargar datos en cada uno y confirmar
-- que A no ve absolutamente nada de B antes de dar por buena la RLS.
-- ============================================================================
