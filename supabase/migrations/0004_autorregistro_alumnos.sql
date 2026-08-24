-- ============================================================================
-- 0004_autorregistro_alumnos.sql
-- Autorregistro de alumnos por código de invitación + QR (Decisión 8 del
-- PLAN.md, checklist E4/E5/E6).
--
-- Cubre:
--   E4. gimnasios.codigo_invitacion + gimnasios.autorregistro_activo,
--       generado en create_gimnasio() y con backfill para filas existentes.
--   E5. join_gimnasio_por_codigo() (alta pública del alumno) +
--       listar_planes_para_codigo() (para poblar el <select> de planes en
--       la pantalla pública, sin exponer configuracion_precios entera).
--   E6. (fuera de este archivo — es UI: generar/mostrar el QR a partir de
--       codigo_invitacion, que ya queda disponible acá). Se suma además
--       regenerar_codigo_invitacion() para que el admin pueda invalidar un
--       código filtrado sin tocar la base a mano.
--
-- Migración ADITIVA sobre 0001: no se toca RLS de ninguna tabla existente
-- ni sus GRANT de tabla (0002). Las funciones nuevas son todas SECURITY
-- DEFINER y bypasean RLS por diseño, igual que create_gimnasio() en 0001 —
-- el control de acceso vive en la lógica de la función, no en policies
-- nuevas sobre alumnos/configuracion_precios.
--
-- ⚠️ ADVERTENCIA DE ARQUITECTURA — LEER ANTES DE TOCAR ESTE ARCHIVO:
-- join_gimnasio_por_codigo() (SECCIÓN 4) es la ÚNICA superficie de
-- escritura pública (sin login, callable por 'anon') de todo el proyecto
-- hasta ahora. Todo lo demás en 0001-0003 exige sesión autenticada. Por
-- eso este archivo es más denso en comentarios de seguridad que los
-- anteriores: cualquier cambio acá tiene que revisarse con la misma
-- seriedad que un endpoint público de internet, porque literalmente lo es.
--
-- Pensado para pegarse ENTERO y de una sola vez en el SQL Editor de
-- Supabase. No requiere la Supabase CLI ni ejecución por partes.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 — Columnas nuevas
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1.1 gimnasios.codigo_invitacion + autorregistro_activo
-- --------------------------------------------------------------------------
-- codigo_invitacion se agrega primero SIN NOT NULL/UNIQUE: no se puede
-- meter una constraint NOT NULL de una en el mismo ALTER TABLE que agrega
-- la columna cuando ya hay filas existentes (hoy hay 1 gimnasio real en la
-- base) — quedarían todas en NULL y la constraint fallaría en el acto. El
-- orden correcto es: (a) columna nullable, (b) backfill con UPDATE, (c)
-- agregar NOT NULL y UNIQUE recién después de que todas las filas tengan
-- un valor. Ver SECCIÓN 2 para el backfill.
ALTER TABLE public.gimnasios
  ADD COLUMN codigo_invitacion TEXT,
  ADD COLUMN autorregistro_activo BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.gimnasios.codigo_invitacion IS
  'Código público (se comparte como link/QR) para que un alumno se autorregistre vía join_gimnasio_por_codigo(). NO es un secreto de sesión ni reemplaza autenticación — es más parecido a un "código de sala" que a una contraseña: si se filtra, el peor caso es que gente ajena se autorregistre como alumno pendiente de activación (activo=false, revisado por el profesor antes de contar como alta real), NUNCA acceso de lectura/escritura al resto del gimnasio. Aun así se genera no-adivinable (16 bytes aleatorios de pgcrypto, ver SECCIÓN 2) para que no sea practicable enumerarlo por fuerza bruta ni adivinarlo por patrón, y es regenerable sin downtime vía regenerar_codigo_invitacion() (SECCIÓN 3) si igual se filtra o se quiere pausar la campaña.';

COMMENT ON COLUMN public.gimnasios.autorregistro_activo IS
  'Permite al admin apagar el autorregistro (ej. código filtrado, o cupo cerrado) SIN perder ni regenerar codigo_invitacion. join_gimnasio_por_codigo() y listar_planes_para_codigo() exigen autorregistro_activo = true además de un código válido.';


