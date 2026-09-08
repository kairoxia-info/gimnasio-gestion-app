-- Bug critico encontrado el 08/09/2026: Nalux probo crear una cuenta de
-- profesor nueva ("Registrarse" en /login) y dio error al llegar al paso de
-- "Crear el gimnasio". La cuenta de Auth se creaba bien (confirmado en los
-- logs: /signup con status 200, perfil creado), pero create_gimnasio()
-- insertaba en public.gimnasios sin asignar codigo_invitacion -- columna
-- NOT NULL, sin ningun DEFAULT (migracion 0004). El INSERT fallaba siempre
-- con "null value in column codigo_invitacion... violates not-null
-- constraint", confirmado en los logs de Postgres. Esto rompia el alta de
-- CUALQUIER gimnasio nuevo, no solo el de esta usuaria -- probablemente
-- nadie habia registrado un gimnasio nuevo desde que se agrego esa columna.
--
-- Mismo patron que ya usa regenerar_codigo_invitacion() (migracion 0004):
-- un codigo hexadecimal de 32 caracteres (16 bytes al azar), con reintentos
-- si por casualidad ya existiera (la probabilidad es astronomicamente baja,
-- pero el UNIQUE constraint de la columna lo exige de todas formas).
CREATE OR REPLACE FUNCTION public.create_gimnasio(nombre_gimnasio text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  nueva_gimnasio_id UUID;
  nuevo_codigo TEXT;
  intentos INTEGER := 0;
BEGIN
  LOOP
    intentos := intentos + 1;
    nuevo_codigo := encode(extensions.gen_random_bytes(16), 'hex');

    BEGIN
      INSERT INTO public.gimnasios (nombre, codigo_invitacion)
        VALUES (nombre_gimnasio, nuevo_codigo)
        RETURNING id INTO nueva_gimnasio_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF intentos >= 10 THEN
        RAISE EXCEPTION 'No se pudo generar un código de invitación único, reintentar';
      END IF;
    END;
  END LOOP;

  UPDATE public.profiles
    SET gimnasio_id = nueva_gimnasio_id, role = 'admin'
    WHERE id = auth.uid();

  INSERT INTO public.configuracion_periodos (gimnasio_id, nombre, dias)
  VALUES
    (nueva_gimnasio_id, 'Clase suelta', 1),
    (nueva_gimnasio_id, 'Diario', 1),
    (nueva_gimnasio_id, 'Semanal', 7),
    (nueva_gimnasio_id, 'Mensual', 30),
    (nueva_gimnasio_id, 'Trimestral', 90),
    (nueva_gimnasio_id, 'Anual', 365);

  INSERT INTO public.configuracion_precios (gimnasio_id, nombre, precio, periodo, activo)
  VALUES
    (nueva_gimnasio_id, 'Mensual', 0, 'Mensual', true),
    (nueva_gimnasio_id, 'Trimestral', 0, 'Trimestral', true);

  RETURN nueva_gimnasio_id;
END;
$function$;
