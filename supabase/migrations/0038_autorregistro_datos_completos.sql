-- ============================================================================
-- 0038_autorregistro_datos_completos.sql
--
-- Pedido de Nalux (09/09/2026), después de definir bien el alcance: que el
-- alumno pueda anotarse solo con el link/QR que le pasa el profesor, pero
-- cargando SOLO sus datos personales -- "al resto lo carga después el
-- profesor si lo da de alta".
--
-- Campos que ahora puede completar el alumno: nombre y apellido (van juntos
-- a alumnos.nombre), DNI, correo, fecha de nacimiento, teléfono y contacto
-- de emergencia. La edad NO es un campo: se calcula sola desde la fecha de
-- nacimiento (guardar las dos invita a que se contradigan). La foto tampoco:
-- subir archivos sin sesión exigiría abrir una puerta de escritura pública
-- al Storage, y se decidió que la sube el profesor después desde la ficha.
--
-- Se saca el plan (p_plan_precio_nombre): lo asigna el profesor al dar de
-- alta, junto con el resto.
--
-- Cubre además DOS arreglos:
--   1. pendiente = true en el INSERT. estadoAlumno() (lib/format.js) lee
--      "activo ? activo : pendiente ? pendiente : inactivo" -- como
--      join_gimnasio_por_codigo() nunca seteaba `pendiente` (DEFAULT false),
--      un alumno autorregistrado caía en "Inactivo", igual que alguien dado
--      de baja, y NO aparecía en el filtro "Pendientes" del profesor. Es
--      justo el balde equivocado: el comentario de format.js ya decía que
--      "Pendiente" cubre al que se autorregistró y falta aprobar.
--   2. autorregistro_activo vuelve a DEFAULT true y se reactiva en los
--      gimnasios existentes -- lo había apagado la migración 0037 partiendo
--      de que el autorregistro no se iba a usar. Se usa, así que se revierte.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 — join_gimnasio_por_codigo() con los datos personales del alumno
-- ============================================================================
-- DROP + CREATE (no CREATE OR REPLACE) porque cambia la firma: dejar la
-- versión vieja conviviendo crearía una sobrecarga ambigua y PostgREST no
-- sabría cuál llamar. Ojo: DROP se lleva puestos los GRANT, por eso se
-- vuelven a otorgar explícitamente al final de esta sección.
DROP FUNCTION IF EXISTS public.join_gimnasio_por_codigo(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION public.join_gimnasio_por_codigo(
  p_codigo               TEXT,
  p_nombre               TEXT,
  p_contacto             TEXT DEFAULT NULL,
  p_email                TEXT DEFAULT NULL,
  p_dni                  TEXT DEFAULT NULL,
  p_fecha_nacimiento     DATE DEFAULT NULL,
  p_contacto_emergencia  TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gimnasio_id UUID;
BEGIN
  -- Todo lo que sigue mantiene, sin cambios, las defensas de la versión
  -- original (migración 0004, SECCIÓN 4): esta es la ÚNICA superficie de
  -- escritura pública (callable por 'anon') del proyecto, así que el caller
  -- se sigue tratando como hostil por default.

  -- Tope de largo ANTES de usar el código en el WHERE: codigo_invitacion
  -- nunca mide más de 32 caracteres hex, así que cortar en 200 no cambia
  -- ningún caso legítimo y evita que un string de varios MB viaje entero y
  -- se compare contra el índice único.
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  -- El gimnasio SIEMPRE sale de resolver el código, nunca de un parámetro
  -- del caller (no existe un p_gimnasio_id, a propósito). Mensaje de error
  -- genérico: no se distingue "código inexistente" de "autorregistro
  -- apagado", para no confirmarle a nadie que un código puntual es real.
  SELECT id INTO v_gimnasio_id
  FROM public.gimnasios
  WHERE codigo_invitacion = p_codigo AND autorregistro_activo = true;

  IF v_gimnasio_id IS NULL THEN
    RAISE EXCEPTION 'Código de invitación inválido';
  END IF;

  -- Rate-limit liviano por gimnasio (50 altas de autorregistro en 5
  -- minutos): acota un loop automatizado contra un código real sin frenar
  -- el caso legítimo más exigente (mostrar el QR a una clase entera).
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

  -- El nombre es el único obligatorio. NOT NULL de la columna no alcanza:
  -- '' o '   ' pasarían igual y dejarían una fila inservible.
  IF p_nombre IS NULL OR btrim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;

  -- Tope de largo en todos los textos del caller, después de validar el
  -- nombre (para que el mensaje se dispare sobre el valor real).
  p_nombre              := left(btrim(p_nombre), 200);
  p_contacto            := left(p_contacto, 200);
  p_email               := left(p_email, 200);
  p_dni                 := left(p_dni, 50);
  p_contacto_emergencia := left(p_contacto_emergencia, 200);

  INSERT INTO public.alumnos (
    gimnasio_id, nombre, contacto, email, dni, fecha_nacimiento,
    contacto_emergencia, fecha_alta, activo, pendiente, origen
  ) VALUES (
    v_gimnasio_id,
    p_nombre,
    p_contacto,
    p_email,
    p_dni,
    p_fecha_nacimiento,
    p_contacto_emergencia,
    CURRENT_DATE,
    false,   -- nunca se autoactiva: lo revisa y lo activa el profesor
    true,    -- ARREGLO: sin esto caía en "Inactivo" en vez de "Pendiente"
    'autorregistro'
  );
END;
$$;

COMMENT ON FUNCTION public.join_gimnasio_por_codigo(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT) IS
  'SECURITY DEFINER, callable SIN sesión (GRANT a anon). Resuelve el gimnasio EXCLUSIVAMENTE por codigo_invitacion + autorregistro_activo=true. Inserta el alumno con activo=false y pendiente=true (queda en el filtro "Pendientes" del profesor) y origen=''autorregistro''. Solo datos personales: el plan, el objetivo, las observaciones de salud y la foto los carga el profesor al darlo de alta.';

-- GRANT A ANON A PROPÓSITO, igual que en la migración 0004: quien escanea el
-- QR no tiene sesión y nunca la va a tener para esta acción (el
-- autorregistro no crea un usuario de auth.users, solo una fila en alumnos).
-- Si algún día se copia acá el patrón de REVOKE ... FROM anon de las otras
-- funciones, la pantalla pública deja de funcionar por completo.
REVOKE EXECUTE ON FUNCTION public.join_gimnasio_por_codigo(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_gimnasio_por_codigo(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT) TO anon, authenticated;


-- ============================================================================
-- SECCIÓN 2 — Revertir la migración 0037 (autorregistro apagado)
-- ============================================================================
-- 0037 lo había apagado partiendo de "el profesor se tiene que encargar de
-- registrarlos". Después quedó claro que sí se va a usar el autorregistro
-- (con el alcance acotado de la SECCIÓN 1), así que vuelve al default
-- original y se reactiva donde 0037 lo había apagado.
ALTER TABLE public.gimnasios
  ALTER COLUMN autorregistro_activo SET DEFAULT true;

UPDATE public.gimnasios SET autorregistro_activo = true WHERE autorregistro_activo = false;
