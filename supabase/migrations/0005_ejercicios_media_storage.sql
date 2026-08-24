-- ============================================================================
-- 0005_ejercicios_media_storage.sql
--
-- Bucket de Supabase Storage para el video/imagen demostrativa que el
-- entrenador sube para un ejercicio (Bloque F). La URL externa (pegar un
-- link de YouTube/Vimeo/etc.) ya existe en el código de la aplicación y NO
-- se toca acá — este archivo cubre exclusivamente el caso de archivo
-- SUBIDO por el propio staff del gimnasio.
--
-- Migración puramente ADITIVA: no toca ninguna tabla, policy ni función de
-- 0001/0002/0003/0004. Solo crea el bucket 'ejercicios-media' y sus
-- policies sobre storage.objects.
--
-- Este archivo sigue el mismo patrón general que 0003 (gimnasio-logos),
-- pero se aparta de él en dos puntos deliberados — señalados en detalle
-- más abajo en SECCIÓN 2:
--   1. Convención de PATH: acá el nombre de archivo no es fijo (no hay "un
--      solo archivo por tenant" como el logo), así que el segundo segmento
--      del path es el UUID del ejercicio (ejercicios.id), no un nombre de
--      archivo fijo tipo "logo".
--   2. Nivel de PERMISO de escritura: acá NO se restringe a role='admin'
--      como sí hacía 0003, para igualar el permiso que ya tiene la propia
--      tabla ejercicios (ejercicios_tenant_isolation en 0001, FOR ALL sin
--      chequeo de role, ver SECCIÓN 4.3 de ese archivo).
--
-- ADVERTENCIA IMPORTANTE DE ARQUITECTURA (misma que 0003, se repite acá a
-- propósito porque cada archivo de Storage tiene que ser autocontenido y
-- releíble sin depender de tener 0003 al lado): storage.objects y
-- storage.buckets son tablas ÚNICAS Y COMPARTIDAS por TODOS los buckets del
-- proyecto, no una tabla por bucket. Supabase ya les otorga por defecto los
-- GRANT de tabla necesarios a 'anon' y 'authenticated' a nivel de
-- infraestructura — eso es intencional y NO hay que tocarlo. Si acá
-- hiciéramos algo como 'REVOKE ALL ON storage.objects FROM anon'
-- (calcando el patrón de 0002, que es para TABLAS DE NEGOCIO propias),
-- romperíamos el acceso a TODOS los demás buckets del proyecto (incluido
-- 'gimnasio-logos'), no solo a este. El control de acceso por bucket se
-- hace 100% vía RLS con 'bucket_id = ...' en el USING/WITH CHECK de cada
-- policy, nunca vía GRANT de tabla. RLS sobre storage.objects ya viene
-- habilitado por Supabase de fábrica; no hace falta (ni corresponde) un
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY acá.
--
-- AppSec review previa a la primera ejecución (2026-08-24): los dos
-- apartamientos deliberados de arriba se confirman coherentes (el regex
-- anclado de 2.2/2.3 sí impide escribir fuera de la propia carpeta o con
-- un nombre no conforme; sacar el chequeo role='admin' iguala el permiso
-- que ejercicios_tenant_isolation ya le da a cualquier staff sobre la
-- tabla ejercicios, no abre nada nuevo ahí). Pero se encontró y corrigió un
-- gap DENTRO del propio tenant que NO tiene equivalente en 0003 (ver FIX
-- completo en SECCIÓN 2.2): a diferencia de gimnasio-logos, acá el segundo
-- segmento del path es un UUID libre, no un nombre fijo tipo "logo" — el
-- regex anclado por sí solo acota el FORMATO del nombre pero no la
-- CANTIDAD de archivos que un staff puede subir dentro de su propia
-- carpeta, porque el espacio de UUIDs con formato válido es prácticamente
-- infinito. Se agregó un EXISTS contra public.ejercicios para atar cada
-- archivo a una fila real del propio tenant.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 — Alta del bucket
-- ============================================================================
-- file_size_limit va en BYTES (columna bigint). 50 MB = 50 * 1024 * 1024 =
-- 52428800. Bastante más margen que los 2 MB de gimnasio-logos: un logo es
-- una imagen chica, pero acá el mismo campo de la UI acepta también un
-- video corto demostrativo del ejercicio, que pesa muchísimo más que una
-- imagen aunque dure pocos segundos.
--
-- allowed_mime_types restringe a nivel de BUCKET (lo valida el propio
-- storage-api de Supabase antes de aceptar el archivo), no es solo una
-- validación de policy — un archivo con extensión falsa ni siquiera llega
-- a evaluarse contra las policies de abajo. El campo de la UI dice "Video o
-- imagen demostrativa", así que la lista mezcla ambos tipos: 3 de video
-- (mp4/webm/quicktime — este último es el .mov que suelen generar los
-- celulares al grabar) + los mismos 3 de imagen que ya usa gimnasio-logos.
--
-- ON CONFLICT DO NOTHING: por si el bucket ya fue creado a mano desde el
-- Dashboard antes de correr esta migración (mismo judgment call que 0003);
-- no pisa la config de un bucket preexistente, solo evita que la migración
-- falle con "duplicate key" si se re-corre por error.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ejercicios-media',
  'ejercicios-media',
  true,                                     -- lectura pública, ver SECCIÓN 2.1
  52428800,                                 -- 50 MB
  ARRAY[
    'video/mp4', 'video/webm', 'video/quicktime',
    'image/png', 'image/jpeg', 'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- SECCIÓN 2 — Policies sobre storage.objects, filtradas por bucket_id
--
-- Convención de path: '{gimnasio_id}/{ejercicio_id}.<ext>'. A diferencia de
-- gimnasio-logos (un solo archivo por tenant, nombre fijo "logo"), acá un
-- gimnasio tiene MUCHOS ejercicios, cada uno con su propio archivo — así
-- que el segundo segmento del path no puede ser un nombre fijo, tiene que
-- ser el UUID de la fila de ejercicios (ejercicios.id) a la que pertenece
-- ese archivo. El primer segmento sigue siendo el gimnasio_id, lo que
-- permite reusar exactamente el mismo patrón de aislamiento por tenant que
-- el resto del schema: comparar ese segmento contra get_mi_gimnasio_id().
-- El regex anclado de INSERT/UPDATE valida el segundo segmento como UUID
-- válido (formato estándar de gen_random_uuid(): hex minúscula,
-- 8-4-4-4-12), en vez de un nombre de archivo fijo como hacía 0003. Además
-- (FIX de AppSec, ver 2.2), INSERT/UPDATE exigen que ese UUID corresponda a
-- una fila REAL de public.ejercicios del propio tenant, no solo que "tenga
-- forma de UUID" — el formato válido por sí solo no acota la cantidad de
-- archivos posibles, la fila real sí.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 2.1 SELECT — lectura pública, sin restricción de tenant ni de rol.
-- No hay nada confidencial en un video/imagen demostrativa de un ejercicio,
-- y el bucket ya está marcado public = true arriba, así que getPublicUrl()
-- en el cliente sirve el archivo directo sin pasar por esta policy
-- (Supabase resuelve /storage/v1/object/public/... sin evaluar RLS cuando
-- el bucket es público). Esta policy se agrega de todas formas por dos
-- motivos: defensa en profundidad, y para que también funcione el endpoint
-- NO público (/object/..., el que usa el método download() del SDK), que
-- sí pasa por RLS incluso en un bucket marcado public. Sin "TO", aplica a
-- PUBLIC (anon incluido) a propósito: es lectura pública real. Mismo
-- razonamiento exacto que gimnasio_logos_select_public en 0003.
CREATE POLICY "ejercicios_media_select_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'ejercicios-media');

-- --------------------------------------------------------------------------
-- 2.2 INSERT — cualquier staff autenticado del gimnasio dueño de la
-- carpeta, SIN chequeo de role='admin'.
--
-- APARTAMIENTO DELIBERADO respecto de 0003 (gimnasio_logos_insert_admin):
-- en gimnasio-logos, solo un admin podía escribir, porque el logo es un
-- dato de MARCA del gimnasio entero (misma restricción que
-- gimnasios_update_admin en 0001). Acá el dato que se está escribiendo es
-- el media de UN ejercicio puntual, y la tabla que gobierna esa misma
-- entidad (public.ejercicios) YA define el nivel de permiso correcto:
-- ejercicios_tenant_isolation (0001, SECCIÓN 4.3) es FOR ALL sin ningún
-- EXISTS contra profiles.role — cualquier staff del tenant (admin o no)
-- puede insertar/editar/borrar filas de ejercicios, porque cargar o
-- actualizar el catálogo de ejercicios es tarea operativa normal de
-- cualquier entrenador, no una decisión de marca. Esta policy tiene que
-- reflejar EXACTAMENTE ese mismo nivel de permiso para que la subida del
-- archivo no quede más restringida que la propia fila a la que pertenece
-- (si se dejara el chequeo de admin acá, un entrenador no-admin podría
-- crear/editar el ejercicio pero no subirle el video, lo cual sería
-- inconsistente con el modelo de permisos ya decidido para esta tabla).
--
-- (storage.foldername(name))[1] es el primer segmento del path
-- ('{gimnasio_id}/{ejercicio_id}.<ext>' -> el gimnasio_id). El regex
-- ancla TAMBIÉN el segundo segmento como UUID válido (no cualquier
-- string). "TO authenticated": un request anónimo ni siquiera llega a
-- evaluar la condición.
--
-- FIX (AppSec review, 2026-08-24, previo a la primera ejecución de esta
-- migración): el regex anclado por sí solo NO alcanza acá para acotar la
-- CANTIDAD de archivos, a diferencia de gimnasio-logos — ahí el patrón fijo
-- "logo.<ext>" limita el total a un puñado de nombres posibles (4 como
-- máximo, uno por extensión), pero acá el segundo segmento es "cualquier
-- UUID con formato válido", un espacio de nombres gigantesco. Sin nada más,
-- cualquier staff autenticado (ni siquiera hace falta ser admin) podía
-- generar UUIDs arbitrarios que NO correspondieran a NINGÚN ejercicio real
-- de la tabla, e insertar un archivo de hasta 50 MB por cada uno, sin
-- límite de cantidad, agotando la cuota de storage compartida por TODOS
-- los tenants del proyecto (mismo tipo de impacto que el hallazgo original
-- de 0003, pero acá sin el techo natural que daba el nombre fijo del
-- logo, y con archivos 25x más grandes). Se agrega el EXISTS de abajo:
-- ata el archivo a una fila REAL de public.ejercicios del propio tenant
-- (mismo gimnasio_id, mismo id que el UUID del path), así que el total de
-- archivos posibles queda acotado al mismo orden de magnitud que la propia
-- tabla ejercicios — que ya es el límite implícitamente aceptado para el
-- resto del schema (no hay tope de cantidad de FILAS de ejercicios
-- tampoco, pero esas son filas de texto livianas, no blobs de hasta 50
-- MB). Efecto colateral esperado y correcto: el archivo tiene que subirse
-- DESPUÉS de crear la fila de ejercicios (nunca antes), que ya era el
-- flujo documentado al final de este archivo — ahora queda reforzado a
-- nivel de base de datos, no solo confiado a la disciplina del cliente.
CREATE POLICY "ejercicios_media_insert_staff" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ejercicios-media'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(mp4|webm|mov|png|jpe?g|webp)$'
    )
    AND EXISTS (
      SELECT 1 FROM public.ejercicios e
      WHERE e.gimnasio_id = public.get_mi_gimnasio_id()
        AND e.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  );

-- --------------------------------------------------------------------------
-- 2.3 UPDATE — necesaria para el caso upload(..., { upsert: true }): si el
-- archivo ya existe en ese path exacto (ej. re-subir el video del mismo
-- ejercicio con la misma extensión), storage-api hace un upsert real a
-- nivel de fila, que dispara policies de UPDATE, no de INSERT. Sin esta
-- policy, re-subir el media de un ejercicio con el mismo nombre de archivo
-- devolvería "new row violates row-level security policy" pese a que
-- insert_staff esté OK.
--
-- Mismo apartamiento que 2.2 (sin chequeo de role='admin', ver ese
-- comentario para el razonamiento completo) y mismo patrón anclado con
-- UUID, tanto en USING (qué filas existentes puede tocar un staff) como en
-- WITH CHECK (qué nombre puede resultar tras el update), para que la
-- restricción sea simétrica en las tres operaciones de escritura.
--
-- FIX (AppSec review, 2026-08-24): mismo motivo que 2.2 (ver ese
-- comentario para el razonamiento completo) — se agrega acá también el
-- EXISTS contra public.ejercicios, tanto en USING como en WITH CHECK, para
-- que la restricción de cantidad sea simétrica en las tres operaciones de
-- escritura, igual que ya lo es el patrón anclado del path.
CREATE POLICY "ejercicios_media_update_staff" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'ejercicios-media'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(mp4|webm|mov|png|jpe?g|webp)$'
    )
    AND EXISTS (
      SELECT 1 FROM public.ejercicios e
      WHERE e.gimnasio_id = public.get_mi_gimnasio_id()
        AND e.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  )
  WITH CHECK (
    bucket_id = 'ejercicios-media'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(mp4|webm|mov|png|jpe?g|webp)$'
    )
    AND EXISTS (
      SELECT 1 FROM public.ejercicios e
      WHERE e.gimnasio_id = public.get_mi_gimnasio_id()
        AND e.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  );

