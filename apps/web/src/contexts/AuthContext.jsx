import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import supabase from '@/lib/supabaseClient';
import { setCurrentGimnasioId } from '@/lib/currentGimnasio';
import { limpiarCacheDeLectura, limpiarTodoOffline, verCola } from '@/lib/offline';
import { aplicarColorGimnasio } from '@/lib/colorTema';
import { setZonaHorariaDelGimnasio } from '@/lib/format';

const AuthContext = createContext(null);

// Borra TODOS los archivos de un gimnasio en Storage (no se pueden borrar por SQL: Supabase
// lo bloquea a propósito, ver la migración 0035). Hay que llamarla ANTES de borrar el gimnasio
// y siendo admin del gimnasio ABIERTO: las políticas de Storage solo dejan tocar la carpeta
// del gimnasio abierto en la sesión. Cada bucket con carpeta por gimnasio tiene que estar
// en esta lista, o sus archivos quedan huérfanos (bug del 16/09/2026 y del 21/09/2026).
//
// list() devuelve 100 archivos por defecto (bug de la auditoría del 28/10/2026: con más de 100
// el resto quedaba huérfano): se repite listar + borrar hasta vaciar la carpeta, con un tope
// de vueltas por si un borrado fallara siempre. Los errores se ignoran a propósito: lo
// importante es que los datos salgan de la base.
const BUCKETS_POR_GIMNASIO = ['gimnasio-logos', 'ejercicios-media', 'alumnos-fotos', 'progreso-fotos', 'noticias-imagenes'];

//
// Biblioteca compartida (migración 0077): los archivos de ejercicios cuelgan de la ORGANIZACIÓN
// (carpeta <organizacion_id>, y la del gimnasio los subidos antes). Si el dueño tiene más
// gimnasios, esos ejercicios siguen en uso en los otros: no se borran. Solo al borrar el ÚLTIMO
// gimnasio se limpian las dos carpetas.
const limpiarArchivosDelGimnasio = async (gimnasioId, { organizacionId = null, otrosEnOrganizacion = false } = {}) => {
    if (!gimnasioId) return;
    for (const bucket of BUCKETS_POR_GIMNASIO) {
        let carpetas = [gimnasioId];
        if (bucket === 'ejercicios-media') {
            carpetas = otrosEnOrganizacion ? [] : [gimnasioId, organizacionId].filter(Boolean);
        }
        for (const carpeta of carpetas) {
            try {
                for (let vuelta = 0; vuelta < 50; vuelta += 1) {
                    const { data: archivos } = await supabase.storage.from(bucket).list(carpeta, { limit: 100 });
                    if (!archivos?.length) break;
                    const paths = archivos.map((a) => carpeta + '/' + a.name);
                    const { error: errorBorrado } = await supabase.storage.from(bucket).remove(paths);
                    if (errorBorrado) break;
                }
            } catch (_) {
                // Ignorado a propósito -- ver comentario arriba.
            }
        }
    }
};

