-- ============================================================================
-- 0100_chequeo_seguridad_semanal.sql
--
-- Chequeo de seguridad automático. Cada lunes, junto con el resumen de Telegram, la base revisa si
-- apareció alguno de los problemas que ya se corrigieron una vez (tabla sin RLS, función pública que no
-- debería serlo, función sin search_path, columna sensible editable) y avisa. Así un descuido en una
-- migración futura se ve en una semana y no cuando ya lo aprovechó alguien.
--
-- Solo informa nombres técnicos (tablas, funciones, columnas): nunca datos de personas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. seguridad_chequeo(): lista de problemas actuales
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.seguridad_chequeo()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Lo único que anon puede ejecutar a propósito: portal del alumno (por código o usuario), autorregistro
  -- y registro de errores del portal. Si se suma una función pública nueva, hay que agregarla acá.
  v_permitidas text[] := ARRAY[
    'aceptar_terminos_alumno', 'alumno_cargar_peso', 'iniciar_sesion_alumno', 'join_gimnasio_por_codigo',
    'marcar_entrenamiento_hecho', 'marcar_notificacion_leida', 'registrar_error_alumno',
    'ver_plan_por_codigo', 'ver_progreso_alumno'
  ];
  v_tablas  jsonb;
  v_anon    jsonb;
  v_sinpath jsonb;
  v_cols    jsonb;
BEGIN
  -- Tablas de public sin RLS.
  SELECT COALESCE(jsonb_agg(c.relname::text ORDER BY c.relname), '[]'::jsonb) INTO v_tablas
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p')
     AND NOT c.relrowsecurity;

  -- Funciones SECURITY DEFINER ejecutables por anon (directo o por PUBLIC) fuera de la lista permitida.
  SELECT COALESCE(jsonb_agg(DISTINCT p.proname::text), '[]'::jsonb) INTO v_anon
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind = 'f'
     AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname <> ALL (v_permitidas)
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');

  -- Funciones SECURITY DEFINER sin search_path fijo.
  SELECT COALESCE(jsonb_agg(DISTINCT p.proname::text), '[]'::jsonb) INTO v_sinpath
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind = 'f'
     AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg WHERE cfg LIKE 'search_path=%')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');

  -- Columnas sensibles que el navegador (authenticated) no debería poder escribir.
  SELECT COALESCE(jsonb_agg(x.tabla || '.' || x.columna ORDER BY x.tabla, x.columna), '[]'::jsonb) INTO v_cols
    FROM (VALUES ('profiles', 'email'),
                 ('alumnos', 'codigo_acceso'),
                 ('alumnos', 'usuario'),
                 ('alumnos', 'user_id')) AS x(tabla, columna)
   WHERE has_column_privilege('authenticated', format('public.%I', x.tabla)::regclass, x.columna, 'UPDATE');

  RETURN jsonb_build_object(
    'tablas_sin_rls',            v_tablas,
    'funciones_anon_no_permitidas', v_anon,
    'funciones_sin_search_path', v_sinpath,
    'columnas_editables',        v_cols,
    'total', jsonb_array_length(v_tablas) + jsonb_array_length(v_anon)
           + jsonb_array_length(v_sinpath) + jsonb_array_length(v_cols)
  );
END;
$function$;

-- Solo la llama telegram_chequeo_semanal (como dueño) y, para pruebas, service_role.
REVOKE ALL ON FUNCTION public.seguridad_chequeo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seguridad_chequeo() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. telegram_chequeo_semanal: además del resumen, el aviso de seguridad
-- ----------------------------------------------------------------------------
-- Es la de la 0092 más un bloque propio: si el chequeo falla, el resumen de la semana igual sale (ya
-- quedó encolado antes). El texto se manda tal cual (la Edge Function solo trata distinto al tipo 'resumen').
CREATE OR REPLACE FUNCTION public.telegram_chequeo_semanal()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seg   jsonb;
  v_total integer;
  v_lista text;
BEGIN
  PERFORM public.telegram_encolar('resumen', '');

  -- Bloque aparte: el aviso de seguridad.
  BEGIN
    v_seg := public.seguridad_chequeo();
    v_total := (v_seg ->> 'total')::integer;

    IF v_total = 0 THEN
      PERFORM public.telegram_encolar('seguridad', '🔒 Seguridad: sin novedades.');
    ELSE
      SELECT string_agg(s.item, ', ') INTO v_lista
        FROM (
          SELECT 'tabla sin RLS ' || t AS item FROM jsonb_array_elements_text(v_seg -> 'tablas_sin_rls') t
          UNION ALL
          SELECT 'anon ejecuta ' || t FROM jsonb_array_elements_text(v_seg -> 'funciones_anon_no_permitidas') t
          UNION ALL
          SELECT 'sin search_path ' || t FROM jsonb_array_elements_text(v_seg -> 'funciones_sin_search_path') t
          UNION ALL
          SELECT 'editable ' || t FROM jsonb_array_elements_text(v_seg -> 'columnas_editables') t
        ) s;
      PERFORM public.telegram_encolar(
        'seguridad',
        left(format('🔒 Seguridad: hay %s %s para revisar: %s',
                    v_total, CASE WHEN v_total = 1 THEN 'punto' ELSE 'puntos' END, v_lista), 900)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Un chequeo que no corre no puede pasar por "sin novedades": se avisa que no se pudo hacer.
    BEGIN
      PERFORM public.telegram_encolar('seguridad', '🔒 Seguridad: no se pudo hacer el chequeo de esta semana.');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;

  -- Bloque aparte: si la limpieza falla, el resumen de la semana igual sale.
  BEGIN
    DELETE FROM public.avisos_telegram WHERE enviado_en < now() - INTERVAL '30 days';
    DELETE FROM cron.job_run_details WHERE end_time < now() - INTERVAL '7 days';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.telegram_chequeo_semanal() FROM PUBLIC, anon, authenticated;
