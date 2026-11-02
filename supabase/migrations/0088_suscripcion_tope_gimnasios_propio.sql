-- 0088 (02/11/2026): tope de gimnasios propio de una suscripción.
--
-- Pedido de Nalux: la cuenta gratis de noelialuduena160@gmail.com (plan Pro, cortesía) debe tener UN solo
-- gimnasio. El tope sale del plan, así que se agrega una columna opcional en la suscripción: si está vacía
-- vale el tope del plan (todas las cuentas siguen igual); si tiene un número, manda ese. Solo se carga en
-- la suscripción de esa cuenta.
--
-- La pantalla "Suscripción" sigue mostrando el tope del plan ("1 de 5 gimnasios") porque lee la lista de
-- planes; lo que se aplica es la regla de la base.

ALTER TABLE public.suscripciones
  ADD COLUMN IF NOT EXISTS max_gimnasios_propio integer CHECK (max_gimnasios_propio > 0);

COMMENT ON COLUMN public.suscripciones.max_gimnasios_propio IS
  'Excepción: tope de gimnasios de esta suscripción en lugar del del plan. NULL = el del plan.';

CREATE OR REPLACE FUNCTION public.suscripcion_validar_gimnasios()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_max      integer;
  v_nombre   text;
  v_cantidad integer;
BEGIN
  SELECT COALESCE(s.max_gimnasios_propio, p.max_gimnasios), p.nombre INTO v_max, v_nombre
    FROM public.suscripciones s JOIN public.planes_suscripcion p ON p.clave = s.plan
   WHERE s.organizacion_id = NEW.organizacion_id;
  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_cantidad FROM public.gimnasios g WHERE g.organizacion_id = NEW.organizacion_id;
  IF v_cantidad >= v_max THEN
    RAISE EXCEPTION 'LIMITE_GIMNASIOS: El plan % permite hasta % %. Pasa a un plan mayor o escríbenos para sumar más.',
      v_nombre, v_max, CASE WHEN v_max = 1 THEN 'gimnasio' ELSE 'gimnasios' END;
  END IF;
  RETURN NEW;
END;
$$;

-- Cuenta gratis de Noelia: un solo gimnasio.
UPDATE public.suscripciones s
   SET max_gimnasios_propio = 1
  FROM public.gimnasios g
  JOIN public.profiles p ON p.gimnasio_id = g.id
  JOIN auth.users u ON u.id = p.id
 WHERE s.organizacion_id = g.organizacion_id
   AND lower(u.email) = 'noelialuduena160@gmail.com';
