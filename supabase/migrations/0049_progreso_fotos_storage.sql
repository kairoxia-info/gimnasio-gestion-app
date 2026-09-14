-- ============================================================================
-- 0049_progreso_fotos_storage.sql
--
-- Fase 2.5 (13/09/2026), pedido de Nalux: sumar carga de fotos al
-- seguimiento físico del alumno (progreso), mismo espíritu que ya existe
-- para peso/cintura/etc. -- una foto de "antes/después" es el complemento
-- natural de las medidas numéricas.
--
-- A DIFERENCIA de alumnos-fotos (0036) y ejercicios-media (0005), este
-- bucket es PRIVADO desde el arranque, no público. Una foto de progreso
-- físico es más sensible que una foto de perfil (puede mostrar el cuerpo
-- del alumno en ropa deportiva ajustada, en distintas etapas) -- es
-- exactamente el tipo de dato para el que la auditoría de seguridad de
-- esta misma sesión (11/09/2026) recomendó URLs firmadas como "el paso
-- siguiente" para alumnos-fotos. Como este bucket se crea de cero ahora,
-- no hay motivo para repetir el criterio menos estricto.
--
-- Con el bucket privado, foto_url no sirve de nada guardada como URL
-- pública -- se guarda el PATH del archivo (foto_path) y el cliente pide
-- una signed URL (createSignedUrl, corta duración) cada vez que necesita
-- mostrarla.
-- ============================================================================

ALTER TABLE public.progreso
    ADD COLUMN IF NOT EXISTS foto_path TEXT;

-- ============================================================================
-- SECCIÓN 1 — Alta del bucket (privado)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'progreso-fotos',
  'progreso-fotos',
  false,                                     -- privado: solo por signed URL
  2097152,                                   -- 2 MB, mismo tope que alumnos-fotos
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- SECCIÓN 2 — Policies sobre storage.objects
--
-- Convención de path: '{gimnasio_id}/{progreso_id}.<ext>' -- el UUID de la
-- FILA de progreso (no del alumno: un alumno tiene muchos registros a lo
-- largo del tiempo, cada uno con su propia foto posible). Mismo patrón de
-- regex anclado + EXISTS contra la tabla dueña que ya usan 0005/0036.
-- ============================================================================

-- 2.1 SELECT -- solo staff autenticado del gimnasio dueño (bucket privado:
-- esto es lo que de verdad protege el archivo, más allá del signed URL).
CREATE POLICY "progreso_fotos_select_staff" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'progreso-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
  );

-- 2.2 INSERT
CREATE POLICY "progreso_fotos_insert_staff" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'progreso-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(png|jpe?g|webp)$'
    )
    AND EXISTS (
      SELECT 1 FROM public.progreso p
      WHERE p.gimnasio_id = public.get_mi_gimnasio_id()
        AND p.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  );

-- 2.3 UPDATE -- upsert al re-subir una foto con el mismo nombre.
CREATE POLICY "progreso_fotos_update_staff" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'progreso-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND EXISTS (
      SELECT 1 FROM public.progreso p
      WHERE p.gimnasio_id = public.get_mi_gimnasio_id()
        AND p.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  )
  WITH CHECK (
    bucket_id = 'progreso-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    AND name ~ (
      '^' || public.get_mi_gimnasio_id()::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(png|jpe?g|webp)$'
    )
    AND EXISTS (
      SELECT 1 FROM public.progreso p
      WHERE p.gimnasio_id = public.get_mi_gimnasio_id()
        AND p.id::text = split_part(split_part(name, '/', 2), '.', 1)
    )
  );

-- 2.4 DELETE -- cualquier staff del gimnasio, cualquier archivo de su
-- propia carpeta (permite limpiar huérfanos de registros ya borrados).
CREATE POLICY "progreso_fotos_delete_staff" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'progreso-fotos'
    AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
  );

-- ============================================================================
-- Fin de la migración 0049.
-- ============================================================================
