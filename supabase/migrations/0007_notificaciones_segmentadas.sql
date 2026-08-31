-- ============================================================================
-- 0007_notificaciones_segmentadas.sql
-- Bloque G6: el profesor manda avisos segmentados a sus alumnos (por estado
-- de cuota), y el alumno los ve como un cartel en su pantalla pública
-- /mi-plan/:codigo (0006) -- sin login, mismo mecanismo de código individual.
--
-- Cubre:
--   1. notificaciones -- avisos que crea el staff, con segmento destinatario.
--   2. notificaciones_leidas -- qué alumno ya vio/descartó cada aviso, para
--      no repetírselo y para que el staff vea "cuántos ya lo leyeron".
--   3. GRANT explícito a nivel de tabla para ambas (ver advertencia SECCIÓN 3
--      -- estas son las PRIMERAS tablas nuevas de public.* desde 0001).
--   4. ver_plan_por_codigo() extendida (0006) con 3 columnas nuevas: calcula
--      el segmento del alumno (mismo criterio EXACTO que ya usa el frontend
--      hoy, DashboardPage.jsx/format.js) y devuelve el aviso más reciente sin
--      leer que matchee ese segmento (o 'todos'), o NULL si no hay ninguno.
--   5. marcar_notificacion_leida(p_codigo, p_notificacion_id) -- RPC pública
--      (anon) para que el alumno descarte el aviso ("Entendido"), idempotente.
--
-- Migración ADITIVA sobre 0001/0004/0006: no se toca RLS ni GRANT de ninguna
-- tabla existente. Mismo criterio de aislamiento que TODA tabla de negocio
-- del proyecto: gimnasio_id, nunca user_id -- ver CONTEXT.md Decisión 2.
--
-- Pensado para pegarse ENTERO y de una sola vez en el SQL Editor de
-- Supabase. No requiere la Supabase CLI ni ejecución por partes.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 — Tabla notificaciones (los avisos que crea el staff)
-- ============================================================================
CREATE TABLE public.notificaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  mensaje     TEXT NOT NULL,
  -- 'todos' + los mismos 5 segmentos que ya usa PagosPage/DashboardPage hoy
  -- (4 calculados desde format.js + 'sin_cuota', que hoy solo vive como
  -- comentario en pagos de 0001 -- acá se vuelve un valor de negocio real).
  segmento    TEXT NOT NULL CHECK (segmento IN ('todos', 'al_dia', 'proximo', 'vencido', 'con_deuda', 'sin_cuota')),
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.notificaciones IS
  'Avisos que el staff crea para un segmento de alumnos (por estado de cuota) o para todos. El alumno los ve en /mi-plan/:codigo vía ver_plan_por_codigo(). "activa=false" es el archivado: el profesor no borra el aviso, lo desactiva -- deja de mostrarse pero conserva el historial.';

COMMENT ON COLUMN public.notificaciones.segmento IS
  'A qué alumnos les llega este aviso. Debe coincidir EXACTO con el segmento que calcula ver_plan_por_codigo() (SECCIÓN 5) a partir del pago más reciente del alumno -- mismo criterio que ya usa el frontend en DashboardPage.jsx/format.js (estadoDesdeVencimiento), más "con_deuda" (pagos.monto_adeudado > 0) y "sin_cuota" (alumno sin ningún pago cargado).';

-- Índice mínimo: gimnasio_id, mismo criterio que las 10 tablas de negocio de
-- 0001 (todas tienen exactamente este único índice, sin compuestos
-- preventivos). Cubre tanto la policy de RLS (SECCIÓN 3) como el filtro
-- gimnasio_id= de la consulta de aviso pendiente en ver_plan_por_codigo()
-- (SECCIÓN 5). Si el volumen de avisos por gimnasio creciera mucho (no es el
-- caso de un gimnasio de barrio), el siguiente paso natural sería un índice
-- compuesto (gimnasio_id, activa, created_at DESC) -- se difiere a propósito
-- hasta medir con EXPLAIN ANALYZE que hace falta, no antes.
CREATE INDEX idx_notificaciones_gimnasio_id ON public.notificaciones (gimnasio_id);


