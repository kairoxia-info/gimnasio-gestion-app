import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Logo } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input } from '@/components/ui-kit';
import AuthBackdrop from '@/components/AuthBackdrop';

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
        <AuthBackdrop>
            <Helmet>
                <title>Restablecer contraseña | Gestión GYM Kairox IA</title>
                <meta name="description" content="Definí una nueva contraseña para tu cuenta de Gestión GYM Kairox IA." />
            </Helmet>

            <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
                className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#141210]/85 p-8 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl"
            >
                <div className="mb-8 flex flex-col items-center text-center">
                    <Logo className="h-24" />
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-[#d8b876]">
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
                            Contraseña actualizada. Ya se puede iniciar sesión con la nueva contraseña.
                        </p>
                        <p className="text-xs text-muted-foreground">Redirigiendo al ingreso...</p>
                    </div>
                ) : !user ? (
                    <div className="space-y-4 text-center">
                        <p className="text-sm text-foreground">
                            Este enlace no es válido o ya expiró. Pedí uno nuevo desde la pantalla de ingreso.
                        </p>
                        <Link to="/login" className="inline-block">
                            <Btn
                                type="button"
                                className="!border-0 !bg-[linear-gradient(135deg,#e3c98f,#c9a86a)] !text-[#1c1509] hover:!brightness-105"
                            >
                                Volver a ingresar
                            </Btn>
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

                        <Btn
                            type="submit"
                            disabled={loading}
                            className="w-full !border-0 !bg-[linear-gradient(135deg,#e3c98f,#c9a86a)] py-3 !text-[#1c1509] hover:!brightness-105"
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar nueva contraseña'}
                        </Btn>
                    </form>
                )}
            </motion.div>
        </AuthBackdrop>
    );
};

export default ResetPasswordPage;
