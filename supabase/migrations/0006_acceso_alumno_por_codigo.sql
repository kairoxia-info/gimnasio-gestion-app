-- ============================================================================
-- 0006_acceso_alumno_por_codigo.sql
-- Acceso público de SOLO LECTURA del propio alumno a su rutina + plan de
-- alimentación, vía un código individual (QR), SIN cuenta de auth.users,
-- SIN contraseña, SIN sesión.
--
-- Decisión de producto (no se cuestiona acá, ya está tomada con el cliente):
-- buena parte de los alumnos son gente mayor / poco técnica. Un login con
-- usuario+contraseña haría que pierdan el acceso. El profesor entrega un QR
-- (impreso o por mensaje); el alumno lo escanea y ve una página pública de
-- solo lectura, que puede imprimir/guardar como PDF con la función nativa
-- del navegador. Es DELIBERADAMENTE más simple que un login real: no crea
-- fila en auth.users, no hay JWT, no hay "sesión" que cerrar.
--
-- Cubre:
--   1. alumnos.codigo_acceso (+ 2 columnas de soporte para el rate-limit de
--      SECCIÓN 3, ver ahí) — backfill de alumnos existentes, DEFAULT para
--      los nuevos, índice de lookup (vía el UNIQUE, no uno aparte).
--   2. ver_plan_por_codigo(p_codigo) — RPC pública (anon), única función de
--      este archivo con GRANT a anon. Devuelve la superficie MÍNIMA para
--      renderizar la página: nombre del alumno, branding del gimnasio,
--      rutina activa, plan de alimentación más reciente. Nada más.
--   3. regenerar_codigo_acceso_alumno(p_alumno_id) — RPC para staff logueado
--      del gimnasio dueño de ese alumno, para invalidar un QR perdido o
--      comprometido.
--
-- Migración ADITIVA sobre 0001/0004: no se toca RLS ni GRANT de tabla de
-- ninguna tabla existente. Las dos funciones nuevas son SECURITY DEFINER y
-- bypasean RLS por diseño, igual que join_gimnasio_por_codigo()/
-- listar_planes_para_codigo() en 0004 — el control de acceso vive
-- ÍNTEGRAMENTE en la lógica de la función (qué WHERE resuelve el alumno, qué
-- columnas se devuelven), no en policies nuevas.
--
-- ⚠️ ADVERTENCIA DE ARQUITECTURA — LEER ANTES DE TOCAR ESTE ARCHIVO:
-- ver_plan_por_codigo() (SECCIÓN 3) es la SEGUNDA superficie de lectura
-- pública (sin login, callable por 'anon') de todo el proyecto, después de
-- listar_planes_para_codigo() (0004). A diferencia de esa, acá el dato que
-- se expone (rutina + plan de alimentación de una persona real) tiene
-- mucho más valor para filtrar que precios de lista — por eso esta función
-- es la más restrictiva en columnas devueltas de todo el proyecto. Ante la
-- duda de si un campo debe salir en el SELECT: NO.
--
-- Pensado para pegarse ENTERO y de una sola vez en el SQL Editor de
-- Supabase. No requiere la Supabase CLI ni ejecución por partes.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 — Columnas nuevas en alumnos
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1.1 alumnos.codigo_acceso
-- --------------------------------------------------------------------------
-- Mismo criterio exacto que gimnasios.codigo_invitacion (0004 SECCIÓN 1.1):
-- se agrega SIN NOT NULL/UNIQUE todavía, porque ya hay alumnos reales en la
-- base y una constraint NOT NULL en el mismo ALTER TABLE fallaría en el
-- acto contra filas existentes en NULL. Orden correcto: (a) columna
-- nullable, (b) backfill con UPDATE, (c) NOT NULL + UNIQUE recién después
-- de que todas las filas tengan valor. Ver SECCIÓN 2.
ALTER TABLE public.alumnos
  ADD COLUMN codigo_acceso TEXT;

COMMENT ON COLUMN public.alumnos.codigo_acceso IS
  'Código individual (se comparte como QR/link) para que el propio alumno vea su rutina y plan de alimentación vía ver_plan_por_codigo(), sin cuenta de auth.users ni contraseña. Mismo criterio de entropía que gimnasios.codigo_invitacion (128 bits, ver SECCIÓN 2): no es adivinable por fuerza bruta, pero tampoco reemplaza autenticación real -- es más parecido a la llave física de un casillero que a una contraseña. Si se filtra, el peor caso es que alguien vea la rutina y el plan de alimentación de ESE alumno puntual (nunca de otro alumno ni de otro gimnasio, ver ver_plan_por_codigo() SECCIÓN 3) -- ningún dato de pagos, contacto, salud ni datos personales sensibles queda expuesto por esta vía. Regenerable sin downtime vía regenerar_codigo_acceso_alumno() (SECCIÓN 4) si se filtra o se pierde el QR.';