-- ============================================================================
-- SECCIÓN 2 — Tabla notificaciones_leidas (qué alumno ya vio cada aviso)
-- ============================================================================
CREATE TABLE public.notificaciones_leidas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacion_id UUID NOT NULL REFERENCES public.notificaciones(id) ON DELETE CASCADE,
  alumno_id       UUID NOT NULL REFERENCES public.alumnos(id) ON DELETE CASCADE,
  -- Denormalizado, mismo criterio que rutinas_asignadas.gimnasio_id (0001
  -- SECCIÓN 3.5): permite que la policy de RLS (SECCIÓN 3) y cualquier
  -- filtro directo del staff resuelvan sin JOIN contra notificaciones ni
  -- alumnos. Se escribe una sola vez desde marcar_notificacion_leida()
  -- (SECCIÓN 6), que ya tiene v_gimnasio_id resuelto -- no hay riesgo de que
  -- quede desincronizado del gimnasio_id real de notificacion_id/alumno_id.
  gimnasio_id     UUID NOT NULL REFERENCES public.gimnasios(id) ON DELETE CASCADE,
  leido_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un alumno no puede "leer" el mismo aviso dos veces. Hace falta para que
  -- el INSERT ... ON CONFLICT DO NOTHING de marcar_notificacion_leida()
  -- (SECCIÓN 6) sea idempotente si el alumno toca "Entendido" dos veces
  -- (doble tap, red lenta y reintento del cliente, etc.). El índice único
  -- que Postgres crea para este UNIQUE es también el índice de lookup que
  -- necesita el NOT EXISTS de ver_plan_por_codigo() (SECCIÓN 5) -- no hace
  -- falta un CREATE INDEX aparte para eso (mismo criterio ya usado para
  -- alumnos.codigo_acceso en 0006 SECCIÓN 2).
  UNIQUE (notificacion_id, alumno_id)
);

COMMENT ON TABLE public.notificaciones_leidas IS
  'Registro de qué alumno ya vio/descartó cada aviso. Se escribe EXCLUSIVAMENTE desde marcar_notificacion_leida() (SECCIÓN 6, SECURITY DEFINER) -- el staff tiene acceso de SOLO LECTURA (SECCIÓN 3/4), nunca INSERT/UPDATE/DELETE vía PostgREST.';

CREATE INDEX idx_notificaciones_leidas_gimnasio_id ON public.notificaciones_leidas (gimnasio_id);

-- Mismo criterio que rutinas_asignadas (0001): además del gimnasio_id, se
-- indexa alumno_id porque es la otra columna natural de consulta desde el
-- lado del staff (ej. "qué avisos ya vio este alumno puntual"). notificacion_id
-- ya queda cubierto como columna líder del índice único de arriba.
CREATE INDEX idx_notificaciones_leidas_alumno_id ON public.notificaciones_leidas (alumno_id);


-- ============================================================================
-- SECCIÓN 3 — Row Level Security
-- Mismo criterio de siempre: gimnasio_id = get_mi_gimnasio_id(), nunca
-- user_id individual (CONTEXT.md Decisión 2).
-- ============================================================================

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

-- FOR ALL, sin restricción de role: cualquier staff del gimnasio puede
-- crear/editar/archivar avisos -- mismo criterio exacto que
-- alumnos_tenant_isolation (0001 SECCIÓN 4.3) y el resto de las 10 tablas de
-- negocio. No hay ninguna razón de producto para restringir esto a admin.
CREATE POLICY "notificaciones_tenant_isolation" ON public.notificaciones
  FOR ALL
  USING (gimnasio_id = public.get_mi_gimnasio_id())
  WITH CHECK (gimnasio_id = public.get_mi_gimnasio_id());

ALTER TABLE public.notificaciones_leidas ENABLE ROW LEVEL SECURITY;

