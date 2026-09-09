-- Pedido de Nalux (09/09/2026): "el profesor se tiene que encargar de
-- registrarlos" -- el autorregistro por link/QR (migración 0004) es una
-- opción que el profesor puede prender si quiere, no el comportamiento
-- esperado por default. autorregistro_activo tenía DEFAULT true desde
-- 0004: cualquier gimnasio nuevo nacía con el autorregistro prendido sin
-- que nadie lo hubiera elegido -- recién ahora existe la pantalla
-- (ConfiguracionPage.jsx) donde un profesor puede prenderlo a propósito.
ALTER TABLE public.gimnasios
  ALTER COLUMN autorregistro_activo SET DEFAULT false;

-- Los gimnasios existentes todavía tienen autorregistro_activo = true
-- heredado del DEFAULT viejo -- ningún profesor lo eligió a propósito
-- (la pantalla no existía hasta hoy). Se apaga para que arranquen igual
-- que arrancaría uno nuevo de acá en adelante; cualquiera lo puede
-- prender de nuevo desde Configuración si lo quiere.
UPDATE public.gimnasios SET autorregistro_activo = false WHERE autorregistro_activo = true;
