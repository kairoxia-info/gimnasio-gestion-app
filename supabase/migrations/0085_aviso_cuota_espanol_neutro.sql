-- Español neutro en el aviso automático de cuota (29/10/2026, pedido de Nalux: la app no usa voseo).
-- La plantilla original (0015) decía "Pasá por {gimnasio}". Se cambia el valor por defecto y SOLO las
-- filas que todavía tienen el texto original exacto: si un profesor ya lo personalizó, no se toca.
ALTER TABLE public.gimnasios
  ALTER COLUMN aviso_cuota_mensaje SET DEFAULT
    'Hola {nombre}, tu cuota del plan {plan} vence el {vence}. Pasa por {gimnasio} para renovarla y seguir entrenando.';

UPDATE public.gimnasios
   SET aviso_cuota_mensaje =
       'Hola {nombre}, tu cuota del plan {plan} vence el {vence}. Pasa por {gimnasio} para renovarla y seguir entrenando.'
 WHERE aviso_cuota_mensaje =
       'Hola {nombre}, tu cuota del plan {plan} vence el {vence}. Pasá por {gimnasio} para renovarla y seguir entrenando.';
