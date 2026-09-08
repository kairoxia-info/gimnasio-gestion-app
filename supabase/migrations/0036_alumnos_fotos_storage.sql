-- ============================================================================
-- 0036_alumnos_fotos_storage.sql
--
-- Pedido de Nalux (08/09/2026): en la ficha del alumno, el campo "Foto" era
-- una URL pegada a mano ("Foto (URL opcional)") -- en la práctica casi
-- nadie tiene la foto ya subida a algún link público. Lo que el profesor sí
-- tiene es la foto guardada en el celular o la compu, así que tiene que
-- poder SUBIR el archivo directo, como ya se puede con el logo del gimnasio
-- (0003) y el media de ejercicios (0005). Sigue siendo opcional -- eso no
-- cambia, solo cambia de "pegar un link" a "elegir un archivo".
--
-- Mismo patrón general que 0005 (ejercicios-media), con las mismas dos
-- decisiones de esa migración: el segundo segmento del path es el UUID de
-- la fila (alumnos.id, no un nombre fijo tipo "logo"), y el permiso de
-- escritura sigue exactamente al de la tabla que gobierna esa entidad
-- (public.alumnos) -- alumnos_tenant_isolation (0001, SECCIÓN 4.3) es FOR
-- ALL sin chequeo de role='admin', así que esta policy tampoco lo exige:
-- cualquier staff que puede cargar/editar un alumno tiene que poder
-- también subirle la foto, sin que quede más restringido que la fila
-- misma.
--
-- Migración puramente ADITIVA: no toca ninguna tabla, policy ni función
-- previa. Solo crea el bucket 'alumnos-fotos' y sus policies sobre
-- storage.objects.
--
-- ADVERTENCIA DE ARQUITECTURA (misma de 0003/0005, se repite acá a
-- propósito para que este archivo sea autocontenido): storage.objects y
-- storage.buckets son tablas ÚNICAS y COMPARTIDAS por TODOS los buckets del
-- proyecto. El control de acceso es 100% vía RLS con 'bucket_id = ...' en
-- cada policy, nunca vía GRANT/REVOKE de tabla (eso rompería el acceso a
-- TODOS los demás buckets, no solo a este).
--
-- DECISIÓN DE PRIVACIDAD, a diferencia del logo y el media de ejercicios
-- (que son marca/contenido genérico, sin dato personal): una foto de
-- alumno SÍ identifica a una persona real. Se decide igual mantener el
-- bucket público (lectura sin autenticación), por consistencia con el
-- resto del storage de esta app y para no sumar la complejidad de URLs
-- firmadas (que compilican mostrar la foto en listas/fichas sin un
-- llamado async extra por cada una). La mitigación es la misma que ya
-- acepta el resto del schema para este tipo de archivo: el path incluye
-- el UUID del alumno, no adivinable ni enumerable (122 bits al azar) --
-- quien no tenga ese UUID no tiene forma de llegar a la foto. Si en algún
-- momento se necesita más privacidad que eso, hay que migrar a URLs
-- firmadas; no se resuelve en esta migración.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 — Alta del bucket
-- ============================================================================
-- file_size_limit en BYTES: 2 MB, mismo tope que gimnasio-logos (0003) --
-- es una foto de perfil, no hace falta más.
-- allowed_mime_types: solo imagen (a diferencia de ejercicios-media, acá no
-- hay caso de uso de video).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'alumnos-fotos',
  'alumnos-fotos',
  true,                                      -- lectura pública, ver SECCIÓN 2.1
  2097152,                                  -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- SECCIÓN 2 — Policies sobre storage.objects, filtradas por bucket_id
--
-- Convención de path: '{gimnasio_id}/{alumno_id}.<ext>'. Mismo criterio que
-- ejercicios-media: un gimnasio tiene muchos alumnos, cada uno con su
-- propia foto, así que el segundo segmento tiene que ser el UUID real de
-- la fila (alumnos.id), no un nombre fijo. El regex anclado valida ese
-- UUID (formato estándar de gen_random_uuid()) + la extensión, y el EXISTS
-- ata el archivo a una fila REAL de public.alumnos del propio tenant --
-- mismo FIX de cuota que encontró la revisión de AppSec en 0005 (sin esto,
-- cualquier staff podría insertar archivos con UUIDs inventados sin límite
-- de cantidad).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 2.1 SELECT — lectura pública. Bucket marcado public = true arriba, así
-- que getPublicUrl() sirve el archivo directo sin pasar por RLS; esta
-- policy cubre además el endpoint no público (download() del SDK), que sí
-- evalúa RLS aunque el bucket sea público. Sin "TO": aplica a PUBLIC
-- (anon incluido) a propósito, ver la decisión de privacidad de la
-- cabecera de este archivo.
CREATE POLICY "alumnos_fotos_select_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'alumnos-fotos');

-- --------------------------------------------------------------------------
-- 2.2 INSERT — cualquier staff autenticado del gimnasio dueño de la
-- carpeta, sin chequeo de role='admin' (ver razonamiento en la cabecera:
-- alumnos_tenant_isolation ya da ese mismo permiso sobre la fila).
CREATE POLICY "alumnos_fotos_insert_staff" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'alumnos-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(png|jpe?g|webp)$'
    )
    AND EXISTS (
      SELECT 1 FROM public.alumnos a
      WHERE a.gimnasio_id = public.get_mi_gimnasio_id()
        AND a.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  );

-- --------------------------------------------------------------------------
-- 2.3 UPDATE — necesaria para upload(..., { upsert: true }) al re-subir la
-- foto de un alumno con el mismo nombre de archivo (mismo motivo que 0005
-- SECCIÓN 2.3).
CREATE POLICY "alumnos_fotos_update_staff" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'alumnos-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(png|jpe?g|webp)$'
    )
    AND EXISTS (
      SELECT 1 FROM public.alumnos a
      WHERE a.gimnasio_id = public.get_mi_gimnasio_id()
        AND a.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  )
  WITH CHECK (
    bucket_id = 'alumnos-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(png|jpe?g|webp)$'
    )
    AND EXISTS (
      SELECT 1 FROM public.alumnos a
      WHERE a.gimnasio_id = public.get_mi_gimnasio_id()
        AND a.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  );

-- --------------------------------------------------------------------------
-- 2.4 DELETE — cualquier staff del gimnasio, sobre cualquier archivo de su
-- propia carpeta (sin el patrón/EXISTS completo: acá interesa poder limpiar
-- también archivos huérfanos de alumnos ya borrados, mismo razonamiento
-- que 0005 SECCIÓN 2.4). Acotado por tenant vía el primer segmento del
-- path, que es lo único que importa para no poder borrar fotos de otro
-- gimnasio.
CREATE POLICY "alumnos_fotos_delete_staff" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'alumnos-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
  );


-- ============================================================================
-- Fin de la migración 0036.
--
-- PENDIENTE PARA LA UI (fuera de este archivo, AlumnosPage.jsx): el campo
-- "Foto (URL opcional)" pasa a ser un <input type="file"> que sube a este
-- bucket con el path '{gimnasio_id}/{alumno_id}.<ext>', mismo criterio que
-- ya usa EjerciciosPage.jsx para el media de ejercicios -- el alumno tiene
-- que existir ANTES de subir el archivo (crear/guardar primero, subir
-- después), porque el EXISTS de SECCIÓN 2.2 lo exige. El campo sigue
-- siendo opcional: sin archivo elegido, no se sube nada y foto_url queda
-- como estaba.
-- ============================================================================
