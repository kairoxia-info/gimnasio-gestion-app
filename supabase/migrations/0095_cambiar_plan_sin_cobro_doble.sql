-- ============================================================================
-- 0095_cambiar_plan_sin_cobro_doble.sql
--
-- Encontrado el 04/11/2026 revisando los cobros: con un cobro automático vivo, "Cambiar de plan" armaba
-- otra suscripción en Mercado Pago sin tocar la anterior. Al autorizarse, suscripcion_aplicar_evento pisa
-- mp_preapproval_id con la nueva, así que el cliente pagaba los dos planes y "Cancelar el cobro
-- automático" solo alcanzaba a la nueva: la vieja seguía cobrando sin que la app supiera de ella.
--
-- Ahora no se puede preparar un cobro nuevo mientras haya uno vivo (suscripcion_cobro_vivo, 0094):
-- primero se cancela. No se pierde nada: cancelar deja el vencimiento como está y el pago nuevo se suma a
-- lo que quede (greatest(vence_en, now()) en suscripcion_aplicar_evento).
--
-- El mensaje empieza con "Ese plan" a propósito: la Edge Function "suscripcion" solo muestra tal cual los
-- mensajes que reconoce (mensajeDe) y así no hace falta volver a desplegarla.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.suscripcion_preparar(p_plan TEXT, p_periodo TEXT)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF public.suscripcion_cobro_vivo(v_org) THEN
    RAISE EXCEPTION 'Ese plan se contrata después de cancelar tu cobro automático actual, para que no se cobren los dos. Cancélalo en esta pantalla y vuelve a elegirlo: lo que ya pagaste se mantiene.';
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
$function$;

-- ============================================================================
-- Fin de la migración 0095.
-- ============================================================================
