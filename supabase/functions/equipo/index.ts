// Edge Function "equipo" (migraciones 0080 y 0081, pedido de Nalux del 28/10/2026): cuentas de staff.
//
// Hace lo único que no se puede hacer desde la base ni desde el navegador: crear el usuario de
// un empleado, cambiarle la contraseña y borrarlo (hace falta la clave de servicio de Supabase
// Auth, que nunca sale de acá). Todo lo que toca las tablas (buscar, sumar, quitar, anotar) lo
// hacen las funciones SQL equipo_* de la base, ejecutadas con la sesión de quien llama: en este
// proyecto la cuenta de servicio no tiene permisos sobre las tablas (por eso la v1 falló).
//
// SEGURIDAD
//  * verify_jwt = true: la plataforma ya rechaza llamadas sin una sesión válida.
//  * Quién llama y qué gimnasio es salen del TOKEN de quien llama (get_mi_rol / get_mi_gimnasio_id
//    y las funciones equipo_* verifican en la base que sea ADMINISTRADOR del gimnasio abierto);
//    nada de eso sale del cuerpo del pedido.
//  * Solo se toca a personas con rol 'staff' de ESE gimnasio. La contraseña de alguien con
//    acceso a otros gimnasios no se cambia desde acá (tiene que cambiarla ella misma).
//  * Tope de 20 personas de staff por gimnasio (lo aplica equipo_sumar).
//  * Los errores devuelven mensajes claros en español, nunca el detalle interno.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

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

