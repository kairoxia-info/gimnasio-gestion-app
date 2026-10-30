-- Módulo de suscripción (pedido de Nalux, 30/10/2026).
--
-- Una suscripción por ORGANIZACIÓN (cubre todos sus gimnasios). Planes:
--   Básico   1 gimnasio,  hasta 50 alumnos,  sin Alimentos ni Planes de alimentación
--   Estándar 2 gimnasios, hasta 200 alumnos, todo
--   Pro      5 gimnasios, alumnos ilimitados, todo
-- Prueba gratis de 7 días al crear la organización. Al vencer: 7 días en SOLO LECTURA y luego BLOQUEO.
--
-- Todo se controla acá, en la base, para que no se pueda saltear desde el navegador:
--   * Estado de acceso ('completo' | 'solo_lectura' | 'bloqueado') calculado desde `vence_en`.
--   * Políticas RLS RESTRICTIVAS en las tablas de cada gimnasio: bloqueado => ni lee; solo lectura => no escribe.
--   * Topes de alumnos activos y de gimnasios con triggers (cubren el alta manual, el autoregistro y reactivar).
--   * Las funciones SECURITY DEFINER que saltean RLS (portal del alumno y acciones del administrador) llaman
--     a suscripcion_exigir_* al empezar (se inyecta con el bloque DO del final).
--   * Los pagos de Mercado Pago los registra SOLO `suscripcion_aplicar_evento`, que ejecuta únicamente la
--     función Edge `mp-webhook` (service_role) después de validar la firma de Mercado Pago.
-- Las organizaciones que ya existen quedan en 'cortesia' (plan Pro, 1 año) para no cortarle el servicio a nadie.

-- ---------------------------------------------------------------------------------------------------
-- Planes
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.planes_suscripcion (
  clave                text PRIMARY KEY,
  nombre               text NOT NULL,
  orden                integer NOT NULL,
  max_gimnasios        integer NOT NULL CHECK (max_gimnasios > 0),
  max_alumnos          integer CHECK (max_alumnos IS NULL OR max_alumnos > 0),   -- NULL = ilimitados
  incluye_alimentacion boolean NOT NULL,
  precio_mensual       integer NOT NULL CHECK (precio_mensual > 0)               -- pesos argentinos
);

INSERT INTO public.planes_suscripcion (clave, nombre, orden, max_gimnasios, max_alumnos, incluye_alimentacion, precio_mensual)
VALUES ('basico',   'Básico',   1, 1,  50, false,  40000),
       ('estandar', 'Estándar', 2, 2, 200, true,   80000),
       ('pro',      'Pro',      3, 5, NULL, true,  150000);

ALTER TABLE public.planes_suscripcion ENABLE ROW LEVEL SECURITY;
CREATE POLICY planes_suscripcion_leer ON public.planes_suscripcion FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.planes_suscripcion FROM anon, authenticated;
GRANT SELECT ON public.planes_suscripcion TO authenticated;

-- Períodos de pago: meses y descuento. Mismo criterio que la página de presentación.
CREATE FUNCTION public.suscripcion_periodo(p_periodo text)
 RETURNS TABLE(meses integer, descuento numeric)
 LANGUAGE sql IMMUTABLE
AS $$
  SELECT v.meses, v.descuento
    FROM (VALUES ('mensual', 1, 0::numeric), ('trimestral', 3, 0.10), ('semestral', 6, 0.20)) AS v(clave, meses, descuento)
   WHERE v.clave = p_periodo
$$;

-- Monto que se cobra en cada ciclo (todos los meses del período juntos). El precio mensual equivalente
-- se redondea a los $500, igual que la página de presentación.
CREATE FUNCTION public.suscripcion_monto(p_plan text, p_periodo text)
 RETURNS integer
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $$
  SELECT (round(p.precio_mensual * (1 - per.descuento) / 500.0) * 500 * per.meses)::integer
    FROM public.planes_suscripcion p, public.suscripcion_periodo(p_periodo) per
   WHERE p.clave = p_plan
$$;