-- ============================================================================
-- SECCIÓN 2 — Backfill de codigo_invitacion para filas existentes
-- ============================================================================
-- gen_random_bytes(16) -> encode(..., 'hex') = 32 caracteres hexadecimales
-- = 128 bits de entropía. Tamaño elegido a propósito, no es un número
-- arbitrario: es el mismo orden de magnitud que un UUID v4 (122 bits
-- efectivos) o un token de sesión típico — muy por encima de lo que hace
-- falta para que la fuerza bruta sea impracticable (10 caracteres hex al
-- azar ya darían 40 bits y tomaría años a fuerza bruta razonable; acá hay
-- muchísimo margen extra porque el costo de un código más largo es cero:
-- no lo tipea nadie a mano, viaja en un link/QR). encode(gen_random_bytes)
-- usa pgcrypto, ya habilitado en 0001 SECCIÓN 0.
--
-- Este UPDATE corre UNA sola vez, acá, para las filas que ya existían
-- antes de esta migración (hoy: 1 gimnasio real). Las filas nuevas de acá
-- en adelante ya nacen con codigo_invitacion generado por create_gimnasio()
-- (SECCIÓN 5), así que este backfill nunca vuelve a tener trabajo que
-- hacer en el futuro — se deja igual en el archivo porque la migración
-- tiene que ser reproducible de punta a punta en un ambiente nuevo (ej.
-- staging) donde también arranca en NULL.
UPDATE public.gimnasios
  SET codigo_invitacion = encode(gen_random_bytes(16), 'hex')
  WHERE codigo_invitacion IS NULL;

-- Recién ahora, con todas las filas pobladas, se puede exigir NOT NULL y
-- UNIQUE. UNIQUE es lo que hace que join_gimnasio_por_codigo() pueda
-- confiar en que "WHERE codigo_invitacion = p_codigo" resuelve como mucho
-- una fila — si dos gimnasios pudieran compartir código, un alumno se
-- autorregistraría en el gimnasio equivocado (o en ambos, según qué fila
-- devuelva el WHERE), que es exactamente el tipo de mezcla entre tenants
-- que este schema existe para evitar.
ALTER TABLE public.gimnasios
  ALTER COLUMN codigo_invitacion SET NOT NULL,
  ADD CONSTRAINT gimnasios_codigo_invitacion_key UNIQUE (codigo_invitacion);


-- --------------------------------------------------------------------------
-- 1.2 alumnos.origen
-- --------------------------------------------------------------------------
-- A diferencia de codigo_invitacion, esta sí se puede agregar con NOT NULL
-- de una: tiene DEFAULT 'manual', así que Postgres lo usa para llenar las
-- filas existentes en el mismo ALTER TABLE, sin necesitar un UPDATE previo
-- ni dos pasos separados.
ALTER TABLE public.alumnos
  ADD COLUMN origen TEXT NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('manual', 'autorregistro'));

COMMENT ON COLUMN public.alumnos.origen IS
  'Valor "manual": alta cargada a mano por el profesor/staff. Valor "autorregistro": alta creada por el propio alumno vía join_gimnasio_por_codigo() (SECCIÓN 4), sin login — nace con activo=false a propósito, pendiente de revisión. Es solo informativo para la UI (ej. filtro "pendientes de revisar" o un badge); no cambia ningún control de acceso ni policy de RLS.';


-- ============================================================================
-- SECCIÓN 3 — regenerar_codigo_invitacion(): solo admin del propio gimnasio
-- ============================================================================
CREATE OR REPLACE FUNCTION public.regenerar_codigo_invitacion()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nuevo_codigo TEXT;
  intentos INTEGER := 0;