// Mensajes de las funciones SQL que se pueden mostrar tal cual (los escribimos nosotros).
const MENSAJES_SEGUROS = [
  'Esa persona ya está en el equipo de este gimnasio',
  'Se alcanzó el máximo de 20 personas de staff por gimnasio',
  'No se encontró a esa persona',
  'Demasiadas búsquedas en poco tiempo. Prueba de nuevo en unos minutos.',
];
const mensajeDe = (error: { message?: string } | null, porDefecto: string) => {
  const m = error?.message ?? '';
  return MENSAJES_SEGUROS.find((s) => m.includes(s)) ?? porDefecto;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Cliente con la sesión de quien llama: todas las funciones equipo_* se ejecutan con ella.
  const delUsuario = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: datosUsuario, error: errorUsuario } = await delUsuario.auth.getUser();
  if (errorUsuario || !datosUsuario?.user) return json({ error: 'La sesión no es válida. Volver a ingresar.' }, 401);

  const { data: rol } = await delUsuario.rpc('get_mi_rol');
  const { data: gimnasioId } = await delUsuario.rpc('get_mi_gimnasio_id');
  const { data: organizacionId } = await delUsuario.rpc('get_mi_organizacion_id');
  if (rol !== 'admin' || !gimnasioId || !organizacionId) {
    return json({ error: 'Solo un administrador puede gestionar el equipo.' }, 403);
  }
  // La marca de "cuenta creada por esta organización" vive en app_metadata, que solo escribe el
  // servidor. user_metadata lo puede editar el propio usuario, por eso nunca se usa para esto.
  const esDeMiOrganizacion = (u: { app_metadata?: Record<string, unknown> } | null | undefined) =>
    !!u && u.app_metadata?.creada_por_organizacion === organizacionId;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: 'Pedido inválido.' }, 400);
  }

  // Cliente con la clave de servicio: SOLO para la API de usuarios de Supabase Auth.
  const admin = createClient(url, servicio, { auth: { persistSession: false } });

  const accion = texto(cuerpo.accion, 30);

  // Datos de una persona del equipo (si es staff de ESTE gimnasio y a cuántos gimnasios accede).
  const infoDe = async (userId: string) => {
    const { data } = await delUsuario.rpc('equipo_info', { p_user_id: userId });
    const fila = Array.isArray(data) ? data[0] : data;
    return {
      esStaff: !!fila?.es_staff,
      gimnasios: Number(fila?.gimnasios ?? 0),
      nombre: (fila?.nombre as string) ?? '',
      email: (fila?.email as string) ?? '',
    };
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

      const { data: existente, error: errorBuscar } = await delUsuario.rpc('equipo_buscar', { p_email: email });
      if (errorBuscar) {
        return json({ error: mensajeDe(errorBuscar, 'No se pudo revisar ese correo. Reintentar en unos minutos.') }, 400);
      }

      let userId: string;
      let creado = false;
      if (existente) {
        // Ya tiene cuenta (por ejemplo trabaja en otro gimnasio): solo se le da acceso a este.
        userId = existente as string;
      } else {
        const errorPass = errorDeContrasena(password);
        if (errorPass) return json({ error: errorPass }, 400);
        const { data: nuevo, error: errorCrear } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { first_name: nombre, last_name: apellido },
          app_metadata: { creada_por_organizacion: organizacionId },
        });
        if (errorCrear || !nuevo?.user) {
          // El correo ya tiene cuenta pero equipo_buscar no la ofreció: la creó otra organización o
          // su dueño todavía no confirmó el correo.
          const yaExiste =
            errorCrear?.code === 'email_exists' ||
            (errorCrear?.status === 422 && /already.*(registered|exists)/i.test(errorCrear.message ?? ''));
          if (yaExiste) {
            return json(
              {
                error:
                  'Ese correo ya tiene una cuenta de RutNail y no se puede sumar desde aquí. Usa otro correo para esta persona o escríbenos por WhatsApp.',
              },
              400,
            );
          }
          return json({ error: 'No se pudo crear la cuenta. Revisar el correo y la contraseña.' }, 400);
        }
        userId = nuevo.user.id;
        creado = true;
      }

      const { error: errorSumar } = await delUsuario.rpc('equipo_sumar', { p_user_id: userId });
      if (errorSumar) {
        if (creado) await admin.auth.admin.deleteUser(userId);
        return json({ error: mensajeDe(errorSumar, 'No se pudo sumar a la persona al equipo.') }, 400);
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
      const info = userId ? await infoDe(userId) : null;
      if (!info?.esStaff) return json({ error: 'No se encontró a esa persona en el equipo.' }, 404);
      if (info.gimnasios > 1) {
        return json(
          { error: 'Esa persona tiene acceso a otros gimnasios: tiene que cambiar su contraseña ella misma.' },
          400,
        );
      }
      // Solo cuentas creadas por esta organización: las demás las maneja su dueño.
      const { data: cuenta } = await admin.auth.admin.getUserById(userId);
      if (!esDeMiOrganizacion(cuenta?.user)) {
        return json({ error: 'Esa persona tiene que cambiar su contraseña ella misma.' }, 400);
      }
      const errorPass = errorDeContrasena(password);
      if (errorPass) return json({ error: errorPass }, 400);

      const { error: errorClave } = await admin.auth.admin.updateUserById(userId, { password });
      if (errorClave) return json({ error: 'No se pudo cambiar la contraseña.' }, 400);

      await delUsuario.rpc('equipo_anotar', { p_evento: 'clave', p_nombre: info.nombre, p_email: info.email });
      return json({ ok: true });
    }

    // ------------------------------------------------------------------ quitar
    if (accion === 'quitar') {
      const userId = texto(cuerpo.user_id, 60);
      const info = userId ? await infoDe(userId) : null;
      if (!info?.esStaff) return json({ error: 'No se encontró a esa persona en el equipo.' }, 404);

      const { data: quedan, error: errorQuitar } = await delUsuario.rpc('equipo_quitar', { p_user_id: userId });
      if (errorQuitar) return json({ error: mensajeDe(errorQuitar, 'No se pudo quitar a la persona del equipo.') }, 400);

      // Sin más gimnasios, la cuenta no sirve para nada: se borra (si quedara viva podría
      // entrar y abrir un gimnasio propio sin pasar por la suscripción).
      // Solo si la cuenta la creó esta organización; una cuenta ajena se quita del equipo y queda viva.
      if (Number(quedan) === 0) {
        const { data: cuenta } = await admin.auth.admin.getUserById(userId);
        if (esDeMiOrganizacion(cuenta?.user)) await admin.auth.admin.deleteUser(userId);
      }

      await delUsuario.rpc('equipo_anotar', { p_evento: 'baja', p_nombre: info.nombre, p_email: info.email });
      return json({ ok: true });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch {
    return json({ error: 'Ocurrió un error. Reintentar en unos minutos.' }, 500);
  }
});