-- ---------------------------------------------------------------------------------------------------
-- Suscripciones y registro de eventos de Mercado Pago
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.suscripciones (
  organizacion_id uuid PRIMARY KEY REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  plan            text NOT NULL REFERENCES public.planes_suscripcion(clave),
  periodo         text NOT NULL DEFAULT 'mensual' CHECK (periodo IN ('mensual', 'trimestral', 'semestral')),
  estado          text NOT NULL CHECK (estado IN ('prueba', 'activa', 'pendiente', 'cancelada', 'cortesia')),
  vence_en        timestamptz NOT NULL,
  mp_preapproval_id text UNIQUE,
  mp_payer_email  text,
  ultimo_pago_en  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suscripciones ENABLE ROW LEVEL SECURITY;
-- Solo el administrador de la organización la ve (el staff no ve la suscripción). Nadie la escribe desde el
-- navegador: solo las funciones de abajo.
CREATE POLICY suscripciones_leer_admin ON public.suscripciones FOR SELECT TO authenticated
  USING (organizacion_id = public.get_mi_organizacion_id() AND public.get_mi_rol() = 'admin');
REVOKE ALL ON public.suscripciones FROM anon, authenticated;
GRANT SELECT ON public.suscripciones TO authenticated;

CREATE TABLE public.suscripcion_eventos (
  id              bigserial PRIMARY KEY,
  organizacion_id uuid,
  tipo            text NOT NULL,            -- 'pago' | 'suscripcion'
  mp_id           text NOT NULL,
  estado          text NOT NULL DEFAULT '',
  monto           numeric,
  crudo           jsonb,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, mp_id, estado)               -- Mercado Pago reenvía avisos: cada uno se aplica una sola vez
);
ALTER TABLE public.suscripcion_eventos ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo funciones
REVOKE ALL ON public.suscripcion_eventos FROM anon, authenticated;

-- Toda organización nueva arranca con 7 días gratis en el plan Estándar (todo incluido).
CREATE FUNCTION public.suscripcion_crear_prueba()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.suscripciones (organizacion_id, plan, estado, vence_en)
  VALUES (NEW.id, 'estandar', 'prueba', now() + interval '7 days')
  ON CONFLICT (organizacion_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER suscripcion_crear_prueba AFTER INSERT ON public.organizaciones
  FOR EACH ROW EXECUTE FUNCTION public.suscripcion_crear_prueba();

-- Las organizaciones que ya existen: cortesía (Pro, 1 año), para no cortar a nadie.
INSERT INTO public.suscripciones (organizacion_id, plan, estado, vence_en)
SELECT o.id, 'pro', 'cortesia', now() + interval '1 year'
  FROM public.organizaciones o
ON CONFLICT (organizacion_id) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------
-- Acceso según el vencimiento
-- ---------------------------------------------------------------------------------------------------
-- Sin fila de suscripción devuelve 'completo' a propósito (falla abierto): una organización sin fila no
-- debería existir (hay trigger y relleno), y un error nuestro no tiene que dejar a un cliente sin servicio.
CREATE FUNCTION public.suscripcion_acceso(p_org uuid)
 RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT CASE
              WHEN now() <= s.vence_en                        THEN 'completo'
              WHEN now() <= s.vence_en + interval '7 days'    THEN 'solo_lectura'
              ELSE 'bloqueado'
            END
       FROM public.suscripciones s WHERE s.organizacion_id = p_org),
    'completo')
$$;

CREATE FUNCTION public.suscripcion_puede_leer()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.suscripcion_acceso(public.get_mi_organizacion_id()) <> 'bloqueado' $$;

CREATE FUNCTION public.suscripcion_puede_escribir()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.suscripcion_acceso(public.get_mi_organizacion_id()) = 'completo' $$;

CREATE FUNCTION public.suscripcion_incluye_alimentacion()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT p.incluye_alimentacion
       FROM public.suscripciones s JOIN public.planes_suscripcion p ON p.clave = s.plan
      WHERE s.organizacion_id = public.get_mi_organizacion_id()),
    true)
$$;

