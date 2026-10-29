-- ============================================================================
-- 0083_bitacora_de_alumnos.sql
--
-- Pedido de Nalux (29/10/2026): probo borrar un alumno desde la cuenta de una persona del equipo y
-- el Historial del profesor no mostraba nada de lo que hizo esa persona. La bitacora (0079) solo
-- anotaba pagos y precios. Ahora tambien anota los ALUMNOS: quien los da de alta, los edita en
-- lo importante o los elimina.
--
-- PRIVACIDAD: de un alumno la bitacora guarda SOLO nombre, estado (activo), plan y fecha de alta.
-- Nada de contacto, DNI, salud, notas ni claves: el borrado real de los datos de un alumno (pedido
-- de baja) no puede dejar copia de esos datos en un registro que nadie puede borrar. Una edicion
-- solo se anota si cambia el nombre, el estado o el plan (los contadores del portal del alumno y
-- el resto de los campos no generan ruido).
--
-- OTROS CAMBIOS
--  * Lo que hace create_gimnasio al armar un gimnasio (periodos y precios por defecto) ya no se
--    anota: eran 8 "altas" del administrador en el Historial de cada gimnasio nuevo, puro ruido.
--  * La marca app.bitacora_omitir (la usaba el archivo mensual de pagos) pasa a valer para
--    cualquier tabla y operacion.
-- ============================================================================

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
  -- Operaciones que arman datos por defecto o archivan en bloque: no se anotan una por una.
  IF COALESCE(current_setting('app.bitacora_omitir', true), '') = '1' THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'alumnos' THEN
    -- Solo lo que importa y nada sensible (ver el encabezado de la migracion).
    IF TG_OP <> 'DELETE' THEN
      v_despues := jsonb_build_object('nombre', v_despues ->> 'nombre', 'activo', v_despues -> 'activo',
                                      'plan_precio_nombre', v_despues ->> 'plan_precio_nombre',
                                      'fecha_alta', v_despues ->> 'fecha_alta');
    END IF;
    IF TG_OP <> 'INSERT' THEN
      v_antes := jsonb_build_object('nombre', v_antes ->> 'nombre', 'activo', v_antes -> 'activo',
                                    'plan_precio_nombre', v_antes ->> 'plan_precio_nombre',
                                    'fecha_alta', v_antes ->> 'fecha_alta');
    END IF;
  END IF;

  -- Un UPDATE que no cambia nada (o, en alumnos, nada de lo que se anota) no es un cambio.
  IF TG_OP = 'UPDATE' AND v_antes = v_despues THEN
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
  ELSIF TG_TABLE_NAME = 'alumnos' THEN
    v_resumen := format('Alumno "%s"', COALESCE(v_fila ->> 'nombre', ''));
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

CREATE TRIGGER alumnos_bitacora_trg AFTER INSERT OR UPDATE OR DELETE ON public.alumnos
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_registrar();

-- create_gimnasio: lo que arma por defecto no se anota (se cambia SOLO eso de la funcion).
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.create_gimnasio(text)'::regprocedure);
  v_ini_viejo CONSTANT TEXT := E'  INSERT INTO public.configuracion_periodos (gimnasio_id, nombre, dias)';
  v_ini_nuevo CONSTANT TEXT := E'  PERFORM set_config(''app.bitacora_omitir'', ''1'', true);\n' || v_ini_viejo;
  v_fin_viejo CONSTANT TEXT := E'    (nueva_gimnasio_id, ''Trimestral'', 0, ''Trimestral'', true);';
  v_fin_nuevo CONSTANT TEXT := v_fin_viejo || E'\n\n  PERFORM set_config(''app.bitacora_omitir'', '''', true);';
BEGIN
  IF position(v_ini_viejo IN v_def) = 0 OR position(v_fin_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION '0083: no se encontro el armado por defecto en create_gimnasio; no se modifica nada';
  END IF;
  EXECUTE replace(replace(v_def, v_ini_viejo, v_ini_nuevo), v_fin_viejo, v_fin_nuevo);
END $$;
