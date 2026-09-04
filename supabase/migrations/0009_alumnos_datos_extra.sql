-- Pedido de Nalux tras investigar la ficha de alumnos: 3 campos nuevos,
-- todos opcionales (nadie los carga si no quiere, no bloquean el alta).
-- fecha_nacimiento NO se toca acá: ya existe desde la migración 0001, solo
-- le faltaba el frontend (formulario + aviso de cumpleaños en el dashboard).
--
-- Sin índices ni UNIQUE en dni a propósito: es un dato de referencia, no la
-- fuente de verdad de identidad del alumno (eso lo sigue siendo el nombre +
-- el propio criterio del profesor) — no hay necesidad de bloquear un alta
-- por un DNI repetido o vacío.

ALTER TABLE public.alumnos
  ADD COLUMN dni TEXT,
  ADD COLUMN contacto_emergencia TEXT,
  ADD COLUMN objetivo TEXT;