-- --------------------------------------------------------------------------
-- 2.4 DELETE — necesaria para el caso en que el staff cambia de extensión
-- (ej. tenía {ejercicio_id}.png y sube {ejercicio_id}.mp4): el nombre de
-- archivo cambia, así que no es un upsert sobre la misma fila, sino un
-- archivo nuevo + borrado del viejo. Sin DELETE, el media anterior queda
-- huérfano en el bucket para siempre.
--
-- A propósito SIN el patrón completo (UUID + extensión) que sí se exige en
-- 2.2/2.3, igual que gimnasio_logos_delete_admin en 0003: acá interesa lo
-- opuesto — que cualquier staff del gimnasio pueda limpiar CUALQUIER
-- archivo huérfano o no conforme que haya quedado en su propia carpeta
-- (incluidos los que pudieran existir de ejercicios ya borrados, o subidos
-- a mano desde el Dashboard), no restringirle el borrado a un solo patrón
-- exacto. Sigue acotado por tenant (primer segmento del path), que es lo
-- que importa para no permitir borrar archivos de OTRO gimnasio.
--
-- A propósito SIN el EXISTS contra public.ejercicios que sí se agregó en
-- 2.2/2.3 (ver FIX ahí): acá el caso de uso típico es justamente limpiar
-- archivos que YA NO tienen fila de ejercicios correspondiente (huérfanos
-- por ejercicio borrado), así que exigir esa fila acá rompería el propio
-- propósito de la policy. Esta asimetría no reabre el problema de cantidad
-- que motivó el FIX de 2.2/2.3: DELETE solo puede reducir la cantidad de
-- archivos de un tenant, nunca aumentarla, así que no es una vía de abuso
-- de cuota de storage.
--
-- Tampoco hay acá ningún riesgo de "path traversal" pese a nombres con
-- '../' o segmentos vacíos: storage.objects.name es una clave de texto
-- opaca dentro del bucket, no una ruta de filesystem real, y
-- (storage.foldername(name))[1] sigue devolviendo literalmente el primer
-- segmento antes de la primera '/' sin ninguna resolución de ruta. Ese
-- primer segmento tiene que ser un match EXACTO de
-- get_mi_gimnasio_id()::text (un UUID resuelto server-side a partir de
-- auth.uid(), no un valor que el atacante pueda escribir), así que ningún
-- nombre de archivo, por más malicioso o con caracteres raros que tenga,
-- puede hacer que esta condición matchee la carpeta de OTRO gimnasio.
--
-- Y, otra vez, SIN chequeo de role='admin' — mismo razonamiento que 2.2:
-- cualquier staff del tenant tiene sobre ejercicios el mismo permiso FOR
-- ALL que un admin (ejercicios_tenant_isolation, 0001), así que restringir
-- acá el DELETE a solo admin dejaría a un entrenador no-admin pudiendo
-- borrar el ejercicio entero pero no limpiar su propio archivo huérfano.
-- Deliberadamente SIN filtro por 'owner' (quién subió el archivo
-- originalmente) por el mismo motivo: el media es un dato del ejercicio
-- (del tenant), no de la persona que lo subió.
CREATE POLICY "ejercicios_media_delete_staff" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'ejercicios-media'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
  );


