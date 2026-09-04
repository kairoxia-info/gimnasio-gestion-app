-- Bloque de Pagos pedido por Nalux (02/09/2026):
--
--   "cuando se le venza la cuota el sistema lo detecta solo y lo pone como
--    deudor, tambien tener la opcion de que el profesor si quiere o no poner
--    un porciento para cuando se les venza (...) que sea configurable esa
--    parte (...) despues el comprobante (...) y que esos comprobante se
--    vallan guardando"
--
-- Decisiones de modelado:
--
-- 1) La deuda NO se guarda como filas. El estado "deudor" y el recargo se
--    CALCULAN a partir de pagos.periodo_hasta + la configuración del gimnasio.
--    Guardar filas de deuda generadas solas llenaría la base de registros que
--    nadie cargó (mismo criterio que Nalux aprobó para la asistencia: no
--    inventar datos). Lo único que se guarda es lo que el profesor carga.
--
-- 2) El "porciento" por mora ya existe: configuracion_precios.interes_mora,
--    por plan. NO se agrega un segundo campo global para lo mismo -- tener dos
--    perillas para el mismo número es garantía de que algún día no coincidan.
--    Acá se agregan solo los TIEMPOS, que sí son política del gimnasio entero.
--
-- 3) El comprobante no se guarda como archivo. Cada fila de `pagos` ES el
--    comprobante: se le agrega un número correlativo por gimnasio y se
--    reimprime cuando haga falta. Guardar un PDF por pago duplicaría el dato
--    (y quedaría desactualizado si se corrige el pago).

-- Tiempos de vencimiento, configurables desde Precios.
--
-- dias_gracia_cuota: cuántos días después de periodo_hasta se le sigue
-- considerando al día. 0 = apenas vence, ya es deudor. 7 = "tiene una semana
-- más para pagar" (el caso que planteó Nalux).
--
-- dias_aviso_vencimiento: con cuántos días de anticipación aparece como
-- "por vencer". 7 es el valor que ya venía usando estadoDesdeVencimiento()
-- hardcodeado, así que este default deja el comportamiento actual igual.
ALTER TABLE public.gimnasios
  ADD COLUMN dias_gracia_cuota INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN dias_aviso_vencimiento INTEGER NOT NULL DEFAULT 7;

-- Número de comprobante, correlativo POR GIMNASIO (cada gimnasio arranca en
-- 1, no comparten numeración).
ALTER TABLE public.pagos
  ADD COLUMN numero INTEGER;

CREATE UNIQUE INDEX pagos_numero_por_gimnasio
  ON public.pagos (gimnasio_id, numero);

-- El número se asigna solo al insertar. SECURITY DEFINER para que el MAX()
-- vea todas las filas del gimnasio sin depender de la RLS del que inserta, y
-- el FOR UPDATE sobre la fila del gimnasio serializa la numeración: dos pagos
-- simultáneos del mismo gimnasio no pueden sacar el mismo número.
CREATE OR REPLACE FUNCTION public.asignar_numero_comprobante()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.numero IS NULL THEN
        PERFORM 1 FROM public.gimnasios WHERE id = NEW.gimnasio_id FOR UPDATE;

        SELECT COALESCE(MAX(numero), 0) + 1
          INTO NEW.numero
          FROM public.pagos
         WHERE gimnasio_id = NEW.gimnasio_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER pagos_asignar_numero
  BEFORE INSERT ON public.pagos
  FOR EACH ROW EXECUTE FUNCTION public.asignar_numero_comprobante();