// Contexto de limpieza del gimnasio abierto, a partir de lo que trae mi_contexto().
const contextoDeLimpieza = (profile) => ({
    organizacionId: profile?.organizacion_id ?? null,
    otrosEnOrganizacion: !!(profile?.misGimnasios ?? []).find((g) => g.id === profile?.gimnasio_id)?.otros_en_organizacion,
});

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    // Si esta sesión ya fijó su gimnasio en la base (ver fetchProfile).
    const sesionFijadaRef = useRef(false);

    const fetchProfile = useCallback(async (userId) => {
        if (!userId) {
            setProfile(null);
            setZonaHorariaDelGimnasio(null);
            return null;
        }
        // gimnasios(...) es un embed de PostgREST vía la FK profiles.gimnasio_id ->
        // gimnasios.id: trae nombre/logo/color del gimnasio del usuario en la misma
        // consulta, sin un segundo roundtrip. La RLS de "gimnasios" (id = get_mi_gimnasio_id())
        // sigue aplicando dentro del embed, así que esto nunca expone el gimnasio de otro.
        const { data, error } = await supabase
            .from('profiles')
            .select(
                'id, email, first_name, last_name, gimnasio_id, role, tour_visto, gimnasios(nombre, logo_url, color_principal, dias_abiertos)',
            )
            .eq('id', userId)
            .single();
        if (error) {
            setProfile(null);
            return null;
        }
        // Varios gimnasios por profesor (migración 0076): el gimnasio ABIERTO en esta sesión, el
        // rol en ESE gimnasio y la lista de gimnasios de la persona vienen de mi_contexto(). Así
        // profile.gimnasio_id sigue significando "el gimnasio con el que se está trabajando" y casi
        // todo el resto de la app no cambia. Si la función todavía no existe (base sin migrar) se
        // sigue con el camino de antes, un solo gimnasio por perfil: no se rompe nada.
        let perfil = { ...data, misGimnasios: [] };
        let zona = null;
        const { data: ctx, error: errorContexto } = await supabase.rpc('mi_contexto');
        if (!errorContexto && ctx) {
            perfil = {
                ...data,
                gimnasio_id: ctx.gimnasio_id ?? null,
                organizacion_id: ctx.organizacion_id ?? null,
                role: ctx.rol ?? data.role,
                gimnasios: ctx.gimnasio ?? null,
                misGimnasios: ctx.gimnasios ?? [],
            };
            zona = ctx.gimnasio?.zona_horaria ?? null;
            // Fija en la base el gimnasio con el que ESTA sesión abrió la app (una vez por carga). Sin
            // fijar, una sesión usa "el último gimnasio usado" de la persona, y si en otro navegador
            // cambia de gimnasio esta se movería sola en la siguiente consulta. Ya fijada, cada sesión
            // queda en el suyo. Es lo mismo que cambiar_gimnasio al mismo gimnasio: no hace nada más.
            if (ctx.gimnasio_id && !sesionFijadaRef.current) {
                sesionFijadaRef.current = true;
                supabase.rpc('cambiar_gimnasio', { p_gimnasio_id: ctx.gimnasio_id }).then(
                    () => {},
                    () => {
                        sesionFijadaRef.current = false;
                    },
                );
            }
        } else if (data?.gimnasio_id) {
            // Zona horaria del gimnasio (migración 0074): consulta aparte y tolerante, ver lib/format.js.
            const { data: gim } = await supabase
                .from('gimnasios')
                .select('zona_horaria')
                .eq('id', data.gimnasio_id)
                .maybeSingle();
            zona = gim?.zona_horaria ?? null;
        }
        // La zona se fija ANTES de publicar el perfil, así ninguna pantalla arma "hoy" con la
        // zona equivocada en su primer render.
        setZonaHorariaDelGimnasio(zona);
        setProfile(perfil);
        return perfil;
    }, []);

    useEffect(() => {
        let mounted = true;

        supabase.auth.getSession().then(async ({ data: { session } }) => {
            if (!mounted) return;
            setUser(session?.user ?? null);
            if (session?.user) await fetchProfile(session.user.id);
            setLoading(false);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!mounted) return;
            // La sesión terminó (vencida, revocada, cerrada desde otra pestaña
            // o dispositivo): la caché de lectura -- alumnos con contacto y
            // observaciones de salud -- no puede quedar en el navegador. Antes
            // solo se borraba con el "Cerrar sesión" manual (28/10/2026,
            // auditoría). A propósito NO se toca la cola de pagos pendientes
            // (ver limpiarCacheDeLectura en lib/offline.js).
            if (event === 'SIGNED_OUT') {
                limpiarCacheDeLectura();
                sesionFijadaRef.current = false;
            }
            setUser(session?.user ?? null);
            if (session?.user) {
                await fetchProfile(session.user.id);
            } else {
                setProfile(null);
                setZonaHorariaDelGimnasio(null);
            }
            setLoading(false);
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [fetchProfile]);

    // data.js es un módulo plano (no un hook): necesita el gimnasio_id
    // vigente para poder mandarlo en cada INSERT. Se lo pasamos acá cada vez
    // que cambia el profile, en vez de que data.js vuelva a consultar
    // `profiles` por su cuenta.
    useEffect(() => {
        setCurrentGimnasioId(profile?.gimnasio_id ?? null);
    }, [profile]);

    // Pinta toda la app con el color que el profesor eligió en Configuración
    // (bug real: el picker lo guardaba en la base pero nada lo leía de
    // vuelta para pintar nada -- ver colorTema.js). Sin gimnasio_id (login,
    // onboarding antes de crear el gimnasio) vuelve sola al rojo de fábrica.
    useEffect(() => {
        aplicarColorGimnasio(profile?.gimnasios?.color_principal);
    }, [profile?.gimnasios?.color_principal]);

    const value = useMemo(
        () => ({
            user,
            profile,
            gimnasio: profile?.gimnasios ?? null,
            isAuthed: !!user,
            loading,
            signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
            // emailRedirectTo (08/09/2026, pedido de Nalux de verificar el correo al
            // registrarse): mismo criterio que resetPasswordForEmail más abajo -- sin
            // esto, el link del mail de confirmación vuelve al "Site URL" fijo que
            // tenga configurado el proyecto en Supabase, que puede no ser el mismo
            // entorno desde el que se registró (local en pruebas vs. producción).
            // Apunta a la raíz (no a una página propia): LoginPage ya redirige solo a
            // /onboarding en cuanto detecta la sesión (ver ProtectedRoute.jsx), así que
            // no hace falta una pantalla dedicada para "correo confirmado".
            signUp: (email, password, { first_name, last_name } = {}) =>
                supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: { first_name, last_name },
                        emailRedirectTo: window.location.origin,
                    },
                }),
            // Limpia el cache y la cola de sincronización de este celular
            // (lib/offline.js) -- si no, un profesor distinto que se loguee
            // después en el mismo dispositivo vería datos (o pagos/asistencia
            // pendientes) de este gimnasio.
            signOut: async () => {
                limpiarTodoOffline();
                return supabase.auth.signOut();
            },
            resetPasswordForEmail: (email) =>
                supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/restablecer-password`,
                }),
            updatePassword: (newPassword) => supabase.auth.updateUser({ password: newPassword }),
            createGimnasio: async (nombre) => {
                const result = await supabase.rpc('create_gimnasio', { nombre_gimnasio: nombre });
                if (!result.error) await fetchProfile(user?.id);
                return result;
            },
            refreshProfile: () => fetchProfile(user?.id),
            // Cambia el gimnasio abierto en ESTA sesión (migración 0076). Recarga la página entera:
            // es lo único que garantiza que ninguna pantalla se quede con datos, caché o canales
            // en tiempo real del gimnasio anterior. No cambia si hay pagos o asistencia sin enviar
            // (la cola sin conexión guarda a qué gimnasio pertenece cada uno y la base rechazaría
            // los del gimnasio anterior).
            cambiarGimnasio: async (gimnasioId) => {
                if (verCola().length > 0) {
                    return {
                        error: {
                            message:
                                'Hay cambios sin enviar (asistencia o pagos registrados sin conexión). Esperar a que se envíen antes de cambiar de gimnasio.',
                        },
                    };
                }
                const { error } = await supabase.rpc('cambiar_gimnasio', { p_gimnasio_id: gimnasioId });
                if (error) return { error: { message: 'No se pudo cambiar de gimnasio.' } };
                window.location.assign('/panel');
                return { error: null };
            },
            // Elimina SOLO el gimnasio abierto (con la contraseña de nuevo, igual que eliminarCuenta)
            // y deja la cuenta y los demás gimnasios. Primero los archivos de Storage, después la base.
            eliminarGimnasioActivo: async (password) => {
                if (!user?.email) return { error: { message: 'No hay sesión activa.' } };
                if (profile?.role !== 'admin' || !profile?.gimnasio_id) {
                    return { error: { message: 'Solo un administrador puede eliminar el gimnasio.' } };
                }
                const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password });
                if (authError) return { error: { message: 'La contraseña no es correcta.' } };

                await limpiarArchivosDelGimnasio(profile.gimnasio_id, contextoDeLimpieza(profile));
                const { error } = await supabase.rpc('eliminar_gimnasio_activo');
                if (error) return { error: { message: 'No se pudo eliminar el gimnasio. Reintentar en unos minutos.' } };

                limpiarTodoOffline();
                window.location.assign('/panel');
                return { error: null };
            },
            // Tour de bienvenida (migración 0060): marca la propia cuenta como
            // "ya vio la demo", para siempre. Va por RPC porque la columna no
            // está en el GRANT UPDATE de authenticated (0043). Se actualiza el
            // estado local en vez de refreshProfile(): ya sabemos el valor
            // resultante, un SELECT de más no aporta nada. Si la red falla justo
            // acá, tour_visto queda en false en la base y la demo vuelve a
            // aparecer en el próximo login -- caso borde aceptado, no de
            // seguridad, y se resuelve solo la próxima vez.
            marcarTourVisto: async () => {
                const result = await supabase.rpc('marcar_tour_visto');
                if (!result.error) {
                    setProfile((prev) => (prev ? { ...prev, tour_visto: true } : prev));
                }
                return result;
            },
            // Borrado de cuenta (migración 0035), pedido de Nalux (08/09/2026):
            // borrado definitivo e inmediato -- sin papelera ni período de
            // gracia (lo pidió así a propósito, para que el mismo correo quede
            // libre enseguida para una cuenta nueva). Por eso exige reingresar
            // la contraseña acá mismo antes de tocar nada: es la única traba
            // real contra un borrado accidental si alguien deja la sesión
            // abierta en un dispositivo compartido.
            //
            // No hace signOut() acá a propósito: el llamador (ConfiguracionPage)
            // necesita esos segundos de margen para mostrar la confirmación
            // antes de que se cierre la sesión y ProtectedRoute redirija solo.
            eliminarCuenta: async (password) => {
                if (!user?.email) return { error: { message: 'No hay sesión activa.' } };

                // ANTES de borrar nada: con varios gimnasios solo se pueden limpiar los archivos del
                // gimnasio ABIERTO, así que la cuenta solo se puede eliminar si lo único que borra es
                // ese. La base lo vuelve a comprobar (eliminar_mi_cuenta), pero acá se evita llegar a
                // borrar archivos y que después la base la rechace.
                const propios = (profile?.misGimnasios ?? []).filter((g) => g.unico_admin);
                if (propios.length > 1) {
                    return {
                        error: {
                            message:
                                'Esta cuenta administra más de un gimnasio. Eliminar primero los otros gimnasios, de a uno, y después la cuenta.',
                        },
                    };
                }
                if (propios.length === 1 && propios[0].id !== profile?.gimnasio_id) {
                    return {
                        error: {
                            message:
                                'Abrir primero el gimnasio "' + propios[0].nombre + '" desde el menú y volver a intentar: así se eliminan también sus archivos.',
                        },
                    };
                }

                const { error: authError } = await supabase.auth.signInWithPassword({
                    email: user.email,
                    password,
                });
                if (authError) return { error: { message: 'La contraseña no es correcta.' } };

                // Los archivos del gimnasio (logo, fotos/videos de ejercicios, fotos
                // de alumnos, fotos de progreso) no se pueden borrar por SQL --
                // Supabase lo bloquea a propósito (ver comentario en la migración
                // 0035) para que nunca quede un archivo huérfano en el storage
                // real. Se listan y remueven acá por la Storage API, con la sesión
                // del propio admin (mismas policies de las migraciones 0003/0005),
                // antes de borrar el resto por la RPC. Si esto falla no bloquea el
                // borrado de la cuenta -- lo importante es que los datos salgan de
                // la base.
                //
                // Bug encontrado el 16/09/2026 (Nalux probó "Eliminar cuenta" en
                // producción y pidió confirmar que no quedara nada): esta lista
                // solo tenía 'gimnasio-logos' y 'ejercicios-media' -- las fotos de
                // alumnos y de progreso (buckets 'alumnos-fotos'/'progreso-fotos',
                // mismo patrón <gimnasio_id>/archivo) quedaban huérfanas en el
                // storage real cada vez que se borraba un gimnasio con alumnos que
                // tuvieran foto cargada. Confirmado con archivos huérfanos reales
                // de pruebas anteriores en la base de producción.
                // Con varios gimnasios, esta función solo limpia los archivos del gimnasio ABIERTO
                // (las políticas de Storage no dejan tocar los demás). Por eso la base no deja
                // eliminar la cuenta si es la única administradora de MÁS de un gimnasio: hay que
                // borrarlos de a uno antes con "Eliminar este gimnasio" (migración 0076).
                if (profile?.role === 'admin' && profile?.gimnasio_id) {
                    await limpiarArchivosDelGimnasio(profile.gimnasio_id, contextoDeLimpieza(profile));
                }
                const { error } = await supabase.rpc('eliminar_mi_cuenta');
                if (error) {
                    if (String(error.message || '').includes('más de un gimnasio')) {
                        return {
                            error: {
                                message:
                                    'Esta cuenta administra más de un gimnasio. Eliminar primero los otros gimnasios, de a uno, y después la cuenta.',
                            },
                        };
                    }
                    return { error: { message: 'No se pudo eliminar la cuenta. Reintentar en unos minutos.' } };
                }

                limpiarTodoOffline();
                return { error: null };
            },
        }),
        [user, profile, loading, fetchProfile],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);

export default AuthContext;
