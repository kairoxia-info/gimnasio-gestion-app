import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const FullscreenSpinner = () => (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-primary"
            role="status"
            aria-label="Cargando"
        />
    </div>
);

const ProtectedRoute = ({ children }) => {
    const { isAuthed, profile, loading } = useAuth();
    const location = useLocation();

    if (loading) return <FullscreenSpinner />;

    if (!isAuthed) return <Navigate to="/login" replace />;

    const tieneGimnasio = !!profile?.gimnasio_id;

    if (!tieneGimnasio && location.pathname !== '/onboarding') {
        return <Navigate to="/onboarding" replace />;
    }

    // "/login" no pasa por este guard (ver App.jsx), así que el único caso real
    // acá es un usuario ya onboardeado que insiste en quedarse en /onboarding.
    // Excepción (migración 0076): "?nuevo=1" es agregar OTRO gimnasio a una cuenta que ya tiene.
    const agregandoOtro = new URLSearchParams(location.search).get('nuevo') === '1';
    if (tieneGimnasio && location.pathname === '/onboarding' && !agregandoOtro) {
        return <Navigate to="/panel" replace />;
    }

    return children;
};

export default ProtectedRoute;

export { ProtectedRoute };
