import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import pb from '@/lib/pocketbaseClient';

const AuthContext = createContext(null);

const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL;
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD;

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(pb.authStore.record);

    // Auto-login as demo trainer so the app is usable without a login page.
    // Only runs if VITE_DEMO_EMAIL / VITE_DEMO_PASSWORD are set (see .env.example).
    useEffect(() => {
        if (!pb.authStore.isValid && DEMO_EMAIL && DEMO_PASSWORD) {
            pb.collection('users')
                .authWithPassword(DEMO_EMAIL, DEMO_PASSWORD)
                .catch(() => {});
        }
    }, []);

    useEffect(() => pb.authStore.onChange((_token, record) => setUser(record)), []);

    const value = useMemo(
        () => ({
            user,
            isAuthed: pb.authStore.isValid,
            login: (email, password) => pb.collection('users').authWithPassword(email, password),
            signup: async (email, password, extraFields = {}) => {
                await pb.collection('users').create({ email, password, passwordConfirm: password, ...extraFields });

                return pb.collection('users').authWithPassword(email, password);
            },
            logout: () => pb.authStore.clear(),
        }),
        [user],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export default AuthContext;
