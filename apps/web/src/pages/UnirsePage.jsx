import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { ThemeToggle } from '@/components/AppLayout';
import { Btn, ErrorBox, Field, Input } from '@/components/ui-kit';

// Alcance definido por Nalux (09/09/2026): el alumno carga SOLO sus datos
// personales. El plan, el objetivo, las observaciones de salud y la foto los
// completa el profesor al darlo de alta -- por eso acá no hay selector de
// plan (lo había antes) ni subida de foto (exigiría abrir una puerta de
// escritura pública al Storage; se decidió que la suba el profesor).
// El DNI se sacó de toda la app (11/09/2026, decisión de Nalux: "sacalo así no
// hay problemas con nada"). No lo usaba ninguna función -- ni el comprobante de
// pago ni nada, solo se guardaba y se mostraba -- así que era juntar un dato de
// identidad sin ningún motivo, que es el tipo de cosa que después hay que
// justificar frente a la Ley 25.326. El dato que no se tiene no hay que
// cuidarlo. La columna `dni` sigue existiendo en la base, vacía, por si algún
// día se decide lo contrario.
const vacio = {
    nombre: '',
    apellido: '',
    contacto: '',
    email: '',
    fecha_nacimiento: '',
    contacto_emergencia: '',
};

// La edad no se guarda como campo aparte: se calcula desde la fecha de
// nacimiento (tener las dos cosas guardadas invita a que se contradigan).
// Acá se muestra al tipear, solo como confirmación visual de que la fecha
// cargada es la correcta.
const edadDesde = (fecha) => {
    if (!fecha) return null;
    const nac = new Date(`${fecha}T00:00:00`);
    if (Number.isNaN(nac.getTime())) return null;
    const hoyFecha = new Date();
    let edad = hoyFecha.getFullYear() - nac.getFullYear();
    const mes = hoyFecha.getMonth() - nac.getMonth();
    if (mes < 0 || (mes === 0 && hoyFecha.getDate() < nac.getDate())) edad -= 1;
    return edad >= 0 && edad < 120 ? edad : null;
};

const UnirsePage = () => {
    const { codigo } = useParams();
    const [searchParams] = useSearchParams();
    const nombreGimnasio = searchParams.get('g') || '';

    const [form, setForm] = useState(vacio);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [enviado, setEnviado] = useState(false);
    // Conformidad para el tratamiento de los datos (11/09/2026). Esta pantalla
    // es pública: la abre alguien de afuera, sin cuenta, y le pide nombre,
    // teléfono, DNI, fecha de nacimiento y un contacto de emergencia. Pedirle
    // todo eso sin decirle para qué es ni que preste conformidad es
    // exactamente lo que la Ley 25.326 no admite. No se guarda como columna
    // (la conformidad es de este momento y de este formulario); lo que hace es
    // que no se pueda enviar sin haberla leído y marcado.
    const [conforme, setConforme] = useState(false);

    const edad = edadDesde(form.fecha_nacimiento);
    const esMenor = edad !== null && edad < 18;

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!conforme) {
            setError('Para enviar la solicitud hay que aceptar el uso de los datos.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            // nombre y apellido van juntos a alumnos.nombre: la tabla tiene una
            // sola columna para el nombre completo, y así se ve igual que un
            // alumno cargado a mano por el profesor.
            const { error: err } = await supabase.rpc('join_gimnasio_por_codigo', {
                p_codigo: codigo,
                p_nombre: `${form.nombre.trim()} ${form.apellido.trim()}`.trim(),
                p_contacto: form.contacto.trim() || null,
                p_email: form.email.trim() || null,
                // p_dni ya no se manda. El parámetro sigue existiendo en la RPC y
                // la función lo ignora: sacarlo de la firma rompería el
                // autorregistro en producción hasta que se despliegue este
                // frontend (ya pasó con el login del alumno esta misma mañana).
                p_dni: null,
                p_fecha_nacimiento: form.fecha_nacimiento || null,
                p_contacto_emergencia: form.contacto_emergencia.trim() || null,
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
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Nombre">
                                <Input
                                    value={form.nombre}
                                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                                    placeholder="Juan"
                                    required
                                    autoComplete="given-name"
                                />
                            </Field>

                            <Field label="Apellido">
                                <Input
                                    value={form.apellido}
                                    onChange={(e) => setForm({ ...form, apellido: e.target.value })}
                                    placeholder="Pérez"
                                    required
                                    autoComplete="family-name"
                                />
                            </Field>
                        </div>

                        <Field label="Teléfono">
                            <Input
                                value={form.contacto}
                                onChange={(e) => setForm({ ...form, contacto: e.target.value })}
                                placeholder="11 2345-6789"
                                required
                                autoComplete="tel"
                            />
                        </Field>

                        <Field label="Correo (opcional)">
                            <Input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                                placeholder="nombre@correo.com"
                                autoComplete="email"
                            />
                        </Field>

                        <Field label="Fecha de nacimiento (opcional)">
                            <Input
                                type="date"
                                value={form.fecha_nacimiento}
                                onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })}
                                autoComplete="bday"
                            />
                            {edad !== null && (
                                <span className="text-xs text-muted-foreground">{edad} años</span>
                            )}
                        </Field>

                        <Field label="Contacto de emergencia (opcional)">
                            <Input
                                value={form.contacto_emergencia}
                                onChange={(e) => setForm({ ...form, contacto_emergencia: e.target.value })}
                                placeholder="Nombre y teléfono"
                            />
                        </Field>

                        {/* Aviso de menores: se muestra solo si la fecha cargada da menos
                            de 18. No bloquea el envío a propósito -- bloquear solo lograría
                            que pongan una fecha falsa, y ahí el gimnasio se quedaría sin
                            saber que el alumno es menor, que es justo el dato que necesita
                            para pedir la autorización del adulto. */}
                        {esMenor && (
                            <div className="rounded-2xl border border-warn/40 bg-warn/5 p-3 text-xs text-muted-foreground">
                                Según la fecha cargada sos menor de 18 años. Esta solicitud la tiene
                                que hacer o autorizar tu madre, padre o tutor, y el profesor se lo va
                                a pedir antes de activar la cuenta.
                            </div>
                        )}

                        <div className="rounded-2xl border border-border bg-secondary/40 p-3">
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                Estos datos los recibe{' '}
                                <span className="font-semibold text-foreground">
                                    {nombreGimnasio || 'el gimnasio'}
                                </span>{' '}
                                para armar tu ficha, contactarte y administrar tu cuota. No se
                                comparten con nadie más ni se usan para publicidad. Para ver,
                                corregir o borrar tus datos en cualquier momento, alcanza con
                                pedírselo al profesor.
                            </p>
                            <label className="mt-3 flex items-start gap-3 text-xs">
                                <input
                                    type="checkbox"
                                    checked={conforme}
                                    onChange={(e) => {
                                        setConforme(e.target.checked);
                                        if (e.target.checked) setError('');
                                    }}
                                    className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                                />
                                <span>Leí lo de arriba y estoy de acuerdo con que se usen mis datos.</span>
                            </label>
                        </div>

                        {error && <ErrorBox>{error}</ErrorBox>}

                        <Btn type="submit" disabled={loading || !conforme} className="w-full py-3">
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
