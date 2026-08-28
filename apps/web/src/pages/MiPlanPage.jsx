import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Download, Dumbbell, Loader2, Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { ThemeToggle } from '@/components/AppLayout';

// El campo "descanso" de cada ejercicio es texto libre que escribe el profe
// ("90 s", "1:30", "2 min", "60"...), no un número — así que hay que
// interpretarlo para poder arrancar el cronómetro. Si no se entiende, se
// devuelve null y el botón de descanso simplemente no aparece: preferimos no
// mostrar el cronómetro antes que mostrar una cuenta regresiva equivocada.
const parsearDescanso = (texto) => {
    if (!texto) return null;
    const t = String(texto).trim().toLowerCase();

    // Formato mm:ss ("1:30")
    const mmss = t.match(/^(\d+)\s*:\s*(\d{1,2})$/);
    if (mmss) {
        const segundos = Number(mmss[1]) * 60 + Number(mmss[2]);
        return segundos > 0 && segundos <= 3600 ? segundos : null;
    }

    const num = t.match(/(\d+(?:[.,]\d+)?)/);
    if (!num) return null;
    const valor = Number(num[1].replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) return null;

    // "2 min"/"2m" son minutos; "90 s"/"90" son segundos. Se pide que
    // aparezca una "m" para tratarlo como minutos, así "90 s" no se
    // malinterpreta.
    const esMinutos = /m/.test(t);
    const segundos = Math.round(esMinutos ? valor * 60 : valor);
    return segundos > 0 && segundos <= 3600 ? segundos : null;
};

const formatearMmSs = (segundos) => {
    const m = Math.floor(segundos / 60);
    const s = segundos % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

// Beep sintetizado con Web Audio API en vez de un archivo de audio: cero
// peso extra, cero request, y funciona igual sin conexión. Envuelto en
// try/catch porque algunos navegadores exigen una interacción previa del
// usuario para permitir audio — si falla, el aviso por vibración (más abajo)
// alcanza igual.
const reproducirBeep = () => {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.55);
    } catch (_) {
        // sin sonido, sigue la vibración si el dispositivo la soporta
    }
};