-- --------------------------------------------------------------------------
-- 1.2 Columnas de soporte para el rate-limit de ver_plan_por_codigo()
-- --------------------------------------------------------------------------
-- ver_plan_por_codigo() es de SOLO LECTURA (a diferencia de
-- join_gimnasio_por_codigo() en 0004, que inserta una fila de alumno por
-- cada llamada legítima). Eso significa que NO existe, como en 0004, una
-- tabla de "altas recientes" contra la que hacer un COUNT(*) con ventana de
-- tiempo para el rate-limit -- acá no hay ningún INSERT de negocio del que
-- colgarse.
--
-- Decisión de diseño: en vez de agregar una tabla de log nueva (que crecería
-- sin límite con el uso legítimo normal -- cada vez que un alumno mira su
-- rutina en el celular sumaría una fila para siempre), se usan 2 columnas
-- de ventana fija directamente en alumnos, con almacenamiento acotado (2
-- columnas por alumno, no una fila nueva por consulta): un contador +
-- timestamp de inicio de ventana, reseteados cuando la ventana expira. Es
-- el mismo patrón conceptual que el rate-limit de join_gimnasio_por_codigo()
-- (0004 SECCIÓN 4: contar intentos recientes contra un umbral y cortar en
-- seco por encima de él) pero implementado sin tabla nueva, porque el
-- "recurso a proteger" acá es un alumno puntual ya resuelto (no un tenant
-- entero acumulando altas). Mismo espíritu que el propio comentario de 0004:
-- "esto NO sustituye un rate-limit de verdad a nivel de red/edge -- es la
-- mitigación mínima razonable que se puede poner acá adentro sin agregar
-- infraestructura nueva".
ALTER TABLE public.alumnos
  ADD COLUMN plan_consultas_ventana_inicio TIMESTAMPTZ,
  ADD COLUMN plan_consultas_contador INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.alumnos.plan_consultas_ventana_inicio IS
  'Soporte interno del rate-limit de ver_plan_por_codigo() (SECCIÓN 3): inicio de la ventana de 5 minutos vigente. No se lee ni se escribe desde ningún otro lugar del sistema.';

COMMENT ON COLUMN public.alumnos.plan_consultas_contador IS
  'Soporte interno del rate-limit de ver_plan_por_codigo() (SECCIÓN 3): cantidad de consultas dentro de la ventana vigente (plan_consultas_ventana_inicio). Se resetea a 1 cada vez que se abre una ventana nueva. No se lee ni se escribe desde ningún otro lugar del sistema.';


-- ============================================================================
-- SECCIÓN 2 — Backfill, NOT NULL/UNIQUE, y DEFAULT para alumnos nuevos
-- ============================================================================

-- gen_random_bytes(16) -> encode(..., 'hex') = 32 caracteres hex = 128 bits
-- de entropía. Mismo tamaño exacto que gimnasios.codigo_invitacion (0004
-- SECCIÓN 2) y mismo razonamiento: muy por encima de lo necesario para que
-- la fuerza bruta sea impracticable, y el costo de un código más largo es
-- cero porque nadie lo tipea a mano (viaja en un link/QR).
--
-- Corre como SQL suelto (no dentro de una función), así que el search_path
-- de SESIÓN por defecto de Supabase ya incluye "extensions" (confirmado en
-- 0004 SECCIÓN 2 -- el backfill de codigo_invitacion no tuvo el bug 42883
-- que sí tuvieron create_gimnasio()/regenerar_codigo_invitacion() por correr
-- con SET search_path = public). Se califica igual el schema
-- explícitamente por prolijidad y para no depender de ese detalle.
UPDATE public.alumnos
  SET codigo_acceso = encode(extensions.gen_random_bytes(16), 'hex')
  WHERE codigo_acceso IS NULL;

-- Recién ahora, con todas las filas pobladas, NOT NULL + UNIQUE. El UNIQUE
-- es lo que garantiza que "WHERE codigo_acceso = p_codigo" en
-- ver_plan_por_codigo() resuelve como mucho UN alumno -- si dos alumnos
-- (del mismo gimnasio o de gimnasios distintos) pudieran compartir código,
-- se filtraría el plan de uno al que tiene el código del otro. El índice
-- único que Postgres crea automáticamente para este UNIQUE ES el índice de
-- lookup por código que hace falta para que ver_plan_por_codigo() resuelva
-- rápido -- no hace falta un CREATE INDEX aparte (mismo criterio ya usado
-- para gimnasios.codigo_invitacion en 0004).
ALTER TABLE public.alumnos
  ALTER COLUMN codigo_acceso SET NOT NULL,
  ADD CONSTRAINT alumnos_codigo_acceso_key UNIQUE (codigo_acceso);

