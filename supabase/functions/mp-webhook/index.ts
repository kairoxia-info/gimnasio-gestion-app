// Edge Function "mp-webhook" (migración 0086, 30/10/2026): recibe los avisos de Mercado Pago sobre la
// suscripción (alta, pago, cancelación) y se los pasa a la base.
//
// SEGURIDAD
//  * verify_jwt = false: Mercado Pago no manda sesión de Supabase. En su lugar se VALIDA LA FIRMA del aviso
//    (cabecera x-signature, HMAC-SHA256 con MP_WEBHOOK_SECRET): un aviso sin firma válida se rechaza.
//  * No se confía en el contenido del aviso: solo se toma el identificador y se vuelve a consultar a Mercado
//    Pago con nuestro token (MP_ACCESS_TOKEN) para saber el estado real.
//  * La base aplica cada aviso una sola vez (suscripcion_eventos) y solo esta función puede llamarla
//    (suscripcion_aplicar_evento está concedida únicamente a service_role).
//
// SECRETOS: MP_ACCESS_TOKEN y MP_WEBHOOK_SECRET (la "clave secreta" que muestra Mercado Pago al configurar
// el webhook). Cambian entre pruebas y producción.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MP = 'https://api.mercadopago.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const aHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const hmacHex = async (clave: string, mensaje: string) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return aHex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(mensaje)));
};

// Comparación en tiempo constante.
const iguales = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

