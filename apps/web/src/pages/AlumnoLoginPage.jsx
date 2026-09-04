import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Dumbbell, Loader2, Lock, User } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { ThemeToggle } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input } from '@/components/ui-kit';

// Clave de localStorage donde queda guardado el codigo_acceso después de un
// login exitoso -- mismo valor que MiPlanPage.jsx lee para "Cerrar sesión"
// (no se comparte como import porque es la única otra pantalla que la usa;
// si en algún momento hay una tercera, vale la pena moverla a un lugar
// común).
const CLAVE_SESION = 'kairox_alumno_codigo';

// Login del alumno (migración 0028, pedido de Nalux 04/09/2026): reemplaza
// al QR/link -- el profesor le crea un usuario y una contraseña desde la
// ficha (AlumnoPage.jsx, AccesoAlumno) y el alumno entra acá con eso. La
// RPC pública iniciar_sesion_alumno() devuelve el mismo codigo_acceso que
// ya usaba MiPlanPage.jsx (no cambia nada de cómo se pide/muestra el plan,
// solo cómo se consigue el código) -- por eso, apenas se loguea, se guarda
// ese código en localStorage y se navega directo a /mi-plan/:codigo. La
// próxima vez que entre acá con la sesión guardada, ni ve el formulario:
// pasa derecho a su plan.
const AlumnoLoginPage = () => {
    const navigate = useNavigate();
    const [revisandoSesion, setRevisandoSesion] = useState(true);
    const [usuario, setUsuario] = useState('');
    const [contrasena, setContrasena] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    // Solo informativo: el PRIMER ingreso siempre necesita conexión (hay que
    // validar la contraseña contra el servidor). Una vez logueado una vez en
    // este celular, las siguientes veces ni pasa por acá -- el chequeo de
    // localStorage de arriba manda derecho a /mi-plan/:codigo sin pedir red.
    const [sinConexion, setSinConexion] = useState(!navigator.onLine);
    useEffect(() => {
        const marcarOnline = () => setSinConexion(false);
        const marcarOffline = () => setSinConexion(true);
        window.addEventListener('online', marcarOnline);
        window.addEventListener('offline', marcarOffline);
        return () => {
            window.removeEventListener('online', marcarOnline);
            window.removeEventListener('offline', marcarOffline);
        };
    }, []);

    useEffect(() => {
        const guardado = localStorage.getItem(CLAVE_SESION);
        if (guardado) {
            navigate(`/mi-plan/${guardado}`, { replace: true });
            return;
        }
        setRevisandoSesion(false);
    }, [navigate]);

    const onSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const { data: codigo, error: err } = await supabase.rpc('iniciar_sesion_alumno', {
                p_usuario: usuario.trim(),
                p_contrasena: contrasena,
            });
            if (err) throw err;
            try {
                localStorage.setItem(CLAVE_SESION, codigo);
            } catch (_) {
                // Si el navegador bloquea localStorage (modo privado, etc.) igual
                // se puede entrar -- solo que la próxima vez va a pedir el login
                // de nuevo, no queda "recordado".
            }
            navigate(`/mi-plan/${codigo}`, { replace: true });
        } catch (err) {
            setError(err?.message || 'No se pudo ingresar. Intentar de nuevo.');
        } finally {
            setLoading(false);
        }
    };

    // Mientras se revisa si ya había una sesión guardada, no se muestra
    // nada (ni el formulario ni un spinner) -- es un chequeo instantáneo de
    // localStorage, mostrar algo acá solo parpadearía sin aportar nada.
    if (revisandoSesion) return null;

    return (
        <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-4 py-12">
            <Helmet>
                <title>Entrar | Gestión GYM Kairox IA</title>
                <meta name="description" content="Entrar con usuario y contraseña para ver la rutina y el plan de alimentación." />
            </Helmet>

            <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-32 top-1/4 h-[36rem] w-[36rem] rounded-full bg-primary/20 blur-3xl"
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -left-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-primary/10 blur-3xl"
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-primary" />

            <div className="absolute right-4 top-4">
                <ThemeToggle />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
                className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-8"
            >
                <div className="mb-8 flex flex-col items-center text-center">
                    <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
                        <Dumbbell className="h-8 w-8 text-primary" strokeWidth={1.8} />
                    </span>
                    <h1 className="font-display mt-3 text-xl font-bold">Tu rutina y tu plan</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Entrar con el usuario y la contraseña que dio el profesor.
                    </p>
                </div>

                <form onSubmit={onSubmit} className="space-y-4">
                    <Field label="Usuario">
                        <div className="relative">
                            <User
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                strokeWidth={1.8}
                            />
                            <Input
                                value={usuario}
                                onChange={(e) => setUsuario(e.target.value)}
                                placeholder="nadia1"
                                required
                                autoComplete="username"
                                autoCapitalize="none"
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
                                value={contrasena}
                                onChange={(e) => setContrasena(e.target.value)}
                                placeholder="••••••••"
                                required
                                autoComplete="current-password"
                                className="pl-9"
                            />
                        </div>
                    </Field>

                    {sinConexion && !error && (
                        <p className="text-center text-xs text-warn">
                            Sin conexión: para el primer ingreso hace falta señal o wifi.
                        </p>
                    )}
                    {error && <ErrorBox>{error}</ErrorBox>}

                    <Btn type="submit" disabled={loading} className="w-full py-3">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ingresar'}
                    </Btn>
                </form>

                <p className="mt-6 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    Gestión GYM Kairox IA
                </p>
            </motion.div>
        </div>
    );
};

export default AlumnoLoginPage;
