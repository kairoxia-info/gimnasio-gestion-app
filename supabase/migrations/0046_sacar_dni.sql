-- 0046: el autorregistro deja de guardar el DNI.
--
-- Decision de Nalux (11/09/2026): "lo del dni entonces sacalo asi no hay
-- problemas con nada". El DNI no lo usaba NINGUNA funcion de la app -- ni el
-- comprobante de pago ni ningun calculo, solo se guardaba y se mostraba en la
-- ficha. O sea que se estaba juntando un numero de identidad de gente real,
-- incluidos menores, sin ningun motivo. Frente a la Ley 25.326 eso es todo
-- costo y cero beneficio: el dato que no se tiene no hay que cuidarlo, ni
-- justificar por que se pide, ni explicar si algun dia se filtra.
--
-- El campo se saco de las tres pantallas (autorregistro, alta del profesor y
-- ficha del alumno) y los dos DNI que estaban cargados se borraron.
--
-- La FIRMA de la funcion se deja intacta, con p_dni y todo. Sacar el parametro
-- romperia el autorregistro en produccion hasta que se despliegue el frontend
-- nuevo -- que es exactamente el error que se cometio esta misma mañana con
-- iniciar_sesion_alumno(). Asi el frontend viejo (que todavia manda el dato)
-- sigue funcionando, solo que el valor se descarta.
--
-- La columna alumnos.dni tampoco se borra: queda vacia, por si algun dia se
-- decide lo contrario. Borrar una columna es irreversible; vaciarla no.

CREATE OR REPLACE FUNCTION public.join_gimnasio_por_codigo(
    p_codigo TEXT,
    p_nombre TEXT,
    p_contacto TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_dni TEXT DEFAULT NULL,
    p_fecha_nacimiento DATE DEFAULT NULL,
    p_contacto_emergencia TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gimnasio_id UUID;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id INTO v_gimnasio_id
  FROM public.gimnasios
  WHERE codigo_invitacion = p_codigo AND autorregistro_activo = true;

  IF v_gimnasio_id IS NULL THEN
    RAISE EXCEPTION 'Código de invitación inválido';
  END IF;

  IF (
    SELECT count(*) FROM (
      SELECT 1 FROM public.alumnos
      WHERE gimnasio_id = v_gimnasio_id
        AND origen = 'autorregistro'
        AND created_at > now() - INTERVAL '5 minutes'
      LIMIT 50
    ) reciente
  ) >= 50 THEN
    RAISE EXCEPTION 'Demasiadas solicitudes de autorregistro en poco tiempo, probar de nuevo en unos minutos';
  END IF;

  IF p_nombre IS NULL OR btrim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;

  p_nombre              := left(btrim(p_nombre), 200);
  p_contacto            := left(p_contacto, 200);
  p_email               := left(p_email, 200);
  p_contacto_emergencia := left(p_contacto_emergencia, 200);

  -- p_dni se recibe y se DESCARTA a proposito (ver el comentario de arriba).

  INSERT INTO public.alumnos (
    gimnasio_id, nombre, contacto, email, fecha_nacimiento,
    contacto_emergencia, fecha_alta, activo, pendiente, origen
  ) VALUES (
    v_gimnasio_id,
    p_nombre,
    p_contacto,
    p_email,
    p_fecha_nacimiento,
    p_contacto_emergencia,
    CURRENT_DATE,
    false,
    true,
    'autorregistro'
  );
END;
$function$;

-- Los DNI que ya estaban cargados (2 al momento de esta migracion).
UPDATE public.alumnos SET dni = NULL WHERE dni IS NOT NULL;
