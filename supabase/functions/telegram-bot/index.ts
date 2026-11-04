// Edge Function "telegram-bot" (migración 0092, pedido de Nalux del 03/11/2026): el bot de Telegram del
// Control de RutNail. Le avisa a la dueña si pasa algo y responde cuando le pregunta cómo está todo.
//
// Le llegan tres cosas distintas:
//  * accion "conectar", desde el panel: arma el enlace para vincular el chat (solo la dueña de la plataforma).
//  * accion "despachar", desde pg_cron: manda lo que haya en la cola avisos_telegram.
//  * un mensaje de Telegram, por el webhook.
//
// SEGURIDAD
//  * verify_jwt = false: ni Telegram ni pg_cron mandan sesión de Supabase. Cada entrada se autentica sola:
//    "conectar" con la sesión de quien llama (telegram_preparar_vinculo exige dueña de la plataforma),
//    "despachar" con la clave de telegram_config y el webhook con la cabecera secreta de Telegram.
//  * El bot SOLO atiende al chat vinculado; a cualquier otro no le responde nada. El chat se vincula con un
//    código de un solo uso que vence en 10 minutos.
//  * Lo que sale por Telegram no lleva correos, ni datos de alumnos, ni rutas (la de /mi-plan/ tiene el código
//    de acceso del alumno). Los correos se miran en el panel.
//
// SECRETOS: TELEGRAM_BOT_TOKEN (la clave que da @BotFather).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ZONA = 'America/Argentina/Buenos_Aires';
const LIMITE_TELEGRAM = 4000; // Telegram corta en 4096
const DIAS_SIN_ACTIVIDAD = 7;

const TECLADO = {
  keyboard: [[{ text: '¿Cómo está todo?' }], [{ text: 'Cuentas' }, { text: 'Pagos' }, { text: 'Errores' }]],
  resize_keyboard: true,
  is_persistent: true,
};

const COMANDOS = [
  { command: 'estado', description: 'Cómo está todo esta semana' },
  { command: 'cuentas', description: 'Todas las cuentas' },
  { command: 'pagos', description: 'Últimos movimientos de Mercado Pago' },
  { command: 'errores', description: 'Errores y problemas del servidor' },
  { command: 'ayuda', description: 'Qué puedo hacer' },
];

const ESTADOS: Record<string, string> = {
  prueba: 'Prueba gratis',
  activa: 'Activa',
  pendiente: 'Pago pendiente',
  cancelada: 'Cancelada',
  cortesia: 'Cortesía',
};

