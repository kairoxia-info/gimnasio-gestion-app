-- Nalux pidió (02/09/2026) poder configurar ella misma los períodos de los
-- planes -- "el semanal, mensual, anual, trimestral, la clase osea una clase,
-- y asi que configure todo (...) que tenga opcion de editarlo borrarlo cuando
-- quiera". Hasta ahora la lista estaba hardcodeada en ConfiguracionPage.jsx
-- (PERIODOS = ['Diario','Semanal','Mensual','Trimestral','Anual']), así que no
-- había forma de agregar "Clase suelta" ni de sacar los que no usa.
--
-- La duración se guarda en DÍAS y no en "meses": es lo que le permite crear
-- cualquier cosa (un plan de 10 días, un pase de 45) sin que el sistema tenga
-- que interpretar nombres. El período de un pago se calcula sumando esos días
-- a la fecha de inicio.

CREATE TABLE public.configuracion_periodos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gimnasio_id UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    dias INTEGER NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX configuracion_periodos_gimnasio ON public.configuracion_periodos (gimnasio_id);

-- Mismo aislamiento por tenant que el resto de las tablas de negocio.
ALTER TABLE public.configuracion_periodos ENABLE ROW LEVEL SECURITY;

CREATE POLICY configuracion_periodos_tenant_isolation
    ON public.configuracion_periodos
    FOR ALL
    USING (gimnasio_id = get_mi_gimnasio_id())
    WITH CHECK (gimnasio_id = get_mi_gimnasio_id());

-- La RLS sola no alcanza: sin GRANT, PostgREST devuelve 401/403 aunque la
-- policy permita la fila. Mismos privilegios que configuracion_precios.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracion_periodos TO authenticated;

-- Se siembran los períodos que hasta hoy estaban fijos en el código, para que
-- los planes que ya existen sigan teniendo su período disponible en la lista.
-- "Clase suelta" se agrega porque es el caso que Nalux nombró explícitamente.
INSERT INTO public.configuracion_periodos (gimnasio_id, nombre, dias)
SELECT g.id, p.nombre, p.dias
  FROM public.gimnasios g
 CROSS JOIN (VALUES
     ('Clase suelta', 1),
     ('Diario', 1),
     ('Semanal', 7),
     ('Mensual', 30),
     ('Trimestral', 90),
     ('Anual', 365)
 ) AS p(nombre, dias);
