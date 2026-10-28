-- ============================================================================
-- 0073_integridad_de_pagos.sql
--
-- Integridad de pagos y comprobantes (auditoria pre-lanzamiento, 28/10/2026).
-- Verificado ANTES de escribirla contra todos los datos existentes: ningun pago
-- viola las reglas nuevas (sin montos negativos, sin periodos invertidos, sin
-- numeros repetidos), asi que se pueden agregar sin tocar nada guardado.
--
-- 1. REGLAS EN LA BASE. Hasta hoy monto, monto_adeudado, descuento, interes y las
--    fechas las calcula el navegador y la tabla no validaba nada: con una
--    llamada directa a la API se podian guardar montos negativos, un descuento de
--    200 % o un periodo que termina antes de empezar. Ahora la base lo rechaza.
--    (Recalcular el total en el servidor a partir de la lista de precios es un
--    paso mas grande y queda para despues; esto ya impide los valores absurdos.)
--
-- 2. NUMERO DE COMPROBANTE QUE NUNCA SE REUTILIZA. Era MAX(numero) + 1: si se
--    borraba el ultimo pago (o se archivaban todos) el numero volvia a usarse, y
--    hasta reiniciaba en 1. Un comprobante entregado a un alumno puede quedar
--    apuntando a otro pago. Ahora cada gimnasio tiene su contador
--    (gimnasios.ultimo_comprobante) que solo sube, mas un indice unico
--    (gimnasio, numero) como red de seguridad.
--
-- 3. EL CLIENTE YA NO PUEDE ESCRIBIR `numero` NI EL CONTADOR. pagos y gimnasios
--    tenian permisos de TABLA COMPLETA para authenticated, asi que cualquier
--    columna nueva (como el contador) habria quedado editable desde la API.
--    Se pasa a permisos por columna, con la lista de lo que el cliente escribe de
--    verdad (revisado en el codigo). El trigger sigue asignando el numero porque
--    corre como duenio de la funcion.
--
-- 4. ARCHIVAR NO LIBERA A UN MOROSO. archivar_pagos_hasta() borraba TODOS los
--    pagos anteriores a la fecha de corte, incluido el ULTIMO de cada alumno: un
--    alumno con la cuota vencida pasaba a "sin cuota" y se le levantaba la
--    restriccion y el aviso. Ahora siempre se conserva el ultimo pago de cada
--    alumno (el mismo criterio con que se calcula su estado de cuota).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reglas de validez
-- ----------------------------------------------------------------------------
ALTER TABLE public.pagos
  ADD CONSTRAINT pagos_monto_no_negativo CHECK (monto >= 0),
  ADD CONSTRAINT pagos_monto_adeudado_no_negativo CHECK (monto_adeudado >= 0),
  ADD CONSTRAINT pagos_descuento_en_rango CHECK (descuento IS NULL OR descuento BETWEEN 0 AND 100),
  ADD CONSTRAINT pagos_interes_en_rango CHECK (interes IS NULL OR interes BETWEEN 0 AND 1000),
  ADD CONSTRAINT pagos_periodo_en_orden CHECK (
    periodo_desde IS NULL OR periodo_hasta IS NULL OR periodo_hasta >= periodo_desde
  );

-- ----------------------------------------------------------------------------
-- 2. Contador de comprobantes por gimnasio
-- ----------------------------------------------------------------------------
ALTER TABLE public.gimnasios
  ADD COLUMN IF NOT EXISTS ultimo_comprobante INTEGER NOT NULL DEFAULT 0;

UPDATE public.gimnasios g
   SET ultimo_comprobante = COALESCE(
         (SELECT MAX(p.numero) FROM public.pagos p WHERE p.gimnasio_id = g.id), 0);

CREATE UNIQUE INDEX IF NOT EXISTS pagos_gimnasio_numero_uk
  ON public.pagos (gimnasio_id, numero)
  WHERE numero IS NOT NULL;

COMMENT ON COLUMN public.gimnasios.ultimo_comprobante IS
  'Ultimo numero de comprobante emitido por este gimnasio (0073). Solo sube; lo incrementa el trigger de pagos. El cliente no puede escribirlo.';

