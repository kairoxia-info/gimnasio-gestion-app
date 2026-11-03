-- 0090 (03/11/2026): cobrar con un PLAN de Mercado Pago, para que pague cualquier cuenta.
--
-- Problema visto en la primera compra real de prueba: el cobro se creaba con `POST /preapproval` + `payer_email`
-- y Mercado Pago exige que la cuenta que paga tenga exactamente ese correo ("Tu e-mail no coincide con el de la
-- suscripción"). Un cliente cuyo correo de Mercado Pago sea distinto del de RutNail no podía pagar.
--
-- Ahora la función Edge `suscripcion` crea (y reutiliza) un PLAN de Mercado Pago (`POST /preapproval_plan`) por
-- organización + plan + período + monto, y manda a la persona al `init_point` del plan, donde se suscribe con SU
-- cuenta, sea cual sea su correo. Como la suscripción que se crea ya no lleva `external_reference`, la función
-- `mp-webhook` identifica la organización por el `preapproval_plan_id` de la suscripción, con esta tabla.
--
-- Solo el servidor (service_role, desde las funciones Edge) toca estas funciones: el navegador no.

CREATE TABLE public.suscripcion_planes_mp (
  mp_plan_id      text PRIMARY KEY,
  init_point      text NOT NULL,
  organizacion_id uuid NOT NULL REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  plan            text NOT NULL REFERENCES public.planes_suscripcion(clave) ON DELETE CASCADE,
  periodo         text NOT NULL CHECK (periodo IN ('mensual', 'trimestral', 'semestral')),
  monto           integer NOT NULL CHECK (monto > 0),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizacion_id, plan, periodo, monto)   -- un plan de Mercado Pago por combinación: se reutiliza
);
ALTER TABLE public.suscripcion_planes_mp ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo funciones
REVOKE ALL ON public.suscripcion_planes_mp FROM anon, authenticated;

-- ¿Ya hay un plan de Mercado Pago para esta organización, plan, período y monto?
CREATE FUNCTION public.suscripcion_plan_mp_buscar(p_org uuid, p_plan text, p_periodo text, p_monto integer)
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object('mp_plan_id', t.mp_plan_id, 'init_point', t.init_point)
    FROM public.suscripcion_planes_mp t
   WHERE t.organizacion_id = p_org AND t.plan = p_plan AND t.periodo = p_periodo AND t.monto = p_monto
$$;

-- Guarda el plan recién creado en Mercado Pago. Si dos pedidos simultáneos crearon cada uno el suyo, queda el
-- primero y los dos usan ese (devuelve siempre el que quedó guardado).
CREATE FUNCTION public.suscripcion_plan_mp_guardar(
  p_mp_plan_id text, p_init_point text, p_org uuid, p_plan text, p_periodo text, p_monto integer)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.suscripcion_planes_mp (mp_plan_id, init_point, organizacion_id, plan, periodo, monto)
  VALUES (p_mp_plan_id, p_init_point, p_org, p_plan, p_periodo, p_monto)
  ON CONFLICT DO NOTHING;
  RETURN public.suscripcion_plan_mp_buscar(p_org, p_plan, p_periodo, p_monto);
END;
$$;

-- Para `mp-webhook`: a qué organización, plan y período corresponde una suscripción creada desde un plan.
CREATE FUNCTION public.suscripcion_plan_mp_resolver(p_mp_plan_id text)
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object('organizacion_id', t.organizacion_id, 'plan', t.plan, 'periodo', t.periodo)
    FROM public.suscripcion_planes_mp t
   WHERE t.mp_plan_id = p_mp_plan_id
$$;

REVOKE ALL ON FUNCTION public.suscripcion_plan_mp_buscar(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suscripcion_plan_mp_buscar(uuid, text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.suscripcion_plan_mp_guardar(text, text, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suscripcion_plan_mp_guardar(text, text, uuid, text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.suscripcion_plan_mp_resolver(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suscripcion_plan_mp_resolver(text) TO service_role;
