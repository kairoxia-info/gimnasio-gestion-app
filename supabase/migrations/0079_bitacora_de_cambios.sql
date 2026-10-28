-- ============================================================================
-- 0079_bitacora_de_cambios.sql
--
-- BITACORA DE CAMBIOS (pedido de Nalux del 28/10/2026): el staff va a poder anular
-- pagos, editar precios y ver el cierre de caja, y "al administrador le tiene que
-- quedar registrado que staff fue el que edito o anulo algun pago".
--
-- COMO FUNCIONA (y por que asi)
--  * La bitacora la escriben TRIGGERS en la base, no la pantalla: no hay forma de
--    cambiar un pago o un precio saltandose el registro llamando a la API directo.
--    El autor sale de auth.uid() (nunca de un dato que mande el cliente).
--  * Nadie escribe ni borra la bitacora a mano (ni el admin): authenticated solo
--    tiene SELECT, y la politica deja leer SOLO a un administrador y SOLO del
--    gimnasio abierto. El staff no la ve.
--  * Cada fila guarda como estaba la fila ANTES y como quedo DESPUES (jsonb) y un
--    resumen legible, mas el nombre del autor tal como era en ese momento (por si la
--    cuenta se borra o cambia de nombre).
--  * Se registra lo que toca plata: pagos y precios (planes, periodos, descuentos).
--  * "Anular un pago" hoy es borrarlo: se hace por anular_pago(id, motivo), que EXIGE un
--    motivo y es la unica forma de borrar un pago (se quita el DELETE directo). El
--    comprobante no se reutiliza (el contador no baja, 0073) y la bitacora conserva la
--    fila completa del pago anulado.
--  * pagos.registrado_por: quien cargo el pago (lo fija un trigger; no se puede mandar ni
--    cambiar despues).
--  * Si se borra el gimnasio o el alumno, la base borra en cascada sus pagos: con el
--    gimnasio no se registra nada (se va todo, bitacora incluida); con el alumno si, con
--    el motivo "Se elimino al alumno".
-- ============================================================================

-- 1. Quien cargo cada pago
ALTER TABLE public.pagos
  ADD COLUMN registrado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.pagos_fijar_registrado_por()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.registrado_por := auth.uid();
  ELSE
    NEW.registrado_por := OLD.registrado_por;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER pagos_fijar_registrado_por_trg
  BEFORE INSERT OR UPDATE ON public.pagos
  FOR EACH ROW EXECUTE FUNCTION public.pagos_fijar_registrado_por();

