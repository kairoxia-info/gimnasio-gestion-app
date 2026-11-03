import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullscreenSpinner } from '@/components/ProtectedRoute';
import PresentacionPage from '@/pages/PresentacionPage';

// Página de inicio de "/" (03/11/2026): quien ya tiene sesión pasa directo al panel, como siempre; quien no
// la tiene ve la presentación de RutNail con los planes y el botón para probarlo (antes veía el ingreso).
const Inicio = () => {
    const { isAuthed, loading } = useAuth();
    if (loading) return <FullscreenSpinner />;
    return isAuthed ? <Navigate to="/panel" replace /> : <PresentacionPage />;
};

export default Inicio;
