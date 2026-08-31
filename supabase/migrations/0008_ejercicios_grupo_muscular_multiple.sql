-- Pedido de Nalux: un ejercicio puede trabajar más de un grupo muscular (ej.
-- "Peso muerto" es Piernas + Espalda), pero grupo_muscular era un TEXT de un
-- solo valor. Se convierte a TEXT[] preservando los datos existentes: cada
-- valor actual pasa a ser un array de un elemento, NULL/vacío pasa a array
-- vacío.
--
-- Sin impacto en RLS ni en ninguna función: grep confirmado contra las 7
-- migraciones previas — la columna no aparece en ninguna policy ni en
-- ver_plan_por_codigo() (esa función lee rutinas.items, que ya guarda una
-- copia del nombre del grupo tomada al armar la rutina, no un join en vivo
-- contra ejercicios). Los GRANT de tabla tampoco cambian con un ALTER
-- COLUMN TYPE.

ALTER TABLE public.ejercicios
  ALTER COLUMN grupo_muscular TYPE TEXT[]
  USING CASE
    WHEN grupo_muscular IS NULL OR btrim(grupo_muscular) = '' THEN ARRAY[]::TEXT[]
    ELSE ARRAY[grupo_muscular]
  END;
