-- 0060: tour de bienvenida que se muestra UNA sola vez a cada profesor.
--
-- Pedido de Nalux (16/09/2026): que al entrar por primera vez al panel, al
-- profesor le aparezca una demo guiada (cajitas explicando cada seccion de
-- la app) y que despues no se le vuelva a mostrar nunca mas -- queda solo el
-- icono "i" de ayuda de cada pantalla. Hoy no existe ningun registro de
-- "primera vez en el panel": el unico gate que hay es gimnasio_id IS NULL
-- (onboarding), y ese ya se usa para otra cosa.
--
-- El flag va en profiles (por CUENTA), no en gimnasios: dos profesores del
-- mismo gimnasio tienen que ver la demo cada uno por su lado, la primera
-- vez que entra cada uno. Confirmado con Nalux antes de escribir esto.

ALTER TABLE public.profiles
  ADD COLUMN tour_visto BOOLEAN NOT NULL DEFAULT false;

-- Las cuentas que YA existen quedan marcadas como "ya visto" en esta misma
-- migracion. Sin esto, la proxima vez que Nalux (o cualquier profesor que ya
-- viene usando la app) entre al panel, le apareceria la demo de golpe. El
-- DEFAULT false solo alcanza a las filas que se creen DE ACA EN ADELANTE:
-- handle_new_user() (0001) inserta sin especificar la columna, asi que las
-- cuentas nuevas heredan el false solas.
UPDATE public.profiles SET tour_visto = true;

-- SECURITY DEFINER a proposito: la migracion 0043 hizo
--     REVOKE UPDATE ON profiles FROM authenticated
-- y solo re-otorgo UPDATE sobre (first_name, last_name, email). Un
--     supabase.from('profiles').update({ tour_visto: true })
-- directo desde el cliente fallaria con "permission denied for column"
-- antes de llegar a ninguna policy. En vez de agrandar ese GRANT de columnas
-- (y tener que volver a razonar sobre privilegios cada vez), se sigue el
-- mismo patron que create_gimnasio() y eliminar_mi_cuenta(): una funcion que
-- corre como su dueño y toca SOLO la propia fila (auth.uid()).
--
-- El trigger profiles_congelar_rol_y_gimnasio_trg (0043) no interfiere: solo
-- pisa role y gimnasio_id, y ademas se saltea cuando current_user no es
-- authenticated/anon, que es el caso de adentro de esta funcion.
--
-- No hay funcion inversa a proposito: una vez visto, es para siempre.
CREATE OR REPLACE FUNCTION public.marcar_tour_visto()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;

  UPDATE public.profiles SET tour_visto = true WHERE id = auth.uid();
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_tour_visto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_tour_visto() TO authenticated;
