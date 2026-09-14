-- ============================================================================
-- 0054_alimentos_biblioteca_global.sql
--
-- Pedido de Nalux (14/09/2026): "el tema de alimentos, podríamos... hacer
-- como hicimos en rutinas [ejercicios], tener ya agregado lo más básico, no
-- más de 200 alimentos... que no se puedan borrar ya que todos los que se
-- logueen van a tener esa biblioteca en su base... no quiero que en cada
-- base de un profe se copien los alimentos, quiero que ya de una sola vez
-- estén en todos los login que se creen, que tengan la opción de ver o
-- ocultar y eso de ver o ocultar lo podamos poner para los ejercicios".
--
-- Mismo patrón exacto que ya existe para `ejercicios` (migración
-- 0019_ejercicios_biblioteca_global.sql): un alimento "de la biblioteca" se
-- modela con gimnasio_id = NULL (de nadie, visible para todos). RLS separa
-- SELECT (propio del gimnasio O global) de escritura (INSERT/UPDATE/DELETE
-- siguen exigiendo gimnasio_id = get_mi_gimnasio_id(), así que un global con
-- gimnasio_id NULL nunca puede editarse/borrarse desde el panel -- ni con
-- una consulta manual armada a mano). Los alimentos propios de cada
-- gimnasio (los que ya tenía cargados, y los nuevos que carguen) siguen
-- funcionando exactamente igual que antes.
--
-- "Ver u ocultar" se resuelve con UNA tabla nueva compartida entre
-- ejercicios Y alimentos (`biblioteca_ocultos`) en vez de duplicar la misma
-- idea dos veces: una fila ahí dice "este gimnasio no quiere ver este ítem
-- global". No se borra el ítem (sigue existiendo para todos los demás
-- gimnasios), cada gimnasio arma su propia lista de qué tiene tapado. Sirve
-- para las dos bibliotecas porque el modelo es idéntico: gimnasio_id NULL +
-- "esconder por gimnasio" sin tocar la fila compartida.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 — alimentos: mismo cambio que 0019 le hizo a ejercicios.
-- ----------------------------------------------------------------------------
ALTER TABLE public.alimentos ALTER COLUMN gimnasio_id DROP NOT NULL;

ALTER TABLE public.alimentos
  ADD COLUMN origen TEXT NOT NULL DEFAULT 'propio' CHECK (origen IN ('propio', 'global'));

DROP POLICY IF EXISTS "alimentos_tenant_isolation" ON public.alimentos;

CREATE POLICY alimentos_select ON public.alimentos
  FOR SELECT
  USING (gimnasio_id = public.get_mi_gimnasio_id() OR gimnasio_id IS NULL);

CREATE POLICY alimentos_insert ON public.alimentos
  FOR INSERT
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

CREATE POLICY alimentos_update ON public.alimentos
  FOR UPDATE
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

CREATE POLICY alimentos_delete ON public.alimentos
  FOR DELETE
  USING (gimnasio_id = public.get_mi_gimnasio_id());

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 — biblioteca_ocultos: "este gimnasio ocultó este ítem global",
-- compartida entre ejercicios y alimentos (columna `tabla` distingue cuál).
-- No tiene FK hacia ejercicios/alimentos (una sola columna item_id no puede
-- referenciar dos tablas distintas a la vez) -- si el ítem global algún día
-- se borrara (no debería, están protegidos por RLS, pero por las dudas),
-- la fila de acá queda huérfana e inofensiva: simplemente nunca vuelve a
-- coincidir con nada.
-- ----------------------------------------------------------------------------
CREATE TABLE public.biblioteca_ocultos (
  gimnasio_id UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  tabla       TEXT NOT NULL CHECK (tabla IN ('ejercicios', 'alimentos')),
  item_id     UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (gimnasio_id, tabla, item_id)
);

ALTER TABLE public.biblioteca_ocultos ENABLE ROW LEVEL SECURITY;

CREATE POLICY biblioteca_ocultos_tenant_isolation ON public.biblioteca_ocultos
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

GRANT SELECT, INSERT, DELETE ON public.biblioteca_ocultos TO authenticated;
REVOKE ALL ON public.biblioteca_ocultos FROM anon;

-- ----------------------------------------------------------------------------
-- SECCIÓN 3 — Semilla: solo 4 alimentos de EJEMPLO, no una biblioteca
-- completa.
--
-- Decisión de Nalux, el mismo día, después de ver la primera versión de
-- esta migración (que traía ~150 alimentos precargados): "a los alimentos
-- deja solo 3 de ejemplo los más usados... para que vean que son de
-- ejemplo. Después cada profe agrega el que quiere." A diferencia de
-- `ejercicios` (donde SÍ tiene sentido una biblioteca grande y curada, son
-- 500 movimientos estándar que no cambian de gimnasio a gimnasio), la
-- nutrición varía mucho más por región/tipo de dieta -- Nalux prefiere que
-- cada profesor arme la suya, con estos 4 solo como muestra de qué campos
-- completar y de que la biblioteca compartida existe.
--
-- Quedan: Banana, Arroz blanco, Café y Galletas de arroz -- uno de cada
-- tipo de comida típica (fruta, carbohidrato con cocción, bebida, snack
-- envasado), para que se entienda el patrón de un vistazo.
-- ----------------------------------------------------------------------------
INSERT INTO public.alimentos (gimnasio_id, origen, nombre, categoria, unidad, calorias, proteinas, carbohidratos, grasas) VALUES
(NULL, 'global', 'Banana', 'Frutas', '1 unidad (120 g)', 107, 1.3, 27, 0.4),
(NULL, 'global', 'Arroz blanco (cocido)', 'Carbohidratos', '100 g', 130, 2.7, 28, 0.3),
(NULL, 'global', 'Café (sin azúcar)', 'Otros', '1 taza (240 ml)', 2, 0.3, 0, 0),
(NULL, 'global', 'Galletas de arroz', 'Carbohidratos', '1 unidad (9 g)', 35, 0.7, 7.3, 0.3);

-- ============================================================================
-- Fin de la migración 0054.
-- ============================================================================
