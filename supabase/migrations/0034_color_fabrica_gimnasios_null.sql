-- Bug encontrado el 08/09/2026, reportado por Nalux con captura ("mira esta
-- en rojo todo"): un gimnasio recién creado ("Full GYM", de la prueba de
-- registro que reveló el bug de la migración 0033) mostraba TODO en rojo en
-- vez del dorado nuevo de fábrica (index.css, cambiado hoy más temprano).
--
-- Causa: la columna gimnasios.color_principal tenía DEFAULT '#E10600' (el
-- rojo viejo de Kairox, de antes del cambio a dorado). Como create_gimnasio()
-- nunca especifica color_principal al insertar, cualquier gimnasio nuevo
-- recibía ese rojo EXPLÍCITO en la fila -- no NULL -- así que
-- aplicarColorGimnasio() (lib/colorTema.js) lo tomaba como "el profesor
-- eligió este color" y lo aplicaba, pisando el dorado de fábrica del CSS
-- (que solo se ve cuando color_principal es NULL/vacío).
--
-- Se saca el DEFAULT (queda NULL hasta que el profesor elija uno en
-- Configuración) y se corrige el único gimnasio ya afectado.
ALTER TABLE public.gimnasios
  ALTER COLUMN color_principal DROP DEFAULT;

UPDATE public.gimnasios
  SET color_principal = NULL
  WHERE color_principal = '#E10600';