BEGIN
  -- Mismo chequeo que la policy "gimnasios_update_admin" de 0001 SECCIÓN
  -- 4.1: solo admin, y solo sobre SU PROPIO gimnasio (get_mi_gimnasio_id()
  -- resuelve el tenant del caller vía profiles, no vía un parámetro que
  -- pudiera venir manipulado). Se re-implementa acá el mismo EXISTS en vez
  -- de depender de la policy de gimnasios porque esta función es SECURITY
  -- DEFINER y por lo tanto bypasea RLS — si no repitiéramos el chequeo acá
  -- adentro, cualquier usuario autenticado (no solo admin) podría invocarla
  -- y regenerar el código de invitación de su gimnasio.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Solo un admin puede regenerar el código de invitación';
  END IF;

  -- Loop de reintento por si acaso hay colisión contra el UNIQUE de
  -- codigo_invitacion. Con 128 bits de entropía (ver SECCIÓN 2) la
  -- probabilidad real es indistinguible de cero incluso con miles de
  -- gimnasios en la base — esto es defensa en profundidad, no una
  -- expectativa real de que el loop itere más de una vez. 10 intentos como
  -- techo de seguridad para no dejar la función en un loop infinito si
  -- algún día gen_random_bytes se rompe o el espacio de códigos se achica
  -- por error en un cambio futuro.
  LOOP
    intentos := intentos + 1;
    -- FIX (verificación en vivo, 2026-08-24, antes de dar por cerrado el
    -- bloque): en Supabase pgcrypto vive en el schema "extensions", NO en
    -- "public" (confirmado con pg_extension contra la base real). Con
    -- SET search_path = public en esta función, gen_random_bytes() sin
    -- calificar fallaba con "function gen_random_bytes(integer) does not
    -- exist" -- el backfill de la SECCIÓN 2 no tuvo este problema porque
    -- corre como SQL suelto con el search_path de sesión por defecto
    -- ("$user", public, extensions), no con el search_path restringido de
    -- una función. Acá adentro hay que calificar el schema explícitamente.
    nuevo_codigo := encode(extensions.gen_random_bytes(16), 'hex');

    BEGIN
      UPDATE public.gimnasios
        SET codigo_invitacion = nuevo_codigo
        WHERE id = public.get_mi_gimnasio_id();

      -- FIX (AppSec review, 2026-08-24, previo a la primera ejecución de
      -- esta migración): sin este chequeo, un caller con role='admin'
      -- pero gimnasio_id NULL (alcanzable HOY vía el gap ya conocido de
      -- profiles_update_self -- un usuario recién registrado, sin
      -- gimnasio propio todavía, puede autoasignarse role='admin' sin
      -- tener gimnasio_id seteado, ver advertencia al final del archivo)
      -- pasaba el EXISTS de arriba, pero el UPDATE de acá no tocaba
      -- ninguna fila (WHERE id = NULL nunca matchea en SQL). Sin este IF
      -- NOT FOUND, la función salía del loop igual (EXIT, sin excepción)
      -- y devolvía un nuevo_codigo que JAMÁS se guardó en ninguna fila
      -- real -- una falla silenciosa (no una fuga entre tenants: no hay
      -- ningún gimnasio real involucrado en este caso), pero sí un
      -- resultado engañoso para quien la llama.
      IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontro un gimnasio asociado a este usuario';
      END IF;
      EXIT;  -- UPDATE sin error: listo, se sale del loop.
    EXCEPTION WHEN unique_violation THEN
      IF intentos >= 10 THEN
        RAISE EXCEPTION 'No se pudo generar un código de invitación único, reintentar';
      END IF;
      -- Colisión: el loop vuelve a probar con otro código aleatorio.
    END;
  END LOOP;

  RETURN nuevo_codigo;
END;
$$;

COMMENT ON FUNCTION public.regenerar_codigo_invitacion() IS
  'SECURITY DEFINER: solo admin del propio gimnasio (chequeo interno vía get_mi_gimnasio_id() + role admin, análogo a gimnasios_update_admin de 0001). Genera un codigo_invitacion nuevo de 128 bits, lo guarda y lo devuelve — para invalidar un código filtrado sin perder la fila del gimnasio ni desactivar autorregistro_activo.';

-- Mismo motivo que create_gimnasio() en 0001 SECCIÓN 5: Supabase otorga
-- EXECUTE a 'anon' Y a 'authenticated' por defecto en funciones nuevas del
-- schema public (ALTER DEFAULT PRIVILEGES a nivel de proyecto). El REVOKE
-- de PUBLIC por sí solo NO alcanza para sacarle el permiso a 'anon',
-- porque Supabase se lo concede de forma EXPLÍCITA a ese rol nombrado, y
-- un REVOKE dirigido a PUBLIC no toca un grant explícito de un rol
-- nombrado — por eso el REVOKE ... FROM anon de abajo es obligatorio, no
-- redundante. Acá el motivo es más fuerte todavía que en create_gimnasio():
-- sin este revoke, cualquiera sin login podría invalidar el código de
-- invitación de CUALQUIER gimnasio... salvo que el EXISTS de arriba exige
-- role='admin' vía profiles, y un caller anónimo tiene auth.uid() = NULL,
-- así que el EXISTS ya lo bloquearía igual. Se deja el REVOKE explícito de
-- todas formas como defensa en profundidad y para no depender de que ese
-- chequeo interno sea la única barrera.
REVOKE EXECUTE ON FUNCTION public.regenerar_codigo_invitacion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerar_codigo_invitacion() FROM anon;
GRANT EXECUTE ON FUNCTION public.regenerar_codigo_invitacion() TO authenticated;


