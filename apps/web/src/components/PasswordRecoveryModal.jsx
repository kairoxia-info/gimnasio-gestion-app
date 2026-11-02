import React, { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Btn, ErrorBox, Field, Input, Modal } from '@/components/ui-kit';

const PasswordRecoveryModal = ({ open, onClose }) => {
    const { resetPasswordForEmail } = useAuth();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);

    const handleClose = () => {
        setEmail('');
        setError('');
        setSent(false);
        setLoading(false);
        onClose();
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            await resetPasswordForEmail(email.trim());
            // Nunca confirmar ni desmentir si el email existe: evita enumeración de cuentas.
            setSent(true);
        } catch {
            setError('No se pudo procesar la solicitud. Intentar de nuevo en un momento.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal open={open} onClose={handleClose} title="Recuperar contraseña">
            {sent ? (
                <div className="space-y-5">
                    <p className="text-sm text-foreground">
                        Si <span className="font-semibold">{email}</span> está registrado, vas a recibir un enlace
                        para restablecer tu contraseña en los próximos minutos.
                    </p>
                    <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-foreground">
                        <span className="font-semibold">Revisa también la carpeta de spam o correo no deseado.</span> El
                        mensaje llega de «RutNail» y, a veces, el correo lo manda allí. Si lo encuentras, márcalo como
                        «No es spam» para que el enlace funcione sin problemas.
                    </p>
                    <Btn
                        type="button"
                        onClick={handleClose}
                        className="w-full !border-0 !bg-[linear-gradient(135deg,#e3c98f,#c9a86a)] py-3 !text-[#1c1509] hover:!brightness-105"
                    >
                        Volver
                    </Btn>
                </div>
            ) : (
                <form onSubmit={onSubmit} className="space-y-4">
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

                    <p className="text-xs text-muted-foreground">
                        Te enviaremos un enlace por correo. Si no lo ves en la bandeja de entrada, revisa la carpeta de spam.
                    </p>

                    {error && <ErrorBox>{error}</ErrorBox>}

                    <div className="flex gap-3">
                        <Btn type="button" variant="ghost" onClick={handleClose} className="flex-1 py-3">
                            Volver
                        </Btn>
                        <Btn
                            type="submit"
                            disabled={loading}
                            className="flex-1 !border-0 !bg-[linear-gradient(135deg,#e3c98f,#c9a86a)] py-3 !text-[#1c1509] hover:!brightness-105"
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar enlace'}
                        </Btn>
                    </div>
                </form>
            )}
        </Modal>
    );
};

export default PasswordRecoveryModal;
