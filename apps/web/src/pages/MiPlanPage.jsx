import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Dumbbell, Loader2, Play, Printer } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { ThemeToggle } from '@/components/AppLayout';

// Mensajes literales que devuelve la RPC ver_plan_por_codigo (migración
// 0006_acceso_alumno_por_codigo.sql). Comparamos con una regex laxa en vez
// de igualdad estricta para no depender de mayúsculas exactas, pero seguimos
// siendo específicos: cualquier otro error de Postgres cae al mensaje
// genérico de abajo, nunca se le muestra el texto crudo al alumno.
const esCodigoInvalido = (msg = '') => /codigo de acceso invalido/i.test(msg);
const esRateLimit = (msg = '') => /demasiadas consultas/i.test(msg);

// Logo del gimnasio con el mismo criterio de fallback que GimnasioMark
// (AppLayout.jsx): si la imagen no carga (link roto, etc.) cae a un ícono
// genérico en vez de romper el header. No se reusa GimnasioMark tal cual
// porque ese componente lee el logo de useAuth() — acá no hay sesión, el
// dato viene de la propia RPC pública.
const LogoGimnasio = ({ nombre, logoUrl }) => {
    const [imgFailed, setImgFailed] = useState(false);
    if (logoUrl && !imgFailed) {
        return (
            <img
                src={logoUrl}
                alt={nombre || 'Logo del gimnasio'}
                onError={() => setImgFailed(true)}
                className="h-14 w-14 shrink-0 rounded-2xl border border-border object-contain sm:h-16 sm:w-16"
            />
        );
    }
    return (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 sm:h-16 sm:w-16">
            <Dumbbell className="h-7 w-7 text-primary sm:h-8 sm:w-8" strokeWidth={2.2} />
        </span>
    );
};

// Dato de ejercicio (series/reps/peso/descanso): etiqueta legible + valor
// bien grande, pensado para leerse de un vistazo en un celular sin anteojos.
const DatoEjercicio = ({ label, valor }) => (
    <div className="rounded-xl bg-secondary p-3 text-center">
        <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-extrabold sm:text-3xl">{valor}</p>
    </div>
);

const EstadoVacio = ({ children }) => (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-lg text-muted-foreground">
        {children}
    </div>
);

// Reglas de impresión, encapsuladas acá porque son exclusivas de esta
// pantalla — meterlas en index.css ensuciaría el CSS global compartido por
// el resto de la app con reglas de una sola página. En vez de forzar
// "color: black" clase por clase (lo que también apagaría el rojo de marca
// en los botones), se sobreescriben directamente las custom properties de
// color en el propio contenedor de la página: como toda la paleta de la app
// ya sale de esas variables (bg-background, text-foreground, etc. vía
// index.css), alcanza con "apagar" el modo oscuro acá para que el árbol
// entero quede legible en papel/PDF sin tocar ninguna clase Tailwind.
const ESTILOS_IMPRESION = `
@media print {
  .mp-no-imprimir {
    display: none !important;
  }
  .mp-pagina {
    --background: 0 0% 100%;
    --foreground: 0 0% 8%;
    --card: 0 0% 98%;
    --card-foreground: 0 0% 8%;
    --border: 0 0% 82%;
    --muted-foreground: 0 0% 28%;
  }
  .mp-evitar-corte {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`;