-- ============================================================================
-- SECCIÓN 4 — join_gimnasio_por_codigo(): alta pública del alumno
-- ============================================================================
-- ⚠️ FUNCIÓN MÁS SENSIBLE DE ESTE ARCHIVO. Es la ÚNICA superficie de
-- escritura pública (callable sin sesión, por el rol 'anon') de todo el
-- proyecto hasta ahora. Todo lo que sigue está pensado bajo la premisa de
-- que el caller es hostil por default: puede no tener sesión, puede mandar
-- cualquier string en cualquier parámetro, y puede llamarla directo por
-- HTTP/PostgREST sin pasar por ninguna pantalla de la app.
--
-- Superficie de daño si algo de esto falla mal:
--   - gimnasio_id NUNCA sale de un parámetro del caller (no existe ese
--     parámetro en la firma, a propósito) — sale exclusivamente de resolver
--     codigo_invitacion contra la tabla gimnasios. Es la misma regla de
--     "nunca confiar en un gimnasio_id que venga del cliente" que ya rige
--     en el resto del schema, acá aplicada al caso más peligroso posible
--     porque ni siquiera hay un JWT de por medio.
--   - El alumno nace con activo = false SIEMPRE, sin excepción y sin que
--     el caller pueda pedir otra cosa (no hay parámetro p_activo). Esto es
--     lo que evita que el autorregistro público equivalga a "cualquiera en
--     internet se da de alta como socio activo": queda pendiente de que el
--     profesor lo revise y lo active a mano, igual que si lo hubiera
--     cargado un desconocido por teléfono.
--   - En el peor caso de abuso (spam de altas contra un código real, o
--     alguien probando códigos al azar hasta acertar uno) el daño queda
--     acotado a filas de alumnos con activo=false amontonadas en un
--     gimnasio puntual — no hay forma de leer ni escribir nada de otro
--     tenant desde acá, y no hay forma de que una fila así llegue a
--     "activa" sin que un admin/staff de ESE gimnasio la toque
--     explícitamente después, logueado, pasando por las policies normales
--     de la SECCIÓN 4 de 0001.
CREATE OR REPLACE FUNCTION public.join_gimnasio_por_codigo(
  p_codigo TEXT,
  p_nombre TEXT,
  p_contacto TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_plan_precio_nombre TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gimnasio_id UUID;
BEGIN
  -- Resolución del tenant EXCLUSIVAMENTE por el código, exigiendo además
  -- autorregistro_activo = true. Mensaje de error GENÉRICO a propósito:
  -- no hay que distinguir entre "el código no existe" y "el código existe
  -- pero está pausado", porque diferenciarlos le regala a un atacante una
  -- señal gratis de que un código puntual SÍ es real (solo que está
  -- desactivado) — información que no necesita para nada legítimo, y que
  -- sí le sirve para, por ejemplo, guardar ese código y reintentar más
  -- tarde si detecta que se reactivó, o para descartar más rápido códigos
  -- inválidos al hacer fuerza bruta.
  -- Acotado defensivo de largo de p_codigo ANTES de usarlo en el WHERE:
  -- mismo motivo que el left(...,200) aplicado más abajo a
  -- nombre/contacto/email/plan, pero acá hace falta ANTES de la consulta,
  -- no después. codigo_invitacion nunca mide más de 32 caracteres hex
  -- (SECCIÓN 2), así que cualquier valor más largo que eso jamás matchea
  -- un código real de todas formas (falla cerrado, no cambia ningún
  -- comportamiento legítimo) -- pero sin este corte, un caller hostil
  -- podría mandar un p_codigo de varios MB en el body del POST, y ese
  -- string gigante viajaría entero por la red y se compararía igual
  -- contra el índice único, gastando ancho de banda y memoria de la
  -- conexión para nada.
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id INTO v_gimnasio_id
  FROM public.gimnasios
  WHERE codigo_invitacion = p_codigo AND autorregistro_activo = true;

  IF v_gimnasio_id IS NULL THEN
    RAISE EXCEPTION 'Código de invitación inválido';
  END IF;

  -- Rate-limit liviano por tenant, defensa en profundidad ante spam/loop
  -- contra un código real (ver la advertencia grande de esta SECCIÓN
  -- sobre el peor caso de abuso): activo=false y el aislamiento por
  -- tenant ya acotan el daño de fondo (nunca hay fuga ni escritura
  -- cruzada), pero nada impedía hasta ahora que alguien amontone miles de
  -- filas basura en minutos contra un código compartido a propósito (QR
  -- en la pared del gimnasio). Umbral generoso a propósito: 50 altas de
  -- origen='autorregistro' en 5 minutos para el MISMO gimnasio deja
  -- margen de sobra para el caso legítimo más exigente que se nos ocurre
  -- (un profesor mostrando el QR a una clase completa un día de puertas
  -- abiertas) y aun así corta en seco un loop automatizado antes de que
  -- el panel de "pendientes de revisar" del profesor se vuelva
  -- inservible. El LIMIT 50 dentro de la subconsulta (en vez de un
  -- COUNT(*) sin límite) hace que Postgres corte de leer apenas encuentra
  -- la fila 51, no escanee de más. Esto NO sustituye un rate-limit de
  -- verdad a nivel de red/edge (fuera del alcance de este archivo, que es
  -- solo SQL) -- es la mitigación mínima razonable que se puede poner acá
  -- adentro sin agregar infraestructura nueva. Si en la práctica hace
  -- falta más (ej. Supabase Edge Function con rate-limit por IP, o un
  -- WAF), el admin igual tiene autorregistro_activo y
  -- regenerar_codigo_invitacion() como palanca de emergencia mientras
  -- tanto.
  IF (
    SELECT count(*) FROM (
      SELECT 1 FROM public.alumnos
      WHERE gimnasio_id = v_gimnasio_id
        AND origen = 'autorregistro'
        AND created_at > now() - INTERVAL '5 minutes'
      LIMIT 50
    ) reciente
  ) >= 50 THEN
    RAISE EXCEPTION 'Demasiadas solicitudes de autorregistro en poco tiempo, proba de nuevo en unos minutos';
  END IF;

  -- Validación de p_nombre: obligatorio y no vacío después de btrim(). No
  -- alcanza con NOT NULL de la columna (alumnos.nombre ya es NOT NULL):
  -- un caller hostil puede mandar '' o '   ' y pasaría igual esa
  -- constraint, generando una fila de alumno inservible para el profesor.
  IF p_nombre IS NULL OR btrim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;

  -- Acotado defensivo de largo de TODOS los campos de texto que vienen del
  -- caller, aplicado DESPUÉS de la validación de arriba (para que el
  -- mensaje de "nombre obligatorio" se dispare sobre el valor real, no
  -- sobre uno ya truncado). Esta es una función pública sin autenticar:
  -- no hay ningún control de tamaño de payload aguas arriba en el que se
  -- pueda confiar (a diferencia del resto de las tablas, donde solo un
  -- usuario ya logueado -y por lo tanto ya identificado- puede mandar un
  -- INSERT). Los límites son generosos para uso normal (un nombre de
  -- persona o un plan no necesitan más de esto) pero cortan de raíz un
  -- INSERT con un string de varios MB pensado para inflar el tamaño de la
  -- tabla o de los índices.
  p_nombre             := left(btrim(p_nombre), 200);
  p_contacto           := left(p_contacto, 200);
  p_email              := left(p_email, 200);
  p_plan_precio_nombre := left(p_plan_precio_nombre, 200);

  INSERT INTO public.alumnos (
    gimnasio_id, nombre, contacto, email, plan_precio_nombre,
    fecha_alta, activo, origen
  ) VALUES (
    v_gimnasio_id,        -- SIEMPRE el resuelto por el código, NUNCA un
                           -- valor del caller: no existe parámetro
                           -- gimnasio_id en la firma, a propósito.
    p_nombre,
    p_contacto,
    p_email,
    p_plan_precio_nombre,
    CURRENT_DATE,
    false,                -- A PROPÓSITO: pendiente de revisión del
                           -- profesor, nunca se autoactiva desde acá.
    'autorregistro'
  );

  -- RETURNS VOID a propósito: el caller es anónimo, no tiene sesión ni
  -- forma legítima de usar el id insertado después (no puede hacer un
  -- SELECT posterior contra alumnos, RLS se lo bloquearía igual). Devolver
  -- el id no aportaría nada y sí sería una superficie extra para pensar en
  -- términos de seguridad sin necesidad.
END;
$$;

COMMENT ON FUNCTION public.join_gimnasio_por_codigo(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'SECURITY DEFINER, callable SIN sesión (GRANT a anon, ver abajo). Resuelve el gimnasio EXCLUSIVAMENTE por codigo_invitacion + autorregistro_activo=true (nunca por un gimnasio_id del caller). Inserta el alumno con activo=false y origen=''autorregistro'' — queda pendiente de que el profesor lo revise y active. Única superficie de escritura pública sin login de todo el proyecto.';

-- ⚠️ GRANT A ANON A PROPÓSITO — NO ES UN ERROR NI UN OLVIDO. Ver el
-- comentario grande arriba de la función: a diferencia de TODAS las demás
-- funciones de este proyecto (create_gimnasio en 0001, y
-- regenerar_codigo_invitacion más arriba en este mismo archivo, ambas
-- restringidas a 'authenticated'), join_gimnasio_por_codigo() tiene que
-- poder ser llamada por alguien que TODAVÍA NO SE REGISTRÓ — un visitante
-- que escaneó el QR del gimnasio no tiene sesión, y no la va a tener nunca
-- para esta acción puntual (el autorregistro no crea un usuario de
-- auth.users, solo una fila en alumnos). Si algún día se agrega acá un
-- 'REVOKE EXECUTE ... FROM anon' calcando el patrón de las otras
-- funciones (por ejemplo copiando y pegando sin leer este comentario), la
-- pantalla pública de autorregistro se rompe por completo con "permission
-- denied for function join_gimnasio_por_codigo" y deja de cumplir su único
-- propósito. Antes de tocar este GRANT, releer esta sección entera.
REVOKE EXECUTE ON FUNCTION public.join_gimnasio_por_codigo(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_gimnasio_por_codigo(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;


-- ============================================================================
-- SECCIÓN 5 — listar_planes_para_codigo(): planes activos para un código
-- ============================================================================
-- Misma superficie pública que join_gimnasio_por_codigo() (SECCIÓN 4):
-- necesaria para poblar el <select> "qué plan querés" en la MISMA pantalla
-- pública de autorregistro, ANTES de que el visitante tenga sesión. Es de
-- solo lectura y devuelve una proyección deliberadamente mínima — nombre,
-- precio y periodo, nada más — de configuracion_precios: ni id, ni
-- gimnasio_id (ya lo reveló el propio código que el visitante ya tiene),
-- ni descuento/interes_mora (esos son datos de gestión interna del
-- gimnasio, no algo que un visitante sin login necesite ni deba ver).
CREATE OR REPLACE FUNCTION public.listar_planes_para_codigo(
  p_codigo TEXT
) RETURNS TABLE (
  nombre  TEXT,
  precio  NUMERIC,
  periodo TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gimnasio_id UUID;
BEGIN
  -- Mismo criterio de resolución que join_gimnasio_por_codigo(): código
  -- válido Y autorregistro_activo = true.
  -- Acotado defensivo de largo de p_codigo ANTES de usarlo en el WHERE,
  -- mismo motivo y mismo límite que en join_gimnasio_por_codigo() (ver el
  -- comentario grande en SECCIÓN 4): codigo_invitacion nunca mide más de
  -- 32 caracteres hex (SECCIÓN 2), así que esto no cambia ningún
  -- comportamiento legítimo, solo evita que un p_codigo de varios MB viaje
  -- entero por la red y se compare igual contra el índice único.
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id INTO v_gimnasio_id
  FROM public.gimnasios
  WHERE codigo_invitacion = p_codigo AND autorregistro_activo = true;

  -- A diferencia de join_gimnasio_por_codigo(), acá NO hace falta
  -- RAISE EXCEPTION si el código no es válido: esta función es de solo
  -- lectura y no tiene ningún efecto que "fallar silenciosamente" pueda
  -- esconder. Devolver cero filas para un código inválido es información
  -- equivalente (y tan genérica como) la de un código válido sin ningún
  -- plan activo — no hay diferencia observable entre ambos casos, así que
  -- no hay señal extra que filtrarle a quien esté probando códigos al azar.
  IF v_gimnasio_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT cp.nombre, cp.precio, cp.periodo
    FROM public.configuracion_precios cp
    WHERE cp.gimnasio_id = v_gimnasio_id AND cp.activo = true;
END;
$$;

COMMENT ON FUNCTION public.listar_planes_para_codigo(TEXT) IS
  'SECURITY DEFINER, callable SIN sesión (GRANT a anon, ver abajo, mismo motivo que join_gimnasio_por_codigo()). Devuelve SOLO nombre/precio/periodo de configuracion_precios activos del gimnasio resuelto por el código — superficie mínima para poblar el <select> de planes en la pantalla pública de autorregistro. Código inválido o autorregistro_activo=false -> cero filas, sin RAISE (es de solo lectura, no hay nada que proteger distinguiendo los casos).';

-- Mismo motivo exacto que el GRANT a anon de join_gimnasio_por_codigo()
-- (SECCIÓN 4): esta función también corre ANTES de que el visitante tenga
-- sesión, en la misma pantalla pública. GRANT A ANON A PROPÓSITO — no
-- calcar acá el patrón de REVOKE FROM anon usado en create_gimnasio() /
-- regenerar_codigo_invitacion(), o se rompe el <select> de planes de la
-- pantalla de autorregistro.
REVOKE EXECUTE ON FUNCTION public.listar_planes_para_codigo(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_planes_para_codigo(TEXT) TO anon, authenticated;


-- ============================================================================
-- SECCIÓN 6 — create_gimnasio(): ahora genera también codigo_invitacion
-- ============================================================================
-- CREATE OR REPLACE sobre la función de 0001 SECCIÓN 5. Único cambio real:
-- el INSERT de gimnasios ahora también genera codigo_invitacion en la
-- misma sentencia (mismo criterio de aleatoriedad que SECCIÓN 2: 16 bytes
-- de gen_random_bytes -> 32 caracteres hex, 128 bits de entropía). El
-- resto de la función (promoción a admin, siembra de configuracion_precios,
-- la advertencia sobre ON CONFLICT y el índice único parcial) queda
-- textualmente igual que en 0001 — se pega completa acá porque
-- CREATE OR REPLACE FUNCTION reemplaza el cuerpo entero, no se puede
-- "parchear" solo una línea de una función ya creada.
--
-- Nota sobre colisión de codigo_invitacion acá: a diferencia de
-- regenerar_codigo_invitacion() (SECCIÓN 3), esta función NO tiene un loop
-- de reintento. Es una decisión consciente, no un descuido: con 128 bits
-- de entropía la probabilidad de colisión es indistinguible de cero (ver
-- SECCIÓN 2), y agregar acá el mismo manejo de excepción por
-- unique_violation complicaría una función que además hace dos INSERT más
-- (profiles, configuracion_precios) dentro de la misma transacción
-- implícita — si en algún futuro lejano esto llegara a colisionar en la
-- práctica (señal de que gen_random_bytes está roto, no de mala suerte),
-- el alta de gimnasio fallaría con un error claro de unique_violation en
-- vez de silenciarlo, que es el comportamiento correcto por defecto.
CREATE OR REPLACE FUNCTION public.create_gimnasio(
  nombre_gimnasio TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nueva_gimnasio_id UUID;
BEGIN
  -- FIX (verificación en vivo, 2026-08-24): mismo motivo que el fix de
  -- regenerar_codigo_invitacion() (SECCIÓN 3) -- gen_random_bytes() vive en
  -- el schema "extensions" en Supabase, no en "public", y esta función
  -- corre con SET search_path = public.
  INSERT INTO public.gimnasios (nombre, codigo_invitacion)
  VALUES (nombre_gimnasio, encode(extensions.gen_random_bytes(16), 'hex'))
    RETURNING id INTO nueva_gimnasio_id;

  UPDATE public.profiles
    SET gimnasio_id = nueva_gimnasio_id, role = 'admin'
    WHERE id = auth.uid();

  -- Siembra de planes de ejemplo. Sin ON CONFLICT hoy porque el único
  -- UNIQUE de la tabla es (gimnasio_id, nombre) y nueva_gimnasio_id recién
  -- se creó en esta misma transacción, así que no puede haber choque.
  --
  -- ADVERTENCIA (lección de producción de Kairox Gestión, dejarla acá para
  -- el futuro): si más adelante se agrega un ÍNDICE ÚNICO PARCIAL a
  -- configuracion_precios (ej. UNIQUE(gimnasio_id, nombre) WHERE activo)
  -- y en algún momento se decide usar ON CONFLICT en esta siembra para
  -- hacerla idempotente, el predicado del ON CONFLICT tiene que repetir
  -- EXACTAMENTE el mismo WHERE que el índice parcial (mismas columnas Y
  -- mismo predicado), o el alta de gimnasio nuevo se rompe en silencio
  -- (Postgres no matchea el índice y el INSERT falla o duplica). Si eso
  -- pasa, actualizar este INSERT junto con el índice, no por separado.
  INSERT INTO public.configuracion_precios (gimnasio_id, nombre, precio, periodo, activo)
  VALUES
    (nueva_gimnasio_id, 'Mensual', 0, 'mensual', true),
    (nueva_gimnasio_id, 'Trimestral', 0, 'trimestral', true);

  RETURN nueva_gimnasio_id;
END;
$$;

COMMENT ON FUNCTION public.create_gimnasio(TEXT) IS
  'SECURITY DEFINER: crea el gimnasio (con codigo_invitacion generado en el mismo INSERT), promueve al usuario actual a admin de ese gimnasio y siembra configuracion_precios de ejemplo. Es la ÚNICA vía de alta de un gimnasio nuevo (no hay policy de INSERT directa sobre gimnasios).';

-- Los GRANT/REVOKE de create_gimnasio() ya están aplicados desde 0001 y no
-- cambian con este REPLACE (REPLACE conserva los privilegios existentes
-- sobre la función, no hace falta repetirlos). Se dejan igual, comentados,
-- para que quede a la vista en este mismo archivo que la función sigue
-- restringida a 'authenticated' después del cambio:
--   REVOKE EXECUTE ON FUNCTION public.create_gimnasio(TEXT) FROM PUBLIC;
--   REVOKE EXECUTE ON FUNCTION public.create_gimnasio(TEXT) FROM anon;
--   GRANT EXECUTE ON FUNCTION public.create_gimnasio(TEXT) TO authenticated;


-- ============================================================================
-- Fin de la migración 0004.
--
-- Pendiente, fuera de alcance de este archivo (a propósito — es UI, no
-- schema):
--   - E6: página de Configuración que genere y muestre el QR a partir de
--     gimnasios.codigo_invitacion (librería de QR en el frontend, ej.
--     qrcode.react) + botón "Regenerar código" que llame a
--     regenerar_codigo_invitacion() + toggle de autorregistro_activo
--     (UPDATE directo sobre gimnasios, ya cubierto por la policy
--     gimnasios_update_admin de 0001 — no necesita una función nueva).
--   - Pantalla pública /join/:codigo (sin AuthContext, sin sesión): llama
--     listar_planes_para_codigo(codigo) para el <select> y
--     join_gimnasio_por_codigo(codigo, nombre, ...) al confirmar.
--   - Vista de "alumnos pendientes de revisar" en el panel del profesor:
--     filtro WHERE origen = 'autorregistro' AND activo = false, ya
--     resuelto por las policies normales de alumnos (0001 SECCIÓN 4.3,
--     alumnos_tenant_isolation) — ningún cambio de RLS necesario para eso.
--
-- Pendiente ya identificado y diferido en 0001/0003 (no es nuevo de este
-- archivo, se repite acá porque este archivo suma una función SECURITY
-- DEFINER más al mismo patrón, y además CAMBIA el cálculo de impacto, ver
-- más abajo): profiles_update_self sigue permitiendo que un staff se
-- autoasigne role='admin' dentro de su propio tenant vía
--   UPDATE profiles SET role='admin' WHERE id = auth.uid();
-- lo que ya le abre la puerta a llamar regenerar_codigo_invitacion() (el
-- chequeo de esta SECCIÓN 3 es exactamente role='admin', igual que
-- gimnasios_update_admin de 0001). Sigue siendo estrictamente
-- INTRA-tenant, no hay fuga entre tenants -- pero esta revisión
-- (AppSec, 2026-08-24) SÍ ajusta la severidad respecto a como estaba
-- clasificado en 0001/0003, en un sentido puntual:
--
--   - Antes de 0004, el techo del abuso era "ver/hacer más cosas
--     administrativas dentro del propio gimnasio" (ej. recolorear la
--     app, reemplazar el logo) -- daño acotado y de bajo incentivo,
--     porque el atacante YA es alguien con acceso legítimo a ese mismo
--     tenant.
--   - Con 0004, el mismo gap habilita además SABOTAJE de disponibilidad:
--     invalidar el codigo_invitacion REAL de producción (el que puede
--     estar impreso en un cartel o QR físico en la pared del gimnasio),
--     sin pasar por ningún admin. Es un vector de mayor impacto e
--     incentivo más realista (empleado no-admin descontento, o cuenta de
--     staff comprometida por phishing, sin necesitar comprometer la
--     cuenta del admin real).
--
-- Con el flujo de producto ACTUAL este segundo escenario todavía no es
-- explotable en la práctica: hoy no existe ninguna forma de que un
-- profile termine con gimnasio_id apuntando a un gimnasio REAL sin ser
-- YA admin de ese gimnasio (la única vía de asignar gimnasio_id es
-- create_gimnasio(), SECCIÓN 6, que promueve a admin en la misma
-- sentencia) -- así que "staff no-admin auto-promovido de un gimnasio
-- con datos reales" no es un estado alcanzable todavía, no hay feature
-- de "invitar staff" implementada. Pero apenas se agregue esa feature
-- (el propio esquema de profiles con role admin/staff ya la anticipa),
-- el escenario de arriba pasa de teórico a explotable de inmediato el
-- mismo día que se habilite, así que el fix diferido (trigger BEFORE
-- UPDATE, o REVOKE de columna sobre profiles.role/profiles.gimnasio_id,
-- ambos ya identificados en 0001 SECCIÓN 4.2) debería aplicarse ANTES o
-- JUNTO con esa feature, no después -- sube de prioridad "eventual" a
-- "bloqueante de esa migración puntual", aunque sigue, correctamente,
-- fuera del alcance de ESTE archivo.
--
-- Aparte de esa reclasificación, esta misma revisión (2026-08-24)
-- corrigió acá mismo un bug de corrección (no de fuga entre tenants)
-- relacionado: regenerar_codigo_invitacion() (SECCIÓN 3) no chequeaba
-- que el UPDATE hubiera afectado alguna fila. Un caller con role='admin'
-- pero gimnasio_id NULL (alcanzable HOY MISMO vía el gap de arriba, sin
-- necesitar la feature de invitar staff: cualquier usuario recién
-- registrado, sin gimnasio propio todavía, ya puede autoasignarse
-- role='admin' con gimnasio_id en NULL) hacía que el UPDATE no tocara
-- ninguna fila (WHERE id = NULL nunca matchea) y el loop igual saliera
-- sin excepción, devolviendo un código que jamás se guardó en ningún
-- lado. Se agregó un IF NOT FOUND ahí para que ese caso falle con un
-- error claro en vez de mentir que la regeneración funcionó.
--
-- También se agregó, en esta misma revisión, un tope defensivo de largo
-- (left(...,200)) sobre p_codigo en join_gimnasio_por_codigo() (SECCIÓN
-- 4) y listar_planes_para_codigo() (SECCIÓN 5) -- faltaba en ese único
-- parámetro pese a aplicarse ya a los demás -- y un rate-limit liviano
-- por tenant en join_gimnasio_por_codigo() (ver comentario en esa
-- sección) para acotar el peor caso de spam/loop contra un código real,
-- sin agregar infraestructura nueva a este archivo.
-- ============================================================================
