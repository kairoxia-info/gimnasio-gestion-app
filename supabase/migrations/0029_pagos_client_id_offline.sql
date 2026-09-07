-- Pedido de Nalux (04/09/2026): que el panel del profesor se pueda seguir
-- usando (ver datos, marcar asistencia, cobrar) si se corta el wifi del
-- gimnasio, y que lo que se hizo offline se mande solo en cuanto vuelve la
-- señal.
--
-- Para pagos en particular: un pago registrado SIN conexión queda guardado
-- en el celular (localStorage) con un client_id armado ahí mismo
-- (crypto.randomUUID()) y se manda de verdad recién cuando vuelve la señal.
-- client_id es la llave para que ese envío sea IDEMPOTENTE -- si por lo que
-- sea el envío se reintenta (se cortó a mitad de camino, se cerró la app
-- antes de terminar, etc.), el UPSERT con ON CONFLICT (client_id) no
-- duplica el pago.
--
-- El número de comprobante (asignar_numero_comprobante(), trigger ya
-- existente) sigue sin tocarse: calcula MAX(numero)+1 en cada intento de
-- insert real, así que un reintento que termina en "ya existe, no hacer
-- nada" nunca deja un hueco en la numeración -- el número solo se gasta de
-- verdad si la fila se llega a insertar. Ver el comentario del trigger para
-- el detalle del lock que ya evita pisarse entre dos pagos concurrentes.
ALTER TABLE public.pagos
  ADD COLUMN client_id UUID;

-- Parcial (WHERE client_id IS NOT NULL) porque un pago cargado con conexión
-- normal no manda client_id -- no tiene que competir por unicidad contra
-- nada.
CREATE UNIQUE INDEX pagos_client_id_unico_idx ON public.pagos (client_id)
  WHERE client_id IS NOT NULL;
