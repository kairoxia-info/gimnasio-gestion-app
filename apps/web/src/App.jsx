import React from 'react';
import { Navigate, Route, Routes, BrowserRouter as Router } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import ScrollToTop from './components/ScrollToTop';
import { AuthProvider } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import LoginPage from '@/pages/LoginPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import UnirsePage from '@/pages/UnirsePage';
import OnboardingPage from '@/pages/OnboardingPage';
import DashboardPage from '@/pages/DashboardPage';
import AlumnosPage from '@/pages/AlumnosPage';
import AlumnoPage from '@/pages/AlumnoPage';
import EjerciciosPage from '@/pages/EjerciciosPage';
import AlimentosPage from '@/pages/AlimentosPage';
import AsistenciaPage from '@/pages/AsistenciaPage';
import PagosPage from '@/pages/PagosPage';
import ConfiguracionPage from '@/pages/ConfiguracionPage';

const guard = (element) => <ProtectedRoute>{element}</ProtectedRoute>;

function App() {
    return (
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
            <AuthProvider>
                <Router>
                    <ScrollToTop />
                    <Routes>
                        <Route path="/" element={<Navigate to="/panel" replace />} />
                        {/* Sin ProtectedRoute a propósito: es la puerta de entrada para
                            usuarios SIN sesión. Envolverla con el guard normal la haría
                            redirigir a "/login" apenas !isAuthed — Navigate hacia la misma
                            ruta en la que ya está, dejando el formulario inalcanzable. El
                            propio LoginPage ya redirige a /panel si detecta sesión activa. */}
                        <Route path="/login" element={<LoginPage />} />
                        {/* Sin ProtectedRoute a propósito: esta ruta se llega con la sesión
                            temporal de recuperación que arma Supabase desde el link del mail,
                            que todavía no tiene por qué tener gimnasio_id. Pasarla por el guard
                            normal la rebotaría a /onboarding antes de poder cambiar la clave. La
                            propia página valida sesión/estado con useAuth() internamente. */}
                        <Route path="/restablecer-password" element={<ResetPasswordPage />} />
                        {/* Sin ProtectedRoute a propósito: es la puerta de entrada para un
                            visitante SIN sesión (alguien que escaneó el QR o abrió el link del
                            código de invitación) — nunca va a tener sesión propia para esta
                            acción puntual (el autorregistro no crea un usuario de auth.users,
                            solo una fila en alumnos). El guard normal lo rebotaría a /login antes
                            de poder ver el formulario, igual que pasaría con /login y
                            /restablecer-password si los envolviéramos. */}
                        <Route path="/unirse/:codigo" element={<UnirsePage />} />
                        <Route path="/onboarding" element={guard(<OnboardingPage />)} />
                        <Route path="/panel" element={guard(<DashboardPage />)} />
                        <Route path="/alumnos" element={guard(<AlumnosPage />)} />
                        <Route path="/alumnos/:id" element={guard(<AlumnoPage />)} />
                        <Route path="/ejercicios" element={guard(<EjerciciosPage />)} />
                        <Route path="/alimentos" element={guard(<AlimentosPage />)} />
                        <Route path="/asistencia" element={guard(<AsistenciaPage />)} />
                        <Route path="/pagos" element={guard(<PagosPage />)} />
                        <Route path="/configuracion" element={guard(<ConfiguracionPage />)} />
                        <Route path="*" element={<Navigate to="/panel" replace />} />
                    </Routes>
                </Router>
            </AuthProvider>
        </ThemeProvider>
    );
}

export default App;
