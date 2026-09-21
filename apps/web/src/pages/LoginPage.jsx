import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Loader2, Lock, Mail, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Logo } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input, PasswordInput } from '@/components/ui-kit';
import AuthBackdrop from '@/components/AuthBackdrop';
import PasswordRecoveryModal from '@/components/PasswordRecoveryModal';
import { validarContrasena } from '@/lib/validacionPassword';

const traducirError = (err, modo) => {
    const msg = err?.message || '';
    if (msg.includes('Invalid login credentials')) return 'Correo o contraseña incorrectos.';
    if (msg.includes('already registered') || msg.includes('already exists')) return 'Ese correo ya está registrado.';
    if (msg.includes('Password should be at least')) return 'La contraseña debe tener al menos 8 caracteres.';
    // 14/09/2026: mensaje real que devuelve Supabase cuando falta minúscula,
    // mayúscula o número (política del proyecto, ver validacionPassword.js)
    // -- antes cualquier password que se colara sin pasar la validación del
    // cliente caía acá al genérico "No se pudo crear la cuenta" sin decir
    // el motivo real.
    if (msg.includes('Password should contain at least one character of each'))
        return 'La contraseña tiene que tener al menos una minúscula, una mayúscula y un número.';
    // 21/09/2026: el registro público está apagado en Supabase ("Allow new
    // users to sign up" en OFF) y las cuentas las crea Nalux a mano desde el
    // Dashboard. Sin esto, el intento caía al genérico de abajo y parecía un
    // error de la app -- le pasó a ella misma el mismo día.
    if (/signups? not allowed/i.test(msg))
        return 'El registro está cerrado por ahora. La cuenta la crea el administrador.';
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
        setError('');
        setInfo('');
        // Pedido de Nalux (09/09/2026): al menos una mayúscula. Solo se exige
        // al REGISTRARSE, no al iniciar sesión -- una cuenta ya creada antes
        // de esta regla no tiene por qué dejar de poder entrar.
        if (!isLogin) {
            // minLength 8 + exigirMinusculaYNumero (14/09/2026): esta cuenta
            // pasa por Supabase Auth, que tiene esa política configurada del
            // lado del servidor -- ver el comentario largo en
            // validacionPassword.js.
            const errorContrasena = validarContrasena(password, 8, { exigirMinusculaYNumero: true });
            if (errorContrasena) {
                setError(errorContrasena);
                return;
            }
        }
        setLoading(true);
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
                    setInfo(
                        'Cuenta creada. Revisar el correo para confirmar antes de ingresar (si no aparece en unos minutos, revisar también la carpeta de spam).',
                    );
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
        <AuthBackdrop>
            <Helmet>
                <title>Ingresar | RutNail</title>
                <meta
                    name="description"
                    content="Acceso del entrenador a RutNail: gestión de alumnos, planes, asistencia y pagos."
                />
            </Helmet>

            <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
                className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#141210]/85 p-10 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl"
            >
                <div className="mb-8 flex flex-col items-center text-center">
                    <Logo className="h-36" />
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-[#d8b876]">
                        Panel del entrenador
                    </p>
                </div>

                {/* Pedido de Nalux (15/09/2026): que el navegador ofrezca guardar la
                    contraseña del profesor para no tener que volver a tipearla cada vez.
                    Eso lo decide el navegador (Chrome), no esta pantalla -- lo único que
                    se puede hacer del lado de la app es no estorbarle: un <form> real con
                    onSubmit (no botones sueltos por fuera del form), type="email"/
                    type="password" en los campos correctos, autoComplete="email"/
                    "current-password", y name="email"/"password" en cada input (agregado
                    ahora -- antes solo tenían autoComplete, y algunos navegadores además
                    se fijan en el name para reconocer el campo). Con eso ya puesto,
                    Chrome debería ofrecer "¿Guardar contraseña?" solo después de un login
                    que funcione -- si no aparece, es un ajuste del lado del navegador
                    (chrome://settings/passwords, o el sitio quedó en la lista de "Nunca
                    guardadas" por haber tocado "Nunca" alguna vez), no de esta pantalla. */}
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
                                name="email"
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
                            <PasswordInput
                                name="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                // minLength solo al registrarse (14/09/2026, mismo
                                // criterio que el resto de la validación en esta
                                // pantalla): una cuenta ya creada con una contraseña
                                // más corta, de antes de esta regla, no tiene por qué
                                // dejar de poder entrar -- el navegador bloquearía el
                                // submit antes de llegar a signIn() si esto quedara
                                // fijo en 8 también para el login.
                                minLength={isLogin ? undefined : 8}
                                autoComplete={isLogin ? 'current-password' : 'new-password'}
                                className="pl-9"
                            />
                        </div>
                        {!isLogin && (
                            <span className="text-xs text-muted-foreground">
                                Mínimo 8 caracteres, con mayúscula, minúscula y número.
                            </span>
                        )}
                    </Field>

                    {isLogin && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => setRecoveryOpen(true)}
                                className="text-xs font-semibold text-[#d8b876] hover:underline"
                            >
                                Olvidé mi contraseña
                            </button>
                        </div>
                    )}

                    {/* Punto 1 del pedido de Nalux (18/09/2026, "cerrar los gaps legales
                        antes de vender a un segundo gimnasio"): enganchar el link a
                        Términos y privacidad en el registro del profesor. Solo en modo
                        "signup" -- un login ya existente no está aceptando nada nuevo.
                        target="_blank" a propósito: si el profesor ya completó nombre/
                        correo/contraseña, navegar en la misma pestaña le borraría el
                        formulario a mitad de carga. */}
                    {!isLogin && (
                        <p className="text-center text-xs text-muted-foreground">
                            Al crear una cuenta, aceptas los{' '}
                            <Link
                                to="/terminos"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-[#d8b876] hover:underline"
                            >
                                Términos y la Política de privacidad
                            </Link>
                            .
                        </p>
                    )}

                    {error && <ErrorBox>{error}</ErrorBox>}
                    {info && !error && (
                        <div className="rounded-2xl border border-border bg-secondary p-4 text-sm text-foreground">
                            {info}
                        </div>
                    )}

                    <Btn
                        type="submit"
                        disabled={loading}
                        className="w-full !border-0 !bg-[linear-gradient(135deg,#e3c98f,#c9a86a)] py-3 !text-[#1c1509] hover:!brightness-105"
                    >
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
                    {isLogin ? '¿No tiene una cuenta?' : '¿Ya tiene una cuenta?'}{' '}
                    <button type="button" onClick={toggleMode} className="font-semibold text-[#d8b876] hover:underline">
                        {isLogin ? 'Registrarse' : 'Iniciar sesión'}
                    </button>
                </p>
            </motion.div>

            <div className="dark">
                <PasswordRecoveryModal open={recoveryOpen} onClose={() => setRecoveryOpen(false)} />
            </div>
        </AuthBackdrop>
    );
};

export default LoginPage;
