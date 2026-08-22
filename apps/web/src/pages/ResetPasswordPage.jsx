import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Logo, ThemeToggle } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input } from '@/components/ui-kit';

const ResetPasswordPage = () => {
    const { user, loading: authLoading, updatePassword, signOut } = useAuth();
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (!done) return;
        const t = setTimeout(() => navigate('/login', { replace: true }), 2200);
        return () => clearTimeout(t);
    }, [done, navigate]);

    const onSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres.');
            return;
        }
        if (password !== confirm) {
            setError('Las contraseñas no coinciden.');
            return;
        }
        setLoading(true);
        try {
            const { error: err } = await updatePassword(password);
            if (err) throw err;
            await signOut();
            setDone(true);
        } catch {
            setError('No se pudo actualizar la contraseña. El enlace puede haber expirado.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-4 py-12">
            <Helmet>
                <title>Restablecer contraseña | Gestión GYM Kairox IA</title>
                <meta name="description" content="Definí una nueva contraseña para tu cuenta de Gestión GYM Kairox IA." />
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
                        Restablecer contraseña
                    </p>
                </div>

                {authLoading ? (
                    <div className="flex justify-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : done ? (
                    <div className="flex flex-col items-center gap-3 py-4 text-center">
                        <CheckCircle2 className="h-12 w-12 text-ok" strokeWidth={1.6} />
                        <p className="text-sm text-foreground">
                            Contraseña actualizada. Ya podés iniciar sesión con tu nueva contraseña.
                        </p>
                        <p className="text-xs text-muted-foreground">Redirigiendo al ingreso...</p>
                    </div>
                ) : !user ? (
                    <div className="space-y-4 text-center">
                        <p className="text-sm text-foreground">
                            Este enlace no es válido o ya expiró. Pedí uno nuevo desde la pantalla de ingreso.
                        </p>
                        <Link to="/login" className="inline-block">
                            <Btn type="button">Volver a ingresar</Btn>
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={onSubmit} className="space-y-4">
                        <Field label="Nueva contraseña">
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
                                    autoComplete="new-password"
                                    className="pl-9"
                                />
                            </div>
                        </Field>
                        <Field label="Confirmar contraseña">
                            <div className="relative">
                                <Lock
                                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                    strokeWidth={1.8}
                                />
                                <Input
                                    type="password"
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
                                    className="pl-9"
                                />
                            </div>
                        </Field>

                        {error && <ErrorBox>{error}</ErrorBox>}

                        <Btn type="submit" disabled={loading} className="w-full py-3">
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar nueva contraseña'}
                        </Btn>
                    </form>
                )}
            </motion.div>
        </div>
    );
};

export default ResetPasswordPage;
