-- Pedido de Nalux (09/09/2026): "hay que exigir... que al menos tenga una
-- mayúscula cuando cree el login de los alumnos". Se validó del lado del
-- cliente (AlumnoPage.jsx) para el aviso inmediato, y también acá: esta
-- función es llamable por RPC directo por cualquier profesor autenticado
-- (RLS de "alumnos" ya la limita a su propio gimnasio, igual que cualquier
-- UPDATE normal -- no es SECURITY DEFINER), sin pasar necesariamente por el
-- formulario -- la validación del cliente sola no alcanza como única barrera.
CREATE OR REPLACE FUNCTION public.crear_acceso_alumno(p_alumno_id uuid, p_usuario text, p_contrasena text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  p_usuario := btrim(COALESCE(p_usuario, ''));

  IF length(p_usuario) < 3 THEN
    RAISE EXCEPTION 'El usuario tiene que tener al menos 3 caracteres.';
  END IF;

  IF length(COALESCE(p_contrasena, '')) < 4 THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos 4 caracteres.';
  END IF;

  IF p_contrasena !~ '[A-Z]' THEN
    RAISE EXCEPTION 'La contraseña tiene que tener al menos una letra mayúscula.';
  END IF;

  UPDATE public.alumnos
     SET usuario = p_usuario,
         password_hash = extensions.crypt(p_contrasena, extensions.gen_salt('bf')),
         codigo_acceso = encode(extensions.gen_random_bytes(16), 'hex')
   WHERE id = p_alumno_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el alumno.';
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Ese usuario ya lo tiene otro alumno -- probá con otro.';
END;
$function$;
