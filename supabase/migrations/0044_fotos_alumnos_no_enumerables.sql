-- 0044: el bucket de fotos de alumnos deja de poder listarse desde afuera.
--
-- Encontrado en el repaso de seguridad (11/09/2026) y verificado contra la
-- base de produccion.
--
-- La policy de lectura que dejo 0036 era:
--     FOR SELECT TO public USING (bucket_id = 'alumnos-fotos')
-- o sea: sin filtro de gimnasio y para CUALQUIERA, sin sesion. El comentario
-- de 0036 daba por mitigado el riesgo porque el path lleva el UUID del alumno
-- y "no se puede adivinar". El problema es que no hace falta adivinarlo:
-- storage.list() es un SELECT sobre storage.objects y pasa por esta misma
-- policy, asi que cualquiera podia pedir el listado completo del bucket y
-- sacar de ahi:
--   - el UUID de TODOS los gimnasios (son los nombres de carpeta),
--   - el UUID y la foto de todos sus alumnos.
--
-- Encadenado con el agujero de 0043 (poder cambiarse el propio gimnasio_id),
-- esto completaba el camino para robar los datos de cualquier gimnasio:
-- listar el bucket sin login para sacar los UUID, crear una cuenta gratis, y
-- ponerse el gimnasio_id del otro.
--
-- Las otras dos policies publicas (gimnasio-logos, ejercicios-media) se dejan
-- como estan a proposito: ahi no hay datos personales y los videos de
-- ejercicios los tiene que poder ver el alumno desde /mi-plan sin sesion.
--
-- No rompe nada: la foto del alumno solo se muestra en AlumnosPage.jsx y
-- AlumnoPage.jsx, las dos detras del login del profesor. /mi-plan no la usa.

DROP POLICY IF EXISTS "alumnos_fotos_select_public" ON storage.objects;

CREATE POLICY "alumnos_fotos_select_staff" ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'alumnos-fotos'
        AND (storage.foldername(name))[1] = public.get_mi_gimnasio_id()::text
    );

-- NOTA para mas adelante: el bucket sigue marcado como `public`, asi que una
-- URL ya conocida (la que guarda alumnos.foto_url) sigue abriendose sin
-- sesion. Eso es lo que hace falta hoy para que la foto se vea en el panel.
-- Lo que este cambio corta es lo importante: que alguien pueda ENUMERAR el
-- bucket entero sin tener ninguna URL. El paso siguiente, cuando haya mas
-- gimnasios, es pasar el bucket a privado y servir las fotos con URL firmada
-- con vencimiento (createSignedUrl) en vez de getPublicUrl.
