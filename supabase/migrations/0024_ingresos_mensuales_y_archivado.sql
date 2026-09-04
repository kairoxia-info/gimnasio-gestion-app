-- Dashboard de ingresos mensuales + archivado manual de pagos, pedido de
-- Nalux (04/09/2026): "quiero que agreges un grafico mensual, de cuanto
-- gano el mes pasado... quiero que valla teniendo un seguimiento de eso, y
-- un historial, despues de cumplir el año eso se puede borrar o comprimir
-- en su propia base para que no siga ocupando mas lugar".
--
-- Decisiones de modelado (conversación completa, ver AskUserQuestion):
--
-- 1) DashboardPage.jsx/PagosPage.jsx hoy calculan "cajaMes" (el mes actual)
--    en el cliente, trayendo TODA la tabla pagos sin filtro de fecha
--    (listAll('pagos')). Eso funciona hoy porque el volumen es chico, pero
--    es un fetch que crece sin límite con los años -- exactamente lo que a
--    Nalux le preocupa. ingresos_por_mes() agrupa en el servidor (PostgREST
--    no hace GROUP BY directo, por eso va como función), así el cliente deja
--    de necesitar traer cada pago individual solo para sumarlos por mes.
--
-- 2) Cada fila de `pagos` es también el comprobante numerado (columna
--    `numero`, migración 0013) -- borrar una fila de pago pierde la
--    posibilidad de reimprimir ESE comprobante. Por eso el archivado NUNCA
--    es automático: archivar_pagos_hasta() es una función que el profesor
--    dispara a mano desde Configuración, con una fecha de corte elegida por
--    él y una confirmación explícita en la UI de que esos comprobantes
--    dejan de poder reimprimirse. Antes de borrar, siempre suma el total a
--    pagos_archivo_mensual -- así el gráfico no pierde continuidad
--    histórica aunque el detalle fila-por-fila ya no exista.
--
-- 3) ingresos_por_mes() completa CADA mes pedido (generate_series) con lo
--    que haya, sea de pagos en vivo o ya archivado -- el gráfico nunca tiene
--    huecos por un mes que se haya archivado.

-- 1) Resumen permanente por mes, sobrevive al borrado del detalle.
CREATE TABLE public.pagos_archivo_mensual (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  mes            DATE NOT NULL,
  total_cobrado  NUMERIC NOT NULL DEFAULT 0,
  cantidad_pagos INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gimnasio_id, mes)
);

CREATE INDEX idx_pagos_archivo_mensual_gimnasio_id ON public.pagos_archivo_mensual (gimnasio_id);

ALTER TABLE public.pagos_archivo_mensual ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pagos_archivo_mensual_tenant_isolation" ON public.pagos_archivo_mensual
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

-- Mismo criterio de GRANT que 0002_grant_authenticated_privileges.sql: CRUD
-- completo para authenticated (RLS ya aísla por gimnasio), nada para anon.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagos_archivo_mensual TO authenticated;
REVOKE ALL ON public.pagos_archivo_mensual FROM anon;

-- 2) Serie mensual para el gráfico del Dashboard. NO es SECURITY DEFINER a
-- propósito: corre con los privilegios del que llama, así que RLS
-- (pagos_tenant_isolation / pagos_archivo_mensual_tenant_isolation) ya
-- aísla por gimnasio sin tener que filtrar a mano por gimnasio_id acá.
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
    COALESCE(v.total, a.total_cobrado, 0) AS total,
    COALESCE(v.cantidad_pagos, a.cantidad_pagos, 0)::integer AS cantidad_pagos
  FROM meses_pedidos mp
  LEFT JOIN vivos v ON v.mes = mp.mes
  LEFT JOIN public.pagos_archivo_mensual a ON a.mes = mp.mes
  ORDER BY mp.mes;
$$;

GRANT EXECUTE ON FUNCTION public.ingresos_por_mes(integer) TO authenticated;

-- 3) Archivado manual. Tampoco SECURITY DEFINER: al correr con los
-- privilegios del que llama, ni el INSERT en pagos_archivo_mensual ni el
-- DELETE en pagos pueden salirse del propio gimnasio -- RLS lo impediría
-- igual que en cualquier otra operación del cliente, es una capa de
-- seguridad extra además del filtro explícito por gimnasio_id de acá abajo.
--
-- ON CONFLICT suma en vez de pisar: si el profesor archiva dos veces sobre
-- rangos que se superponen (por error, o porque cargó pagos nuevos de una
-- fecha vieja después de un primer archivado), no se pierde el total ya
-- archivado antes.
CREATE OR REPLACE FUNCTION public.archivar_pagos_hasta(p_fecha_corte date)
RETURNS TABLE(meses_afectados integer, pagos_archivados integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_gimnasio_id UUID := public.get_mi_gimnasio_id();
  v_meses INTEGER;
  v_pagos INTEGER;
BEGIN
  IF v_gimnasio_id IS NULL THEN
    RAISE EXCEPTION 'No hay un gimnasio activo para este usuario.';
  END IF;

  WITH resumen AS (
    SELECT
      date_trunc('month', fecha_pago)::date AS mes,
      SUM(monto) AS total,
      COUNT(*) AS cantidad
    FROM public.pagos
    WHERE gimnasio_id = v_gimnasio_id
      AND fecha_pago IS NOT NULL
      AND fecha_pago < p_fecha_corte
    GROUP BY 1
  )
  INSERT INTO public.pagos_archivo_mensual (gimnasio_id, mes, total_cobrado, cantidad_pagos)
  SELECT v_gimnasio_id, mes, total, cantidad FROM resumen
  ON CONFLICT (gimnasio_id, mes) DO UPDATE
    SET total_cobrado = public.pagos_archivo_mensual.total_cobrado + EXCLUDED.total_cobrado,
        cantidad_pagos = public.pagos_archivo_mensual.cantidad_pagos + EXCLUDED.cantidad_pagos;

  GET DIAGNOSTICS v_meses = ROW_COUNT;

  DELETE FROM public.pagos
  WHERE gimnasio_id = v_gimnasio_id
    AND fecha_pago IS NOT NULL
    AND fecha_pago < p_fecha_corte;

  GET DIAGNOSTICS v_pagos = ROW_COUNT;

  RETURN QUERY SELECT v_meses, v_pagos;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archivar_pagos_hasta(date) TO authenticated;
