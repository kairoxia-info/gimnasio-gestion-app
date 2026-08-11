import React from 'react';
import { Navigate, Route, Routes, BrowserRouter as Router } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import ScrollToTop from './components/ScrollToTop';
import { AuthProvider } from '@/contexts/AuthContext';
import DashboardPage from '@/pages/DashboardPage';
import AlumnosPage from '@/pages/AlumnosPage';
import AlumnoPage from '@/pages/AlumnoPage';
import EjerciciosPage from '@/pages/EjerciciosPage';
import AlimentosPage from '@/pages/AlimentosPage';
import AsistenciaPage from '@/pages/AsistenciaPage';
import PagosPage from '@/pages/PagosPage';
import ConfiguracionPage from '@/pages/ConfiguracionPage';

const guard = (element) => element;

function App() {
    return (
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
            <AuthProvider>
                <Router>
                    <ScrollToTop />
                    <Routes>
                        <Route path="/" element={<Navigate to="/panel" replace />} />
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
