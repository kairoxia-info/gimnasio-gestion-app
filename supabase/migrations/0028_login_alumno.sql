-- Pedido de Nalux (04/09/2026): "yo diria que si le pongamos loguin al
-- alumno, pero que el profesor se lo cree y el alumno pueda ingresar... el
-- login reemplaza al QR". El alumno deja de entrar con un link/QR con un
-- código secreto largo -- ahora entra con un usuario corto (lo elige el
-- profesor, no el alumno) y una contraseña, también puesta por el profesor.
--
-- codigo_acceso (migración 0006) NO se borra: sigue siendo la "sesión" que
-- ver_plan_por_codigo() ya sabe leer -- MiPlanPage.jsx no cambia nada de
-- cómo pide los datos. Lo que cambia es CÓMO se consigue ese código: antes
-- salía de un QR/link que el profesor imprimía o mandaba; ahora sale de
-- loguearse con usuario+contraseña (iniciar_sesion_alumno() de abajo
-- devuelve el codigo_acceso ya vigente, y el frontend lo guarda en
-- localStorage para no pedir el login de nuevo cada vez).
ALTER TABLE public.alumnos
  ADD COLUMN usuario TEXT,
  ADD COLUMN password_hash TEXT;

-- Único a nivel de TODA la base (no por gimnasio): un solo login público
-- para cualquier alumno de cualquier gimnasio, sin tener que elegir primero
-- a qué gimnasio pertenece -- mismo criterio de "sencillo y claro" pedido
-- para el lado del alumno. Case-insensitive (lower()) para que "Nadia1" y
-- "nadia1" sean el mismo usuario -- lo escribe un alumno de memoria en el
-- celular, no tiene que acordarse mayúsculas exactas. Parcial (WHERE
-- usuario IS NOT NULL) porque la mayoría de los alumnos van a arrancar sin
-- acceso creado todavía, y NULL no debe chocar contra NULL.
CREATE UNIQUE INDEX alumnos_usuario_unico_idx ON public.alumnos (lower(usuario))
  WHERE usuario IS NOT NULL;

-- Crea o cambia el usuario/contraseña de un alumno. La llama el profesor
-- logueado (SECURITY INVOKER, el default -- así el UPDATE de abajo sigue
-- pasando por la política RLS de "alumnos", que ya exige gimnasio_id =
-- get_mi_gimnasio_id(): un profesor no puede tocar el acceso del alumno de
-- otro gimnasio aunque adivine el id).
--
-- Regenera codigo_acceso de paso: si el profesor está CAMBIANDO una
-- contraseña (por ejemplo porque el alumno se la olvidó, o porque dejó de
-- venir y no quiere que siga entrando con la vieja), cualquier sesión ya
-- guardada en un celular con el código viejo deja de servir -- mismo
-- criterio que "Regenerar código" tenía antes con el QR.
CREATE OR REPLACE FUNCTION public.crear_acceso_alumno(
  p_alumno_id UUID,
  p_usuario TEXT,
  p_contrasena TEXT
)
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

GRANT EXECUTE ON FUNCTION public.crear_acceso_alumno(UUID, TEXT, TEXT) TO authenticated;

-- Le saca el acceso a un alumno (usuario/contraseña) sin tocar el resto de
-- su ficha -- por ejemplo si dejó de venir y no se quiere que siga
-- entrando a ver su rutina. Mismo criterio SECURITY INVOKER + RLS que
-- crear_acceso_alumno().
CREATE OR REPLACE FUNCTION public.quitar_acceso_alumno(p_alumno_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.alumnos
     SET usuario = NULL,
         password_hash = NULL,
         codigo_acceso = encode(extensions.gen_random_bytes(16), 'hex')
   WHERE id = p_alumno_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el alumno.';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.quitar_acceso_alumno(UUID) TO authenticated;

-- Login público del alumno (sin sesión, como ver_plan_por_codigo -- SECURITY
-- DEFINER a propósito, porque necesita buscar el usuario en TODOS los
-- gimnasios sin que el que llama tenga ninguna sesión todavía). Devuelve el
-- codigo_acceso vigente si el usuario/contraseña son correctos; el
-- frontend lo guarda y de ahí en más pide el plan con
-- ver_plan_por_codigo(), como ya hacía con el link del QR.
--
-- Mismo mensaje genérico exista o no ese usuario, y para usuario correcto
-- con contraseña mal puesta -- no hay que darle pistas a quien prueba
-- usuarios al azar de cuáles existen.
CREATE OR REPLACE FUNCTION public.iniciar_sesion_alumno(
  p_usuario TEXT,
  p_contrasena TEXT
)
RETURNS TEXT
SECURITY DEFINER
SET search_path TO 'public'
LANGUAGE plpgsql
AS $function$
DECLARE
  v_id UUID;
  v_hash TEXT;
  v_codigo TEXT;
  v_contador INTEGER;
BEGIN
  p_usuario := left(btrim(COALESCE(p_usuario, '')), 100);

  SELECT id, password_hash, codigo_acceso
    INTO v_id, v_hash, v_codigo
  FROM public.alumnos
  WHERE lower(usuario) = lower(p_usuario) AND activo = true;

  IF v_id IS NULL OR v_hash IS NULL THEN
    RAISE EXCEPTION 'Usuario o contraseña incorrectos';
  END IF;

  -- Mismo mecanismo de tope que ver_plan_por_codigo (5 minutos de ventana),
  -- pero más estricto (20, no 60): acá se está probando una contraseña, no
  -- solo leyendo un plan ya visto.
  UPDATE public.alumnos
    SET
      plan_consultas_contador = CASE
        WHEN plan_consultas_ventana_inicio IS NULL
          OR plan_consultas_ventana_inicio < now() - INTERVAL '5 minutes'
        THEN 1
        ELSE plan_consultas_contador + 1
      END,
      plan_consultas_ventana_inicio = CASE
        WHEN plan_consultas_ventana_inicio IS NULL
          OR plan_consultas_ventana_inicio < now() - INTERVAL '5 minutes'
        THEN now()
        ELSE plan_consultas_ventana_inicio
      END
    WHERE id = v_id
      AND (
        plan_consultas_ventana_inicio IS NULL
        OR plan_consultas_ventana_inicio < now() - INTERVAL '5 minutes'
        OR plan_consultas_contador < 20
      )
    RETURNING plan_consultas_contador INTO v_contador;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demasiados intentos. Probá de nuevo en unos minutos.';
  END IF;

  IF extensions.crypt(p_contrasena, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'Usuario o contraseña incorrectos';
  END IF;

  RETURN v_codigo;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.iniciar_sesion_alumno(TEXT, TEXT) TO anon, authenticated;
