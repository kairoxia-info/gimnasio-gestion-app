// Edge Function "equipo" (migración 0080, pedido de Nalux del 28/10/2026): cuentas de staff.
//
// Hace lo único que no se puede hacer desde la base ni desde el navegador: crear el usuario de
// un empleado, cambiarle la contraseña y borrarlo (hace falta la clave de servicio de Supabase
// Auth, que nunca sale de acá). Pausar, reactivar y listar el equipo son funciones SQL (0080).
//
// SEGURIDAD
//  * verify_jwt = true: la plataforma ya rechaza llamadas sin una sesión válida.
//  * Quién llama y qué gimnasio es salen del TOKEN de quien llama (get_mi_rol / get_mi_gimnasio_id
//    ejecutados con su sesión), nunca del cuerpo del pedido: solo un administrador del gimnasio
//    abierto puede usarla y solo sobre ese gimnasio.
//  * Solo se toca a personas con rol 'staff' de ESE gimnasio. La contraseña de alguien con
//    acceso a otros gimnasios no se cambia desde acá (tiene que cambiarla ella misma).
//  * Tope de 20 personas de staff por gimnasio.
//  * Los errores devuelven mensajes claros en español, nunca el detalle interno.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MAX_STAFF = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Misma política que el proyecto (mínimo 8, mayúscula, minúscula y número).
const errorDeContrasena = (c: string): string => {
  if (c.length < 8) return 'La contraseña tiene que tener al menos 8 caracteres.';
  if (c.length > 72) return 'La contraseña no puede tener más de 72 caracteres.';
  if (!/[A-Z]/.test(c)) return 'La contraseña tiene que tener al menos una letra mayúscula.';
  if (!/[a-z]/.test(c)) return 'La contraseña tiene que tener al menos una letra minúscula.';
  if (!/[0-9]/.test(c)) return 'La contraseña tiene que tener al menos un número.';
  return '';
};

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Cliente con la sesión de quien llama: sirve para saber quién es y qué rol tiene.
  const delUsuario = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: datosUsuario, error: errorUsuario } = await delUsuario.auth.getUser();
  if (errorUsuario || !datosUsuario?.user) return json({ error: 'La sesión no es válida. Volver a ingresar.' }, 401);

  const { data: rol } = await delUsuario.rpc('get_mi_rol');
  const { data: gimnasioId } = await delUsuario.rpc('get_mi_gimnasio_id');
  if (rol !== 'admin' || !gimnasioId) {
    return json({ error: 'Solo un administrador puede gestionar el equipo.' }, 403);
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: 'Pedido inválido.' }, 400);
  }

  // Cliente con la clave de servicio: solo para Auth y para leer/escribir membresías.
  const admin = createClient(url, servicio, { auth: { persistSession: false } });

  const accion = texto(cuerpo.accion, 30);

  // La persona tiene que ser de staff de ESTE gimnasio.
  const staffDelGimnasio = async (userId: string) => {
    const { data } = await admin
      .from('membresias')
      .select('user_id')
      .eq('user_id', userId)
      .eq('gimnasio_id', gimnasioId)
      .eq('rol', 'staff')
      .maybeSingle();
    return !!data;
  };
  const cuantosGimnasios = async (userId: string) => {
    const { count } = await admin
      .from('membresias')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId);
    return count ?? 0;
  };
  const nombreDe = async (userId: string) => {
    const { data } = await admin.from('profiles').select('first_name,last_name,email').eq('id', userId).maybeSingle();
    const nombre = `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim();
    return { nombre, email: data?.email ?? '' };
  };

  try {
    // ------------------------------------------------------------------ crear
    if (accion === 'crear') {
      const nombre = texto(cuerpo.nombre, 80);
      const apellido = texto(cuerpo.apellido, 80);
      const email = texto(cuerpo.email, 200).toLowerCase();
      const password = typeof cuerpo.password === 'string' ? cuerpo.password : '';

      if (!nombre) return json({ error: 'Falta el nombre.' }, 400);
      if (!EMAIL.test(email)) return json({ error: 'El correo no es válido.' }, 400);

      const { count: cantidad } = await admin
        .from('membresias')
        .select('user_id', { count: 'exact', head: true })
        .eq('gimnasio_id', gimnasioId)
        .eq('rol', 'staff');
      if ((cantidad ?? 0) >= MAX_STAFF) {
        return json({ error: `Se alcanzó el máximo de ${MAX_STAFF} personas de staff por gimnasio.` }, 400);
      }

      // eq y no ilike: ilike trata % y _ como comodines y un correo armado a propósito podría
      // coincidir con una cuenta ajena. Supabase Auth guarda los correos en minúsculas.
      const { data: existente } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();

      let userId: string;
      let creado = false;
      if (existente?.id) {
        // Ya tiene cuenta (por ejemplo trabaja en otro gimnasio): solo se le da acceso a este.
        userId = existente.id;
        const { data: yaEsta } = await admin
          .from('membresias')
          .select('user_id')
          .eq('user_id', userId)
          .eq('gimnasio_id', gimnasioId)
          .maybeSingle();
        if (yaEsta) return json({ error: 'Esa persona ya está en el equipo de este gimnasio.' }, 400);
      } else {
        const errorPass = errorDeContrasena(password);
        if (errorPass) return json({ error: errorPass }, 400);
        const { data: nuevo, error: errorCrear } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { first_name: nombre, last_name: apellido },
        });
        if (errorCrear || !nuevo?.user) {
          return json({ error: 'No se pudo crear la cuenta. Revisar el correo y la contraseña.' }, 400);
        }
        userId = nuevo.user.id;
        creado = true;
      }

      const { error: errorMembresia } = await admin
        .from('membresias')
        .insert({ user_id: userId, gimnasio_id: gimnasioId, rol: 'staff' });
      if (errorMembresia) {
        if (creado) await admin.auth.admin.deleteUser(userId);
        return json({ error: 'No se pudo sumar a la persona al equipo.' }, 500);
      }

      await delUsuario.rpc('equipo_anotar', {
        p_evento: 'alta',
        p_nombre: `${nombre} ${apellido}`.trim(),
        p_email: email,
      });
      return json({ ok: true, creado });
    }

    // ----------------------------------------------------------- cambiar_clave
    if (accion === 'cambiar_clave') {
      const userId = texto(cuerpo.user_id, 60);
      const password = typeof cuerpo.password === 'string' ? cuerpo.password : '';
      if (!userId || !(await staffDelGimnasio(userId))) {
        return json({ error: 'No se encontró a esa persona en el equipo.' }, 404);
      }
      if ((await cuantosGimnasios(userId)) > 1) {
        return json(
          { error: 'Esa persona tiene acceso a otros gimnasios: tiene que cambiar su contraseña ella misma.' },
          400,
        );
      }
      const errorPass = errorDeContrasena(password);
      if (errorPass) return json({ error: errorPass }, 400);

      const { error: errorClave } = await admin.auth.admin.updateUserById(userId, { password });
      if (errorClave) return json({ error: 'No se pudo cambiar la contraseña.' }, 400);

      const { nombre, email } = await nombreDe(userId);
      await delUsuario.rpc('equipo_anotar', { p_evento: 'clave', p_nombre: nombre, p_email: email });
      return json({ ok: true });
    }

    // ------------------------------------------------------------------ quitar
    if (accion === 'quitar') {
      const userId = texto(cuerpo.user_id, 60);
      if (!userId || !(await staffDelGimnasio(userId))) {
        return json({ error: 'No se encontró a esa persona en el equipo.' }, 404);
      }
      const { nombre, email } = await nombreDe(userId);

      const { error: errorBorrar } = await admin
        .from('membresias')
        .delete()
        .eq('user_id', userId)
        .eq('gimnasio_id', gimnasioId)
        .eq('rol', 'staff');
      if (errorBorrar) return json({ error: 'No se pudo quitar a la persona del equipo.' }, 500);

      // Sin más gimnasios, la cuenta no sirve para nada: se borra (si quedara viva podría
      // entrar y abrir un gimnasio propio sin pasar por la suscripción).
      if ((await cuantosGimnasios(userId)) === 0) {
        await admin.from('profiles').delete().eq('id', userId);
        await admin.auth.admin.deleteUser(userId);
      }

      await delUsuario.rpc('equipo_anotar', { p_evento: 'baja', p_nombre: nombre, p_email: email });
      return json({ ok: true });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch {
    return json({ error: 'Ocurrió un error. Reintentar en unos minutos.' }, 500);
  }
});