-- Corta con un mensaje claro. p_escritura = la acción modifica datos del gimnasio.
CREATE FUNCTION public.suscripcion_exigir(p_org uuid, p_escritura boolean)
 RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_acceso text := public.suscripcion_acceso(p_org);
BEGIN
  IF v_acceso = 'bloqueado' THEN
    RAISE EXCEPTION 'SUSCRIPCION_PAUSADA: El acceso de este gimnasio está pausado porque la suscripción venció.';
  END IF;
  IF p_escritura AND v_acceso = 'solo_lectura' THEN
    RAISE EXCEPTION 'SUSCRIPCION_SOLO_LECTURA: La suscripción venció y la cuenta está en solo lectura. Renueva el plan para volver a editar.';
  END IF;
END;
$$;

CREATE FUNCTION public.suscripcion_exigir_mi_org(p_escritura boolean)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.suscripcion_exigir(public.get_mi_organizacion_id(), p_escritura);
END;
$$;

-- Portal del alumno: la organización sale del código del alumno.
CREATE FUNCTION public.suscripcion_exigir_codigo(p_codigo text, p_escritura boolean)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT g.organizacion_id INTO v_org
    FROM public.alumnos a JOIN public.gimnasios g ON g.id = a.gimnasio_id
   WHERE a.codigo_acceso = left(btrim(COALESCE(p_codigo, '')), 200);
  IF v_org IS NOT NULL THEN
    PERFORM public.suscripcion_exigir(v_org, p_escritura);
  END IF;
END;
$$;

-- Autoregistro: la organización sale del código de invitación del gimnasio.
CREATE FUNCTION public.suscripcion_exigir_invitacion(p_codigo text, p_escritura boolean)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT g.organizacion_id INTO v_org
    FROM public.gimnasios g
   WHERE g.codigo_invitacion = left(btrim(COALESCE(p_codigo, '')), 200);
  IF v_org IS NOT NULL THEN
    PERFORM public.suscripcion_exigir(v_org, p_escritura);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Topes de alumnos y de gimnasios
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION public.suscripcion_validar_alumnos()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org     uuid;
  v_max     integer;
  v_nombre  text;
  v_activos integer;
BEGIN
  -- Solo importa cuando el alumno queda ACTIVO: alta activa o reactivación.
  IF NOT COALESCE(NEW.activo, false) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.activo, false) THEN
    RETURN NEW;
  END IF;

  SELECT g.organizacion_id INTO v_org FROM public.gimnasios g WHERE g.id = NEW.gimnasio_id;
  SELECT p.max_alumnos, p.nombre INTO v_max, v_nombre
    FROM public.suscripciones s JOIN public.planes_suscripcion p ON p.clave = s.plan
   WHERE s.organizacion_id = v_org;
  IF v_max IS NULL THEN
    RETURN NEW;   -- ilimitados, o sin suscripción (no debería pasar)
  END IF;

  SELECT count(*) INTO v_activos
    FROM public.alumnos a JOIN public.gimnasios g ON g.id = a.gimnasio_id
   WHERE g.organizacion_id = v_org AND a.activo AND a.id <> NEW.id;

  IF v_activos >= v_max THEN
    RAISE EXCEPTION 'LIMITE_ALUMNOS: El plan % permite hasta % alumnos activos. Pasa a un plan mayor para sumar más.', v_nombre, v_max;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER suscripcion_validar_alumnos BEFORE INSERT OR UPDATE OF activo ON public.alumnos
  FOR EACH ROW EXECUTE FUNCTION public.suscripcion_validar_alumnos();

CREATE FUNCTION public.suscripcion_validar_gimnasios()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_max      integer;
  v_nombre   text;
  v_cantidad integer;