// Devuelve el estado HTTP y el cuerpo (o null si no es JSON): quien llama decide qué hacer con un 404.
const pedir = async (ruta: string, token: string) => {
  const r = await fetch(`${MP}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  const texto = await r.text();
  let cuerpo: any = null;
  try {
    cuerpo = JSON.parse(texto);
  } catch (_) {
    // no es JSON
  }
  return { ok: r.ok, status: r.status, cuerpo, texto: texto.slice(0, 300) };
};

const consultar = async (ruta: string, token: string) => {
  const r = await pedir(ruta, token);
  if (!r.ok) throw new Error(`Mercado Pago ${ruta} respondió ${r.status} ${r.texto}`);
  return r.cuerpo;
};

const responder = (texto: string, status = 200) => new Response(texto, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder('Método no permitido', 405);

  const token = Deno.env.get('MP_ACCESS_TOKEN');
  const secreto = Deno.env.get('MP_WEBHOOK_SECRET');
  if (!token || !secreto) {
    console.error('Falta MP_ACCESS_TOKEN o MP_WEBHOOK_SECRET');
    return responder('No configurado', 503);
  }

  const url = new URL(req.url);
  const cuerpo = await req.json().catch(() => ({}));
  const tipo = String(url.searchParams.get('type') ?? cuerpo?.type ?? url.searchParams.get('topic') ?? '');
  const idQuery = String(url.searchParams.get('data.id') ?? '');
  const id = idQuery || String(cuerpo?.data?.id ?? '');

  // --- Firma ---------------------------------------------------------------------------------------
  const firma = req.headers.get('x-signature') ?? '';
  const requestId = req.headers.get('x-request-id') ?? '';
  const partes = Object.fromEntries(
    firma.split(',').map((p) => {
      const [k, ...v] = p.split('=');
      return [k.trim(), v.join('=').trim()];
    }),
  );
  if (!partes.ts || !partes.v1 || !idQuery) return responder('Firma ausente', 401);
  // Mercado Pago firma el id en minúsculas cuando es alfanumérico.
  const manifiesto = `id:${/^[a-z0-9]+$/i.test(idQuery) ? idQuery.toLowerCase() : idQuery};request-id:${requestId};ts:${partes.ts};`;
  const esperado = await hmacHex(secreto, manifiesto);
  if (!iguales(esperado, partes.v1)) return responder('Firma inválida', 401);

  try {
    let preapprovalId = '';
    let referencia = ''; // external_reference, si el aviso es de un pago común
    let pago: { id: string; estado: string; monto: number } | null = null;

    if (tipo === 'subscription_preapproval') {
      preapprovalId = id;
    } else if (tipo === 'subscription_authorized_payment') {
      // El aviso suele llegar un instante antes de que el pago pueda consultarse (404 en las dos vías):
      // se reintenta unas pocas veces. Mercado Pago espera la respuesta unos 20 s, así que el total se
      // mantiene por debajo de eso; si igual no aparece, el 500 hace que Mercado Pago reintente.
      const INTENTOS = 4;
      const ESPERA_MS = 3000;
      let ultimo = '';
      for (let i = 0; i < INTENTOS && !pago; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, ESPERA_MS));
        const r1 = await pedir(`/authorized_payments/${encodeURIComponent(id)}`, token);
        if (r1.ok) {
          const ap = r1.cuerpo;
          preapprovalId = String(ap.preapproval_id ?? '');
          pago = {
            id: String(ap.id ?? id),
            estado: String(ap.payment?.status ?? ap.status ?? ''),
            monto: Number(ap.transaction_amount ?? 0),
          };
          break;
        }
        if (r1.status !== 404) {
          throw new Error(`Mercado Pago /authorized_payments/${id} respondió ${r1.status} ${r1.texto}`);
        }
        // En algunos casos (por ejemplo en el modo de prueba) el número es el de un pago común.
        const r2 = await pedir(`/v1/payments/${encodeURIComponent(id)}`, token);
        if (r2.ok) {
          const p = r2.cuerpo;
          preapprovalId = String(p.metadata?.preapproval_id ?? p.metadata?.preapprovalId ?? '');
          referencia = String(p.external_reference ?? '');
          pago = { id: String(p.id ?? id), estado: String(p.status ?? ''), monto: Number(p.transaction_amount ?? 0) };
          console.log('Pago consultado por /v1/payments', id, pago.estado, 'intento', i + 1, 'preapproval:', preapprovalId || '(sin dato)', 'referencia:', referencia ? 'sí' : 'no');
          break;
        }
        ultimo = `/v1/payments ${r2.status} ${r2.texto}`;
      }
      if (!pago) {
        throw new Error(`ni /authorized_payments (404) ni ${ultimo} conocen el id ${id} tras ${INTENTOS} intentos`);
      }
    } else {
      return responder('Ignorado'); // otros avisos (por ejemplo "payment") no interesan acá
    }
    if (!preapprovalId && !referencia) {
      console.error('Aviso sin suscripción ni referencia', tipo, id);
      return responder('Sin suscripción');
    }

    const pre = preapprovalId ? await consultar(`/preapproval/${encodeURIComponent(preapprovalId)}`, token) : null;
    const [org, plan, periodo] = String(pre?.external_reference ?? referencia).split('|');
    if (!UUID.test(org ?? '') || !plan || !periodo) {
      console.error('Aviso de una suscripción que no es de RutNail', preapprovalId);
      return responder('Ignorado');
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin.rpc('suscripcion_aplicar_evento', {
      p_org: org,
      p_plan: plan,
      p_periodo: periodo,
      p_preapproval_id: pre ? String(pre.id ?? preapprovalId) : null,
      p_preapproval_estado: pre ? String(pre.status ?? '') : '',
      p_payer_email: pre?.payer_email ? String(pre.payer_email) : null,
      p_pago_id: pago ? pago.id : null,
      p_pago_estado: pago ? pago.estado : null,
      p_pago_monto: pago ? pago.monto : null,
      p_crudo: { tipo, id, preapproval: pre ? { id: pre.id, status: pre.status } : null, pago },
    });
    if (error) throw new Error(error.message);
    console.log('Aviso aplicado', tipo, id, data);
    return responder(String(data ?? 'ok'));
  } catch (e) {
    // 500 para que Mercado Pago reintente más tarde.
    console.error('Error aplicando el aviso', tipo, id, (e as Error).message);
    return responder('Error', 500);
  }
});