const MiPlanPage = () => {
    const { codigo } = useParams();
    const [plan, setPlan] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Se llama una sola vez al montar (o si cambia el código de la URL):
    // esta pantalla no tiene sesión ni refresco automático, es un "ver y listo".
    useEffect(() => {
        let cancelado = false;
        setLoading(true);
        setError('');
        setPlan(null);
        supabase
            .rpc('ver_plan_por_codigo', { p_codigo: codigo })
            .then(({ data, error: err }) => {
                if (cancelado) return;
                if (err) throw err;
                // La RPC devuelve una sola fila; según cómo esté tipada en el
                // SQL, supabase-js puede envolverla en un array de un
                // elemento o devolverla directo como objeto — cubrimos los
                // dos casos en vez de asumir uno solo.
                const fila = Array.isArray(data) ? data[0] : data;
                if (!fila) throw new Error('Codigo de acceso invalido');
                setPlan(fila);
            })
            .catch((err) => {
                if (cancelado) return;
                const msg = err?.message || '';
                if (esCodigoInvalido(msg)) {
                    setError('Este código no es válido o ya no está activo. Pedile a tu profe un código nuevo.');
                } else if (esRateLimit(msg)) {
                    setError('Demasiadas consultas en poco tiempo. Probá de nuevo en unos minutos.');
                } else {
                    setError('No pudimos cargar tu plan en este momento. Probá de nuevo más tarde.');
                }
            })
            .finally(() => {
                if (!cancelado) setLoading(false);
            });
        return () => {
            cancelado = true;
        };
    }, [codigo]);

    const porDia = useMemo(() => {
        const map = {};
        (plan?.rutina_items || []).forEach((it) => {
            map[it.dia] = map[it.dia] || [];
            map[it.dia].push(it);
        });
        return map;
    }, [plan]);

    const porComida = useMemo(() => {
        const map = {};
        (plan?.plan_items || []).forEach((it) => {
            map[it.comida] = map[it.comida] || [];
            map[it.comida].push(it);
        });
        return map;
    }, [plan]);

    const tieneRutina = !!plan?.rutina_nombre;
    const tienePlan = !!plan?.plan_nombre;

    return (
        <div className="mp-pagina min-h-[100dvh] bg-background text-foreground">
            <style>{ESTILOS_IMPRESION}</style>
            <Helmet>
                <title>
                    {plan?.alumno_nombre ? `Tu plan | ${plan.alumno_nombre}` : 'Tu plan de entrenamiento'}
                </title>
                <meta
                    name="description"
                    content="Rutina de entrenamiento y plan de alimentación, sin necesidad de usuario ni contraseña."
                />
            </Helmet>

            {loading && (
                <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden="true" />
                    <p className="text-xl font-semibold">Cargando tu plan...</p>
                </div>
            )}

            {!loading && error && (
                <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
                        <AlertTriangle className="h-8 w-8 text-primary" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <p className="max-w-sm text-xl font-bold">{error}</p>
                </div>
            )}

            {!loading && !error && plan && (
                <>
                    <header className="border-b border-border bg-card px-4 py-5 sm:px-6">
                        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <LogoGimnasio nombre={plan.gimnasio_nombre} logoUrl={plan.gimnasio_logo_url} />
                                <p className="truncate text-lg font-extrabold uppercase tracking-tight sm:text-xl">
                                    {plan.gimnasio_nombre || 'Tu gimnasio'}
                                </p>
                            </div>
                            <div className="mp-no-imprimir shrink-0">
                                <ThemeToggle />
                            </div>
                        </div>
                    </header>

                    <main className="mx-auto max-w-2xl space-y-10 px-4 py-8 sm:px-6">
                        <section className="space-y-4 text-center sm:text-left">
                            <h1 className="font-display text-3xl font-extrabold leading-tight sm:text-4xl">
                                Hola, {plan.alumno_nombre}
                            </h1>
                            <p className="text-lg text-muted-foreground">
                                Acá tenés tu rutina y tu plan de alimentación.
                            </p>
                            <button
                                type="button"
                                onClick={() => window.print()}
                                className="mp-no-imprimir inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-primary px-6 py-4 text-lg font-bold text-primary-foreground transition active:scale-[0.98] sm:w-auto"
                            >
                                <Printer className="h-6 w-6" aria-hidden="true" /> Descargar / Imprimir
                            </button>
                        </section>

                        <section aria-labelledby="mp-rutina-titulo" className="space-y-5">
                            <h2 id="mp-rutina-titulo" className="font-display text-2xl font-extrabold uppercase">
                                Tu rutina
                            </h2>

                            {!tieneRutina ? (
                                <EstadoVacio>
                                    Todavía no tenés una rutina cargada, pedísela a tu profe.
                                </EstadoVacio>
                            ) : (
                                <>
                                    <div className="rounded-2xl border border-border bg-card p-5">
                                        <p className="text-2xl font-bold">{plan.rutina_nombre}</p>
                                        {plan.rutina_descripcion && (
                                            <p className="mt-2 text-lg text-muted-foreground">{plan.rutina_descripcion}</p>
                                        )}
                                        {plan.rutina_duracion_semanas ? (
                                            <p className="mt-2 text-base text-muted-foreground">
                                                {plan.rutina_duracion_semanas} semana
                                                {plan.rutina_duracion_semanas === 1 ? '' : 's'}
                                            </p>
                                        ) : null}
                                    </div>

                                    {(plan.rutina_items || []).length === 0 ? (
                                        <EstadoVacio>Esta rutina todavía no tiene ejercicios cargados.</EstadoVacio>
                                    ) : (
                                        Object.entries(porDia).map(([dia, items]) => (
                                            <div key={dia} className="space-y-3">
                                                <h3 className="font-display text-xl font-bold uppercase text-primary">
                                                    {dia}
                                                </h3>
                                                <div className="space-y-3">
                                                    {items.map((it) => (
                                                        <article
                                                            key={it.key}
                                                            className="mp-evitar-corte rounded-2xl border border-border bg-card p-5"
                                                        >
                                                            <p className="text-xl font-bold sm:text-2xl">{it.nombre}</p>
                                                            {it.grupo && (
                                                                <p className="mt-0.5 text-base text-muted-foreground">
                                                                    {it.grupo}
                                                                </p>
                                                            )}
                                                            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                                                <DatoEjercicio label="Series" valor={it.series} />
                                                                <DatoEjercicio label="Reps" valor={it.reps} />
                                                                <DatoEjercicio label="Peso" valor={it.peso || '—'} />
                                                                <DatoEjercicio
                                                                    label="Descanso"
                                                                    valor={it.descanso || '—'}
                                                                />
                                                            </div>
                                                            {it.mediaUrl && (
                                                                <a
                                                                    href={it.mediaUrl}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="mp-no-imprimir mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary px-5 py-3 text-lg font-bold text-primary transition active:scale-[0.98] sm:w-auto"
                                                                >
                                                                    <Play className="h-5 w-5" aria-hidden="true" /> Ver
                                                                    cómo se hace
                                                                </a>
                                                            )}
                                                        </article>
                                                    ))}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </>
                            )}
                        </section>

                        <section aria-labelledby="mp-alimentacion-titulo" className="space-y-5">
                            <h2 id="mp-alimentacion-titulo" className="font-display text-2xl font-extrabold uppercase">
                                Tu plan de alimentación
                            </h2>

                            {!tienePlan ? (
                                <EstadoVacio>
                                    Todavía no tenés un plan de alimentación cargado, pedíselo a tu profe.
                                </EstadoVacio>
                            ) : (
                                <>
                                    <div className="rounded-2xl border border-border bg-card p-5">
                                        <p className="text-2xl font-bold">{plan.plan_nombre}</p>
                                        {plan.plan_notas && (
                                            <p className="mt-2 text-lg text-muted-foreground">{plan.plan_notas}</p>
                                        )}
                                    </div>

                                    {(plan.plan_items || []).length === 0 ? (
                                        <EstadoVacio>Este plan todavía no tiene alimentos cargados.</EstadoVacio>
                                    ) : (
                                        Object.entries(porComida).map(([comida, items]) => (
                                            <div key={comida} className="mp-evitar-corte space-y-3">
                                                <h3 className="font-display text-xl font-bold uppercase text-primary">
                                                    {comida}
                                                </h3>
                                                <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                                                    {items.map((it) => (
                                                        <li
                                                            key={it.key}
                                                            className="flex items-center justify-between gap-3 p-5"
                                                        >
                                                            <span className="text-xl font-semibold">{it.nombre}</span>
                                                            <span className="shrink-0 text-lg font-bold text-muted-foreground">
                                                                {it.cantidad} {it.unidad || ''}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))
                                    )}
                                </>
                            )}
                        </section>
                    </main>
                </>
            )}
        </div>
    );
};

export default MiPlanPage;
