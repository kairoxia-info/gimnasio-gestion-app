-- Fix encontrado en revisión (04/09/2026), no lo reportó Nalux con un
-- error: el índice único de la migración 0029 era PARCIAL (WHERE client_id
-- IS NOT NULL), y PostgREST arma el upsert como
-- "ON CONFLICT (client_id) DO NOTHING" SIN el WHERE -- Postgres no lo
-- reconoce como el mismo índice y devuelve 42P10 ("no hay ninguna
-- restricción única que coincida"). El upsert de un pago offline fallaba
-- SIEMPRE, silenciosamente (se descartaba de la cola sin insertarse -- ver
-- el catch de sincronizarCola() en lib/offline.js).
--
-- No hace falta que sea parcial: en Postgres un UNIQUE constraint/index
-- normal ya permite cualquier cantidad de filas con client_id NULL sin que
-- choquen entre sí (los NULL nunca son "iguales" a otro NULL) -- exactamente
-- lo que hace falta para los pagos cargados con conexión normal, que nunca
-- mandan client_id.
DROP INDEX IF EXISTS public.pagos_client_id_unico_idx;

ALTER TABLE public.pagos
  ADD CONSTRAINT pagos_client_id_key UNIQUE (client_id);
