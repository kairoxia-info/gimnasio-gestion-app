import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import supabase from '@/lib/supabaseClient';
import { setCurrentGimnasioId } from '@/lib/currentGimnasio';
import { limpiarTodoOffline } from '@/lib/offline';
import { aplicarColorGimnasio } from '@/lib/colorTema';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchProfile = useCallback(async (userId) => {
        if (!userId) {
            setProfile(null);
            return null;
        }
        // gimnasios(...) es un embed de PostgREST vía la FK profiles.gimnasio_id ->
        // gimnasios.id: trae nombre/logo/color del gimnasio del usuario en la misma
        // consulta, sin un segundo roundtrip. La RLS de "gimnasios" (id = get_mi_gimnasio_id())
        // sigue aplicando dentro del embed, así que esto nunca expone el gimnasio de otro.
        const { data, error } = await supabase
            .from('profiles')
            .select(
                'id, email, first_name, last_name, gimnasio_id, role, gimnasios(nombre, logo_url, color_principal, dias_abiertos)',
            )
            .eq('id', userId)
            .single();
        if (error) {
            setProfile(null);
            return null;
        }
        setProfile(data);
        return data;
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
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (!mounted) return;
            setUser(session?.user ?? null);
            if (session?.user) {
                await fetchProfile(session.user.id);
            } else {
                setProfile(null);
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

                const { error: authError } = await supabase.auth.signInWithPassword({
                    email: user.email,
                    password,
                });
                if (authError) return { error: { message: 'La contraseña no es correcta.' } };

                // Los archivos del gimnasio (logo, fotos/videos de ejercicios) no
                // se pueden borrar por SQL -- Supabase lo bloquea a propósito
                // (ver comentario en la migración 0035) para que nunca quede un
                // archivo huérfano en el storage real. Se listan y remueven acá
                // por la Storage API, con la sesión del propio admin (mismas
                // policies de las migraciones 0003/0005), antes de borrar el
                // resto por la RPC. Si esto falla no bloquea el borrado de la
                // cuenta -- lo importante es que los datos salgan de la base.
                if (profile?.role === 'admin' && profile?.gimnasio_id) {
                    const gimnasioId = profile.gimnasio_id;
                    for (const bucket of ['gimnasio-logos', 'ejercicios-media']) {
                        try {
                            const { data: archivos } = await supabase.storage.from(bucket).list(gimnasioId);
                            if (archivos?.length) {
                                const paths = archivos.map((a) => `${gimnasioId}/${a.name}`);
                                await supabase.storage.from(bucket).remove(paths);
                            }
                        } catch (_) {
                            // Ignorado a propósito -- ver comentario arriba.
                        }
                    }
                }

                const { error } = await supabase.rpc('eliminar_mi_cuenta');
                if (error) return { error: { message: 'No se pudo eliminar la cuenta. Reintentar en unos minutos.' } };

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
