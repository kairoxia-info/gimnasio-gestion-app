-- 0087 (02/11/2026): un pago durante la prueba gratis cuenta desde hoy.
--
-- Problema visto en la prueba con Mercado Pago: el aviso "suscripción autorizada" llega justo antes que el
-- del primer pago y pasaba el estado de 'prueba' a 'pendiente'. Cuando llegaba el pago, la suscripción ya
-- no figuraba en prueba y el mes se sumaba a los días de prueba que quedaban (vencía unos días después de
-- lo que cobra Mercado Pago). Ahora la autorización solo pasa a 'pendiente' si estaba 'cancelada'; en
-- prueba sigue en prueba hasta que entre el pago (y si el primer cobro falla, la prueba continúa).
--
-- Es el mismo cuerpo de suscripcion_aplicar_evento (0086) con un único cambio: el CASE del estado en la
-- rama "Suscripción autorizada". Los permisos (solo service_role) se conservan.

CREATE OR REPLACE FUNCTION public.suscripcion_aplicar_evento(
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

  -- Suscripción autorizada (todavía sin pago aprobado): solo se guarda el vínculo. Si estaba cancelada
  -- pasa a 'pendiente'; si estaba en prueba, sigue en prueba hasta que entre el pago.
  IF v_tipo = 'suscripcion' AND p_preapproval_estado = 'authorized' THEN
    UPDATE public.suscripciones
       SET mp_preapproval_id = p_preapproval_id,
           mp_payer_email = COALESCE(p_payer_email, mp_payer_email),
           estado = CASE WHEN estado = 'cancelada' THEN 'pendiente' ELSE estado END,
           updated_at = now()
     WHERE organizacion_id = p_org;
    RETURN 'autorizada';
  END IF;

  RETURN 'registrado';
END;
$$;