-- DEFAULT para que los alumnos nuevos lo obtengan automáticamente, SIN
-- trigger. Justificación de por qué DEFAULT y no trigger, y por qué esto es
-- distinto a como se resolvió gimnasios.codigo_invitacion en 0004:
--
--   - gimnasios NO tiene columna DEFAULT para codigo_invitacion: no le hace
--     falta, porque existe UN SOLO camino de alta de gimnasio
--     (create_gimnasio(), SECURITY DEFINER, sin policy de INSERT directa
--     sobre gimnasios) -- alcanza con generarlo a mano ahí adentro.
--   - alumnos tiene DOS caminos de alta bien distintos: (a) el staff
--     logueado creando un alumno a mano desde la app (INSERT normal vía
--     PostgREST, pasa por alumnos_tenant_isolation, NO por ninguna función
--     intermedia), y (b) join_gimnasio_por_codigo() (0004 SECCIÓN 4,
--     SECURITY DEFINER, INSERT con lista explícita de columnas que NO
--     incluye codigo_acceso). Un DEFAULT a nivel de columna cubre los DOS
--     caminos (y cualquier camino futuro que se agregue) con una sola
--     línea, sin tener que acordarse de tocar cada función de alta por
--     separado -- un trigger BEFORE INSERT lograría lo mismo pero con más
--     código para el mismo resultado exacto (mismo criterio ya usado en
--     todo el schema para id/created_at, que también son DEFAULT de
--     columna, no triggers).
--
-- Igual que create_gimnasio() (0004 SECCIÓN 6) con codigo_invitacion: SIN
-- retry por colisión acá. Con 128 bits de entropía la probabilidad es
-- indistinguible de cero; si algún día colisionara de verdad (señal de que
-- gen_random_bytes está roto, no de mala suerte), el INSERT falla con un
-- unique_violation claro en vez de silenciarlo, que es el comportamiento
-- correcto por defecto. (Distinto del LOOP con retry de
-- regenerar_codigo_acceso_alumno() en SECCIÓN 4 -- ahí sí vale la pena
-- porque es una operación puntual, no un DEFAULT que corre en cada INSERT.)
--
-- Se califica extensions.gen_random_bytes explícitamente: aunque un DEFAULT
-- de columna se resuelve a una referencia de función fija en el momento de
-- este ALTER TABLE (no se re-resuelve por search_path en cada INSERT
-- futuro), calificar el schema achica el margen de error a cero y es
-- coherente con el resto del archivo.
ALTER TABLE public.alumnos
  ALTER COLUMN codigo_acceso SET DEFAULT encode(extensions.gen_random_bytes(16), 'hex');


