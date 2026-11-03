-- 0089 (03/11/2026): suscripcion_monto deja de redondear a los $500 cuando el precio por mes es menor a $500.
--
-- Motivo: para probar el cobro real con un plan temporal de $100 por mes (compra real chica de prueba con
-- Mercado Pago). Con el redondeo a $500, $100 daba $0 y Mercado Pago no lo acepta.
--
-- Los planes reales NO cambian: Básico, Estándar y Pro (y sus descuentos de 10 % y 20 %) dan precios
-- mensuales equivalentes que ya son múltiplos de $500, así que el redondeo no hacía nada en ellos
-- (verificado: los 9 montos son idénticos antes y después).

CREATE OR REPLACE FUNCTION public.suscripcion_monto(p_plan text, p_periodo text)
 RETURNS integer
 LANGUAGE sql STABLE
 SET search_path TO 'public'
AS $$
  SELECT (CASE WHEN p.precio_mensual * (1 - per.descuento) >= 500
               THEN round(p.precio_mensual * (1 - per.descuento) / 500.0) * 500
               ELSE round(p.precio_mensual * (1 - per.descuento))
          END * per.meses)::integer
    FROM public.planes_suscripcion p, public.suscripcion_periodo(p_periodo) per
   WHERE p.clave = p_plan
$$;
