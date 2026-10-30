import React from 'react';
import { Helmet } from 'react-helmet';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { rutaDeIngreso } from '@/lib/rutaDeIngreso';

const FullscreenSpinner = () => (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-primary"
            role="status"
            aria-label="Cargando"
        />
    </div>
);

// Un empleado al que el administrador le pausó el acceso no tiene gimnasio activo: sin este aviso la
// app lo mandaba a "Crear el gimnasio" como si fuera un profesor nuevo (la base ya le impide crearlo).
const AccesoPausado = ({ signOut, refreshProfile }) => (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center">
            <h1 className="font-display text-xl font-bold">Tu acceso está pausado</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                El administrador del gimnasio pausó tu acceso por ahora. Cuando lo reactive podrás ingresar de nuevo con
                el mismo correo y contraseña. Si crees que es un error, comunícate con él.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <button
                    type="button"
                    onClick={() => refreshProfile?.()}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:border-primary"
                >
                    Volver a comprobar
                </button>
                <button
                    type="button"
                    onClick={() => signOut()}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:border-primary"
                >
                    Cerrar sesión
                </button>
            </div>
        </div>
    </div>
);

// Suscripción vencida y pasados los 7 días de solo lectura (migración 0086): la base ya no deja leer
// nada del gimnasio. El administrador puede entrar a "Suscripción" para renovar; el equipo ve un aviso.
const SuscripcionBloqueada = ({ esAdmin, signOut }) => (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
        <Helmet>
            <title>Suscripción vencida | RutNail</title>
        </Helmet>
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center">
            <h1 className="font-display text-xl font-bold">La suscripción venció</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                {esAdmin
                    ? 'El acceso a tu gimnasio está pausado hasta que renueves el plan. Tus datos están a salvo: apenas pagues, todo vuelve a estar como lo dejaste.'
                    : 'El acceso a este gimnasio está pausado porque la suscripción venció. Avisa al administrador para que la renueve.'}
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                {esAdmin && (
                    <Link
                        to="/suscripcion"
                        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
                    >
                        Renovar suscripción
                    </Link>
                )}
                <button
                    type="button"
                    onClick={() => signOut()}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:border-primary"
                >
                    Cerrar sesión
                </button>
            </div>
        </div>
    </div>
);

const ProtectedRoute = ({ children }) => {
    const { isAuthed, profile, loading, signOut, refreshProfile } = useAuth();
    const location = useLocation();

    if (loading) return <FullscreenSpinner />;

    // Sin sesión: cada uno vuelve a su ingreso (el del equipo o el del profesor).
    if (!isAuthed) return <Navigate to={rutaDeIngreso()} replace />;

    const tieneGimnasio = !!profile?.gimnasio_id;

    // Antes que cualquier redirección: con la suscripción bloqueada nunca se debe ofrecer "Crear el gimnasio".
    if (profile?.suscripcion?.acceso === 'bloqueado' && location.pathname !== '/suscripcion') {
        return <SuscripcionBloqueada esAdmin={profile?.role === 'admin'} signOut={signOut} />;
    }

    if (!tieneGimnasio && profile?.accesoPausado) {
        return <AccesoPausado signOut={signOut} refreshProfile={refreshProfile} />;
    }

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
