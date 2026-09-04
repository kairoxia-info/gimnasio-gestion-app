import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { ThemeToggle } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input, Select } from '@/components/ui-kit';
import { money } from '@/lib/format';

const vacio = {
    nombre: '',
    contacto: '',
    email: '',
    plan: '',
};

const UnirsePage = () => {
    const { codigo } = useParams();
    const [searchParams] = useSearchParams();
    const nombreGimnasio = searchParams.get('g') || '';

    const [planes, setPlanes] = useState([]);
    const [form, setForm] = useState(vacio);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [enviado, setEnviado] = useState(false);

    useEffect(() => {
        if (!codigo) return;
        supabase
            .rpc('listar_planes_para_codigo', { p_codigo: codigo })
            .then(({ data }) => setPlanes(data || []))
            .catch(() => setPlanes([]));
    }, [codigo]);

    const onSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const { error: err } = await supabase.rpc('join_gimnasio_por_codigo', {
                p_codigo: codigo,
                p_nombre: form.nombre.trim(),
                p_contacto: form.contacto.trim() || null,
                p_email: form.email.trim() || null,
                p_plan_precio_nombre: form.plan || null,
            });
            if (err) throw err;
            setEnviado(true);
        } catch (err) {
            setError(err?.message || 'No se pudo enviar la solicitud. Intentar de nuevo en un momento.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-4 py-12">
            <Helmet>
                <title>Unirse al gimnasio | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Autorregistro rápido de alumnos: dejar los datos para que el profesor active la cuenta."
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
                    <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
                        <Sparkles className="h-8 w-8 text-primary" strokeWidth={1.8} />
                    </span>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                        Autorregistro de alumnos
                    </p>
                    <h1 className="font-display mt-2 text-xl font-bold">
                        {nombreGimnasio ? `Unirse a ${nombreGimnasio}` : 'Autorregistro'}
                    </h1>
                    {!enviado && (
                        <p className="mt-1 text-sm text-muted-foreground">
                            Dejar los datos para que el profesor se ponga en contacto y active la cuenta.
                        </p>
                    )}
                </div>

                {enviado ? (
                    <div className="flex flex-col items-center gap-3 text-center">
                        <CheckCircle2 className="h-10 w-10 text-ok" strokeWidth={1.8} />
                        <p className="font-display text-lg font-bold">¡Listo!</p>
                        <p className="text-sm text-muted-foreground">
                            Ya se avisó al profesor. En breve se va a poner en contacto para activar la cuenta.
                        </p>
                    </div>
                ) : (
                    <form onSubmit={onSubmit} className="space-y-4">
                        <Field label="Nombre y apellido">
                            <Input
                                value={form.nombre}
                                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                                placeholder="Juan Pérez"
                                required
                                autoComplete="name"
                            />
                        </Field>

                        <Field label="Teléfono / contacto">
                            <Input
                                value={form.contacto}
                                onChange={(e) => setForm({ ...form, contacto: e.target.value })}
                                placeholder="11 2345-6789"
                                autoComplete="tel"
                            />
                        </Field>

                        <Field label="Correo">
                            <Input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                                placeholder="nombre@correo.com"
                                autoComplete="email"
                            />
                        </Field>

                        <Field label="Plan que te interesa">
                            <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                                <option value="">Sin preferencia</option>
                                {planes.map((p) => (
                                    <option key={p.nombre} value={p.nombre}>
                                        {p.nombre} — {money(p.precio)} / {p.periodo}
                                    </option>
                                ))}
                            </Select>
                        </Field>

                        {error && <ErrorBox>{error}</ErrorBox>}

                        <Btn type="submit" disabled={loading} className="w-full py-3">
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar solicitud'}
                        </Btn>
                    </form>
                )}

                <p className="mt-6 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    Gestión GYM Kairox IA
                </p>
            </motion.div>
        </div>
    );
};

export default UnirsePage;
