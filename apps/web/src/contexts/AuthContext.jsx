import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import supabase from '@/lib/supabaseClient';
import { setCurrentGimnasioId } from '@/lib/currentGimnasio';
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
            .select('id, email, first_name, last_name, gimnasio_id, role, gimnasios(nombre, logo_url, color_principal)')
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
            signUp: (email, password, { first_name, last_name } = {}) =>
                supabase.auth.signUp({
                    email,
                    password,
                    options: { data: { first_name, last_name } },
                }),
            signOut: () => supabase.auth.signOut(),
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
        }),
        [user, profile, loading, fetchProfile],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);

export default AuthContext;