-- 2. La bitacora
CREATE TABLE public.bitacora (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  user_id      UUID,
  autor_nombre TEXT,
  autor_rol    TEXT,
  accion       TEXT NOT NULL CHECK (accion IN ('alta', 'edicion', 'baja', 'anulacion')),
  tabla        TEXT NOT NULL,
  registro_id  UUID,
  resumen      TEXT NOT NULL,
  motivo       TEXT,
  antes        JSONB,
  despues      JSONB,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bitacora IS
  'Historial de cambios de plata (0079): pagos y precios. La escriben triggers; solo la lee un administrador del gimnasio.';

CREATE INDEX bitacora_gimnasio_fecha_idx ON public.bitacora (gimnasio_id, creado_en DESC);

ALTER TABLE public.bitacora ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bitacora FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bitacora TO authenticated;

CREATE POLICY bitacora_select_admin ON public.bitacora FOR SELECT TO authenticated
  USING (gimnasio_id = (SELECT public.get_mi_gimnasio_id())
         AND (SELECT public.get_mi_rol()) = 'admin');

-- 3. El trigger que la escribe (una sola funcion; los campos se leen del jsonb de la
--    fila para que sirva a varias tablas sin depender de sus columnas)
CREATE OR REPLACE FUNCTION public.bitacora_registrar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fila    JSONB := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_antes   JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_despues JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_gim     UUID := (v_fila ->> 'gimnasio_id')::uuid;
  v_accion  TEXT;
  v_motivo  TEXT := NULLIF(btrim(COALESCE(current_setting('app.bitacora_motivo', true), '')), '');
  v_alumno  TEXT;
  v_resumen TEXT;
  v_autor   TEXT;
BEGIN
  -- Un UPDATE que no cambia nada no es un cambio.
  IF TG_OP = 'UPDATE' AND v_antes = v_despues THEN
    RETURN NULL;
  END IF;

  -- El archivo mensual borra muchos pagos de golpe y deja UN solo renglon resumen
  -- (archivar_pagos_hasta): no se anota uno por cada pago archivado.
  IF TG_TABLE_NAME = 'pagos' AND TG_OP = 'DELETE'
     AND COALESCE(current_setting('app.bitacora_omitir', true), '') = '1' THEN
    RETURN NULL;
  END IF;

  -- Borrado en cascada del gimnasio entero: se va todo, no hay donde registrarlo.
  IF NOT EXISTS (SELECT 1 FROM public.gimnasios WHERE id = v_gim) THEN
    RETURN NULL;
  END IF;

  v_accion := CASE TG_OP
    WHEN 'INSERT' THEN 'alta'
    WHEN 'UPDATE' THEN 'edicion'
    WHEN 'DELETE' THEN CASE WHEN TG_TABLE_NAME = 'pagos' THEN 'anulacion' ELSE 'baja' END
  END;

  IF TG_TABLE_NAME = 'pagos' THEN
    SELECT a.nombre INTO v_alumno FROM public.alumnos a WHERE a.id = (v_fila ->> 'alumno_id')::uuid;
    IF v_alumno IS NULL THEN
      v_alumno := 'un alumno eliminado';
      IF TG_OP = 'DELETE' AND v_motivo IS NULL THEN
        v_motivo := 'Se eliminó al alumno';
      END IF;
    END IF;
    v_resumen := format('Pago N° %s de %s por $%s',
                        COALESCE(v_fila ->> 'numero', '—'), v_alumno, COALESCE(v_fila ->> 'monto', '0'));
  ELSIF TG_TABLE_NAME = 'configuracion_precios' THEN
    v_resumen := format('Plan "%s" ($%s)', COALESCE(v_fila ->> 'nombre', ''), COALESCE(v_fila ->> 'precio', '0'));
  ELSIF TG_TABLE_NAME = 'configuracion_periodos' THEN
    v_resumen := format('Período "%s" (%s días)', COALESCE(v_fila ->> 'nombre', ''), COALESCE(v_fila ->> 'dias', '?'));
  ELSIF TG_TABLE_NAME = 'configuracion_descuentos' THEN
    v_resumen := format('Descuento "%s" (%s%%)', COALESCE(v_fila ->> 'nombre', ''), COALESCE(v_fila ->> 'porcentaje', '?'));
  ELSE
    v_resumen := TG_TABLE_NAME;
  END IF;

  SELECT COALESCE(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), p.email)
    INTO v_autor
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.bitacora (gimnasio_id, user_id, autor_nombre, autor_rol, accion, tabla, registro_id, resumen, motivo, antes, despues)
  VALUES (v_gim, auth.uid(), COALESCE(v_autor, CASE WHEN auth.uid() IS NULL THEN 'Sistema' END),
          CASE WHEN auth.uid() IS NULL THEN NULL ELSE public.get_mi_rol() END,
          v_accion, TG_TABLE_NAME, (v_fila ->> 'id')::uuid, v_resumen, v_motivo, v_antes, v_despues);

  RETURN NULL;
END;
$function$;

CREATE TRIGGER pagos_bitacora_trg AFTER INSERT OR UPDATE OR DELETE ON public.pagos
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_registrar();
CREATE TRIGGER configuracion_precios_bitacora_trg AFTER INSERT OR UPDATE OR DELETE ON public.configuracion_precios
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_registrar();
CREATE TRIGGER configuracion_periodos_bitacora_trg AFTER INSERT OR UPDATE OR DELETE ON public.configuracion_periodos
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_registrar();
CREATE TRIGGER configuracion_descuentos_bitacora_trg AFTER INSERT OR UPDATE OR DELETE ON public.configuracion_descuentos
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_registrar();

