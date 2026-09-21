-- ============================================================================
-- export-gimnasio.sql — copia de seguridad manual de UN gimnasio
--
-- Para qué es: el proyecto de Supabase está en plan Free, que NO tiene backups
-- restaurables. Esto es la red de contención mínima mientras dure eso: saca
-- todos los datos de un gimnasio a un solo archivo JSON, para poder recuperar
-- la información a mano si algo sale mal.
--
-- CÓMO SE USA (2 minutos):
--   1. Supabase → SQL Editor → New query.
--   2. Pegar TODO este archivo.
--   3. Cambiar el nombre del gimnasio en la línea de abajo que dice
--      'PONER ACA EL NOMBRE DEL GIMNASIO' (tiene que ser igual al que figura
--      en la app; si no estás segura, corré primero:
--        SELECT nombre FROM public.gimnasios;).
--   4. Run. Devuelve UNA celda con todo adentro.
--   5. Botón de descarga de resultados (arriba a la derecha del panel de
--      resultados) → guardar el archivo. Nombre sugerido:
--        backup-<gimnasio>-<AAAA-MM-DD>.json
--
-- DÓNDE GUARDARLO: donde puedas encontrarlo y donde no se pierda si se rompe
-- la compu (Drive, OneDrive, etc.). OJO: el archivo tiene datos personales de
-- los alumnos (nombre, teléfono, correo, observaciones de salud) y los códigos
-- de acceso a sus planes -- tratalo como información sensible, no lo compartas
-- ni lo dejes en una carpeta pública.
--
-- QUÉ INCLUYE: las 18 tablas de negocio del gimnasio (alumnos, rutinas,
-- rutinas asignadas, planes de alimentación y su biblioteca, ejercicios y
-- alimentos propios, asistencias, progreso, pagos y su archivo mensual,
-- precios/períodos/descuentos, avisos y sus lecturas, entrenamientos
-- completados, ocultos de la biblioteca) más la ficha del gimnasio.
--
-- QUÉ NO INCLUYE, a propósito:
--   * Las contraseñas de los alumnos (`password_hash`) ni los contadores
--     internos de límite de intentos. Si alguna vez hay que restaurar, los
--     accesos se vuelven a crear desde la ficha de cada alumno -- no tiene
--     sentido andar paseando hashes de contraseñas en un archivo.
--   * La cuenta de Supabase Auth del profesor (usuario/contraseña de ingreso):
--     eso vive en `auth.users`, no se toca desde acá.
--   * Los archivos subidos (logo del gimnasio, fotos de alumnos, fotos de
--     progreso, media de ejercicios). Están en Storage, aparte. Si hace falta
--     guardarlos, se bajan desde Supabase → Storage, carpeta por carpeta (el
--     nombre de cada carpeta es el id del gimnasio). En el JSON quedan las
--     URLs, así que se sabe qué archivo era cada uno.
--
-- CÓMO SE RESTAURA: a mano, y conviene pedir ayuda para hacerlo. El JSON tiene
-- todas las filas con sus ids originales, así que se pueden volver a insertar
-- tabla por tabla respetando el orden (primero `gimnasio`, después `alumnos`,
-- `ejercicios`, `alimentos`, `rutinas`, y al final lo que depende de ellos).
-- No es un "restaurar con un botón": es la diferencia entre perder los datos y
-- poder recuperarlos con trabajo.
--
-- Cada cuánto conviene correrlo durante la semana de prueba: una vez por día
-- alcanza. Son 2 minutos y queda la foto del día anterior.
-- ============================================================================

