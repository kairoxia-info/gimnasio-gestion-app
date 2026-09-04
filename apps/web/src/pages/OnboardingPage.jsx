import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Building2, ImagePlus, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';
import { Logo } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input } from '@/components/ui-kit';
import AuthBackdrop from '@/components/AuthBackdrop';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const OnboardingPage = () => {
    const { createGimnasio, refreshProfile } = useAuth();
    const navigate = useNavigate();
    const [nombre, setNombre] = useState('');
    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState('');
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    const [loading, setLoading] = useState(false);

    const onFileChange = (e) => {
        const file = e.target.files?.[0];
        setError('');
        if (!file) {
            setLogoFile(null);
            setLogoPreview('');
            return;
        }
        if (!MIME_TO_EXT[file.type]) {
            setError('El logo debe ser PNG, JPG o WEBP.');
            e.target.value = '';
            return;
        }
        if (file.size > MAX_LOGO_BYTES) {
            setError('El logo no puede pesar más de 2 MB.');
            e.target.value = '';
            return;
        }
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!nombre.trim()) return;
        setLoading(true);
        setError('');
        setWarning('');

        try {
            const { data: gimnasioId, error: createError } = await createGimnasio(nombre.trim());
            if (createError) throw createError;

            if (logoFile) {
                try {
                    const ext = MIME_TO_EXT[logoFile.type];
                    const path = `${gimnasioId}/logo.${ext}`;
                    const { error: uploadError } = await supabase.storage
                        .from('gimnasio-logos')
                        .upload(path, logoFile, { upsert: true });
                    if (uploadError) throw uploadError;

                    const {
                        data: { publicUrl },
                    } = supabase.storage.from('gimnasio-logos').getPublicUrl(path);

                    const { error: updateError } = await supabase
                        .from('gimnasios')
                        .update({ logo_url: publicUrl })
                        .eq('id', gimnasioId);
                    if (updateError) throw updateError;
                } catch {
                    // No bloqueamos el alta del gimnasio por un logo que falló al subir.
                    // Se puede volver a subir después desde Configuración.
                    setWarning('El gimnasio se creó, pero el logo no se pudo subir. Se puede cargar después desde Configuración.');
                }
            }

            await refreshProfile();
            navigate('/panel', { replace: true });
        } catch {
            setError('No se pudo crear el gimnasio. Intentar de nuevo en un momento.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthBackdrop>
            <Helmet>
                <title>Crear el gimnasio | Gestión GYM Kairox IA</title>
                <meta name="description" content="Configurar el gimnasio para empezar a usar Gestión GYM Kairox IA." />
            </Helmet>

            <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
                className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#141210]/85 p-8 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl"
            >
                <div className="mb-8 flex flex-col items-center text-center">
                    <Logo className="h-20" />
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-[#d8b876]">
                        Un último paso
                    </p>
                    <h1 className="font-display mt-2 text-xl font-bold text-foreground">Crear el gimnasio</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Con esto se arma el espacio para gestionar alumnos, planes y pagos.
                    </p>
                </div>

                <form onSubmit={onSubmit} className="space-y-4">
                    <Field label="Nombre del gimnasio">
                        <div className="relative">
                            <Building2
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                strokeWidth={1.8}
                            />
                            <Input
                                value={nombre}
                                onChange={(e) => setNombre(e.target.value)}
                                placeholder="Mi Gimnasio"
                                required
                                autoComplete="organization"
                                className="pl-9"
                            />
                        </div>
                    </Field>

                    <Field label="Logo (opcional)">
                        <div className="flex items-center gap-3">
                            {logoPreview ? (
                                <img
                                    src={logoPreview}
                                    alt="Vista previa del logo"
                                    className="h-12 w-12 shrink-0 rounded-xl border border-border object-contain"
                                />
                            ) : (
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
                                    <ImagePlus className="h-5 w-5" strokeWidth={1.6} />
                                </div>
                            )}
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={onFileChange}
                                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-[linear-gradient(135deg,#e3c98f,#c9a86a)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#1c1509] file:transition hover:file:brightness-105"
                            />
                        </div>
                        <span className="text-xs text-muted-foreground">PNG, JPG o WEBP. Máximo 2 MB.</span>
                    </Field>

                    {error && <ErrorBox>{error}</ErrorBox>}
                    {warning && !error && (
                        <div className="flex items-start gap-2 rounded-2xl border border-border bg-secondary p-4 text-sm text-foreground">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={1.8} />
                            <span>{warning}</span>
                        </div>
                    )}

                    <Btn
                        type="submit"
                        disabled={loading}
                        className="w-full !border-0 !bg-[linear-gradient(135deg,#e3c98f,#c9a86a)] py-3 !text-[#1c1509] hover:!brightness-105"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Crear gimnasio y continuar'}
                    </Btn>
                </form>
            </motion.div>
        </AuthBackdrop>
    );
};

export default OnboardingPage;
