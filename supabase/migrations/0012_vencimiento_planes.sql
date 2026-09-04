-- Nalux pidió poder poner fecha de inicio Y fecha de fin al asignarle un
-- plan (rutina o dieta) a un alumno, para que el dashboard avise cuando se
-- le esté por vencer o ya se le venció -- mismo concepto que ya existe para
-- cuotas, aplicado ahora a los planes.
--
-- rutinas_asignadas.fecha_inicio ya existía (0001); se agrega fecha_fin.
-- planes_alimentacion no tenía ninguna de las dos, se agregan ambas.
--
-- Todo nullable a propósito: un plan sin fecha de fin cargada (el caso de
-- todo lo que ya existe hoy) simplemente no entra en el cálculo de
-- vencimiento -- no se puede convertir en "vencido" un plan al que nunca se
-- le puso fecha, eso rompería silenciosamente la pantalla de cualquiera que
-- ya tenga una rutina o dieta asignada.

ALTER TABLE public.rutinas_asignadas
  ADD COLUMN fecha_fin DATE;

ALTER TABLE public.planes_alimentacion
  ADD COLUMN fecha_inicio DATE,
  ADD COLUMN fecha_fin DATE;