-- SOLO SELECT a propósito: el staff necesita leer (para mostrar "cuántos ya
-- lo leyeron" en la pantalla de Avisos), pero nunca escribir directo vía
-- PostgREST -- esas filas nacen únicamente en marcar_notificacion_leida()
-- (SECCIÓN 6), que es SECURITY DEFINER y bypasea RLS de todas formas. Sin
-- policy de INSERT/UPDATE/DELETE = esas operaciones quedan bloqueadas para
-- 'authenticated' vía la API, reforzado además por el GRANT de SECCIÓN 4
-- (que ni siquiera otorga esos privilegios a nivel de tabla).
CREATE POLICY "notificaciones_leidas_select" ON public.notificaciones_leidas
  FOR SELECT
  USING (gimnasio_id = public.get_mi_gimnasio_id());


-- ============================================================================
-- SECCIÓN 4 — GRANT explícito a nivel de tabla (NO dar por hecho)
-- ============================================================================
-- 0002_grant_authenticated_privileges.sql existe PRECISAMENTE porque en 0001
-- alguien asumió que RLS alcanzaba y se olvidó del GRANT a nivel de tabla --
-- Postgres exige las DOS cosas: RLS filtra FILAS, pero sin GRANT el error es
-- "permission denied for table X" ANTES de que la policy siquiera se evalúe
-- (CONTEXT.md Decisión 5). notificaciones/notificaciones_leidas son las
-- PRIMERAS tablas nuevas de public.* desde el schema original de 0001 (0004,
-- 0005 y 0006 solo agregaron columnas y funciones, ninguna tabla nueva) --
-- así que este GRANT tiene que estar desde el arranque, no se puede confiar
-- en ningún default de Supabase para tablas nuevas.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificaciones TO authenticated;
REVOKE ALL ON public.notificaciones FROM anon;

-- Recorta a propósito el GRANT a SELECT únicamente para notificaciones_leidas
-- -- ni siquiera 'authenticated' tiene INSERT/UPDATE/DELETE a nivel de tabla,
-- coherente con la policy de solo SELECT de SECCIÓN 3: esas filas se escriben
-- ÚNICAMENTE a través de marcar_notificacion_leida() (SECCIÓN 6, SECURITY
-- DEFINER, que corre con los privilegios del owner de la función y no
-- necesita GRANT de tabla para 'authenticated' ni 'anon').
GRANT SELECT ON public.notificaciones_leidas TO authenticated;
REVOKE ALL ON public.notificaciones_leidas FROM anon;


-- ============================================================================
-- SECCIÓN 5 — Extender ver_plan_por_codigo() con el aviso pendiente
-- ============================================================================
-- ⚠️ CREATE OR REPLACE FUNCTION no permite cambiar el juego de columnas de
-- salida de una función existente (agregar columnas a un RETURNS TABLE
-- cuenta como cambiar el tipo de retorno -- Postgres lo rechaza con
-- "cannot change return type of existing function", HINT "Use DROP FUNCTION
-- first"). Por eso hace falta este DROP antes del CREATE: no es una reescritura
-- de la lógica (que se mantiene INTACTA -- rate-limit, truncado defensivo,
-- mediaUrl por ejercicio, mensajes genéricos, todo igual que 0006), es un
-- requisito mecánico de Postgres para poder sumar columnas nuevas al mismo
-- RETURNS TABLE. El DROP + CREATE corren en la misma transacción implícita
-- del script, así que no hay ventana real donde la función no exista.
DROP FUNCTION IF EXISTS public.ver_plan_por_codigo(TEXT);

-- SUPERFICIE DE DATOS NUEVA -- lista blanca explícita, mismo criterio
-- restrictivo que el resto de esta función (0006 SECCIÓN 3): del aviso
-- SOLO título y mensaje (texto que el propio profesor escribió para que el
-- alumno lo lea), nunca el segmento calculado del alumno ni ningún otro dato
-- de negocio.
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
  plan_items                JSONB,
  -- NUEVO (Bloque G6): aviso más reciente sin leer que matchea el segmento
  -- del alumno (o 'todos'), NULL en las 3 columnas si no hay ninguno
  -- pendiente. La pantalla del alumno muestra un cartel a la vez, no una
  -- lista -- ver el cálculo completo más abajo.
  aviso_id                 UUID,
  aviso_titulo             TEXT,
  aviso_mensaje            TEXT
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
  -- NUEVO (Bloque G6): segmento del alumno + datos del pago usados para
  -- calcularlo, y el aviso pendiente resuelto a partir de ese segmento.
  v_periodo_hasta  DATE;
  v_monto_adeudado NUMERIC;
  v_dias           INTEGER;
  v_segmento       TEXT;
  v_aviso_id       UUID;
  v_aviso_titulo   TEXT;
  v_aviso_mensaje  TEXT;
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

  -- ==========================================================================
  -- NUEVO (Bloque G6) -- Segmento del alumno + aviso pendiente.
  --
  -- CÁLCULO DEL SEGMENTO: replica EXACTO el criterio que ya usa el frontend
  -- hoy (DashboardPage.jsx/PagosPage.jsx + format.js, estadoDesdeVencimiento),
  -- no inventa uno nuevo. Ese código hace, por cada alumno:
  --   1. toma el pago con periodo_hasta más reciente (comparando
  --      String(periodo_hasta || '') -- un pago SIN periodo_hasta queda
  --      siempre último en esa comparación de strings, porque '' es siempre
  --      "menor" que cualquier fecha real). El equivalente exacto en SQL es
  --      ORDER BY periodo_hasta DESC NULLS LAST LIMIT 1.
  --   2. si no hay NINGÚN pago -> 'vencido' en el frontend HOY (así están
  --      hardcodeados DashboardPage/PagosPage: "p ? estado(...) : 'vencido'")
  --      -- pero acá el pedido explícito es diferenciarlo como 'sin_cuota'
  --      (más preciso para poder segmentar avisos: "mandale un aviso de
  --      bienvenida a quien nunca cargó una cuota" es un caso de uso real
  --      que 'vencido' no permite distinguir). No es una discrepancia con el
  --      frontend por descuido: es información MÁS fina que agrega esta
  --      función, sin romper nada existente (el frontend de staff no lee
  --      estas columnas nuevas).
  --   3. si el pago encontrado tiene monto_adeudado > 0 -> 'con_deuda'. Esto
  --      NUNCA matchea hoy en la práctica (ninguna pantalla carga
  --      monto_adeudado todavía), pero la columna y el CHECK constraint de
  --      pagos ya la soportan desde 0001 -- la lógica queda bien armada para
  --      el día que se conecte, sin tener que tocar esta función de nuevo.
  --   4. si no, por fecha: sin periodo_hasta -> 'vencido'; días hasta
  --      periodo_hasta < 0 -> 'vencido'; <= 7 -> 'proximo'; si no -> 'al_dia'.
  --
  -- DECISIÓN DE DISEÑO (día vs. milisegundo): estadoDesdeVencimiento() en el
  -- frontend calcula "dias" con Date.now() (instante exacto, con hora) menos
  -- la medianoche LOCAL del navegador del periodo_hasta, y redondea. Replicar
  -- ese cálculo al milisegundo del lado del servidor no es posible ni tiene
  -- sentido (no hay "zona horaria del navegador" acá, y periodo_hasta es un
  -- DATE sin componente de hora). El equivalente server-side correcto es
  -- restar dos DATE (periodo_hasta - CURRENT_DATE), que da directamente un
  -- entero de días sin necesidad de ROUND. Coincide con el frontend la
  -- enorme mayoría de las veces; el único borde posible es un alumno
  -- consultando su plan a horas muy distintas del día justo en el límite de
  -- los 7 días de "próximo a vencer" -- una diferencia de cartel de aviso
  -- visible por un rato en el peor caso, no un bug de seguridad ni de
  -- aislamiento de datos.
  -- Desempate explícito por created_at si dos pagos comparten periodo_hasta
  -- (ej. un pago parcial con monto_adeudado > 0 y un ajuste posterior sin
  -- deuda cargados para el mismo período): sin esto, cuál "gana" dependía
  -- del plan de ejecución de Postgres, no determinístico -- el segmento
  -- calculado podía variar entre llamadas para el mismo alumno sin que
  -- cambiara ningún dato real. Hallazgo de la auditoría de appsec.
  SELECT p.periodo_hasta, p.monto_adeudado
    INTO v_periodo_hasta, v_monto_adeudado
  FROM public.pagos p
  WHERE p.alumno_id = v_alumno_id
    AND p.gimnasio_id = v_gimnasio_id
  ORDER BY p.periodo_hasta DESC NULLS LAST, p.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Ningún pago cargado para este alumno.
    v_segmento := 'sin_cuota';
  ELSIF COALESCE(v_monto_adeudado, 0) > 0 THEN
    v_segmento := 'con_deuda';
  ELSIF v_periodo_hasta IS NULL THEN
    v_segmento := 'vencido';
  ELSE
    v_dias := v_periodo_hasta - CURRENT_DATE;
    IF v_dias < 0 THEN
      v_segmento := 'vencido';
    ELSIF v_dias <= 7 THEN
      v_segmento := 'proximo';
    ELSE
      v_segmento := 'al_dia';
    END IF;
  END IF;

  -- Aviso más reciente que matchea el segmento calculado (o 'todos'), de
  -- ESTE gimnasio, activo, y que el alumno todavía NO leyó -- uno solo, el
  -- más reciente sin leer: la pantalla del alumno muestra un cartel a la
  -- vez, no una lista. AND n.gimnasio_id = v_gimnasio_id (no
  -- get_mi_gimnasio_id(), que acá no aplicaría -- no hay sesión) es la única
  -- barrera real de tenant de esta consulta, coherente con el resto de la
  -- función (SECURITY DEFINER, bypasea RLS).
  SELECT n.id, n.titulo, n.mensaje
    INTO v_aviso_id, v_aviso_titulo, v_aviso_mensaje
  FROM public.notificaciones n
  WHERE n.gimnasio_id = v_gimnasio_id
    AND n.activa = true
    AND (n.segmento = 'todos' OR n.segmento = v_segmento)
    AND NOT EXISTS (
      SELECT 1
      FROM public.notificaciones_leidas nl
      WHERE nl.notificacion_id = n.id
        AND nl.alumno_id = v_alumno_id
    )
  ORDER BY n.created_at DESC
  LIMIT 1;
  -- Sin FOUND/IF acá a propósito: si no matchea nada, el SELECT INTO deja
  -- v_aviso_id/v_aviso_titulo/v_aviso_mensaje en NULL, que es exactamente el
  -- resultado que se quiere devolver ("no hay ningún aviso pendiente").
  -- ==========================================================================

  RETURN QUERY
    SELECT
      v_alumno_nombre,
      v_gim_nombre, v_gim_logo, v_gim_color,
      v_rut_nombre, v_rut_desc, v_rut_semanas, v_rut_items,
      v_plan_nombre, v_plan_notas, v_plan_items,
      v_aviso_id, v_aviso_titulo, v_aviso_mensaje;
END;
$$;

COMMENT ON FUNCTION public.ver_plan_por_codigo(TEXT) IS
  'SECURITY DEFINER, callable SIN sesión (GRANT a anon, ver abajo). Resuelve el alumno EXCLUSIVAMENTE por codigo_acceso + activo=true (nunca por un id/gimnasio_id del caller). Devuelve la superficie MÍNIMA para la página pública de solo lectura del alumno: su nombre, branding del gimnasio, su rutina asignada activa, su plan de alimentación más reciente, y (Bloque G6) el aviso más reciente sin leer que matchea su segmento de cuota calculado server-side o "todos" -- NUNCA pagos, contacto, salud, asistencias, progreso ni datos de otro alumno/gimnasio. Código inválido, inexistente, o alumno inactivo -> mismo mensaje genérico (no enumerable). Incluye rate-limit por alumno (60 consultas/5min) como defensa en profundidad ante hostigar un código puntual ya conocido.';

-- ⚠️ GRANT A ANON A PROPÓSITO -- NO ES UN ERROR NI UN OLVIDO. El alumno que
-- escanea el QR no tiene sesión y NUNCA la va a tener para esta acción (no
-- existe login de alumno en este proyecto, ver el encabezado de 0006). Si
-- algún día se agrega acá un REVOKE EXECUTE ... FROM anon calcando el patrón
-- de regenerar_codigo_acceso_alumno()/marcar_notificacion_leida() sin leer
-- este comentario, la página pública del alumno se rompe por completo con
-- "permission denied for function ver_plan_por_codigo". Antes de tocar este
-- GRANT, releer esta sección entera. (Recordatorio: el DROP FUNCTION de más
-- arriba borra cualquier GRANT que la función tuviera antes -- por eso hay
-- que reotorgarlo acá explícitamente, no alcanza con "no haberlo tocado".)
REVOKE EXECUTE ON FUNCTION public.ver_plan_por_codigo(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_plan_por_codigo(TEXT) TO anon, authenticated;


-- ============================================================================
-- SECCIÓN 6 — marcar_notificacion_leida(): el alumno descarta un aviso
-- ============================================================================
-- Mismo patrón de resolución de identidad que TODA función pública de este
-- proyecto callable sin sesión: código + activo=true, mensaje genérico si no
-- resuelve (no distingue "código inválido" de "código de alumno de baja").
--
-- ⚠️ DEFENSA EN PROFUNDIDAD, mismo criterio que
-- regenerar_codigo_acceso_alumno() (0006 SECCIÓN 4): p_notificacion_id es un
-- valor que manda el CLIENTE, así que nunca se confía ciegamente en él. Antes
-- de insertar, se valida que sea una fila REAL de notificaciones Y que
-- pertenezca al MISMO gimnasio que el alumno recién resuelto por el código --
-- sin este chequeo, un alumno de un gimnasio A podría marcar como "leído" el
-- id de un aviso de un gimnasio B (adivinado o filtrado de algún otro lado):
-- no sería una fuga de datos en sí (notificaciones_leidas no se lee después
-- desde ningún otro lugar público), pero sí contaminaría con basura
-- cross-tenant una tabla que el staff del gimnasio B sí puede leer
-- (notificaciones_leidas_select, SECCIÓN 3) -- rompería la cuenta de
-- "cuántos ya lo leyeron" que ve el staff de B con una fila que no
-- corresponde a ningún alumno real de sus avisos.
--
-- No se exige notificaciones.activa = true en esa validación, a propósito:
-- si el staff archiva un aviso justo mientras un alumno lo tiene abierto en
-- pantalla y toca "Entendido", marcar esa lectura igual es inofensivo (el
-- aviso ya no se le va a volver a mostrar a nadie, esté o no marcado como
-- leído) y evita una carrera innecesaria entre archivar y descartar.
CREATE OR REPLACE FUNCTION public.marcar_notificacion_leida(
  p_codigo TEXT,
  p_notificacion_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_alumno_id   UUID;
  v_gimnasio_id UUID;
BEGIN
  -- Mismo truncado defensivo que ver_plan_por_codigo() (SECCIÓN 5) y el resto
  -- de 0006 -- ver esa sección para el detalle completo del porqué.
  p_codigo := left(btrim(coalesce(p_codigo, '')), 200);

  SELECT id, gimnasio_id
    INTO v_alumno_id, v_gimnasio_id
  FROM public.alumnos
  WHERE codigo_acceso = p_codigo AND activo = true;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'Código de acceso inválido';
  END IF;

  -- p_notificacion_id tiene que ser una fila real de notificaciones del
  -- MISMO gimnasio que el alumno ya resuelto (ver la advertencia completa
  -- arriba). Mensaje genérico también acá: no distingue "no existe" de
  -- "existe pero es de otro gimnasio", mismo criterio de no regalar señal
  -- que el resto de las funciones públicas de este proyecto.
  IF NOT EXISTS (
    SELECT 1 FROM public.notificaciones
    WHERE id = p_notificacion_id AND gimnasio_id = v_gimnasio_id
  ) THEN
    RAISE EXCEPTION 'Aviso inválido';
  END IF;

  -- ON CONFLICT DO NOTHING sobre el UNIQUE (notificacion_id, alumno_id) de
  -- SECCIÓN 2: idempotente si el alumno toca "Entendido" dos veces (doble
  -- tap, reintento de red, etc.) -- nunca falla por duplicado, nunca crea
  -- una segunda fila.
  INSERT INTO public.notificaciones_leidas (notificacion_id, alumno_id, gimnasio_id)
  VALUES (p_notificacion_id, v_alumno_id, v_gimnasio_id)
  ON CONFLICT (notificacion_id, alumno_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.marcar_notificacion_leida(TEXT, UUID) IS
  'SECURITY DEFINER, callable SIN sesión (GRANT a anon, ver abajo) -- la llama el alumno sin sesión desde /mi-plan/:codigo al tocar "Entendido". Resuelve el alumno EXCLUSIVAMENTE por codigo_acceso + activo=true, valida que p_notificacion_id sea una fila real de notificaciones del MISMO gimnasio (defensa en profundidad, nunca confía en el id que manda el cliente), e inserta en notificaciones_leidas con ON CONFLICT DO NOTHING (idempotente). Código inválido o aviso inválido -> mensajes genéricos, no enumerables.';

-- ⚠️ GRANT A ANON A PROPÓSITO -- NO ES UN ERROR NI UN OLVIDO, mismo criterio
-- exacto que ver_plan_por_codigo() (SECCIÓN 5) y por el mismo motivo: la
-- llama el alumno sin sesión, y nunca la va a tener. Supabase le da EXECUTE
-- a 'anon' por default en funciones NUEVAS del schema public (ALTER DEFAULT
-- PRIVILEGES a nivel de proyecto) -- pero para no depender de ese default
-- implícito, acá se hace explícito: REVOKE de PUBLIC primero (saca el
-- permiso implícito que Postgres da a toda función nueva) y GRANT explícito
-- a anon + authenticated después. Si algún día se agrega acá un REVOKE
-- EXECUTE ... FROM anon calcando el patrón de
-- regenerar_codigo_acceso_alumno() (0006 SECCIÓN 4, que SÍ debe quedar
-- restringida a solo staff) sin leer este comentario, el botón "Entendido"
-- de la pantalla pública del alumno se rompe por completo con "permission
-- denied for function marcar_notificacion_leida". Antes de tocar este GRANT,
-- releer esta sección entera.
REVOKE EXECUTE ON FUNCTION public.marcar_notificacion_leida(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_notificacion_leida(TEXT, UUID) TO anon, authenticated;


-- ============================================================================
-- Fin de la migración 0007.
--
-- Pendiente, fuera de alcance de este archivo (a propósito -- es UI, no
-- schema):
--   - Pantalla de Avisos para el staff (alta/edición/archivado de
--     notificaciones, conteo de "cuántos ya lo leyeron" por segmento --
--     ese conteo lo resuelve el frontend con consultas normales a alumnos +
--     pagos + notificaciones_leidas, ya accesibles por RLS, calculando en JS
--     igual que ya hace DashboardPage.jsx -- NO es responsabilidad de esta
--     migración, ver el encargo).
--   - Cartel en /mi-plan/:codigo que muestre aviso_titulo/aviso_mensaje si
--     aviso_id no es NULL, con un botón "Entendido" que llame
--     marcar_notificacion_leida(codigo, aviso_id).
-- ============================================================================
