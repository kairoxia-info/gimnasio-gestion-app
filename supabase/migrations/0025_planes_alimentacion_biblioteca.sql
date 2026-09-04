-- Biblioteca de "planes de alimentación" reutilizables, pedido de Nalux
-- (04/09/2026): "me he dado cuenta que no hay un modulo para armar comidas,
-- asi como rutinas de ejercicios" -- armar una vez, combinando alimentos de
-- la biblioteca con su cantidad, y reusarlo después al armar el plan de
-- cualquier alumno (en vez de tipear la misma comida de nuevo cada vez).
--
-- Nombre de la tabla NO puede ser `planes_alimentacion`: esa ya existe y es
-- el plan REAL asignado a un alumno puntual (1-a-1, alumno_id NOT NULL,
-- migración 0001). Esta es la versión reutilizable, sin dueño -- el mismo
-- rol que `rutinas` (plantilla) cumple para `rutinas_asignadas`, aunque acá
-- no hace falta una tabla de asignación separada: lo que se reusa no es el
-- plan completo, es cada renglón (comida) dentro del plan de un alumno --
-- ver AlumnoPage.jsx (PlanAlimentacion, agregarOpcion) para cómo se
-- consume: elegir de esta biblioteca solo arma el texto de una opción,
-- nunca queda una referencia en vivo a esta fila.
--
-- items: JSONB, un array de { alimentoId, nombre, cantidad } -- nombre
-- queda copiado (no solo el id) para que si el alimento se edita o se
-- borra de la biblioteca, este plan siga mostrando lo que decía cuando se
-- armó (mismo criterio que rutinas.items con nombre + ejercicioId).
CREATE TABLE public.planes_alimentacion_biblioteca (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_planes_alimentacion_biblioteca_gimnasio_id
  ON public.planes_alimentacion_biblioteca (gimnasio_id);

ALTER TABLE public.planes_alimentacion_biblioteca ENABLE ROW LEVEL SECURITY;
CREATE POLICY "planes_alimentacion_biblioteca_tenant_isolation" ON public.planes_alimentacion_biblioteca
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

-- Mismo criterio de GRANT que 0002_grant_authenticated_privileges.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planes_alimentacion_biblioteca TO authenticated;
REVOKE ALL ON public.planes_alimentacion_biblioteca FROM anon;
