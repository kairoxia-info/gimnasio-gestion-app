-- Descuentos con nombre, pedido por Nalux (03/09/2026) al investigar Precios:
-- en vez de un solo % suelto por plan, una lista de descuentos con nombre
-- ("Estudiante -10%", "Promo verano -20%") para elegir al cobrar. Mismo
-- patrón que configuracion_periodos (migración 0014): tabla propia,
-- editable/borrable desde Precios, RLS + GRANT.
--
-- No reemplaza a configuracion_precios.descuento (el % por defecto de cada
-- plan) -- son dos cosas distintas: el descuento del plan es la política de
-- ese plan; un descuento con nombre es algo que se aplica puntualmente al
-- cobrar (elegirlo en Pagos pisa el % que traía el plan, igual que ya pasa
-- hoy si el profesor edita el campo a mano).

CREATE TABLE public.configuracion_descuentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gimnasio_id UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    porcentaje NUMERIC NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX configuracion_descuentos_gimnasio ON public.configuracion_descuentos (gimnasio_id);

ALTER TABLE public.configuracion_descuentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY configuracion_descuentos_tenant_isolation
    ON public.configuracion_descuentos
    FOR ALL
    USING (gimnasio_id = get_mi_gimnasio_id())
    WITH CHECK (gimnasio_id = get_mi_gimnasio_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracion_descuentos TO authenticated;