const MOVIMIENTOS: Record<string, string> = {
  'pago:approved': '💰 Pago aprobado',
  'pago:rejected': '❌ Pago rechazado',
  'pago:cancelled': '❌ Pago cancelado',
  'pago:refunded': '↩️ Pago devuelto',
  'pago:pending': '⏳ Pago pendiente',
  'pago:in_process': '⏳ Pago en revisión',
  'suscripcion:authorized': '✅ Cobro automático activado',
  'suscripcion:paused': '⏸️ Cobro automático pausado',
  'suscripcion:cancelled': '🚫 Cobro automático cancelado',
  'suscripcion:pending': '⏳ Suscripción sin confirmar',
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const pesos = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es', { dateStyle: 'short', timeZone: ZONA }) : '—');
const fechaHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short', timeZone: ZONA }) : '—';

const haceCuanto = (iso: string | null) => {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${plural(dias, 'día', 'días')}`;
};

const recortar = (texto: string) => (texto.length > LIMITE_TELEGRAM ? `${texto.slice(0, LIMITE_TELEGRAM - 20)}\n\n(mensaje recortado)` : texto);

// Mismo criterio que el semáforo del panel (apps/web/src/pages/ControlPage.jsx).
const semaforoDe = (p: any) => {
  const problemas: string[] = [];
  const atencion: string[] = [];
  if (p.problemas_servidor > 0) problemas.push(`${plural(p.problemas_servidor, 'problema', 'problemas')} del servidor.`);
  if (p.errores >= 10) problemas.push(`${plural(p.errores, 'error', 'errores')} en pantallas de clientes.`);
  else if (p.errores > 0) atencion.push(`${plural(p.errores, 'error', 'errores')} en pantallas de clientes.`);
  if (p.pagos_rechazados > 0) atencion.push(`${plural(p.pagos_rechazados, 'pago rechazado', 'pagos rechazados')} en Mercado Pago.`);
  if (p.bloqueadas > 0) atencion.push(`${plural(p.bloqueadas, 'cuenta bloqueada', 'cuentas bloqueadas')} por suscripción vencida.`);
  if (p.solo_lectura > 0) atencion.push(`${plural(p.solo_lectura, 'cuenta', 'cuentas')} en solo lectura.`);
  if (p.avisos_servidor > 0) atencion.push(`${plural(p.avisos_servidor, 'aviso', 'avisos')} del servidor para revisar.`);
  if (problemas.length) return { icono: '🔴', titulo: 'Hay algo para resolver', items: [...problemas, ...atencion] };
  if (atencion.length) return { icono: '🟡', titulo: 'Hay cosas para mirar', items: atencion };
  return { icono: '🟢', titulo: 'Todo en orden', items: [] as string[] };
};

const textoEstado = (r: any, encabezado: string) => {
  const p = r.periodo;
  const s = semaforoDe(p);
  const lineas = [encabezado, '', `${s.icono} ${s.titulo}`, ...s.items.map((t) => `• ${t}`), ''];
  lineas.push(
    `Cuentas nuevas: ${p.cuentas_nuevas}`,
    `Pagos aprobados: ${p.pagos_aprobados} (${pesos(p.monto_aprobado)})`,
    `Pagos rechazados: ${p.pagos_rechazados}`,
    `Cobros cancelados: ${p.cancelaciones}`,
    `Errores en pantallas: ${p.errores}`,
    `Problemas del servidor: ${p.problemas_servidor}`,
  );
  if (p.pruebas_por_vencer > 0) {
    lineas.push('', `⏰ ${plural(p.pruebas_por_vencer, 'prueba gratis vence', 'pruebas gratis vencen')} en los próximos 3 días: buen momento para escribirles.`);
  }
  const inactivas = (r.cuentas ?? []).filter(
    (c: any) => c.estado !== 'cortesia' && (!c.ultima_actividad || Date.now() - new Date(c.ultima_actividad).getTime() > DIAS_SIN_ACTIVIDAD * 86400000),
  );
  if (inactivas.length) lineas.push('', `💤 Sin entrar hace más de ${DIAS_SIN_ACTIVIDAD} días: ${inactivas.map((c: any) => c.nombre).join(', ')}.`);
  return lineas.join('\n');
};

const textoCuentas = (r: any) => {
  const cuentas = r.cuentas ?? [];
  if (!cuentas.length) return 'Todavía no hay cuentas.';
  const bloques = cuentas.slice(0, 20).map((c: any) => {
    const estado = ESTADOS[c.estado] ?? c.estado ?? 'Sin suscripción';
    const acceso = c.estado === 'cortesia' ? '' : c.acceso === 'bloqueado' ? ' · Bloqueada' : c.acceso === 'solo_lectura' ? ' · Solo lectura' : '';
    return [
      `${c.nombre}`,
      `${estado}${acceso}${c.plan_nombre ? ` · ${c.plan_nombre}` : ''}`,
      `Vence: ${c.estado === 'cortesia' ? 'nunca' : fecha(c.vence_en)} · Alumnos activos: ${c.alumnos_activos}`,
      `Última actividad: ${haceCuanto(c.ultima_actividad)}${c.errores > 0 ? ` · Errores: ${c.errores}` : ''}`,
    ].join('\n');
  });
  const resto = cuentas.length > 20 ? `\n\nY ${cuentas.length - 20} más: míralas en el panel.` : '';
  return `Cuentas (${cuentas.length})\n\n${bloques.join('\n\n')}${resto}`;
};

const textoPagos = (r: any) => {
  const pagos = (r.pagos ?? []).slice(0, 10);
  if (!pagos.length) return 'Sin movimientos de Mercado Pago en los últimos 30 días.';
  const lineas = pagos.map((m: any) => {
    const tipo = MOVIMIENTOS[`${m.tipo}:${m.estado}`] ?? `${m.tipo} ${m.estado}`;
    return `${tipo}${m.monto != null ? ` ${pesos(m.monto)}` : ''}\n${m.cuenta || 'Cuenta borrada'} · ${fechaHora(m.creado_en)}`;
  });
  return `Últimos movimientos de Mercado Pago\n\n${lineas.join('\n\n')}`;
};

const textoErrores = (r: any) => {
  const errores = (r.errores ?? []).slice(0, 5);
  const eventos = (r.eventos ?? []).slice(0, 5);
  if (!errores.length && !eventos.length) return '🟢 Sin errores ni problemas del servidor en los últimos 30 días.';
  const partes: string[] = [];
  if (errores.length) {
    const lineas = errores.map(
      (e: any) => `⚠️ ${String(e.mensaje).slice(0, 200)}\n${plural(e.veces, 'vez', 'veces')}${e.ultimo?.gimnasio ? ` · última en ${e.ultimo.gimnasio}` : ''} · ${fechaHora(e.ultima_vez)}`,
    );
    partes.push(`Errores en pantallas (30 días)\n\n${lineas.join('\n\n')}`);
  }
  if (eventos.length) {
    const lineas = eventos.map(
      (e: any) => `${e.nivel === 'error' ? '🔴' : '🟡'} ${String(e.mensaje).slice(0, 200)}\n${e.cuenta ? `${e.cuenta} · ` : ''}${fechaHora(e.creado_en)}`,
    );
    partes.push(`Problemas del servidor (30 días)\n\n${lineas.join('\n\n')}`);
  }
  return `${partes.join('\n\n')}\n\nEl detalle está en el panel Control de RutNail.`;
};

const TEXTO_AYUDA = [
  'Te aviso solo cuando hay una cuenta nueva, un pago aprobado o rechazado, una cancelación, un error o un problema del servidor. Los lunes a las 9 te mando el resumen de la semana.',
  '',
  'También puedes preguntarme con los botones de abajo, o escribirme "pagos", "errores", "cuentas" o "cómo está todo".',
].join('\n');

// Comparación en tiempo constante.
const iguales = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

// La cabecera secreta del webhook se deriva de la clave del bot: no hace falta guardar otro secreto.
const secretoWebhook = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rutnail-webhook:${token}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  // trim(): al pegar una clave en el panel de Supabase puede quedar un espacio o salto de línea invisible.
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim();
  if (!token) {
    console.error('Falta TELEGRAM_BOT_TOKEN');
    return json({ error: 'Falta la clave del bot en Supabase.' }, 503);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const telegram = async (metodo: string, cuerpo: Record<string, unknown>) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const datos = await r.json().catch(() => ({}));
    // Sin la dirección del pedido: lleva la clave del bot.
    if (!r.ok || !datos.ok) console.error('Telegram respondió error', metodo, r.status, datos?.description ?? '');
    return { ok: r.ok && !!datos.ok, datos };
  };

  const enviar = (chat: number, texto: string) =>
    telegram('sendMessage', { chat_id: chat, text: recortar(texto), reply_markup: TECLADO, link_preview_options: { is_disabled: true } });

  const resumen = async (dias: number) => {
    const { data, error } = await admin.rpc('plataforma_resumen', { p_dias: dias });
    if (error) throw new Error(error.message);
    return data;
  };

  // --- Mensaje de Telegram ---------------------------------------------------------------------
  const secretoRecibido = req.headers.get('x-telegram-bot-api-secret-token');
  if (secretoRecibido !== null) {
    if (!iguales(secretoRecibido, await secretoWebhook(token))) return new Response('No autorizado', { status: 401 });

    // Siempre 200: si no, Telegram reintenta el mismo mensaje una y otra vez.
    try {
      const update = await req.json().catch(() => ({}));
      const mensaje = update?.message;
      const chat = Number(mensaje?.chat?.id);
      const texto = String(mensaje?.text ?? '').trim();
      if (!chat || mensaje?.chat?.type !== 'private' || !texto) return new Response('ok');

      const vinculo = texto.match(/^\/start\s+([0-9a-f]{32})$/i);
      if (vinculo) {
        const { data: vinculado } = await admin.rpc('telegram_vincular', { p_codigo: vinculo[1].toLowerCase(), p_chat_id: chat });
        if (vinculado) {
          await telegram('setMyCommands', { commands: COMANDOS });
          await enviar(chat, `Listo, quedó conectado. ✅\n\n${TEXTO_AYUDA}`);
        } else {
          // Sin teclado: todavía no se sabe quién es.
          await telegram('sendMessage', { chat_id: chat, text: 'Ese enlace ya no sirve. Genera uno nuevo desde el panel Control de RutNail.' });
        }
        return new Response('ok');
      }

      const { data: dueno } = await admin.rpc('telegram_chat');
      if (!dueno || Number(dueno) !== chat) return new Response('ok'); // otro chat: ni se le responde

      const t = texto.toLowerCase();
      if (/^\/(start|ayuda|help)\b/.test(t)) await enviar(chat, TEXTO_AYUDA);
      else if (/^\/errores\b|error|falla|problema/.test(t)) await enviar(chat, textoErrores(await resumen(30)));
      else if (/^\/pagos\b|pago|cobr|mercado|plata/.test(t)) await enviar(chat, textoPagos(await resumen(30)));
      else if (/^\/cuentas\b|cuenta|cliente|gimnasio/.test(t)) await enviar(chat, textoCuentas(await resumen(7)));
      else if (/^\/estado\b|c[oó]mo|estado|todo|resumen|novedad/.test(t)) await enviar(chat, textoEstado(await resumen(7), 'Últimos 7 días'));
      else await enviar(chat, `No entendí eso. ${TEXTO_AYUDA}`);
    } catch (e) {
      console.error('Error atendiendo un mensaje de Telegram', (e as Error).message);
    }
    return new Response('ok');
  }

  let cuerpo: Record<string, unknown> = {};
  try {
    cuerpo = await req.json();
  } catch (_) {
    return json({ error: 'Pedido inválido' }, 400);
  }

  // --- Cola de avisos (pg_cron) ----------------------------------------------------------------
  if (cuerpo.accion === 'despachar') {
    const { data: avisos, error } = await admin.rpc('telegram_tomar_pendientes', { p_clave: req.headers.get('x-despacho') ?? '' });
    if (error) return json({ error: 'No autorizado' }, 401);

    const { data: chat } = await admin.rpc('telegram_chat');
    if (!chat) return json({ enviados: 0 });

    const fallidos: number[] = [];
    let enviados = 0;
    for (const aviso of avisos ?? []) {
      try {
        const texto = aviso.tipo === 'resumen' ? textoEstado(await resumen(7), '📋 Resumen de la semana') : aviso.texto;
        const { ok } = await enviar(Number(chat), texto);
        if (ok) enviados += 1;
        else fallidos.push(aviso.id);
      } catch (e) {
        console.error('No se pudo mandar un aviso', aviso.id, (e as Error).message);
        fallidos.push(aviso.id);
      }
    }
    if (fallidos.length) await admin.rpc('telegram_reponer', { p_ids: fallidos });
    return json({ enviados, fallidos: fallidos.length });
  }

  // --- Conectar el chat (panel) ----------------------------------------------------------------
  if (cuerpo.accion === 'conectar') {
    const sesion = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: codigo, error } = await sesion.rpc('telegram_preparar_vinculo');
    if (error || !codigo) return json({ error: 'Esta cuenta no puede conectar el bot.' }, 403);

    const bot = await telegram('getMe', {});
    if (!bot.ok) return json({ error: 'Telegram no reconoció la clave del bot. Revisa TELEGRAM_BOT_TOKEN en Supabase.' }, 502);

    const webhook = await telegram('setWebhook', {
      url: `${url}/functions/v1/telegram-bot`,
      secret_token: await secretoWebhook(token),
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    if (!webhook.ok) return json({ error: 'Telegram no aceptó la conexión. Inténtalo de nuevo en un momento.' }, 502);

    return json({ enlace: `https://t.me/${bot.datos.result.username}?start=${codigo}` });
  }

  return json({ error: 'Acción desconocida' }, 400);
});