// Cronómetro de descanso entre series. Basado en un timestamp objetivo
// (Date.now() + duración) en vez de simplemente restar 1 en cada tick: un
// setInterval de "restar 1 por segundo" se atrasa si el celular pone la
// pestaña en segundo plano (el navegador enlentece los timers), y acá el
// alumno bien puede bloquear el teléfono mientras descansa. Comparando
// siempre contra el reloj real, al volver a abrir la pantalla el cronómetro
// muestra el tiempo que pasó de verdad, no el que el timer alcanzó a contar.
const CronometroModal = ({ duracionInicial, onClose }) => {
    const [restante, setRestante] = useState(duracionInicial);
    const [corriendo, setCorriendo] = useState(true);
    const finRef = useRef(Date.now() + duracionInicial * 1000);
    const avisadoRef = useRef(false);

    useEffect(() => {
        if (!corriendo) return undefined;
        const id = setInterval(() => {
            const seg = Math.max(0, Math.ceil((finRef.current - Date.now()) / 1000));
            setRestante(seg);
            if (seg <= 0 && !avisadoRef.current) {
                avisadoRef.current = true;
                reproducirBeep();
                if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300]);
            }
        }, 250);
        return () => clearInterval(id);
    }, [corriendo]);

    const pausarOReanudar = () => {
        if (corriendo) {
            setCorriendo(false);
        } else {
            finRef.current = Date.now() + restante * 1000;
            avisadoRef.current = restante <= 0;
            setCorriendo(true);
        }
    };

    const reiniciar = () => {
        finRef.current = Date.now() + duracionInicial * 1000;
        avisadoRef.current = false;
        setRestante(duracionInicial);
        setCorriendo(true);
    };

    const terminado = restante <= 0;
    const porcentaje = Math.min(
        100,
        Math.round(((duracionInicial - restante) / duracionInicial) * 100),
    );

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Cronómetro de descanso"
            className="mp-no-imprimir fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
            <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-xl">
                <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                        Tiempo de descanso
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar cronómetro"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>

                <p
                    className={`font-display text-7xl font-extrabold tabular-nums ${
                        terminado ? 'text-primary' : 'text-foreground'
                    }`}
                >
                    {formatearMmSs(restante)}
                </p>

                <p className="mt-3 text-lg font-bold text-primary">
                    {terminado ? '¡Descanso terminado!' : corriendo ? 'Contando...' : 'En pausa'}
                </p>

                <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${porcentaje}%` }}
                    />
                </div>

                <div className="mt-6 flex gap-3">
                    <button
                        type="button"
                        onClick={pausarOReanudar}
                        disabled={terminado}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-lg font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-40"
                    >
                        {corriendo ? (
                            <>
                                <Pause className="h-5 w-5" aria-hidden="true" /> Pausar
                            </>
                        ) : (
                            <>
                                <Play className="h-5 w-5" aria-hidden="true" /> Seguir
                            </>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={reiniciar}
                        aria-label="Reiniciar cronómetro"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-border px-5 py-4 text-lg font-bold transition active:scale-[0.98]"
                    >
                        <RotateCcw className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    );
};

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
  /* El alumno puede descargar la rutina y el plan de comida por separado
     (cada uno en su propio PDF, no uno solo con todo junto) — al imprimir
     con data-imprimiendo="rutina" se oculta la sección de alimentación y
     viceversa, dejando el saludo/header igual en los dos casos. Fuera de
     @media print esto no hace nada: en pantalla siempre se ven las dos. */
  .mp-pagina[data-imprimiendo='rutina'] .mp-seccion-alimentacion {
    display: none !important;
  }
  .mp-pagina[data-imprimiendo='alimentacion'] .mp-seccion-rutina {
    display: none !important;
  }
}
`;

