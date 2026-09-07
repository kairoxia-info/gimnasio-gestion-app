-- Reportado por Nalux (07/09/2026): "muchos comprobantes sin cobrar, está
-- mal eso, el comprobante saldría cuando el alumno ya paga".
--
-- Tenía razón: hasta ahora TODA fila de pagos se llevaba un número de
-- comprobante, incluidas las "activaciones sin cobrar" (monto 0, que existen
-- para habilitarle el período a alguien que todavía debe). Resultado: la
-- lista de comprobantes emitidos se llenaba de comprobantes por $ 0 -- algo
-- que como comprobante no significa nada, porque no hubo cobro.
--
-- Desde acá el número se asigna SOLO si entró plata (monto > 0). Una
-- activación sin cobrar queda igual como fila (sigue cubriendo el período y
-- registrando la deuda), pero con numero NULL: no es un comprobante, porque
-- no hubo nada que comprobar. El día que el alumno pague se carga el cobro
-- de verdad y ESE sí sale numerado.
--
-- Los pagos parciales (cobró algo pero quedó debiendo el resto) sí llevan
-- número: hubo un cobro real que el alumno tiene derecho a que le conste.
--
-- La numeración no se rompe ni deja huecos: sigue siendo MAX(numero)+1 por
-- gimnasio, calculado recién cuando hace falta, así que las filas sin número
-- simplemente no participan.
CREATE OR REPLACE FUNCTION public.asignar_numero_comprobante()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.numero IS NULL AND COALESCE(NEW.monto, 0) > 0 THEN
        PERFORM 1 FROM public.gimnasios WHERE id = NEW.gimnasio_id FOR UPDATE;

        SELECT COALESCE(MAX(numero), 0) + 1
          INTO NEW.numero
          FROM public.pagos
         WHERE gimnasio_id = NEW.gimnasio_id;
    END IF;
    RETURN NEW;
END;
$function$;
