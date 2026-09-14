-- ============================================================================
-- 0052_contadores_separados_por_accion.sql
--
-- Repaso de seguridad del 14/09/2026, hallazgo menor. La migración 0050 (de
-- ayer) escribió en su propio encabezado que cada acción del alumno tiene que
-- llevar SU PROPIO contador de tope de intentos, citando el error ya corregido
-- en la 0042 (compartir el contador de "ver el plan" con el de "login" hacía
-- que usar una bloqueara la otra)... y acto seguido usó UN SOLO contador
-- (`escritura_intentos_*`) para las DOS funciones nuevas. O sea: el comentario
-- promete una cosa y el código hacía otra.
--
-- El impacto práctico era bajo -- marcar el entrenamiento del día y cargar el
-- peso son acciones deliberadas y poco frecuentes, así que 30 cada 5 minutos
-- compartidas no llegaban a trabar a nadie en uso normal. Pero la regla existe
-- justamente para no tener que razonar caso por caso si "esta vez sí molesta o
-- no": si el alumno agota un tope tocando un botón, no tiene por qué quedarse
-- sin el otro. Se separa y listo.
--
-- Las columnas nuevas quedan FUERA de los permisos de `authenticated` (la
-- migración 0051 usa lista blanca explícita, y estas no están en ella), así
-- que el navegador no las ve ni las puede escribir: las maneja solamente el
-- servidor dentro de estas funciones SECURITY DEFINER. Si el cliente pudiera
-- escribirlas, el tope se saltearía poniéndolas en cero.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECCIÓN 1 — Un par de columnas por acción, en vez del par compartido
-- ----------------------------------------------------------------------------
ALTER TABLE public.alumnos
    ADD COLUMN IF NOT EXISTS marcar_entreno_contador INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS marcar_entreno_ventana_inicio TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cargar_peso_contador INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cargar_peso_ventana_inicio TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- SECCIÓN 2 — marcar_entrenamiento_hecho(): ahora con su contador propio
--
-- Idéntica a la versión de la 0050 salvo por las dos columnas del tope. Se
-- deja el CREATE OR REPLACE completo (no un parche) para que el archivo se
-- pueda leer solo y se vea qué hace la función entera, mismo criterio que el
-- resto de las migraciones del proyecto.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_entrenamiento_hecho(
    p_codigo TEXT,
    p_semana INTEGER,
    p_dia TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alumno_id           UUID;
  v_gimnasio_id         UUID;
  v_rutina_asignada_id  UUID;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id INTO v_alumno_id, v_gimnasio_id
  FROM public.alumnos
  WHERE codigo_acceso = p_codigo AND activo = true;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'Codigo de acceso invalido';
  END IF;

  UPDATE public.alumnos
    SET marcar_entreno_contador = CASE
          WHEN marcar_entreno_ventana_inicio IS NULL
            OR marcar_entreno_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN 1
          ELSE marcar_entreno_contador + 1
        END,
        marcar_entreno_ventana_inicio = CASE
          WHEN marcar_entreno_ventana_inicio IS NULL
            OR marcar_entreno_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN now()
          ELSE marcar_entreno_ventana_inicio
        END
    WHERE id = v_alumno_id
      AND (
        marcar_entreno_ventana_inicio IS NULL
        OR marcar_entreno_ventana_inicio < now() - INTERVAL '5 minutes'
        OR marcar_entreno_contador < 30
      );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demasiadas acciones en poco tiempo, proba de nuevo en unos minutos';
  END IF;

  IF p_dia IS NULL OR btrim(p_dia) = '' THEN
    RAISE EXCEPTION 'Dia invalido';
  END IF;

  SELECT id INTO v_rutina_asignada_id
  FROM public.rutinas_asignadas
  WHERE alumno_id = v_alumno_id AND gimnasio_id = v_gimnasio_id AND activa = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_rutina_asignada_id IS NULL THEN
    RAISE EXCEPTION 'No hay una rutina activa para marcar';
  END IF;

  INSERT INTO public.entrenamientos_completados
    (gimnasio_id, alumno_id, rutina_asignada_id, semana, dia, fecha)
  VALUES (
    v_gimnasio_id, v_alumno_id, v_rutina_asignada_id,
    GREATEST(1, COALESCE(p_semana, 1)), left(btrim(p_dia), 50), CURRENT_DATE
  )
  ON CONFLICT (alumno_id, rutina_asignada_id, semana, dia, fecha) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_entrenamiento_hecho(TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_entrenamiento_hecho(TEXT, INTEGER, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- SECCIÓN 3 — alumno_cargar_peso(): ahora con su contador propio
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alumno_cargar_peso(
    p_codigo TEXT,
    p_peso NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alumno_id       UUID;
  v_gimnasio_id     UUID;
  v_progreso_hoy_id UUID;
BEGIN
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id INTO v_alumno_id, v_gimnasio_id
  FROM public.alumnos
  WHERE codigo_acceso = p_codigo AND activo = true;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'Codigo de acceso invalido';
  END IF;

  UPDATE public.alumnos
    SET cargar_peso_contador = CASE
          WHEN cargar_peso_ventana_inicio IS NULL
            OR cargar_peso_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN 1
          ELSE cargar_peso_contador + 1
        END,
        cargar_peso_ventana_inicio = CASE
          WHEN cargar_peso_ventana_inicio IS NULL
            OR cargar_peso_ventana_inicio < now() - INTERVAL '5 minutes'
          THEN now()
          ELSE cargar_peso_ventana_inicio
        END
    WHERE id = v_alumno_id
      AND (
        cargar_peso_ventana_inicio IS NULL
        OR cargar_peso_ventana_inicio < now() - INTERVAL '5 minutes'
        OR cargar_peso_contador < 30
      );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demasiadas acciones en poco tiempo, proba de nuevo en unos minutos';
  END IF;

  IF p_peso IS NULL OR p_peso <= 0 OR p_peso > 400 THEN
    RAISE EXCEPTION 'Peso invalido';
  END IF;

  SELECT id INTO v_progreso_hoy_id
  FROM public.progreso
  WHERE alumno_id = v_alumno_id AND fecha = CURRENT_DATE AND origen = 'alumno'
  LIMIT 1;

  IF v_progreso_hoy_id IS NOT NULL THEN
    UPDATE public.progreso SET peso = p_peso WHERE id = v_progreso_hoy_id;
  ELSE
    INSERT INTO public.progreso (gimnasio_id, alumno_id, fecha, peso, origen)
    VALUES (v_gimnasio_id, v_alumno_id, CURRENT_DATE, p_peso, 'alumno');
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.alumno_cargar_peso(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.alumno_cargar_peso(TEXT, NUMERIC) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- SECCIÓN 4 — Sacar el par compartido, que ya no lo usa nadie
--
-- Se dropea en vez de dejarlo: una columna de rate limit huérfana es
-- justamente la que alguien más adelante vuelve a usar "porque ya estaba",
-- reintroduciendo el problema que esta migración corrige.
-- ----------------------------------------------------------------------------
ALTER TABLE public.alumnos
    DROP COLUMN IF EXISTS escritura_intentos_contador,
    DROP COLUMN IF EXISTS escritura_intentos_ventana_inicio;

-- ============================================================================
-- Fin de la migración 0052.
-- ============================================================================
