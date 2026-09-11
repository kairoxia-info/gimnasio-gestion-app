-- 0043: un usuario ya no puede cambiarse a si mismo el rol ni el gimnasio.
--
-- AGUJERO MAS GRAVE ENCONTRADO EN EL REPASO DE SEGURIDAD (11/09/2026).
-- Verificado contra la base de produccion, no es teorico.
--
-- La policy profiles_update_self (0001) deja hacer UPDATE de la PROPIA fila:
--     USING (id = auth.uid()) WITH CHECK (id = auth.uid())
-- y el GRANT de 0002 daba UPDATE sobre la TABLA ENTERA:
--     GRANT SELECT, UPDATE ON public.profiles TO authenticated;
-- RLS filtra FILAS, no COLUMNAS. Asi que cualquier usuario logueado podia
-- escribir sus propias columnas `role` y `gimnasio_id` desde la consola del
-- navegador, con una linea:
--     supabase.from('profiles').update({ gimnasio_id: OTRO }).eq('id', yo)
--
-- Y como TODAS las policies de las tablas de negocio dicen
--     gimnasio_id = get_mi_gimnasio_id()
-- y get_mi_gimnasio_id() es literalmente
--     SELECT gimnasio_id FROM profiles WHERE id = auth.uid()
-- ponerse el gimnasio_id de otro daba acceso completo de lectura Y escritura
-- a los datos de ese otro gimnasio: alumnos, DNI, telefonos, pagos, medidas
-- corporales. Fuga total entre clientes del SaaS.
-- Con role='admin' ademas se habilitaba eliminar_mi_cuenta(), que borra el
-- gimnasio entero en cascada.
--
-- Postgres evalua los privilegios de COLUMNA antes que RLS, asi que quitando
-- el GRANT sobre esas dos columnas el UPDATE falla con "permission denied for
-- column" sin siquiera llegar a la policy.
--
-- No rompe nada: el cliente (AuthContext.jsx) solo hace SELECT de profiles,
-- nunca UPDATE.

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (first_name, last_name, email) ON public.profiles TO authenticated;

-- Segunda barrera, por si en el futuro alguien vuelve a dar UPDATE sobre la
-- tabla entera sin acordarse de esto.
--
-- OJO con el `current_user`: create_gimnasio() SI tiene que poder escribir
-- esas dos columnas (hace SET gimnasio_id = <nuevo>, role = 'admin' al crear
-- el gimnasio, que es como se da de alta CADA cuenta nueva). Esa funcion es
-- SECURITY DEFINER, o sea que adentro corre como el dueño de la funcion, no
-- como `authenticated`. Por eso el congelamiento se aplica solo cuando el
-- UPDATE viene directo del cliente (roles `authenticated` / `anon`), que es
-- justamente el camino que hay que cerrar. Sin esta distincion, el trigger
-- revertiria en silencio el alta y ningun gimnasio nuevo podria crearse.
CREATE OR REPLACE FUNCTION public.profiles_congelar_rol_y_gimnasio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.role := OLD.role;
    NEW.gimnasio_id := OLD.gimnasio_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.profiles_congelar_rol_y_gimnasio() FROM PUBLIC;

DROP TRIGGER IF EXISTS profiles_congelar_rol_y_gimnasio_trg ON public.profiles;
CREATE TRIGGER profiles_congelar_rol_y_gimnasio_trg
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.profiles_congelar_rol_y_gimnasio();