-- ============================================================================
-- Fin de la migración 0005.
--
-- PENDIENTE PARA LA UI (Bloque F, fuera de este archivo): el código que
-- arma el path de subida tiene que usar SIEMPRE
-- '{gimnasio_id}/{ejercicio_id}.<ext>' con el ejercicio_id REAL de la fila
-- (el id devuelto/existente en public.ejercicios), NUNCA un nombre elegido
-- o editable por el usuario — mismo criterio que ya usan
-- OnboardingPage.jsx/ConfiguracionPage.jsx para armar el path del logo
-- (gimnasioId + nombre fijo + extensión de una whitelist fija). Esto ya no
-- es solo una convención esperada del lado del cliente: desde el FIX de
-- AppSec de SECCIÓN 2.2, la fila de ejercicios tiene que existir ANTES de
-- subir el archivo (orden: crear/guardar el ejercicio primero, subir el
-- media después), porque el EXISTS de la policy la exige. Si el path no
-- matchea el regex anclado de SECCIÓN 2.2/2.3 (UUID válido en el segundo
-- segmento + extensión de la whitelist) o si ese UUID no corresponde a una
-- fila existente de ejercicios del propio tenant, el INSERT/UPDATE va a
-- fallar con "new row violates row-level security policy" pese a que el
-- bucket haya aceptado el mime type — es el comportamiento esperado
-- (fail-closed), no un bug de esta migración.
-- ============================================================================
