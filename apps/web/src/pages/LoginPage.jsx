import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Logo, ThemeToggle } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input } from '@/components/ui-kit';

const LoginPage = () => {
    const { login, isAuthed } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    if (isAuthed) return <Navigate to="/panel" replace />;

    const onSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            await login(email.trim(), password);
            navigate('/panel', { replace: true });
        } catch (err) {
            setError(err?.status === 400 ? 'Correo o contraseña incorrectos.' : 'No se pudo iniciar sesión.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-4 py-12">
            <Helmet>
                <title>Ingresar | Fitness Gym Place</title>
                <meta
                    name="description"
                    content="Acceso del entrenador a Fitness Gym Place: gestión de alumnos, planes, asistencia y pagos."
                />
            </Helmet>

            <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-32 top-1/4 h-[36rem] w-[36rem] rounded-full bg-primary/20 blur-3xl"
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-primary"
            />

            <div className="absolute right-4 top-4">
                <ThemeToggle />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
                className="relative w-full max-w-md rounded-3xl border border-border bg-card p-8"
            >
                <div className="mb-8 flex flex-col items-center text-center">
                    <Logo className="h-24" />
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                        Panel del entrenador
                    </p>
                </div>

                <form onSubmit={onSubmit} className="space-y-4">
                    <Field label="Correo">
                        <Input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="entrenador@tugimnasio.com"
                            required
                            autoComplete="email"
                        />
                    </Field>
                    <Field label="Contraseña">
                        <Input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            autoComplete="current-password"
                        />
                    </Field>
                    {error && <ErrorBox>{error}</ErrorBox>}
                    <Btn type="submit" disabled={loading} className="w-full py-3">
                        {loading ? 'Ingresando...' : 'Ingresar'}
                    </Btn>
                </form>
            </motion.div>
        </div>
    );
};

export default LoginPage;
