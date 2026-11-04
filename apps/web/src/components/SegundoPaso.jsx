import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { ShieldCheck } from 'lucide-react';
import AuthBackdrop from '@/components/AuthBackdrop';
import { EMAIL_SOPORTE, Logo } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input } from '@/components/ui-kit';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';

// Verificación en dos pasos (04/11/2026): la cuenta tiene la verificación activada y la sesión todavía no
// pasó el código. Al verificar, Supabase avisa con MFA_CHALLENGE_VERIFIED, AuthContext baja
// necesitaSegundoPaso y se muestra lo que estaba detrás, sin navegar a ningún lado.
const SegundoPaso = () => {
    const { signOut } = useAuth();
    const [codigo, setCodigo] = useState('');
    const [verificando, setVerificando] = useState(false);
    const [error, setError] = useState('');

    const verificar = async (e) => {
        e.preventDefault();
        setError('');
        setVerificando(true);
        const { data: factores, error: errorFactores } = await supabase.auth.mfa.listFactors();
        const factor = factores?.totp?.[0];
        if (errorFactores || !factor) {
            setError('No se pudo comprobar la verificación. Revisa la conexión y prueba de nuevo.');
            setVerificando(false);
            return;
        }
        const { error: errorCodigo } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo });
        if (errorCodigo) {
            setError(
                errorCodigo.code === 'mfa_verification_failed'
                    ? 'Ese código no es correcto o ya cambió. Escribe el que se ve ahora en tu app.'
                    : 'No se pudo verificar el código. Prueba de nuevo en unos segundos.',
            );
            setCodigo('');
            setVerificando(false);
        }
    };

    return (
        <AuthBackdrop>
            <Helmet>
                <title>Verificación en dos pasos | RutNail</title>
            </Helmet>
            <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#141210]/85 p-6 text-center shadow-[0_30px_80px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl sm:p-10">
                <Logo className="mx-auto h-20" />
                <ShieldCheck className="mx-auto mt-4 h-8 w-8 text-primary" strokeWidth={1.8} aria-hidden="true" />
                <h1 className="font-display mt-2 text-xl font-bold text-foreground">Verificación en dos pasos</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Abre tu app de autenticación y escribe el código de 6 números.
                </p>

                <form onSubmit={verificar} className="mt-6 space-y-4 text-left">
                    <Field label="Código">
                        <Input
                            value={codigo}
                            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="123456"
                            className="text-center text-lg tracking-[0.4em]"
                            autoFocus
                            required
                        />
                    </Field>
                    {error && <ErrorBox>{error}</ErrorBox>}
                    <Btn type="submit" className="w-full py-3" disabled={verificando || codigo.length !== 6}>
                        {verificando ? 'Verificando...' : 'Verificar'}
                    </Btn>
                    <Btn variant="ghost" className="w-full py-3" onClick={() => signOut()}>
                        Cerrar sesión
                    </Btn>
                </form>

                <p className="mt-5 text-xs text-muted-foreground">
                    ¿Perdiste el acceso a tu app? Escribe a{' '}
                    <a href={`mailto:${EMAIL_SOPORTE}`} className="font-medium text-primary hover:underline">
                        {EMAIL_SOPORTE}
                    </a>
                    .
                </p>
            </div>
        </AuthBackdrop>
    );
};

export default SegundoPaso;