const MiPlanPage = () => {
    const { codigo } = useParams();
    const [plan, setPlan] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // { duracion, id } del cronómetro activo, o null si está cerrado. El id
    // incremental (no solo la duración) es a propósito: si dos ejercicios
    // comparten el mismo descanso ("90 s" los dos) y se pide el segundo
    // mientras el primero sigue contando, la duración por sí sola no cambia
    // -React no re-renderiza con un valor de estado idéntico- y el
    // cronómetro viejo seguiría mostrando su cuenta a mitad de camino en vez
    // de arrancar de nuevo.
    const [cronometro, setCronometro] = useState(null);
    const cronometroIdRef = useRef(0);
    // 'rutina' | 'alimentacion' | null. Controla qué sección queda visible
    // a la hora de imprimir (ver ESTILOS_IMPRESION) — así "Descargar rutina"
    // y "Descargar plan de comida" arman cada uno su propio PDF con solo lo
    // que corresponde, en vez de un único PDF con todo mezclado.
    const [imprimiendoSeccion, setImprimiendoSeccion] = useState(null);

    // 'afterprint' es un evento estándar del navegador que se dispara al
    // cerrarse el diálogo de impresión, se haya guardado el PDF o
    // cancelado — se usa para "soltar" el filtro de sección después, sin
    // adivinar con un timeout cuánto tarda el usuario en elegir. Es solo
    // prolijidad (deja el estado en null cuando ya no hace falta): NO es lo
    // que dispara la impresión en sí, ver descargarSeccion() más abajo.
    useEffect(() => {
        const soltar = () => setImprimiendoSeccion(null);
        window.addEventListener('afterprint', soltar);
        return () => window.removeEventListener('afterprint', soltar);
    }, []);

    // Fija qué sección queda visible para imprimir y recién AHÍ llama a
    // print() — nunca desde un useEffect enganchado al valor de
    // imprimiendoSeccion. Motivo: si 'afterprint' no llegara a dispararse en
    // algún navegador (pasa en algunas versiones de iOS), el estado
    // quedaría trabado en, por ejemplo, 'rutina'; un useEffect por-valor no
    // volvería a dispararse si el alumno aprieta "Descargar en PDF" de la
    // rutina una segunda vez (mismo valor = sin cambio = sin efecto). Acá,
    // en cambio, cada clic llama a print() de nuevo sin importar el valor
    // anterior. requestAnimationFrame espera al frame siguiente para que el
    // atributo data-imprimiendo ya esté aplicado en el DOM antes de abrir el
    // diálogo — si se llamara print() en el mismo tick, se arriesga a
    // capturar el DOM de ANTES de ocultar la otra sección.
    const descargarSeccion = (seccion) => {
        setImprimiendoSeccion(seccion);
        requestAnimationFrame(() => window.print());
    };

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
        <div
            className="mp-pagina min-h-[100dvh] bg-background text-foreground"
            data-imprimiendo={imprimiendoSeccion || undefined}
        >
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
                        </section>

                        <section aria-labelledby="mp-rutina-titulo" className="mp-seccion-rutina space-y-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h2 id="mp-rutina-titulo" className="font-display text-2xl font-extrabold uppercase">
                                    Tu rutina
                                </h2>
                                {tieneRutina && (
                                    <button
                                        type="button"
                                        onClick={() => descargarSeccion('rutina')}
                                        className="mp-no-imprimir inline-flex items-center justify-center gap-2 rounded-xl border-2 border-primary px-4 py-2.5 text-base font-bold text-primary transition active:scale-[0.98]"
                                    >
                                        <Download className="h-5 w-5" aria-hidden="true" /> Descargar en PDF
                                    </button>
                                )}
                            </div>

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
                                                    {items.map((it) => {
                                                        const descansoSeg = parsearDescanso(it.descanso);
                                                        return (
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
                                                                <div className="mp-no-imprimir mt-4 flex flex-col gap-3 sm:flex-row">
                                                                    {it.mediaUrl && (
                                                                        <a
                                                                            href={it.mediaUrl}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary px-5 py-3 text-lg font-bold text-primary transition active:scale-[0.98] sm:w-auto"
                                                                        >
                                                                            <Play className="h-5 w-5" aria-hidden="true" />{' '}
                                                                            Ver cómo se hace
                                                                        </a>
                                                                    )}
                                                                    {descansoSeg && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                cronometroIdRef.current += 1;
                                                                                setCronometro({
                                                                                    duracion: descansoSeg,
                                                                                    id: cronometroIdRef.current,
                                                                                });
                                                                            }}
                                                                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-secondary px-5 py-3 text-lg font-bold transition active:scale-[0.98] sm:w-auto"
                                                                        >
                                                                            <Timer className="h-5 w-5" aria-hidden="true" />{' '}
                                                                            Iniciar descanso
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </article>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </>
                            )}
                        </section>

                        <section
                            aria-labelledby="mp-alimentacion-titulo"
                            className="mp-seccion-alimentacion space-y-5"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h2
                                    id="mp-alimentacion-titulo"
                                    className="font-display text-2xl font-extrabold uppercase"
                                >
                                    Tu plan de alimentación
                                </h2>
                                {tienePlan && (
                                    <button
                                        type="button"
                                        onClick={() => descargarSeccion('alimentacion')}
                                        className="mp-no-imprimir inline-flex items-center justify-center gap-2 rounded-xl border-2 border-primary px-4 py-2.5 text-base font-bold text-primary transition active:scale-[0.98]"
                                    >
                                        <Download className="h-5 w-5" aria-hidden="true" /> Descargar en PDF
                                    </button>
                                )}
                            </div>

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

                    {cronometro !== null && (
                        <CronometroModal
                            key={cronometro.id}
                            duracionInicial={cronometro.duracion}
                            onClose={() => setCronometro(null)}
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default MiPlanPage;
