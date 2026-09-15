-- ============================================================================
-- Migración 0059 — ingresos_por_mes() sumaba mal cuando un mes queda
-- MITAD vivo, MITAD archivado
-- ============================================================================
-- Encontrado en la auditoría final del proyecto (15/09/2026, agente
-- database-architect): la versión original (0024) arma el total de cada mes
-- con COALESCE(v.total, a.total_cobrado, 0) -- eso elige el PRIMERO que no
-- sea nulo, no SUMA los dos. archivar_pagos_hasta() acepta cualquier fecha
-- de corte, no solo el primer día de un mes (es un <input type="date"> libre
-- en ConfiguracionPage.jsx, con default "hoy menos 12 meses" -- que rara vez
-- cae justo el día 1). Si un mes queda con ALGUNOS pagos ya archivados
-- (a.total_cobrado > 0) y OTROS todavía en pagos (v.total > 0, los que
-- quedaron después de la fecha de corte), el COALESCE se queda solo con
-- v.total y descarta por completo lo ya archivado -- el gráfico de "Ingresos
-- por mes" le mostraba al profesor MENOS plata de la real para ese mes, sin
-- ningún aviso ni error.
--
-- Corrección: sumar los dos (cada uno con su propio COALESCE a 0 para no
-- perder el mes cuando falta alguno de los dos). Mismo cambio para
-- cantidad_pagos. No hace falta DROP FUNCTION -- el RETURNS TABLE no cambia,
-- solo el cuerpo de la consulta.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ingresos_por_mes(p_meses integer DEFAULT 12)
RETURNS TABLE(mes date, total numeric, cantidad_pagos integer)
LANGUAGE sql
STABLE
AS $$
  WITH meses_pedidos AS (
    SELECT generate_series(
      date_trunc('month', CURRENT_DATE) - (GREATEST(p_meses, 1) - 1) * INTERVAL '1 month',
      date_trunc('month', CURRENT_DATE),
      INTERVAL '1 month'
    )::date AS mes
  ),
  vivos AS (
    SELECT date_trunc('month', fecha_pago)::date AS mes,
           SUM(monto) AS total,
           COUNT(*) AS cantidad_pagos
    FROM public.pagos
    WHERE fecha_pago IS NOT NULL
    GROUP BY 1
  )
  SELECT
    mp.mes,
    COALESCE(v.total, 0) + COALESCE(a.total_cobrado, 0) AS total,
    (COALESCE(v.cantidad_pagos, 0) + COALESCE(a.cantidad_pagos, 0))::integer AS cantidad_pagos
  FROM meses_pedidos mp
  LEFT JOIN vivos v ON v.mes = mp.mes
  LEFT JOIN public.pagos_archivo_mensual a ON a.mes = mp.mes
  ORDER BY mp.mes;
$$;

GRANT EXECUTE ON FUNCTION public.ingresos_por_mes(integer) TO authenticated;