-- ============================================================================
-- SECCIÓN 3 — ver_plan_por_codigo(): lectura pública mínima del plan
-- ============================================================================
-- ⚠️ FUNCIÓN MÁS SENSIBLE DE ESTE ARCHIVO. Callable SIN sesión (GRANT a
-- anon, ver abajo). El caller es hostil por default: puede no tener sesión,
-- puede mandar cualquier string en p_codigo, y puede llamarla directo por
-- HTTP/PostgREST sin pasar por ninguna pantalla de la app.
--
-- SUPERFICIE DE DATOS -- lista blanca explícita, nada más que esto:
--   - alumno: nombre (para que el alumno confirme que es SU plan).
--   - gimnasio: nombre, logo_url, color_principal (branding de la página).
--   - rutina asignada ACTIVA (rutinas_asignadas.activa=true, la más
--     reciente): nombre, descripcion, duracion_semanas, items -- con cada
--     item enriquecido con el media_url de su ejercicio (video/imagen
--     demostrativa del Bloque F), ver más abajo.
--   - plan de alimentación más reciente: nombre, notas, items.
-- NUNCA: pagos, deuda, contacto/telefono/email, observaciones_salud,
-- fecha_nacimiento, asistencias, progreso/mediciones, user_id, gimnasio_id
-- crudo, ni ningún dato de OTRO alumno u OTRO gimnasio. Como esta función es
-- SECURITY DEFINER y bypasea RLS por diseño, esta lista blanca de columnas
-- (y el WHERE que resuelve el alumno) es la ÚNICA barrera real -- no hay
-- una policy de RLS por detrás cubriendo el error si acá se filtra de más.
--
-- DECISIÓN: se exige alumnos.activo = true para devolver datos.
-- Un alumno "dado de baja" (activo=false) puede ser por dos motivos en este
-- schema: (a) un profesor lo desactivó explícitamente (dejó de asistir, se
-- fue del gimnasio, deuda, etc.), o (b) es un autorregistro (0004) recién
-- llegado, todavía pendiente de revisión del profesor (origen='autorregistro',
-- nace con activo=false a propósito). En AMBOS casos corresponde que el QR
-- deje de funcionar (o todavía no funcione): para (a), seguir mostrando la
-- rutina/plan a alguien que ya no es socio no tiene sentido de negocio y
-- además prolonga innecesariamente la superficie de un código viejo dando
-- vueltas (impreso, en un chat, etc.) después de que la persona se fue; para
-- (b), el alumno ni siquiera tiene todavía una rutina/plan real asignados
-- por el profesor, así que no hay nada legítimo que mostrar de todas formas.
-- El código NO se borra ni se regenera al desactivar -- si el profesor
-- reactiva al alumno más tarde, el mismo QR ya entregado vuelve a funcionar
-- solo, sin que nadie tenga que reimprimirlo ni reenviarlo.
--
-- Código inválido, inexistente, o de un alumno inactivo -> el MISMO mensaje
-- genérico, sin distinguir el motivo (mismo criterio que
-- join_gimnasio_por_codigo() en 0004): decirle a quien prueba códigos al
-- azar "ese código no existe" vs. "ese código existe pero el alumno está de
-- baja" le regala gratis la señal de que un código puntual SÍ es real.
CREATE OR REPLACE FUNCTION public.ver_plan_por_codigo(
  p_codigo TEXT
) RETURNS TABLE (
  alumno_nombre            TEXT,
  gimnasio_nombre          TEXT,
  gimnasio_logo_url        TEXT,
  gimnasio_color_principal TEXT,
  rutina_nombre            TEXT,
  rutina_descripcion       TEXT,
  rutina_duracion_semanas  INTEGER,
  rutina_items             JSONB,
  plan_nombre              TEXT,
  plan_notas               TEXT,
  plan_items                JSONB
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_alumno_id     UUID;
  v_gimnasio_id   UUID;
  v_alumno_nombre TEXT;
  v_gim_nombre    TEXT;
  v_gim_logo      TEXT;
  v_gim_color     TEXT;
  v_rut_nombre    TEXT;
  v_rut_desc      TEXT;
  v_rut_semanas   INTEGER;
  v_rut_items     JSONB;
  v_plan_nombre   TEXT;
  v_plan_notas    TEXT;
  v_plan_items    JSONB;
  v_contador      INTEGER;
BEGIN
  -- Acotado defensivo de largo de p_codigo ANTES de usarlo en el WHERE.
  -- Mismo motivo y mismo límite que en join_gimnasio_por_codigo()/
  -- listar_planes_para_codigo() (0004): codigo_acceso nunca mide más de 32
  -- caracteres hex (SECCIÓN 2), así que esto no cambia ningún comportamiento
  -- legítimo -- solo evita que un p_codigo de varios MB viaje entero por la
  -- red y se compare igual contra el índice único.
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  -- Resolución del alumno EXCLUSIVAMENTE por el código + activo=true (ver
  -- la DECISIÓN documentada arriba). gimnasio_id sale de ESTA fila, nunca
  -- de un parámetro del caller -- no existe ese parámetro en la firma, a
  -- propósito, mismo criterio que join_gimnasio_por_codigo() en 0004.
  SELECT id, gimnasio_id, nombre
    INTO v_alumno_id, v_gimnasio_id, v_alumno_nombre
  FROM public.alumnos
  WHERE codigo_acceso = p_codigo AND activo = true;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'Código de acceso inválido';
  END IF;

  -- Rate-limit por alumno ya resuelto (ver justificación de diseño completa
  -- en SECCIÓN 1.2). Ventana fija de 5 minutos, tope de 60 consultas: una
  -- persona real recargando la página, revisándola desde el celular y la
  -- compu el mismo rato, o imprimiéndola dos veces, entra sobrado (60 en 5
  -- minutos = 12/min); un script automatizado scrapeando ese código puntual
  -- se corta en seco. Esto NO protege contra adivinar códigos al azar (esa
  -- defensa es la entropía de 128 bits de SECCIÓN 2, no esto) -- protege
  -- contra hostigar un código puntual YA CONOCIDO/filtrado. Igual que en
  -- 0004: esto no sustituye un rate-limit de verdad a nivel de red/edge, es
  -- la mitigación mínima razonable sin agregar infraestructura nueva.
  -- ⚠️ El tope de 60 va DENTRO del WHERE, no en un IF posterior. Esto no es
  -- un detalle de estilo: en la versión anterior el UPDATE corría siempre y
  -- recién después un "IF v_contador > 60 THEN RAISE" abortaba. Como el
  -- RAISE hace rollback de la transacción entera de la llamada RPC, el
  -- contador nunca quedaba por encima de 60 (o sea: SÍ limitaba los datos
  -- devueltos), pero el UPDATE abortado igual generaba una tupla muerta
  -- nueva en MVCC antes de deshacerse -- el abort no evita la escritura
  -- física, solo la hace invisible. Resultado: alguien con UN código válido
  -- podía loopear esta función sin techo, generando WAL y bloat sobre esa
  -- fila indefinidamente; el "límite" limitaba las lecturas pero no las
  -- escrituras, que es justo lo que un rate-limit tiene que frenar.
  -- Con la condición en el WHERE, apenas se alcanza el tope el UPDATE no
  -- matchea ninguna fila: cero tuplas nuevas, cero WAL, y NOT FOUND corta.
  -- Mismo criterio atómico de "una sola sentencia decide y actúa" que ya usa
  -- regenerar_codigo_acceso_alumno() en SECCIÓN 4.
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
    WHERE id = v_alumno_id
      AND (
        plan_consultas_ventana_inicio IS NULL
        OR plan_consultas_ventana_inicio < now() - INTERVAL '5 minutes'
        OR plan_consultas_contador < 60
      )
    RETURNING plan_consultas_contador INTO v_contador;

  -- Mensaje DISTINTO al de "código inválido" a propósito, y no es una
  -- inconsistencia con el criterio de "mensaje genérico" de más arriba: acá
  -- el caller YA demostró conocer un código válido (por eso llegó hasta
  -- este punto) -- distinguir "código inválido" de "código válido pero
  -- estás pidiendo de más" no le regala ninguna señal NUEVA a un atacante
  -- que ya sabía que el código funcionaba (la primera respuesta exitosa con
  -- datos reales ya se lo confirmó). Sirve además para que el frontend
  -- pueda mostrar un mensaje distinto y útil ("probá de nuevo en unos
  -- minutos") en vez de "código inválido" cuando el código en realidad sí
  -- es válido.
  -- (Matiz conocido y aceptado: el contador vive en la fila del alumno, no
  -- por-caller, así que si la ventana ya está saturada por tráfico legítimo,
  -- alguien probando un código al azar podría recibir este mensaje en su
  -- primer intento y deducir que ese código existe. Requiere que la ventana
  -- esté casi llena justo en ese momento y no filtra ningún dato del alumno
  -- -- solo confirma existencia, contra un código que igual tendría que
  -- adivinar entre 2^128.)
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demasiadas consultas en poco tiempo, proba de nuevo en unos minutos';
  END IF;

  -- Branding del gimnasio. Solo las 3 columnas de marca -- NUNCA
  -- gimnasio_id (ya está resuelto server-side, no hace falta exponerlo) ni
  -- codigo_invitacion (0004, no tiene nada que ver con esta pantalla).
  SELECT nombre, logo_url, color_principal
    INTO v_gim_nombre, v_gim_logo, v_gim_color
  FROM public.gimnasios
  WHERE id = v_gimnasio_id;

  -- Rutina asignada ACTIVA más reciente. Mismo criterio que ya usa el
  -- frontend real (CONTEXT.md, bug corregido en Bloque G1): filtrar
  -- activa=true SERVER-SIDE, no traer todas y filtrar en el cliente -- así
  -- un alumno sin ninguna asignación activa (nunca tuvo, o se la quitaron
  -- con "Quitar rutina") da limpio "sin rutina" en vez de resucitar una
  -- vieja desactivada. AND ra.gimnasio_id = v_gimnasio_id es un filtro
  -- redundante a propósito (rutinas_asignadas.alumno_id ya ata la fila al
  -- alumno correcto por FK) -- defensa en profundidad barata, coherente con
  -- que esta función es SECURITY DEFINER y bypasea RLS: no hay policy
  -- corrigiendo un descuido acá si algún día la relación alumno<->tenant se
  -- rompiera por algún bug de otro lado.
  SELECT r.nombre, r.descripcion, r.duracion_semanas, r.items
    INTO v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_items
  FROM public.rutinas_asignadas ra
  JOIN public.rutinas r ON r.id = ra.rutina_id
  WHERE ra.alumno_id = v_alumno_id
    AND ra.gimnasio_id = v_gimnasio_id
    AND ra.activa = true
  ORDER BY ra.created_at DESC
  LIMIT 1;

  -- Enriquecer cada ejercicio de la rutina con su video/imagen demostrativa.
  -- POR QUÉ HACE FALTA: rutinas.items guarda ejercicioId + nombre + grupo +
  -- series/reps/peso/descanso, pero NO el media_url (ver el armador en
  -- RutinasPage.jsx) -- ese vive en la tabla ejercicios. Sin este paso el
  -- alumno leería "Sentadilla 4x10" sin poder ver CÓMO se hace, y todo el
  -- material que el profesor sube en el Bloque F (bucket ejercicios-media)
  -- no le llegaría nunca a quien más lo necesita. Decisión de producto
  -- confirmada con el cliente: el público objetivo es gente mayor, para
  -- quien ver la demostración es más útil que leer la planilla.
  --
  -- No expone nada nuevo: el bucket ejercicios-media ya es de lectura
  -- pública (0005) y media_url también puede ser un link externo (YouTube),
  -- así que la URL no es un secreto -- lo que se agrega es la comodidad de
  -- tenerla al lado del ejercicio. Igual se filtra por gimnasio_id: un
  -- ejercicioId de otro gimnasio no resuelve y queda en NULL.
  --
  -- Detalles defensivos, porque esta función la llama 'anon' y un JSONB roto
  -- no debe voltear la página entera con un 500:
  --   - jsonb_typeof(...) = 'array' antes de expandir: si items fuera un
  --     objeto o un escalar (dato viejo, edición a mano), jsonb_array_elements
  --     lanzaría excepción.
  --   - se compara e.id::text = item->>'ejercicioId' (texto contra texto) en
  --     vez de castear el JSON a UUID: un ejercicioId ausente o malformado
  --     haría fallar el CAST con invalid_input_syntax. Se pierde el uso del
  --     índice por PK, pero una rutina tiene un puñado de ejercicios, no miles.
  --   - WITH ORDINALITY + ORDER BY: jsonb_agg NO garantiza el orden de
  --     entrada por sí solo, y acá el orden importa (es el orden en que el
  --     profesor cargó los ejercicios del día).
  IF v_rut_items IS NOT NULL AND jsonb_typeof(v_rut_items) = 'array' THEN
    SELECT COALESCE(jsonb_agg(s.item_con_media ORDER BY s.ord), '[]'::jsonb)
      INTO v_rut_items
    FROM (
      SELECT
        t.ord,
        t.item || jsonb_build_object(
          'mediaUrl',
          (SELECT e.media_url
             FROM public.ejercicios e
            WHERE e.gimnasio_id = v_gimnasio_id
              AND e.id::text = t.item->>'ejercicioId')
        ) AS item_con_media
      FROM jsonb_array_elements(v_rut_items) WITH ORDINALITY AS t(item, ord)
    ) s;
  END IF;

  -- Plan de alimentación más reciente. planes_alimentacion no tiene
  -- concepto de "activo/activa" en el schema (a diferencia de
  -- rutinas_asignadas) -- "más reciente" es el criterio pedido y el único
  -- disponible. Mismo filtro redundante de gimnasio_id que en rutinas, por
  -- el mismo motivo.
  SELECT pa.nombre, pa.notas, pa.items
    INTO v_plan_nombre, v_plan_notas, v_plan_items
  FROM public.planes_alimentacion pa
  WHERE pa.alumno_id = v_alumno_id
    AND pa.gimnasio_id = v_gimnasio_id
  ORDER BY pa.created_at DESC
  LIMIT 1;

  RETURN QUERY
    SELECT
      v_alumno_nombre,
      v_gim_nombre, v_gim_logo, v_gim_color,
      v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_items,
      v_plan_nombre, v_plan_notas, v_plan_items;
END;
$$;

COMMENT ON FUNCTION public.ver_plan_por_codigo(TEXT) IS
  'SECURITY DEFINER, callable SIN sesión (GRANT a anon, ver abajo). Resuelve el alumno EXCLUSIVAMENTE por codigo_acceso + activo=true (nunca por un id/gimnasio_id del caller). Devuelve la superficie MÍNIMA para la página pública de solo lectura del alumno: su nombre, branding del gimnasio, su rutina asignada activa y su plan de alimentación más reciente -- NUNCA pagos, contacto, salud, asistencias, progreso ni datos de otro alumno/gimnasio. Código inválido, inexistente, o alumno inactivo -> mismo mensaje genérico (no enumerable). Incluye rate-limit por alumno (60 consultas/5min) como defensa en profundidad ante hostigar un código puntual ya conocido.';

-- ⚠️ GRANT A ANON A PROPÓSITO -- NO ES UN ERROR NI UN OLVIDO. El alumno que
-- escanea el QR no tiene sesión y NUNCA la va a tener para esta acción (no
-- existe login de alumno en este proyecto, ver el encabezado del archivo).
-- Si algún día se agrega acá un REVOKE EXECUTE ... FROM anon calcando el
-- patrón de regenerar_codigo_acceso_alumno() (SECCIÓN 4) sin leer este
-- comentario, la página pública del alumno se rompe por completo con
-- "permission denied for function ver_plan_por_codigo". Antes de tocar este
-- GRANT, releer esta sección entera.
REVOKE EXECUTE ON FUNCTION public.ver_plan_por_codigo(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_plan_por_codigo(TEXT) TO anon, authenticated;


-- ============================================================================
-- SECCIÓN 4 — regenerar_codigo_acceso_alumno(): solo staff del propio
-- gimnasio, dueño de ESE alumno puntual
-- ============================================================================
-- A diferencia de regenerar_codigo_invitacion() (0004 SECCIÓN 3, restringida
-- a role='admin'), acá CUALQUIER staff del gimnasio puede regenerar el
-- código -- no solo admin. No es una inconsistencia, es coherencia con el
-- permiso de base ya existente: alumnos_tenant_isolation (0001 SECCIÓN 4.3)
-- es FOR ALL sin restricción de role, así que cualquier staff YA puede
-- editar cualquier columna de cualquier alumno de su gimnasio -- incluida
-- codigo_acceso -- con un UPDATE directo vía PostgREST (alumnos tiene GRANT
-- UPDATE a authenticated desde 0002). Restringir esta función a solo admin
-- daría una falsa sensación de control: el mismo staff no-admin igual
-- podría pisar codigo_acceso a mano con cualquier valor (perdiendo la
-- garantía de 128 bits de entropía, pero sin cruzar ningún límite de tenant
-- porque la policy ya lo circunscribe a SU gimnasio). El valor real de esta
-- función no es restringir MÁS que la tabla, es dar el camino fácil y
-- correcto: genera el valor con la entropía adecuada y maneja la colisión,
-- en vez de que alguien tenga que inventar un string "random" a mano.
--
-- Lo que SÍ es no negociable, y es la única barrera real de esta función
-- (SECURITY DEFINER bypasea RLS): el UPDATE de más abajo exige
-- id = p_alumno_id **Y** gimnasio_id = get_mi_gimnasio_id() en la MISMA
-- sentencia -- nunca un chequeo de permiso separado seguido de un UPDATE
-- "ciego" por id solo. Si p_alumno_id pertenece a OTRO gimnasio, el WHERE
-- no matchea ninguna fila, el UPDATE no toca nada, y el IF NOT FOUND de
-- abajo lo convierte en un error claro -- así un staff nunca puede ni
-- siquiera CONFIRMAR (por la diferencia entre "éxito" y "error") si un
-- p_alumno_id ajeno existe o no en otro gimnasio.
CREATE OR REPLACE FUNCTION public.regenerar_codigo_acceso_alumno(
  p_alumno_id UUID
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nuevo_codigo TEXT;
  intentos     INTEGER := 0;
BEGIN
  -- Loop de reintento por colisión contra el UNIQUE de codigo_acceso, igual
  -- criterio y mismo tope de 10 intentos que regenerar_codigo_invitacion()
  -- (0004 SECCIÓN 3): con 128 bits de entropía la probabilidad real es
  -- indistinguible de cero, esto es defensa en profundidad, no una
  -- expectativa real de que el loop itere más de una vez.
  LOOP
    intentos := intentos + 1;
    -- Mismo motivo que en 0004 (regenerar_codigo_invitacion() y
    -- create_gimnasio()): gen_random_bytes() vive en el schema "extensions"
    -- en Supabase, no en "public", y esta función corre con
    -- SET search_path = public -- hay que calificar el schema explícito o
    -- falla con 42883.
    nuevo_codigo := encode(extensions.gen_random_bytes(16), 'hex');

    BEGIN
      -- FIX YA CONOCIDO, aplicado acá desde el arranque (no como un parche
      -- posterior): regenerar_codigo_invitacion() en 0004 originalmente NO
      -- chequeaba si el UPDATE había afectado alguna fila, y devolvía un
      -- "código nuevo" que jamás se guardó cuando el caller no tenía
      -- gimnasio_id resuelto. Acá el mismo caso (y uno más: p_alumno_id de
      -- OTRO gimnasio, ver advertencia arriba) se cubre con el mismo
      -- patrón: IF NOT FOUND -> RAISE EXCEPTION, nunca un RETURN silencioso
      -- de un valor que no quedó persistido.
      -- Se resetea también la ventana de rate-limit: el caso típico de
      -- regenerar es justamente que el código viejo se filtró y lo están
      -- hostigando, así que el contador puede estar cerca del tope. Sin este
      -- reset, el alumno que recibe el código NUEVO heredaría el castigo del
      -- viejo durante lo que reste de la ventana.
      UPDATE public.alumnos
        SET codigo_acceso = nuevo_codigo,
            plan_consultas_contador = 0,
            plan_consultas_ventana_inicio = NULL
        WHERE id = p_alumno_id
          AND gimnasio_id = public.get_mi_gimnasio_id();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Alumno no encontrado o no pertenece a tu gimnasio';
      END IF;
      EXIT;  -- UPDATE sin error: listo, se sale del loop.
    EXCEPTION WHEN unique_violation THEN
      IF intentos >= 10 THEN
        RAISE EXCEPTION 'No se pudo generar un código de acceso único, reintentar';
      END IF;
      -- Colisión: el loop vuelve a probar con otro código aleatorio.
    END;
  END LOOP;

  RETURN nuevo_codigo;
END;
$$;

COMMENT ON FUNCTION public.regenerar_codigo_acceso_alumno(UUID) IS
  'SECURITY DEFINER: cualquier staff autenticado (no solo admin, ver comentario arriba) puede regenerar el codigo_acceso de un alumno de SU PROPIO gimnasio (chequeo vía get_mi_gimnasio_id() en el mismo WHERE del UPDATE, nunca separado). Genera un código nuevo de 128 bits, lo guarda y lo devuelve -- para invalidar un QR perdido o comprometido sin borrar al alumno ni tocar el resto de sus datos.';

-- Mismo motivo exacto que el REVOKE de regenerar_codigo_invitacion() (0004
-- SECCIÓN 3): Supabase otorga EXECUTE a 'anon' Y a 'authenticated' por
-- defecto en funciones nuevas del schema public (ALTER DEFAULT PRIVILEGES a
-- nivel de proyecto). El REVOKE de PUBLIC por sí solo NO alcanza para
-- sacarle el permiso a 'anon' -- Supabase se lo concede de forma EXPLÍCITA a
-- ese rol nombrado, y un REVOKE dirigido a PUBLIC no toca un grant explícito
-- de un rol nombrado. Acá el REVOKE FROM anon es obligatorio: a diferencia
-- de ver_plan_por_codigo() (SECCIÓN 3), esta función SÍ tiene que quedar
-- fuera del alcance de cualquiera sin sesión -- es una acción de gestión
-- del staff, no una lectura pública.
REVOKE EXECUTE ON FUNCTION public.regenerar_codigo_acceso_alumno(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerar_codigo_acceso_alumno(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.regenerar_codigo_acceso_alumno(UUID) TO authenticated;


-- ============================================================================
-- Fin de la migración 0006.
--
-- Pendiente, fuera de alcance de este archivo (a propósito -- es UI, no
-- schema):
--   - Página pública /plan/:codigo (o similar), sin AuthContext ni
--     ProtectedRoute, igual criterio que /unirse/:codigo (0004): llama
--     ver_plan_por_codigo(codigo) una sola vez al cargar, renderiza rutina +
--     plan, con un botón "Imprimir" que use window.print() (función nativa
--     del navegador, no hace falta ninguna librería de PDF).
--   - Botón "Generar/Regenerar QR" en la ficha del alumno (AlumnoPage o
--     AlumnosPage), análogo al de Configuración para codigo_invitacion
--     (0004): muestra el QR generado client-side (librería qrcode, ya en el
--     proyecto) a partir de alumnos.codigo_acceso, con descarga, y un botón
--     que llame regenerar_codigo_acceso_alumno(alumno_id) si el QR se
--     perdió o se filtró.
--
-- Nota de alcance, NO es un gap de este archivo: la tabla alumnos ya tenía,
-- desde 0001, una policy alumnos_tenant_isolation FOR ALL sin restricción de
-- role -- por lo tanto cualquier staff del gimnasio ya podía (y sigue
-- pudiendo) ver/editar codigo_acceso de un alumno propio con un UPDATE/
-- SELECT directo vía PostgREST, sin pasar por ninguna de las dos funciones
-- de este archivo. Eso es esperado y coherente con el modelo de permisos ya
-- establecido en 0001 (staff de un mismo gimnasio comparte acceso total a
-- los datos de ESE gimnasio) -- no es un bug nuevo que introduzca esta
-- migración, y no había forma de "arreglarlo" acá sin cambiar una policy
-- existente que el encargo de esta migración pidió explícitamente no tocar.
-- ============================================================================
