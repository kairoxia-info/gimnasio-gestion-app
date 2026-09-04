-- Seguimiento físico: medidas de pierna y cadera, pedido de Nalux
-- (04/09/2026): "agrega tambien el tamaño de pierna... investiga bien esa
-- parte que tienen los gimnacios para el seguimiento".
--
-- Investigado: el set estándar de circunferencias que usan los gimnasios
-- para seguimiento de progreso es cintura, cadera, pecho, brazo y muslo
-- (medidos siempre en el mismo punto y momento del día). `progreso` ya
-- tenía cintura/pecho/brazo -- acá se agregan las dos que faltaban: pierna
-- (lo que pidió explícitamente) y cadera (el complemento estándar de
-- cintura en toda la bibliografía, para relación cintura-cadera).
--
-- Mismo patrón que 0009_alumnos_datos_extra.sql: ALTER TABLE simple, ambas
-- nullable -- un registro de progreso viejo (sin estas dos medidas) sigue
-- siendo válido tal cual, no hace falta migrar nada retroactivamente.
ALTER TABLE public.progreso
  ADD COLUMN pierna NUMERIC,
  ADD COLUMN cadera NUMERIC;
