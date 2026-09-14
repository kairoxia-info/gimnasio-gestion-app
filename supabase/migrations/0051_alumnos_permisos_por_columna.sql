-- ============================================================================
-- 0051_alumnos_permisos_por_columna.sql
--
-- Repaso de seguridad del 14/09/2026 (pedido de Nalux: "quiero que sea todo
-- seguro"). Hallazgo: el panel del profesor recibía las 28 columnas de cada
-- alumno, incluido el hash bcrypt de su contraseña. Comprobado en vivo contra
-- la app real, no era teoría: una consulta desde la consola del navegador,
-- con la sesión normal de la profesora, devolvía `password_hash` con valor.
--
-- Por qué pasaba: la migración 0002 otorgó `GRANT SELECT, INSERT, UPDATE,
-- DELETE ON public.alumnos TO authenticated` a nivel de TABLA entera, y
-- `lib/data.js` pedía `select('*')` en todas las pantallas. RLS hacía bien su
-- trabajo (solo alumnos del propio gimnasio, nunca de otro), así que NO era
-- una fuga entre gimnasios ni hacia un anónimo -- pero el hash de una
-- contraseña no tiene por qué llegar nunca al navegador: si mañana entra un
-- XSS, una extensión de navegador metida, o alguien agarra la compu del
-- profesor abierta, se lleva hashes para intentar romperlos offline y entrar
-- al portal de esos alumnos. Esto lo corta de raíz.
--
-- Se recortan los permisos a nivel de COLUMNA, dejando afuera:
--   * password_hash                          -> el hash de la contraseña
--   * login_intentos_contador/_ventana_inicio    -> tope de intentos (0042)
--   * plan_consultas_contador/_ventana_inicio    -> tope de consultas (0006)
--   * escritura_intentos_contador/_ventana_inicio-> tope de escrituras (0050)
--   * dni                                    -> se sacó de toda la app el
--     11/09/2026 y quedó vacía (verificado: 0 de 8 alumnos la tienen
--     cargada). Si no se usa y es un dato personal, tampoco tiene por qué
--     viajar al navegador.
--
-- Nada de esto lo usa ninguna pantalla: se verificó buscándolos uno por uno
-- en todo `apps/web/src` antes de sacarlos (password_hash: cero usos; los
-- contadores: cero usos; el cartel "este alumno todavía no tiene acceso" mira
-- `usuario`, que SÍ queda).
--
-- IMPORTANTE para el futuro: con permisos por columna, `SELECT *` NO filtra
-- en silencio -- falla entero con "permission denied for column". Por eso
-- este cambio va de la mano con `columnasDe()` en `apps/web/src/lib/data.js`,
-- que lista exactamente las mismas columnas. Si algún día se agrega una
-- columna nueva a `alumnos` que el panel necesite, hay que sumarla en los DOS
-- lados o la pantalla se rompe.
--
-- Las funciones SECURITY DEFINER (iniciar_sesion_alumno, crear_acceso_alumno,
-- regenerar_codigo_acceso_alumno, ver_plan_por_codigo, marcar_entrenamiento_
-- hecho, alumno_cargar_peso...) NO se ven afectadas: corren con los permisos
-- de su dueño, no con los del profesor, así que siguen leyendo y escribiendo
-- password_hash y los contadores como siempre. Lo único que cambia es lo que
-- puede pedir el navegador por su cuenta.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SELECT: lista blanca de las 20 columnas que el panel sí usa.
-- ----------------------------------------------------------------------------
REVOKE SELECT ON public.alumnos FROM authenticated;

GRANT SELECT (
  id, gimnasio_id, nombre, contacto, email, fecha_alta, fecha_nacimiento,
  foto_url, activo, observaciones_salud, plan_precio_nombre, user_id,
  created_at, origen, codigo_acceso, contacto_emergencia, objetivo,
  pendiente, usuario, notas_internas
) ON public.alumnos TO authenticated;

-- ----------------------------------------------------------------------------
-- UPDATE: mismas columnas. Un profesor no tiene por qué escribir un hash a
-- mano -- para dar o regenerar el acceso de un alumno ya están
-- crear_acceso_alumno()/quitar_acceso_alumno(), que son SECURITY DEFINER y
-- hacen el bcrypt del lado del servidor. Y los contadores de tope de intentos
-- los maneja únicamente el servidor: si el cliente pudiera escribirlos, el
-- tope se saltearía poniéndolos en cero.
-- ----------------------------------------------------------------------------
REVOKE UPDATE ON public.alumnos FROM authenticated;

GRANT UPDATE (
  id, gimnasio_id, nombre, contacto, email, fecha_alta, fecha_nacimiento,
  foto_url, activo, observaciones_salud, plan_precio_nombre, user_id,
  created_at, origen, codigo_acceso, contacto_emergencia, objetivo,
  pendiente, usuario, notas_internas
) ON public.alumnos TO authenticated;

-- ----------------------------------------------------------------------------
-- INSERT: mismas columnas. El alta desde el panel manda solo datos normales
-- (nombre, contacto, plan...) más gimnasio_id, que createRec() agrega y la
-- policy de RLS igual valida contra get_mi_gimnasio_id(). codigo_acceso tiene
-- DEFAULT en la columna (gen_random_bytes(16) -> 32 hex), así que se sigue
-- generando solo del lado del servidor aunque el cliente no lo mande.
-- ----------------------------------------------------------------------------
REVOKE INSERT ON public.alumnos FROM authenticated;

GRANT INSERT (
  id, gimnasio_id, nombre, contacto, email, fecha_alta, fecha_nacimiento,
  foto_url, activo, observaciones_salud, plan_precio_nombre, user_id,
  created_at, origen, codigo_acceso, contacto_emergencia, objetivo,
  pendiente, usuario, notas_internas
) ON public.alumnos TO authenticated;

-- DELETE se deja como está: es por fila entera (no tiene sentido a nivel de
-- columna) y RLS ya limita a los alumnos del propio gimnasio.

-- ============================================================================
-- Fin de la migración 0051.
-- ============================================================================
