-- 0048: notas privadas del profesor sobre un alumno (Fase 2.1, 13/09/2026).
--
-- A diferencia de observaciones_salud (que se muestra en la ficha con
-- fondo destacado, dato del alumno) esto es del profesor para el profesor:
-- contexto, recordatorios, preferencias. NUNCA lo ve el alumno.
--
-- No hace falta tocar ver_plan_por_codigo() para que quede privado: esa
-- función ya trabaja con una lista blanca explícita de columnas (ver
-- migración 0041), así que con no agregar notas_internas ahí alcanza.

ALTER TABLE public.alumnos
    ADD COLUMN IF NOT EXISTS notas_internas TEXT;
