import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Loader2, Lock, Mail, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Logo, ThemeToggle } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input } from '@/components/ui-kit';
import PasswordRecoveryModal from '@/components/PasswordRecoveryModal';

const traducirError = (err, modo) => {
    const msg = err?.message || '';
    if (msg.includes('Invalid login credentials')) return 'Correo o contraseña incorrectos.';
    if (msg.includes('already registered') || msg.includes('already exists')) return 'Ese correo ya está registrado.';
    if (msg.includes('Password should be at least')) return 'La contraseña debe tener al menos 6 caracteres.';
    return modo === 'login' ? 'No se pudo iniciar sesión.' : 'No se pudo crear la cuenta.';
};

const LoginPage = () => {
    const { signIn, signUp, isAuthed, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [mode, setMode] = useState('login');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [loading, setLoading] = useState(false);
    const [recoveryOpen, setRecoveryOpen] = useState(false);

    if (!authLoading && isAuthed) return <Navigate to="/panel" replace />;

    const isLogin = mode === 'login';

    const onSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setInfo('');
        try {
            if (isLogin) {
                const { error: err } = await signIn(email.trim(), password);
                if (err) throw err;
                navigate('/panel', { replace: true });
            } else {
                const { data, error: err } = await signUp(email.trim(), password, {
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                });
                if (err) throw err;
                if (data?.session) {
                    navigate('/panel', { replace: true });
                } else {
                    setInfo('Cuenta creada. Revisá tu correo para confirmar antes de ingresar.');
                }
            }
        } catch (err) {
            setError(traducirError(err, mode));
        } finally {
            setLoading(false);
        }
    };

    const toggleMode = () => {
        setMode(isLogin ? 'signup' : 'login');
        setError('');
        setInfo('');
    };

    return (
        <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-4 py-12">
            <Helmet>
                <title>Ingresar | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Acceso del entrenador a Gestión GYM Kairox IA: gestión de alumnos, planes, asistencia y pagos."
                />
            </Helmet>

            <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-32 top-1/4 h-[36rem] w-[36rem] rounded-full bg-primary/20 blur-3xl"
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -left-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-primary/10 blur-3xl"
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
                    {!isLogin && (
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Nombre">
                                <div className="relative">
                                    <User
                                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                        strokeWidth={1.8}
                                    />
                                    <Input
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        placeholder="Juan"
                                        required
                                        autoComplete="given-name"
                                        className="pl-9"
                                    />
                                </div>
                            </Field>
                            <Field label="Apellido">
                                <div className="relative">
                                    <User
                                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                        strokeWidth={1.8}
                                    />
                                    <Input
                                        value={lastName}
                                        onChange={(e) => setLastName(e.target.value)}
                                        placeholder="Pérez"
                                        required
                                        autoComplete="family-name"
                                        className="pl-9"
                                    />
                                </div>
                            </Field>
                        </div>
                    )}

                    <Field label="Correo">
                        <div className="relative">
                            <Mail
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                strokeWidth={1.8}
                            />
                            <Input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="entrenador@tugimnasio.com"
                                required
                                autoComplete="email"
                                className="pl-9"
                            />
                        </div>
                    </Field>

                    <Field label="Contraseña">
                        <div className="relative">
                            <Lock
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                strokeWidth={1.8}
                            />
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                minLength={6}
                                autoComplete={isLogin ? 'current-password' : 'new-password'}
                                className="pl-9"
                            />
                        </div>
                    </Field>

                    {isLogin && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => setRecoveryOpen(true)}
                                className="text-xs font-semibold text-primary hover:underline"
                            >
                                Olvidé mi contraseña
                            </button>
                        </div>
                    )}

                    {error && <ErrorBox>{error}</ErrorBox>}
                    {info && !error && (
                        <div className="rounded-2xl border border-border bg-secondary p-4 text-sm text-foreground">
                            {info}
                        </div>
                    )}

                    <Btn type="submit" disabled={loading} className="w-full py-3">
                        {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                {isLogin ? 'Ingresar' : 'Crear cuenta'}
                                <ArrowRight className="h-4 w-4" strokeWidth={2} />
                            </>
                        )}
                    </Btn>
                </form>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                    {isLogin ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?'}{' '}
                    <button type="button" onClick={toggleMode} className="font-semibold text-primary hover:underline">
                        {isLogin ? 'Registrate' : 'Iniciá sesión'}
                    </button>
                </p>
            </motion.div>

            <PasswordRecoveryModal open={recoveryOpen} onClose={() => setRecoveryOpen(false)} />
        </div>
    );
};

export default LoginPage;