WITH g AS (
  SELECT * FROM public.gimnasios
  WHERE nombre = 'PONER ACA EL NOMBRE DEL GIMNASIO'
)
SELECT jsonb_pretty(jsonb_build_object(
  'exportado_en',      now(),
  'gimnasio',          (SELECT to_jsonb(g.*) FROM g),

  -- Alumnos SIN password_hash ni contadores internos (ver el encabezado).
  'alumnos', (
    SELECT coalesce(jsonb_agg(to_jsonb(a.*) - 'password_hash'
              - 'login_intentos_contador'       - 'login_intentos_ventana_inicio'
              - 'plan_consultas_contador'       - 'plan_consultas_ventana_inicio'
              - 'marcar_entreno_contador'       - 'marcar_entreno_ventana_inicio'
              - 'cargar_peso_contador'          - 'cargar_peso_ventana_inicio'
              - 'aceptar_terminos_contador'     - 'aceptar_terminos_ventana_inicio'
            ORDER BY a.nombre), '[]'::jsonb)
    FROM public.alumnos a WHERE a.gimnasio_id = (SELECT id FROM g)
  ),

  'ejercicios_propios', (
    SELECT coalesce(jsonb_agg(to_jsonb(e.*) ORDER BY e.nombre), '[]'::jsonb)
    FROM public.ejercicios e WHERE e.gimnasio_id = (SELECT id FROM g)
  ),
  'alimentos_propios', (
    SELECT coalesce(jsonb_agg(to_jsonb(al.*) ORDER BY al.nombre), '[]'::jsonb)
    FROM public.alimentos al WHERE al.gimnasio_id = (SELECT id FROM g)
  ),
  'rutinas_biblioteca', (
    SELECT coalesce(jsonb_agg(to_jsonb(r.*) ORDER BY r.nombre), '[]'::jsonb)
    FROM public.rutinas r WHERE r.gimnasio_id = (SELECT id FROM g)
  ),
  'rutinas_asignadas', (
    SELECT coalesce(jsonb_agg(to_jsonb(ra.*) ORDER BY ra.created_at), '[]'::jsonb)
    FROM public.rutinas_asignadas ra WHERE ra.gimnasio_id = (SELECT id FROM g)
  ),
  'planes_alimentacion', (
    SELECT coalesce(jsonb_agg(to_jsonb(pa.*) ORDER BY pa.created_at), '[]'::jsonb)
    FROM public.planes_alimentacion pa WHERE pa.gimnasio_id = (SELECT id FROM g)
  ),
  'planes_alimentacion_biblioteca', (
    SELECT coalesce(jsonb_agg(to_jsonb(pb.*) ORDER BY pb.nombre), '[]'::jsonb)
    FROM public.planes_alimentacion_biblioteca pb WHERE pb.gimnasio_id = (SELECT id FROM g)
  ),
  'asistencias', (
    SELECT coalesce(jsonb_agg(to_jsonb(asi.*) ORDER BY asi.fecha), '[]'::jsonb)
    FROM public.asistencias asi WHERE asi.gimnasio_id = (SELECT id FROM g)
  ),
  'progreso', (
    SELECT coalesce(jsonb_agg(to_jsonb(pr.*) ORDER BY pr.fecha), '[]'::jsonb)
    FROM public.progreso pr WHERE pr.gimnasio_id = (SELECT id FROM g)
  ),
  'entrenamientos_completados', (
    SELECT coalesce(jsonb_agg(to_jsonb(ec.*) ORDER BY ec.fecha), '[]'::jsonb)
    FROM public.entrenamientos_completados ec WHERE ec.gimnasio_id = (SELECT id FROM g)
  ),
  'pagos', (
    SELECT coalesce(jsonb_agg(to_jsonb(p.*) ORDER BY p.fecha_pago), '[]'::jsonb)
    FROM public.pagos p WHERE p.gimnasio_id = (SELECT id FROM g)
  ),
  'pagos_archivo_mensual', (
    SELECT coalesce(jsonb_agg(to_jsonb(pam.*) ORDER BY pam.mes), '[]'::jsonb)
    FROM public.pagos_archivo_mensual pam WHERE pam.gimnasio_id = (SELECT id FROM g)
  ),
  'configuracion_precios', (
    SELECT coalesce(jsonb_agg(to_jsonb(cp.*)), '[]'::jsonb)
    FROM public.configuracion_precios cp WHERE cp.gimnasio_id = (SELECT id FROM g)
  ),
  'configuracion_periodos', (
    SELECT coalesce(jsonb_agg(to_jsonb(cpe.*)), '[]'::jsonb)
    FROM public.configuracion_periodos cpe WHERE cpe.gimnasio_id = (SELECT id FROM g)
  ),
  'configuracion_descuentos', (
    SELECT coalesce(jsonb_agg(to_jsonb(cd.*)), '[]'::jsonb)
    FROM public.configuracion_descuentos cd WHERE cd.gimnasio_id = (SELECT id FROM g)
  ),
  'notificaciones', (
    SELECT coalesce(jsonb_agg(to_jsonb(n.*) ORDER BY n.created_at), '[]'::jsonb)
    FROM public.notificaciones n WHERE n.gimnasio_id = (SELECT id FROM g)
  ),
  'notificaciones_leidas', (
    SELECT coalesce(jsonb_agg(to_jsonb(nl.*)), '[]'::jsonb)
    FROM public.notificaciones_leidas nl WHERE nl.gimnasio_id = (SELECT id FROM g)
  ),
  'biblioteca_ocultos', (
    SELECT coalesce(jsonb_agg(to_jsonb(bo.*)), '[]'::jsonb)
    FROM public.biblioteca_ocultos bo WHERE bo.gimnasio_id = (SELECT id FROM g)
  ),

  -- Conteo rápido para mirar de un vistazo que el archivo trajo algo.
  'resumen', jsonb_build_object(
    'alumnos',             (SELECT count(*) FROM public.alumnos            WHERE gimnasio_id = (SELECT id FROM g)),
    'rutinas_asignadas',   (SELECT count(*) FROM public.rutinas_asignadas  WHERE gimnasio_id = (SELECT id FROM g)),
    'planes_alimentacion', (SELECT count(*) FROM public.planes_alimentacion WHERE gimnasio_id = (SELECT id FROM g)),
    'pagos',               (SELECT count(*) FROM public.pagos              WHERE gimnasio_id = (SELECT id FROM g)),
    'asistencias',         (SELECT count(*) FROM public.asistencias        WHERE gimnasio_id = (SELECT id FROM g))
  )
)) AS backup_json;
