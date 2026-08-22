-- ============================================================================
-- 0003_gimnasio_logos_storage.sql
--
-- Bucket de Supabase Storage para el logo de cada gimnasio, subido durante
-- el onboarding (después de create_gimnasio(), ver 0001 SECCIÓN 5).
--
-- Migración puramente ADITIVA: no toca ninguna tabla, policy ni función de
-- 0001/0002. Solo crea el bucket 'gimnasio-logos' y sus policies sobre
-- storage.objects.
--
-- Convención de path: '{gimnasio_id}/logo.<ext>' — un solo logo por
-- gimnasio, se sobreescribe en cada re-subida (upload con upsert: true
-- desde el cliente). El primer segmento del path es el gimnasio_id, lo que
-- permite reusar exactamente el mismo patrón de aislamiento por tenant que
-- el resto del schema: comparar ese segmento contra get_mi_gimnasio_id().
--
-- ADVERTENCIA IMPORTANTE DE ARQUITECTURA (por qué este archivo NO tiene una
-- sección de GRANT/REVOKE como 0002): storage.objects y storage.buckets son
-- tablas ÚNICAS Y COMPARTIDAS por TODOS los buckets del proyecto, no una
-- tabla por bucket. Supabase ya les otorga por defecto los GRANT de tabla
-- necesarios a 'anon' y 'authenticated' a nivel de infraestructura — eso es
-- intencional y NO hay que tocarlo. Si acá hiciéramos algo como
-- 'REVOKE ALL ON storage.objects FROM anon' (calcando el patrón de 0002),
-- romperíamos el acceso a TODOS los demás buckets del proyecto (incluido
-- el futuro 'ejercicios-media' del Bloque F), no solo a este. El control de
-- acceso por bucket se hace 100% vía RLS con 'bucket_id = ...' en el
-- USING/WITH CHECK de cada policy, nunca vía GRANT de tabla. RLS sobre
-- storage.objects ya viene habilitado por Supabase de fábrica; no hace
-- falta (ni corresponde) un ALTER TABLE ... ENABLE ROW LEVEL SECURITY acá.
--
-- AppSec review previa a la primera ejecucion (2026-08-19): la fuga de
-- escritura ENTRE tenants no aparece aca -- a diferencia del gap
-- encontrado en 0001 (handle_new_user confiaba en un campo role que
-- llenaba el cliente), aca el WITH CHECK ya estaba presente y completo en
-- INSERT y en UPDATE desde la primera version de este archivo. Si se
-- encontro y se corrigio un gap DENTRO del propio tenant (ver FIX en
-- SECCION 2.2/2.3 mas abajo): nada impedia que un admin subiera una
-- cantidad ilimitada de archivos con cualquier nombre dentro de SU PROPIA
-- carpeta, no solo logo con extension.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 — Alta del bucket
-- ============================================================================
-- file_size_limit va en BYTES (columna bigint). 2 MB = 2 * 1024 * 1024.
-- allowed_mime_types restringe a nivel de BUCKET (lo valida el propio
-- storage-api de Supabase antes de aceptar el archivo), no es solo una
-- validación de policy — un PDF o un .exe con extensión falsa "logo.png"
-- ni siquiera llega a evaluarse contra las policies de abajo.
--
-- ON CONFLICT DO NOTHING: por si el bucket ya fue creado a mano desde el
-- Dashboard antes de correr esta migración (judgment call, ver resumen);
-- no pisa la config de un bucket preexistente, solo evita que la migración
-- falle con "duplicate key" si se re-corre por error.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gimnasio-logos',
  'gimnasio-logos',
  true,                                     -- lectura pública, ver SECCIÓN 2.1
  2097152,                                  -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- SECCIÓN 2 — Policies sobre storage.objects, filtradas por bucket_id
-- Mismo patrón que "gimnasios_update_admin" de 0001: USING y WITH CHECK
-- repiten la misma condición (comparación de tenant + EXISTS de role admin
-- contra profiles).
-- ============================================================================

