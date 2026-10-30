import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Suscripción vencida en solo lectura (migración 0086): la base rechaza todo guardado. Mientras la cuenta
// esté así, cada guardado rechazado dispara este evento para que la pantalla explique el motivo real
// (cada página muestra su propio error genérico).
export const EVENTO_SOLO_LECTURA = 'rutnail:solo-lectura';
let soloLectura = false;
export const marcarSoloLectura = (valor) => {
    soloLectura = Boolean(valor);
};

const fetchConAviso = async (input, init) => {
    const respuesta = await fetch(input, init);
    if (soloLectura && !respuesta.ok) {
        const url = typeof input === 'string' ? input : (input?.url ?? '');
        const metodo = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
        if (metodo !== 'GET' && metodo !== 'HEAD' && /\/(rest|storage)\/v1\//.test(url)) {
            window.dispatchEvent(new CustomEvent(EVENTO_SOLO_LECTURA));
        }
    }
    return respuesta;
};

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { global: { fetch: fetchConAviso } });

export default supabaseClient;

export { supabaseClient };
