-- Investigación de la sección Precios (03/09/2026) — dos correcciones reales
-- encontradas, no pedidas explícitamente pero confirmadas como bugs:
--
-- 1) create_gimnasio() siembra dos planes de ejemplo ("Mensual"/"Trimestral")
--    con periodo en MINÚSCULA ('mensual'/'trimestral'). Desde la migración
--    0014 (períodos configurables), el período de un plan se elige de una
--    lista real (configuracion_periodos.nombre, sembrada en MAYÚSCULA:
--    "Mensual", "Trimestral", etc.) — un plan con periodo en minúscula no
--    matchea ningún período real: el <select> de "Editar plan" lo muestra
--    sin nada elegido, y aplicarPlan() (Pagos) no encuentra sus días y cae
--    al piso de 30 días sin avisar. Se corrige la siembra para plantar
--    nuevos gimnasios ya bien desde el alta.
--
-- 2) Los dos planes de ejemplo de ESTE gimnasio (Mi GYM FIT) tenían el mismo
--    problema, heredado de antes de la migración 0014. Se corrigen acá
--    también los datos reales -- no solo el molde para gimnasios futuros.

UPDATE public.configuracion_precios
   SET periodo = 'Mensual'
 WHERE periodo = 'mensual';

UPDATE public.configuracion_precios
   SET periodo = 'Trimestral'
 WHERE periodo = 'trimestral';

CREATE OR REPLACE FUNCTION public.create_gimnasio(
  nombre_gimnasio TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nueva_gimnasio_id UUID;
BEGIN
  INSERT INTO public.gimnasios (nombre) VALUES (nombre_gimnasio)
    RETURNING id INTO nueva_gimnasio_id;

  UPDATE public.profiles
    SET gimnasio_id = nueva_gimnasio_id, role = 'admin'
    WHERE id = auth.uid();

  -- Períodos base (mismo set que ya siembra la pantalla de Precios cuando
  -- un gimnasio no tiene ninguno cargado — ver PreciosPage.jsx,
  -- PERIODOS_SUGERIDOS). Se siembran ACÁ también para que los dos planes de
  -- ejemplo de abajo tengan, desde el primer segundo, un período real al
  -- que apuntar -- no un nombre suelto que no matchea nada.
  INSERT INTO public.configuracion_periodos (gimnasio_id, nombre, dias)
  VALUES
    (nueva_gimnasio_id, 'Clase suelta', 1),
    (nueva_gimnasio_id, 'Diario', 1),
    (nueva_gimnasio_id, 'Semanal', 7),
    (nueva_gimnasio_id, 'Mensual', 30),
    (nueva_gimnasio_id, 'Trimestral', 90),
    (nueva_gimnasio_id, 'Anual', 365);

  -- Siembra de planes de ejemplo. periodo en MAYÚSCULA a propósito: tiene
  -- que coincidir EXACTO con configuracion_periodos.nombre (arriba), porque
  -- el match es por nombre de texto, no por id.
  --
  -- Sin ON CONFLICT hoy porque el único UNIQUE de la tabla es
  -- (gimnasio_id, nombre) y nueva_gimnasio_id recién se creó en esta misma
  -- transacción, así que no puede haber choque.
  INSERT INTO public.configuracion_precios (gimnasio_id, nombre, precio, periodo, activo)
  VALUES
    (nueva_gimnasio_id, 'Mensual', 0, 'Mensual', true),
    (nueva_gimnasio_id, 'Trimestral', 0, 'Trimestral', true);

  RETURN nueva_gimnasio_id;
END;
$$;