-- 4. Anular un pago: unica forma de borrarlo, con motivo obligatorio
CREATE OR REPLACE FUNCTION public.anular_pago(p_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gim    UUID := public.get_mi_gimnasio_id();
  v_motivo TEXT := left(btrim(COALESCE(p_motivo, '')), 500);
BEGIN
  IF auth.uid() IS NULL OR v_gim IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa';
  END IF;
  IF char_length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Indicar el motivo de la anulación';
  END IF;

  PERFORM set_config('app.bitacora_motivo', v_motivo, true);
  DELETE FROM public.pagos WHERE id = p_id AND gimnasio_id = v_gim;
  IF NOT FOUND THEN
    PERFORM set_config('app.bitacora_motivo', '', true);
    RAISE EXCEPTION 'El pago no existe';
  END IF;
  PERFORM set_config('app.bitacora_motivo', '', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.anular_pago(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_pago(uuid, text) TO authenticated;

-- 5. Archivo mensual: borraba pagos con los permisos de quien la llamaba, asi que al quitar
--    el DELETE directo (abajo) dejaria de andar. Pasa a ejecutarse con permisos propios; ya
--    filtra todo por el gimnasio abierto (get_mi_gimnasio_id) y ahora deja un renglon
--    resumen en la bitacora con quien archivo. Mismo calculo que antes (0020 en adelante).
CREATE OR REPLACE FUNCTION public.archivar_pagos_hasta(p_fecha_corte date)
 RETURNS TABLE(meses_afectados integer, pagos_archivados integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_gimnasio_id UUID := public.get_mi_gimnasio_id();
  v_meses INTEGER;
  v_pagos INTEGER;
  v_autor TEXT;
BEGIN
  IF auth.uid() IS NULL OR v_gimnasio_id IS NULL THEN
    RAISE EXCEPTION 'No hay un gimnasio activo para este usuario.';
  END IF;

  PERFORM set_config('app.bitacora_omitir', '1', true);

  WITH ultimo_de_cada_alumno AS (
    SELECT DISTINCT ON (alumno_id) id
      FROM public.pagos
     WHERE gimnasio_id = v_gimnasio_id
     ORDER BY alumno_id, periodo_hasta DESC NULLS LAST, created_at DESC
  ),
  a_archivar AS (
    SELECT id, fecha_pago, monto
      FROM public.pagos
     WHERE gimnasio_id = v_gimnasio_id
       AND fecha_pago IS NOT NULL
       AND fecha_pago < p_fecha_corte
       AND id NOT IN (SELECT id FROM ultimo_de_cada_alumno)
  ),
  resumen AS (
    SELECT date_trunc('month', fecha_pago)::date AS mes,
           SUM(monto) AS total,
           COUNT(*) AS cantidad
      FROM a_archivar
     GROUP BY 1
  ),
  guardado AS (
    INSERT INTO public.pagos_archivo_mensual (gimnasio_id, mes, total_cobrado, cantidad_pagos)
    SELECT v_gimnasio_id, mes, total, cantidad FROM resumen
    ON CONFLICT (gimnasio_id, mes) DO UPDATE
      SET total_cobrado = public.pagos_archivo_mensual.total_cobrado + EXCLUDED.total_cobrado,
          cantidad_pagos = public.pagos_archivo_mensual.cantidad_pagos + EXCLUDED.cantidad_pagos
    RETURNING 1
  ),
  borrado AS (
    DELETE FROM public.pagos
     WHERE id IN (SELECT id FROM a_archivar)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM guardado)::integer, (SELECT count(*) FROM borrado)::integer
    INTO v_meses, v_pagos;

  PERFORM set_config('app.bitacora_omitir', '', true);

  IF v_pagos > 0 THEN
    SELECT COALESCE(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), p.email)
      INTO v_autor FROM public.profiles p WHERE p.id = auth.uid();
    INSERT INTO public.bitacora (gimnasio_id, user_id, autor_nombre, autor_rol, accion, tabla, resumen, motivo)
    VALUES (v_gimnasio_id, auth.uid(), v_autor, public.get_mi_rol(), 'baja', 'pagos',
            format('Archivó %s pagos anteriores al %s (quedan en el resumen mensual)', v_pagos, to_char(p_fecha_corte, 'DD/MM/YYYY')),
            'Archivo mensual de pagos');
  END IF;

  RETURN QUERY SELECT v_meses, v_pagos;
END;
$function$;

-- Ya no se borra un pago directo: sin motivo ni registro. (Los borrados en cascada por
-- alumno o gimnasio los hace la base como dueña de la tabla y no pasan por este permiso.)
REVOKE DELETE ON public.pagos FROM authenticated;
