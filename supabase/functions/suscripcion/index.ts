// Edge Function "suscripcion" (migración 0086, pedido de Nalux del 30/10/2026): crea y cancela el cobro
// automático de la suscripción en Mercado Pago.
//
// Qué hace: el administrador elige un plan y un período en la pantalla "Suscripción"; esta función valida
// la elección en la base (suscripcion_preparar: plan, tope de alumnos y de gimnasios, monto), le pide a
// Mercado Pago un PLAN de cobro recurrente (si ya creó uno igual para esa organización, plan, período y monto,
// lo reutiliza) y devuelve el link (init_point) al que se manda a la persona para suscribirse. El pago en sí
// lo confirma Mercado Pago por webhook (función "mp-webhook").
//
// Por qué un plan y no una suscripción con correo (migración 0090, 03/11/2026): con `POST /preapproval` +
// `payer_email`, Mercado Pago exige que la cuenta que paga tenga exactamente ese correo, y un cliente cuyo
// correo de Mercado Pago no sea el de RutNail no podía pagar ("Tu e-mail no coincide con el de la
// suscripción"). El link de un plan lo puede usar cualquier cuenta; la organización se reconoce después por
// el id del plan (tabla suscripcion_planes_mp).
//
// SEGURIDAD
//  * verify_jwt = true: solo sesiones válidas. Quién es y de qué organización sale del TOKEN (las funciones
//    SQL verifican que sea ADMINISTRADOR); nada de eso sale del cuerpo del pedido.
//  * El monto y el plan los calcula la base, nunca el navegador.
//  * El token de Mercado Pago (MP_ACCESS_TOKEN) vive solo en los secretos de esta función. La tabla que
//    relaciona planes de Mercado Pago con organizaciones solo se toca con service_role, desde acá y desde
//    mp-webhook.
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

const MP = 'https://api.mercadopago.com';

// Problemas del servidor (migración 0091): quedan en eventos_sistema y se ven en "Control de RutNail". El
// mensaje es fijo para poder agruparlos; lo variable va en `detalle`, sin claves. Anotar nunca cambia la
// respuesta.
const anotar = async (mensaje: string, detalle: Record<string, unknown> = {}, org: string | null = null) => {
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    await admin.rpc('registrar_evento_sistema', {
      p_origen: 'suscripcion',
      p_nivel: 'error',
      p_mensaje: mensaje,
      p_detalle: detalle,
      p_org: org,
    });
  } catch (_) {
    // sin registro: la respuesta a la pantalla sigue igual
  }
};

// Mensajes que escribimos nosotros en las funciones SQL y se pueden mostrar tal cual.
const mensajeDe = (error: { message?: string } | null, porDefecto: string) => {
  const m = error?.message ?? '';
  if (/^(Tienes \d+|Solo el administrador|Ese plan|Ese período)/.test(m)) return m;
  return porDefecto;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // trim(): al pegar una clave en el panel de Supabase puede quedar un espacio o salto de línea invisible.
  const token = Deno.env.get('MP_ACCESS_TOKEN')?.trim();
  const appUrl = (Deno.env.get('APP_URL') ?? '').trim().replace(/\/$/, '');
  if (!token || !appUrl) {
    console.error('Falta MP_ACCESS_TOKEN o APP_URL');
    await anotar('Faltan las claves del cobro en el servidor (nadie puede pagar)', { token: !!token, appUrl: !!appUrl });
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

    // Con service_role: la tabla de planes de Mercado Pago no es accesible desde el navegador.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const clave = { p_org: data.organizacion_id, p_plan: data.plan, p_periodo: data.periodo, p_monto: data.monto };

    // ¿Ya hay un plan de Mercado Pago para esta combinación? Se reutiliza (no se llena Mercado Pago de planes).
    const { data: existente, error: errorBuscar } = await admin.rpc('suscripcion_plan_mp_buscar', clave);
    if (errorBuscar) {
      console.error('No se pudo buscar el plan de Mercado Pago', errorBuscar.message);
      await anotar('No se pudo preparar el pago: falló la base al buscar el plan', { error: errorBuscar.message }, data.organizacion_id);
      return json({ error: 'No se pudo preparar el cobro. Inténtalo de nuevo.' }, 500);
    }
    if (existente?.init_point) return json({ init_point: existente.init_point });

    const respuesta = await fetch(`${MP}/preapproval_plan`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: data.razon,
        auto_recurring: {
          frequency: data.meses,
          frequency_type: 'months',
          transaction_amount: data.monto,
          currency_id: 'ARS',
        },
        // Mercado Pago le agrega su propio "?preapproval_id=…"; la pantalla lo tiene en cuenta (startsWith).
        back_url: `${appUrl}/suscripcion?volvio=1`,
      }),
    });
    const resultado = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || !resultado.id || !resultado.init_point) {
      console.error('Mercado Pago no creó el plan de cobro', respuesta.status, JSON.stringify(resultado));
      await anotar(
        'Mercado Pago no creó el plan de cobro (un cliente no pudo abrir el pago)',
        { status: respuesta.status, respuesta: JSON.stringify(resultado).slice(0, 500), plan: data.plan, periodo: data.periodo },
        data.organizacion_id,
      );
      return json({ error: 'Mercado Pago no pudo preparar el cobro. Inténtalo de nuevo en un momento.' }, 502);
    }

    // Sin guardar la relación plan ↔ organización, el pago no se podría reconocer: si falla, no se manda a pagar.
    const { data: guardado, error: errorGuardar } = await admin.rpc('suscripcion_plan_mp_guardar', {
      p_mp_plan_id: String(resultado.id),
      p_init_point: String(resultado.init_point),
      ...clave,
    });
    if (errorGuardar || !guardado?.init_point) {
      console.error('No se pudo guardar el plan de Mercado Pago', errorGuardar?.message ?? 'sin respuesta');
      await anotar('No se pudo preparar el pago: falló la base al guardar el plan', { error: errorGuardar?.message ?? 'sin respuesta' }, data.organizacion_id);
      return json({ error: 'No se pudo preparar el cobro. Inténtalo de nuevo.' }, 500);
    }
    return json({ init_point: guardado.init_point });
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
      const texto = (await respuesta.text()).slice(0, 500);
      console.error('Mercado Pago no canceló', respuesta.status, texto);
      await anotar('Mercado Pago no canceló un cobro automático (el cliente lo pidió)', { status: respuesta.status, respuesta: texto });
      return json({ error: 'Mercado Pago no pudo cancelar el cobro. Inténtalo de nuevo en un momento.' }, 502);
    }
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida' }, 400);
});