-- Misma regla de siempre (0013/0032): solo los pagos con importe > 0 llevan
-- numero; una activacion "sin cobrar" no emite comprobante. El UPDATE bloquea la
-- fila del gimnasio hasta el fin de la transaccion, asi que dos cobros a la vez
-- nunca reciben el mismo numero.
CREATE OR REPLACE FUNCTION public.asignar_numero_comprobante()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.numero IS NULL AND COALESCE(NEW.monto, 0) > 0 THEN
    UPDATE public.gimnasios
       SET ultimo_comprobante = ultimo_comprobante + 1
     WHERE id = NEW.gimnasio_id
    RETURNING ultimo_comprobante INTO NEW.numero;
  END IF;
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Permisos por columna (el cliente deja de poder escribir `numero` y el contador)
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.pagos FROM authenticated;
GRANT INSERT (gimnasio_id, alumno_id, monto, monto_adeudado, fecha_pago, periodo_desde,
              periodo_hasta, estado, descuento, interes, metodo, notas, client_id)
  ON public.pagos TO authenticated;
GRANT UPDATE (monto, monto_adeudado, fecha_pago, periodo_desde, periodo_hasta, estado,
              descuento, interes, metodo, notas)
  ON public.pagos TO authenticated;

REVOKE UPDATE ON public.gimnasios FROM authenticated;
GRANT UPDATE (nombre, logo_url, color_principal, autorregistro_activo, dias_gracia_cuota,
              dias_aviso_vencimiento, aviso_cuota_activo, aviso_cuota_titulo,
              aviso_cuota_mensaje, comprobante_texto_pie, politica_vencimiento_cuota,
              restringir_rutina, restringir_alimentacion, dias_abiertos,
              alias_mercadopago, whatsapp_pagos, email_pagos)
  ON public.gimnasios TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Archivar conserva el ultimo pago de cada alumno
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archivar_pagos_hasta(p_fecha_corte date)
 RETURNS TABLE(meses_afectados integer, pagos_archivados integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_gimnasio_id UUID := public.get_mi_gimnasio_id();
  v_meses INTEGER;
  v_pagos INTEGER;
BEGIN
  IF v_gimnasio_id IS NULL THEN
    RAISE EXCEPTION 'No hay un gimnasio activo para este usuario.';
  END IF;

  WITH ultimo_de_cada_alumno AS (
    -- Mismo orden con el que ver_plan_por_codigo() y estadoCuota() eligen el
    -- "ultimo pago": el de periodo_hasta mas alto (los sin fecha al final).
    SELECT DISTINCT ON (alumno_id) id
      FROM public.pagos
     WHERE gimnasio_id = v_gimnasio_id
     ORDER BY alumno_id, periodo_hasta DESC NULLS LAST, created_at DESC
  ),
  a_archivar AS (
    SELECT id, fecha_pago, monto
      FROM public.pagos
     WHERE gimnasio_id = v_gimnasio_id
       AND fecha_pago IS NOT NULL
       AND fecha_pago < p_fecha_corte
       AND id NOT IN (SELECT id FROM ultimo_de_cada_alumno)
  ),
  resumen AS (
    SELECT date_trunc('month', fecha_pago)::date AS mes,
           SUM(monto) AS total,
           COUNT(*) AS cantidad
      FROM a_archivar
     GROUP BY 1
  ),
  guardado AS (
    INSERT INTO public.pagos_archivo_mensual (gimnasio_id, mes, total_cobrado, cantidad_pagos)
    SELECT v_gimnasio_id, mes, total, cantidad FROM resumen
    ON CONFLICT (gimnasio_id, mes) DO UPDATE
      SET total_cobrado = public.pagos_archivo_mensual.total_cobrado + EXCLUDED.total_cobrado,
          cantidad_pagos = public.pagos_archivo_mensual.cantidad_pagos + EXCLUDED.cantidad_pagos
    RETURNING 1
  ),
  borrado AS (
    DELETE FROM public.pagos
     WHERE id IN (SELECT id FROM a_archivar)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM guardado)::integer, (SELECT count(*) FROM borrado)::integer
    INTO v_meses, v_pagos;

  RETURN QUERY SELECT v_meses, v_pagos;
END;
$function$;
