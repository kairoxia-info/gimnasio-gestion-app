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
            setError('No se pudo procesar la solicitud. Probá de nuevo en un momento.');
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
                    <Btn type="button" onClick={handleClose} className="w-full py-3">
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

                    {error && <ErrorBox>{error}</ErrorBox>}

                    <div className="flex gap-3">
                        <Btn type="button" variant="ghost" onClick={handleClose} className="flex-1 py-3">
                            Volver
                        </Btn>
                        <Btn type="submit" disabled={loading} className="flex-1 py-3">
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar enlace'}
                        </Btn>
                    </div>
                </form>
            )}
        </Modal>
    );
};

export default PasswordRecoveryModal;
