-- Pedido de Nalux (07/09/2026): "por lo general los domingos el gym está
-- cerrado, pero el profe podría tener opción de ponerlo como activo o
-- inactivo". Se generaliza a los 7 días en vez de un booleano solo para el
-- domingo: hay gimnasios que también cierran sábados o algún día de semana,
-- y el costo de resolverlo bien ahora es el mismo.
--
-- Convención de números: la misma que devuelve Date.getDay() en JavaScript
-- (0 = domingo, 1 = lunes, ... 6 = sábado), así la pantalla de asistencia
-- puede comparar directo sin tablas de traducción de por medio.
--
-- Default lunes a sábado (sin domingo), que es lo que Nalux describió como
-- lo habitual. Los gimnasios que ya existen quedan igual: el ALTER les
-- aplica ese mismo default.
ALTER TABLE public.gimnasios
  ADD COLUMN dias_abiertos smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}';

-- Sin días válidos la grilla de asistencia no tendría sentido; el CHECK
-- evita que un bug del cliente deje un gimnasio "cerrado toda la semana" o
-- con números fuera de rango.
ALTER TABLE public.gimnasios
  ADD CONSTRAINT gimnasios_dias_abiertos_validos CHECK (
    array_length(dias_abiertos, 1) BETWEEN 1 AND 7
    AND dias_abiertos <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  );
