// Edge Function "suscripcion" (migración 0086, pedido de Nalux del 30/10/2026): crea y cancela el cobro
// automático de la suscripción en Mercado Pago.
//
// Qué hace: el administrador elige un plan y un período en la pantalla "Suscripción"; esta función valida
// la elección en la base (suscripcion_preparar: plan, tope de alumnos y de gimnasios, monto), le pide a
// Mercado Pago un cobro recurrente en estado "pending" y devuelve el link (init_point) al que se manda a
// la persona para pagar. El pago en sí lo confirma Mercado Pago por webhook (función "mp-webhook").
//
// SEGURIDAD
//  * verify_jwt = true: solo sesiones válidas. Quién es y de qué organización sale del TOKEN (las funciones
//    SQL verifican que sea ADMINISTRADOR); nada de eso sale del cuerpo del pedido.
//  * El monto y el plan los calcula la base, nunca el navegador.
//  * El token de Mercado Pago (MP_ACCESS_TOKEN) vive solo en los secretos de esta función.
//  * Los errores de Mercado Pago se anotan en el registro de la función, no se muestran tal cual.
//
// SECRETOS (Supabase > Edge Functions > Secrets):
//  MP_ACCESS_TOKEN  token de Mercado Pago (de prueba o de producción: el cambio de uno a otro es solo este valor)
//  APP_URL          dirección pública de la app, sin barra final (ej. https://rutnail.vercel.app)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MP = 'https://api.mercadopago.com';

// Mensajes que escribimos nosotros en las funciones SQL y se pueden mostrar tal cual.
const mensajeDe = (error: { message?: string } | null, porDefecto: string) => {
  const m = error?.message ?? '';
  if (/^(Tienes \d+|Solo el administrador|Ese plan|Ese período)/.test(m)) return m;
  return porDefecto;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const token = Deno.env.get('MP_ACCESS_TOKEN');
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  if (!token || !appUrl) {
    console.error('Falta MP_ACCESS_TOKEN o APP_URL');
    return json({ error: 'El cobro todavía no está configurado. Escríbenos y lo resolvemos.' }, 503);
  }

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = await req.json();
  } catch (_) {
    return json({ error: 'Pedido inválido' }, 400);
  }
  const accion = typeof cuerpo.accion === 'string' ? cuerpo.accion : '';

  // --- Crear el cobro -------------------------------------------------------------------------
  if (accion === 'crear') {
    const plan = typeof cuerpo.plan === 'string' ? cuerpo.plan : '';
    const periodo = typeof cuerpo.periodo === 'string' ? cuerpo.periodo : '';
    const { data, error } = await supa.rpc('suscripcion_preparar', { p_plan: plan, p_periodo: periodo });
    if (error || !data) {
      return json({ error: mensajeDe(error, 'No se pudo preparar la suscripción. Inténtalo de nuevo.') }, 400);
    }

    const correoPedido = typeof cuerpo.email === 'string' ? cuerpo.email.trim() : '';
    const email = EMAIL.test(correoPedido) ? correoPedido : (data.email as string);

    // A dónde vuelve la persona después de pagar: solo la app (o el entorno local de pruebas).
    const volver = typeof cuerpo.volver_a === 'string' ? cuerpo.volver_a.replace(/\/$/, '') : '';
    const permitidos = [appUrl, 'http://localhost:3001', 'http://localhost:3000'];
    const base = permitidos.includes(volver) ? volver : appUrl;

    const respuesta = await fetch(`${MP}/preapproval`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: data.razon,
        // organización | plan | período: el webhook lo lee de acá para saber qué activar.
        external_reference: `${data.organizacion_id}|${data.plan}|${data.periodo}`,
        payer_email: email,
        auto_recurring: {
          frequency: data.meses,
          frequency_type: 'months',
          transaction_amount: data.monto,
          currency_id: 'ARS',
        },
        back_url: `${base}/suscripcion?volvio=1`,
        status: 'pending',
      }),
    });
    const resultado = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !resultado.init_point) {
      console.error('Mercado Pago no creó el cobro', respuesta.status, JSON.stringify(resultado));
      return json(
        {
          error:
            'Mercado Pago no pudo crear el cobro. Revisa que el correo sea el de tu cuenta de Mercado Pago e inténtalo de nuevo.',
        },
        502,
      );
    }
    return json({ init_point: resultado.init_point });
  }

  // --- Cancelar el cobro automático ---------------------------------------------------------------
  if (accion === 'cancelar') {
    const { data: id, error } = await supa.rpc('suscripcion_mi_preapproval');
    if (error) return json({ error: mensajeDe(error, 'No se pudo cancelar. Inténtalo de nuevo.') }, 400);
    if (!id) return json({ error: 'No hay un cobro automático para cancelar.' }, 400);

    const respuesta = await fetch(`${MP}/preapproval/${encodeURIComponent(id as string)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    if (!respuesta.ok) {
      console.error('Mercado Pago no canceló', respuesta.status, await respuesta.text());
      return json({ error: 'Mercado Pago no pudo cancelar el cobro. Inténtalo de nuevo en un momento.' }, 502);
    }
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida' }, 400);
});
