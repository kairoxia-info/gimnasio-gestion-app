-- ============================================================================
-- 0094_eliminar_cuenta_con_cobro.sql
--
-- Encontrado al reescribir los términos (04/11/2026): eliminar_mi_cuenta() borraba la cuenta sin tocar
-- el cobro automático. Mercado Pago lo sigue cobrando por su cuenta, así que un cliente que eliminara su
-- cuenta seguiría pagando, ya sin pantalla desde donde cancelarlo. Ahora la cuenta no se puede eliminar
-- mientras el cobro esté vivo.
--
-- Por qué suscripcion_cobro_vivo() y no suscripciones.estado: cancelar durante la prueba deja estado =
-- 'prueba' y un cobro autorizado sin pago todavía también, y 'pendiente' tampoco distingue. Lo que sí es
-- seguro es el aviso de Mercado Pago: una suscripción cancelada no se reactiva, y ese aviso queda en
-- suscripcion_eventos. Sin aviso de cancelación del último id guardado, el cobro sigue vivo.
--
-- mi_suscripcion() usa lo mismo para tiene_cobro_automatico (antes pedía estado = 'activa'): si no, una
-- cuenta en 'pendiente' o 'prueba' con el cobro vivo no veía el botón para cancelarlo y quedaría trabada
-- sin poder eliminarse.
-- ============================================================================

CREATE FUNCTION public.suscripcion_cobro_vivo(p_org UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.suscripciones s
    WHERE s.organizacion_id = p_org
      AND s.mp_preapproval_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.suscripcion_eventos e
        WHERE e.tipo = 'suscripcion' AND e.mp_id = s.mp_preapproval_id AND e.estado = 'cancelled'
      )
  )
$function$;

REVOKE ALL ON FUNCTION public.suscripcion_cobro_vivo(UUID) FROM PUBLIC, anon, authenticated;

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

  IF EXISTS (SELECT 1 FROM unnest(v_orgs) AS o(id) WHERE public.suscripcion_cobro_vivo(o.id)) THEN
    RAISE EXCEPTION 'Primero cancela el cobro automático desde la pantalla Suscripción. Si no, Mercado Pago seguiría cobrando.';
  END IF;

  DELETE FROM public.gimnasios WHERE id = ANY (v_propios);

  DELETE FROM public.organizaciones o
   WHERE o.id = ANY (v_orgs)
     AND NOT EXISTS (SELECT 1 FROM public.gimnasios g WHERE g.organizacion_id = o.id);

  DELETE FROM public.profiles WHERE id = mi_user_id;
  DELETE FROM auth.users WHERE id = mi_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mi_suscripcion()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    'tiene_cobro_automatico', public.suscripcion_cobro_vivo(v_org),
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
$function$;

-- ============================================================================
-- Fin de la migración 0094.
-- ============================================================================