BEGIN
  SELECT p.max_gimnasios, p.nombre INTO v_max, v_nombre
    FROM public.suscripciones s JOIN public.planes_suscripcion p ON p.clave = s.plan
   WHERE s.organizacion_id = NEW.organizacion_id;
  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_cantidad FROM public.gimnasios g WHERE g.organizacion_id = NEW.organizacion_id;
  IF v_cantidad >= v_max THEN
    RAISE EXCEPTION 'LIMITE_GIMNASIOS: El plan % permite hasta % %. Pasa a un plan mayor o escríbenos para sumar más.',
      v_nombre, v_max, CASE WHEN v_max = 1 THEN 'gimnasio' ELSE 'gimnasios' END;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER suscripcion_validar_gimnasios BEFORE INSERT ON public.gimnasios
  FOR EACH ROW EXECUTE FUNCTION public.suscripcion_validar_gimnasios();

-- ---------------------------------------------------------------------------------------------------
-- Políticas RESTRICTIVAS en las tablas de cada gimnasio
-- ---------------------------------------------------------------------------------------------------
-- (SELECT ...) para que se evalúe una vez por consulta y no por fila.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'alimentos', 'alumnos', 'asistencias', 'biblioteca_ocultos', 'configuracion_descuentos',
    'configuracion_periodos', 'configuracion_precios', 'ejercicios', 'entrenamientos_completados',
    'noticias', 'notificaciones', 'notificaciones_leidas', 'pagos', 'pagos_archivo_mensual',
    'planes_alimentacion', 'planes_alimentacion_biblioteca', 'progreso', 'rutinas', 'rutinas_asignadas'
  ] LOOP
    EXECUTE format('CREATE POLICY susc_leer ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.suscripcion_puede_leer()))', t);
    EXECUTE format('CREATE POLICY susc_insertar ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.suscripcion_puede_escribir()))', t);
    EXECUTE format('CREATE POLICY susc_actualizar ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.suscripcion_puede_escribir())) WITH CHECK ((SELECT public.suscripcion_puede_escribir()))', t);
    EXECUTE format('CREATE POLICY susc_borrar ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.suscripcion_puede_escribir()))', t);
  END LOOP;

  -- El plan Básico no incluye alimentación: no se pueden crear ni cambiar alimentos ni planes de comidas
  -- (lo que ya existía se puede ver).
  FOREACH t IN ARRAY ARRAY['alimentos', 'planes_alimentacion', 'planes_alimentacion_biblioteca'] LOOP
    EXECUTE format('CREATE POLICY susc_alimentacion_insertar ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.suscripcion_incluye_alimentacion()))', t);
    EXECUTE format('CREATE POLICY susc_alimentacion_actualizar ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.suscripcion_incluye_alimentacion())) WITH CHECK ((SELECT public.suscripcion_incluye_alimentacion()))', t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Contexto de la sesión + datos para la pantalla de suscripción
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mi_contexto()
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'gimnasio_id', public.get_mi_gimnasio_id(),
    'organizacion_id', public.get_mi_organizacion_id(),
    'rol', public.get_mi_rol(),
    'acceso_pausado', (
      NOT EXISTS (SELECT 1 FROM public.membresias m WHERE m.user_id = auth.uid() AND m.activo)
      AND EXISTS (SELECT 1 FROM public.membresias m WHERE m.user_id = auth.uid() AND m.rol = 'staff' AND NOT m.activo)
    ),
    'suscripcion_acceso', public.suscripcion_acceso(public.get_mi_organizacion_id()),
    'incluye_alimentacion', public.suscripcion_incluye_alimentacion(),
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
$$;

-- Lo que ve la pantalla "Suscripción". Funciona también con la cuenta bloqueada (no pasa por RLS).
-- El staff solo recibe el estado de acceso.
CREATE FUNCTION public.mi_suscripcion()
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org    uuid := public.get_mi_organizacion_id();
  v_s      public.suscripciones%ROWTYPE;
  v_acceso text := public.suscripcion_acceso(public.get_mi_organizacion_id());
BEGIN
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('acceso', v_acceso);
  END IF;
  IF public.get_mi_rol() <> 'admin' THEN
    RETURN jsonb_build_object('acceso', v_acceso);
  END IF;

  SELECT * INTO v_s FROM public.suscripciones WHERE organizacion_id = v_org;

  RETURN jsonb_build_object(
    'acceso', v_acceso,
    'plan', v_s.plan,
    'periodo', v_s.periodo,
    'estado', v_s.estado,
    'vence_en', v_s.vence_en,
    'dias_restantes', CASE WHEN v_s.vence_en IS NULL THEN NULL
                           ELSE ceil(extract(epoch FROM (v_s.vence_en - now())) / 86400.0)::integer END,
    'tiene_cobro_automatico', v_s.mp_preapproval_id IS NOT NULL AND v_s.estado = 'activa',
    'uso', jsonb_build_object(
      'alumnos', (SELECT count(*) FROM public.alumnos a JOIN public.gimnasios g ON g.id = a.gimnasio_id
                   WHERE g.organizacion_id = v_org AND a.activo),
      'gimnasios', (SELECT count(*) FROM public.gimnasios g WHERE g.organizacion_id = v_org)),
    'planes', (
      SELECT jsonb_agg(jsonb_build_object(
               'clave', p.clave, 'nombre', p.nombre, 'max_gimnasios', p.max_gimnasios,
               'max_alumnos', p.max_alumnos, 'incluye_alimentacion', p.incluye_alimentacion,
               'precio_mensual', p.precio_mensual,
               'montos', jsonb_build_object(
                  'mensual', public.suscripcion_monto(p.clave, 'mensual'),
                  'trimestral', public.suscripcion_monto(p.clave, 'trimestral'),
                  'semestral', public.suscripcion_monto(p.clave, 'semestral'))
             ) ORDER BY p.orden)
        FROM public.planes_suscripcion p)
  );
END;
$$;

-- Valida el plan elegido y devuelve lo que necesita la función Edge para crear el cobro en Mercado Pago.
CREATE FUNCTION public.suscripcion_preparar(p_plan text, p_periodo text)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org      uuid := public.get_mi_organizacion_id();
  v_plan     public.planes_suscripcion%ROWTYPE;
  v_per      record;
  v_alumnos  integer;
  v_gims     integer;
  v_email    text;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR public.get_mi_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar la suscripción';
  END IF;

  SELECT * INTO v_plan FROM public.planes_suscripcion WHERE clave = p_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese plan no existe';
  END IF;
  SELECT * INTO v_per FROM public.suscripcion_periodo(p_periodo);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese período de pago no existe';
  END IF;

  SELECT count(*) INTO v_alumnos FROM public.alumnos a JOIN public.gimnasios g ON g.id = a.gimnasio_id
   WHERE g.organizacion_id = v_org AND a.activo;
  SELECT count(*) INTO v_gims FROM public.gimnasios g WHERE g.organizacion_id = v_org;

  IF v_plan.max_alumnos IS NOT NULL AND v_alumnos > v_plan.max_alumnos THEN
    RAISE EXCEPTION 'Tienes % alumnos activos y el plan % permite hasta %. Desactiva alumnos o elige un plan mayor.',
      v_alumnos, v_plan.nombre, v_plan.max_alumnos;
  END IF;
  IF v_gims > v_plan.max_gimnasios THEN
    RAISE EXCEPTION 'Tienes % gimnasios y el plan % permite hasta %. Elige un plan mayor.',
      v_gims, v_plan.nombre, v_plan.max_gimnasios;
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();

  RETURN jsonb_build_object(
    'organizacion_id', v_org,
    'plan', v_plan.clave,
    'periodo', p_periodo,
    'meses', v_per.meses,
    'monto', public.suscripcion_monto(v_plan.clave, p_periodo),
    'razon', 'RutNail · Plan ' || v_plan.nombre || ' (' || p_periodo || ')',
    'email', v_email
  );
END;
$$;

-- Para cancelar el cobro automático desde la pantalla.
CREATE FUNCTION public.suscripcion_mi_preapproval()
 RETURNS text
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.get_mi_organizacion_id();
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR public.get_mi_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar la suscripción';
  END IF;
  RETURN (SELECT s.mp_preapproval_id FROM public.suscripciones s WHERE s.organizacion_id = v_org);
END;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Aplicar un aviso de Mercado Pago (solo la función Edge `mp-webhook`, con la clave de servicio)
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION public.suscripcion_aplicar_evento(
  p_org uuid, p_plan text, p_periodo text,
  p_preapproval_id text, p_preapproval_estado text, p_payer_email text,
  p_pago_id text, p_pago_estado text, p_pago_monto numeric, p_crudo jsonb)
 RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_s        public.suscripciones%ROWTYPE;
  v_meses    integer;
  v_tipo     text;
  v_mp_id    text;
  v_estado   text;
  v_nuevo    integer;
  v_base     timestamptz;
BEGIN
  SELECT * INTO v_s FROM public.suscripciones WHERE organizacion_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organización sin suscripción';
  END IF;
  PERFORM 1 FROM public.planes_suscripcion WHERE clave = p_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan inválido';
  END IF;
  SELECT per.meses INTO v_meses FROM public.suscripcion_periodo(p_periodo) per;
  IF v_meses IS NULL THEN
    RAISE EXCEPTION 'Período inválido';
  END IF;

  v_tipo   := CASE WHEN p_pago_id IS NOT NULL THEN 'pago' ELSE 'suscripcion' END;
  v_mp_id  := COALESCE(p_pago_id, p_preapproval_id);
  v_estado := COALESCE(p_pago_estado, p_preapproval_estado, '');
  IF v_mp_id IS NULL THEN
    RAISE EXCEPTION 'Aviso sin identificador';
  END IF;

  -- Cada aviso (mismo pago o suscripción en el mismo estado) se aplica una sola vez.
  INSERT INTO public.suscripcion_eventos (organizacion_id, tipo, mp_id, estado, monto, crudo)
  VALUES (p_org, v_tipo, v_mp_id, v_estado, p_pago_monto, p_crudo)
  ON CONFLICT (tipo, mp_id, estado) DO NOTHING;
  GET DIAGNOSTICS v_nuevo = ROW_COUNT;
  IF v_nuevo = 0 THEN
    RETURN 'repetido';
  END IF;

  -- Pago aprobado: activa el plan y suma el período (desde hoy si estaba en prueba o vencida; si
  -- todavía tenía días pagos, se suman a continuación).
  IF v_tipo = 'pago' AND p_pago_estado IN ('approved', 'processed') THEN
    v_base := CASE WHEN v_s.estado = 'prueba' THEN now() ELSE greatest(v_s.vence_en, now()) END;
    UPDATE public.suscripciones
       SET plan = p_plan, periodo = p_periodo, estado = 'activa',
           vence_en = v_base + make_interval(months => v_meses),
           mp_preapproval_id = COALESCE(p_preapproval_id, mp_preapproval_id),
           mp_payer_email = COALESCE(p_payer_email, mp_payer_email),
           ultimo_pago_en = now(), updated_at = now()
     WHERE organizacion_id = p_org;
    RETURN 'activada';
  END IF;

  -- Cobro automático cancelado: sigue con acceso hasta el vencimiento ya pagado.
  IF v_tipo = 'suscripcion' AND p_preapproval_estado = 'cancelled'
     AND (v_s.mp_preapproval_id IS NULL OR v_s.mp_preapproval_id = p_preapproval_id) THEN
    UPDATE public.suscripciones
       SET estado = 'cancelada', updated_at = now()
     WHERE organizacion_id = p_org AND estado <> 'prueba';
    RETURN 'cancelada';
  END IF;

  -- Suscripción autorizada (todavía sin pago aprobado): solo se guarda el vínculo.
  IF v_tipo = 'suscripcion' AND p_preapproval_estado = 'authorized' THEN
    UPDATE public.suscripciones
       SET mp_preapproval_id = p_preapproval_id,
           mp_payer_email = COALESCE(p_payer_email, mp_payer_email),
           estado = CASE WHEN estado IN ('prueba', 'cancelada') THEN 'pendiente' ELSE estado END,
           updated_at = now()
     WHERE organizacion_id = p_org;
    RETURN 'autorizada';
  END IF;

  RETURN 'registrado';
END;
$$;

REVOKE ALL ON FUNCTION public.suscripcion_aplicar_evento(uuid, text, text, text, text, text, text, text, numeric, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suscripcion_aplicar_evento(uuid, text, text, text, text, text, text, text, numeric, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.mi_suscripcion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_suscripcion() TO authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_preparar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suscripcion_preparar(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.suscripcion_mi_preapproval() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suscripcion_mi_preapproval() TO authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Funciones que saltean RLS: se les inyecta la comprobación al empezar
-- ---------------------------------------------------------------------------------------------------
-- Portal del alumno: pausado solo cuando está BLOQUEADO (lo que el alumno anota es suyo; no se le corta
-- por una cuota que no es suya durante los 7 días de solo lectura). Acciones del administrador y
-- autoregistro: también se cortan en solo lectura.
DO $$
DECLARE
  r record;
  v_def text;
  v_nuevo text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('ver_plan_por_codigo',        'text',                                                    'PERFORM public.suscripcion_exigir_codigo(p_codigo, false);'),
      ('ver_progreso_alumno',        'text',                                                    'PERFORM public.suscripcion_exigir_codigo(p_codigo, false);'),
      ('listar_planes_para_codigo',  'text',                                                    'PERFORM public.suscripcion_exigir_codigo(p_codigo, false);'),
      ('marcar_entrenamiento_hecho', 'text, integer, text',                                     'PERFORM public.suscripcion_exigir_codigo(p_codigo, false);'),
      ('alumno_cargar_peso',         'text, numeric',                                           'PERFORM public.suscripcion_exigir_codigo(p_codigo, false);'),
      ('aceptar_terminos_alumno',    'text, boolean, boolean, text, text',                      'PERFORM public.suscripcion_exigir_codigo(p_codigo, false);'),
      ('marcar_notificacion_leida',  'text, uuid',                                              'PERFORM public.suscripcion_exigir_codigo(p_codigo, false);'),
      ('join_gimnasio_por_codigo',   'text, text, text, text, text, date, text',                'PERFORM public.suscripcion_exigir_invitacion(p_codigo, true);'),
      ('anular_pago',                'uuid, text',                                              'PERFORM public.suscripcion_exigir_mi_org(true);'),
      ('archivar_pagos_hasta',       'date',                                                    'PERFORM public.suscripcion_exigir_mi_org(true);'),
      ('crear_acceso_alumno',        'uuid, text, text',                                        'PERFORM public.suscripcion_exigir_mi_org(true);'),
      ('quitar_acceso_alumno',       'uuid',                                                    'PERFORM public.suscripcion_exigir_mi_org(true);'),
      ('regenerar_codigo_acceso_alumno', 'uuid',                                                'PERFORM public.suscripcion_exigir_mi_org(true);'),
      ('regenerar_codigo_invitacion', '',                                                       'PERFORM public.suscripcion_exigir_mi_org(true);'),
      ('equipo_sumar',               'uuid',                                                    'PERFORM public.suscripcion_exigir_mi_org(true);'),
      ('equipo_cambiar_estado',      'uuid, boolean',                                           'PERFORM public.suscripcion_exigir_mi_org(true);'),
      ('equipo_quitar',              'uuid',                                                    'PERFORM public.suscripcion_exigir_mi_org(true);')
    ) AS x(nombre, args, inyeccion)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nombre
       AND p.pronargs = CASE WHEN r.args = '' THEN 0 ELSE array_length(string_to_array(r.args, ','), 1) END;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'No se encontró la función %', r.nombre;
    END IF;
    IF position('suscripcion_exigir' IN v_def) > 0 THEN
      CONTINUE;   -- ya tiene la comprobación
    END IF;
    v_nuevo := regexp_replace(v_def, E'\nBEGIN\n', E'\nBEGIN\n  ' || r.inyeccion || E'\n');
    IF v_nuevo = v_def THEN
      RAISE EXCEPTION 'No se pudo inyectar la comprobación en %', r.nombre;
    END IF;
    EXECUTE v_nuevo;
  END LOOP;
END;
$$;