-- --------------------------------------------------------------------------
-- 2.1 SELECT — lectura pública, sin restricción de tenant ni de rol.
-- No hay nada confidencial en un logo, y el bucket ya está marcado
-- public = true arriba, así que getPublicUrl() en el cliente sirve el
-- archivo directo sin pasar por esta policy (Supabase resuelve
-- /storage/v1/object/public/... sin evaluar RLS cuando el bucket es
-- público). Esta policy se agrega de todas formas por dos motivos:
-- defensa en profundidad, y para que también funcione el endpoint NO
-- público (/object/... , el que usa el método download() del SDK), que sí
-- pasa por RLS incluso en un bucket marcado public. Sin "TO", aplica a
-- PUBLIC (anon incluido) a proposito: es lectura publica real.
--
-- CONFIRMADO en AppSec review: public = true en el bucket solo afecta el
-- endpoint de LECTURA (object public). Nunca abre un camino de ESCRITURA
-- sin pasar por RLS. INSERT/UPDATE/DELETE (incluido el protocolo TUS de
-- subida resumable) siempre pasan por storage-api autenticado, que evalua
-- las policies de abajo sin excepcion. No hay hallazgo aca.
CREATE POLICY "gimnasio_logos_select_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'gimnasio-logos');

-- --------------------------------------------------------------------------
-- 2.2 INSERT — solo admin, y solo dentro de la carpeta de su propio
-- gimnasio. (storage.foldername(name))[1] es el primer segmento del path
-- ('{gimnasio_id}/logo.<ext>' -> el gimnasio_id). "TO authenticated": un
-- request anónimo ni siquiera llega a evaluar la condición (auth.uid()
-- sería NULL y fallaría igual, pero restringir el rol de la policy es más
-- prolijo y evita evaluarla de mas).
--
-- FIX (AppSec review, 2026-08-19, previo a la primera ejecucion de esta
-- migracion): la version original de esta policy solo comparaba el PRIMER
-- segmento del path contra el tenant (foldername primer elemento), sin
-- validar nada del resto del path. Cualquier admin podia subir un archivo
-- con name igual a su_gimnasio_id seguido de barra y cualquier nombre
-- arbitrario, incluso con segmentos de carpeta extra -- la condicion de
-- tenant se seguia cumpliendo igual, porque solo mira el primer segmento.
-- Impacto: (a) abuso de espacio de storage del proyecto -- nada limitaba
-- la CANTIDAD de archivos que un admin podia amontonar dentro de su propia
-- carpeta, cada uno hasta el file_size_limit de 2 MB; con miles de
-- archivos eso agota cuota de storage compartida por TODOS los tenants del
-- proyecto, no solo el propio (mismo espiritu que el hallazgo de
-- create_gimnasio sin REVOKE en 0001); (b) reduce a cero el margen de
-- maniobra ante cualquier comportamiento inesperado de storage-api con
-- paths raros -- con el patron anclado de abajo, ese tipo de name ni
-- siquiera pasa el WITH CHECK. El codigo cliente actual
-- (apps/web/src/pages/OnboardingPage.jsx) ya arma el path bien
-- (gimnasioId + logo + extension, con gimnasioId devuelto por la RPC
-- create_gimnasio y ext de una whitelist fija, nunca del nombre de
-- archivo que eligio el usuario), asi que hoy no hay explotacion activa
-- via la UI -- pero la policy no debe depender de que el codigo cliente
-- sea disciplinado, tiene que ser fail-closed por si sola: manana puede
-- aparecer otra pantalla, otro script, o un curl directo con el token del
-- usuario. Se agrega el chequeo de patron completo (no solo el primer
-- segmento) aca.
CREATE POLICY "gimnasio_logos_insert_admin" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'gimnasio-logos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ ('^' || public.get_mi_gimnasio_id()::text || '/logo\.(png|jpe?g|webp)$')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- --------------------------------------------------------------------------
-- 2.3 UPDATE — necesaria para el caso upload(..., { upsert: true }): si el
-- archivo ya existe en ese path exacto (ej. re-subir logo.png con el mismo
-- nombre), storage-api hace un upsert real a nivel de fila, que dispara
-- policies de UPDATE, no de INSERT. Sin esta policy, re-subir un logo con
-- el mismo nombre de archivo devolvería "new row violates row-level
-- security policy" pese a que insert_admin este OK.
--
-- FIX (AppSec review, 2026-08-19): mismo motivo que 2.2 -- se agrega el
-- chequeo de patron completo tambien aca, tanto en USING (que filas
-- existentes puede tocar un admin) como en WITH CHECK (que nombre puede
-- resultar tras el update), para que la restriccion sea simetrica en las
-- tres operaciones de escritura.
CREATE POLICY "gimnasio_logos_update_admin" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'gimnasio-logos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ ('^' || public.get_mi_gimnasio_id()::text || '/logo\.(png|jpe?g|webp)$')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'gimnasio-logos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ ('^' || public.get_mi_gimnasio_id()::text || '/logo\.(png|jpe?g|webp)$')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- --------------------------------------------------------------------------
-- 2.4 DELETE — necesaria para el caso en que el admin cambia de extensión
-- (ej. tenía logo.png y sube logo.webp): el nombre de archivo cambia, así
-- que no es un upsert sobre la misma fila, sino un archivo nuevo + borrado
-- del viejo. Sin DELETE, el logo anterior queda huérfano en el bucket para
-- siempre. Deliberadamente SIN filtro por 'owner' (quién subió el archivo
-- originalmente): cualquier admin del gimnasio puede reemplazar el logo,
-- no solo quien lo subió la primera vez — coherente con que el logo es un
-- dato del gimnasio, no de una persona.
--
-- A proposito SIN el chequeo de patron completo que si se agrego en
-- 2.2/2.3: aca interesa lo opuesto -- que un admin pueda limpiar CUALQUIER
-- archivo huerfano o no conforme que haya quedado en su propia carpeta
-- (incluidos los que pudieran existir de antes de este fix, o subidos a
-- mano desde el Dashboard), no restringirle el borrado a un solo nombre
-- exacto. Sigue acotado a su propia carpeta mas rol admin, que es lo que
-- importa para DELETE.
CREATE POLICY "gimnasio_logos_delete_admin" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'gimnasio-logos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );


-- ============================================================================
-- Fin de la migracion 0003. Pendiente (fuera de alcance aca, a proposito):
-- bucket "ejercicios-media" del Bloque F es un archivo aparte.
--
-- NOTA DIFERIDA (AppSec review, 2026-08-19, no es un gap nuevo de este
-- archivo -- se hereda de 0001 y ya esta documentado y diferido ahi):
-- profiles_update_self (0001, SECCION 4.2) permite que cualquier staff se
-- autoasigne role admin via UPDATE directo dentro de SU PROPIO tenant.
-- Como las policies de este archivo usan esa misma columna role para
-- decidir quien puede escribir el logo, ese gap ya conocido ahora tambien
-- habilita a un staff auto-promovido a reemplazar el logo publico de su
-- gimnasio (antes solo destrababa gimnasios_update_admin). Sigue siendo
-- estrictamente INTRA-tenant (get_mi_gimnasio_id no se ve afectado por
-- este gap), asi que no es fuga entre tenants. No amerita fix en ESTE
-- archivo: la correccion correcta (trigger BEFORE UPDATE, o REVOKE de
-- columna sobre profiles role y gimnasio_id) ya esta identificada y
-- diferida a una migracion aparte en 0001; cuando se aplique ahi, este
-- archivo queda corregido automaticamente sin tocarlo, porque reutiliza la
-- misma condicion EXISTS con role admin.
-- ============================================================================
