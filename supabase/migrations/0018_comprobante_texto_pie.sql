-- Texto de pie del comprobante configurable, pedido por Nalux (03/09/2026) al
-- investigar Configuración. Hoy el comprobante (PagosPage.jsx, componente
-- Comprobante) tiene fija la frase "Este comprobante no es válido como
-- factura." -- se saca a un campo editable por gimnasio, con ESE mismo texto
-- como default para no cambiarle nada a nadie que no toque la configuración.
ALTER TABLE public.gimnasios
  ADD COLUMN comprobante_texto_pie TEXT NOT NULL
    DEFAULT 'Este comprobante no es válido como factura.';
