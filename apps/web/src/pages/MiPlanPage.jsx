import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useParams } from 'react-router-dom';
import {
    AlertTriangle,
    Download,
    Dumbbell,
    Lock,
    Loader2,
    Megaphone,
    Pause,
    Play,
    RotateCcw,
    Timer,
    Wallet,
    X,
} from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { ThemeToggle } from '@/components/AppLayout';
import { agruparCombos, agruparItemsRutina, agruparPorBloque, armarTextoAlimentos } from '@/lib/format';
import { aplicarColorGimnasio } from '@/lib/colorTema';
import { ESTILOS_IMPRESION_RUTINA, RutinaImprimiblePDF, esperarImagenesCargadas } from '@/components/RutinaPDF';
import { ESTILOS_IMPRESION_ALIMENTACION, PlanAlimentacionImprimiblePDF } from '@/components/PlanAlimentacionPDF';

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

// "Ver cómo se hace" abría el archivo en otra pestaña — en el celular, sin
// una barra de pestañas visible, el alumno no encontraba cómo volver a la
// app (reportado por Nalux). Para un archivo propio (subido al bucket
// ejercicios-media, mismo criterio que EjerciciosPage.jsx) alcanza con
// mostrarlo adentro en un modal — nunca hay pestaña de la que volver. Un
// link externo (YouTube, Vimeo...) sigue abriendo aparte, porque no hay
// forma simple y confiable de embeberlo acá.
const EXTENSIONES_VIDEO = ['mp4', 'webm', 'mov'];
const EXTENSIONES_IMAGEN = ['png', 'jpg', 'jpeg', 'webp'];

const esArchivoPropio = (url) => (url || '').includes('/object/public/ejercicios-media/');

const extensionDe = (url) => {
    const limpio = (url || '').split('?')[0].split('#')[0];
    const m = limpio.match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : null;
};

// null = no hay preview posible acá (el botón usa el link externo tal cual).
const tipoDePreview = (mediaUrl) => {
    if (!esArchivoPropio(mediaUrl)) return null;
    const ext = extensionDe(mediaUrl);
    if (EXTENSIONES_VIDEO.includes(ext)) return 'video';
    if (EXTENSIONES_IMAGEN.includes(ext)) return 'imagen';
    return null;
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
    const porcentaje = Math.min(100, Math.round(((duracionInicial - restante) / duracionInicial) * 100));

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

// Preview de la demostración de un ejercicio (video o imagen), mostrada
// adentro de la app en vez de mandar al alumno a otra pestaña. Mismo
// criterio visual que CronometroModal de arriba (overlay fijo, tarjeta
// redondeada, botón de cerrar arriba a la derecha).
//
// max-h-[70vh] + w-auto en vez de w-full: un video vertical (grabado con
// el celular) se veía gigante con w-full porque la altura escalaba libre
// en proporción a ese ancho fijo. Así el navegador elige el tamaño que
// entra a la vez en el ancho de la tarjeta Y en el alto de la pantalla,
// tanto en celular como en computadora — funciona igual para fotos.
const PreviewMediaModal = ({ nombre, url, tipo, onClose }) => (
    <div
        role="dialog"
        aria-modal="true"
        aria-label={`Demostración de ${nombre}`}
        className="mp-no-imprimir fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
        <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <p className="truncate text-lg font-bold">{nombre}</p>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Cerrar demostración"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border"
                >
                    <X className="h-5 w-5" aria-hidden="true" />
                </button>
            </div>
            {tipo === 'video' ? (
                <video
                    src={url}
                    controls
                    autoPlay
                    playsInline
                    className="mx-auto h-auto max-h-[70vh] w-auto max-w-full rounded-2xl bg-black"
                />
            ) : (
                <img
                    src={url}
                    alt={`Demostración de ${nombre}`}
                    className="mx-auto h-auto max-h-[70vh] w-auto max-w-full rounded-2xl"
                />
            )}
        </div>
    </div>
);

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

// Botón/link de "Ver demostración" de un ejercicio. Se reusa tal cual para
// un ejercicio suelto y, dentro de un combo (superserie), una vez por cada
// ejercicio que la tenga -- mostrarNombre distingue el segundo caso, porque
// ahí hace falta aclarar de cuál de los dos es la demostración.
const BotonVerDemo = ({ item, mostrarNombre, onPreview }) => {
    const clase =
        'inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary px-5 py-3 text-lg font-bold text-primary transition active:scale-[0.98] sm:w-auto';
    const texto = mostrarNombre ? `Ver ${item.nombre}` : 'Ver cómo se hace';
    return tipoDePreview(item.mediaUrl) ? (
        <button type="button" onClick={() => onPreview(item)} className={clase}>
            <Play className="h-5 w-5" aria-hidden="true" /> {texto}
        </button>
    ) : (
        <a href={item.mediaUrl} target="_blank" rel="noreferrer" className={clase}>
            <Play className="h-5 w-5" aria-hidden="true" /> {texto}
        </a>
    );
};

// ---------------------------------------------------------------------------
// PDF de rutina y de plan de alimentación: Nalux trajo dos ejemplos armados
// aparte (tablas compactas por bloque, "Series x Reps" combinado; comidas
// numeradas con opciones en viñetas) y pidió que el PDF se vea así. Antes
// esta pantalla imprimía el mismo DOM que se ve en pantalla (tarjetas
// grandes, cajas de colores) apagando el modo oscuro con variables CSS —
// ahora una hoja de impresión DEDICADA, montada aparte, que nunca se ve en
// pantalla (ver ESTILOS_IMPRESION_RUTINA/ESTILOS_IMPRESION_ALIMENTACION,
// mismo truco de visibility en vez de display:none para no romper el layout
// del resto de la página). Los dos PDF (EncabezadoPDF/RutinaImprimiblePDF y
// PlanAlimentacionImprimiblePDF) se separaron a components/RutinaPDF.jsx y
// components/PlanAlimentacionPDF.jsx (03 y 04/09/2026) para reusarlos
// también desde RutinasPage.jsx/AlumnoPage.jsx -- acá ya no queda nada
// propio del PDF, solo dónde se montan más abajo.
// ---------------------------------------------------------------------------

const EstadoVacio = ({ children }) => (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-lg text-muted-foreground">
        {children}
    </div>
);

// Cuota vencida + política "restringir" (Configuración, migración 0021).
// Distinto de EstadoVacio a propósito: acá SÍ hay contenido cargado, solo
// que no se manda mientras deba -- el mensaje tiene que dejar eso claro,
// no sonar a "todavía no te cargaron nada". Cada sección (rutina, plan de
// comidas) se restringe por separado -- pueden estar en estados distintos
// según lo que el profesor haya tildado en Configuración.
const EstadoRestringido = ({ gimnasioNombre }) => (
    <div className="flex items-start gap-3 rounded-2xl border-2 border-warn bg-warn/10 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warn/20">
            <Lock className="h-6 w-6 text-warn" strokeWidth={2.2} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
            <p className="text-xl font-extrabold">En pausa por cuota vencida</p>
            <p className="mt-2 text-lg text-foreground">
                Pasá por {gimnasioNombre || 'el gimnasio'} para renovarla y volver a verlo.
            </p>
        </div>
    </div>
);

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
    // Ejercicio cuya demostración se está mostrando en el modal de preview
    // ("Ver cómo se hace"), o null si está cerrado.
    const [previewItem, setPreviewItem] = useState(null);
    // 'rutina' | 'alimentacion' | null. Controla qué sección queda visible
    // a la hora de imprimir (ver ESTILOS_IMPRESION_RUTINA/
    // ESTILOS_IMPRESION_ALIMENTACION) — así "Descargar rutina" y "Descargar
    // plan de comida" arman cada uno su propio PDF con solo lo que
    // corresponde, en vez de un único PDF con todo mezclado.
    const [imprimiendoSeccion, setImprimiendoSeccion] = useState(null);
    // Cartel de aviso (Bloque G6): "Entendido" se resuelve 100% client-side
    // sin recargar la página. avisoOculto es un estado APARTE de `plan` (no
    // se muta plan.aviso_id) para no tener que reconstruir el objeto entero
    // que ya viene tal cual de la RPC.
    const [avisoOculto, setAvisoOculto] = useState(false);
    const [marcandoAviso, setMarcandoAviso] = useState(false);
    const [avisoError, setAvisoError] = useState('');

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

    // Fija qué hoja de impresión queda montada y recién AHÍ llama a print()
    // — nunca desde un useEffect enganchado al valor de imprimiendoSeccion.
    // Motivo: si 'afterprint' no llegara a dispararse en algún navegador
    // (pasa en algunas versiones de iOS), el estado quedaría trabado en, por
    // ejemplo, 'rutina'; un useEffect por-valor no volvería a dispararse si
    // el alumno aprieta "Descargar en PDF" de la rutina una segunda vez
    // (mismo valor = sin cambio = sin efecto). Acá, en cambio, cada clic
    // llama a print() de nuevo sin importar el valor anterior.
    // requestAnimationFrame espera al frame siguiente para que React ya haya
    // montado la hoja (RutinaImprimiblePDF/PlanAlimentacionImprimiblePDF) en
    // el DOM antes de abrir el diálogo — si se llamara print() en el mismo
    // tick, se arriesga a capturar el DOM de antes de que aparezca.
    // Además de esperar al frame siguiente, se espera a que el logo del
    // gimnasio (EncabezadoPDF, en las dos hojas) termine de cargar antes de
    // imprimir -- si no, la imagen recién montada puede no estar lista
    // todavía y el logo sale en blanco (reportado por Nalux, 03/09/2026).
    const descargarSeccion = (seccion) => {
        setImprimiendoSeccion(seccion);
        requestAnimationFrame(async () => {
            await esperarImagenesCargadas('.rutina-pdf-hoja img, .alimentacion-pdf-hoja img');
            window.print();
        });
    };

    // El alumno toca "Entendido" en el cartel de aviso (Bloque G6). Sin
    // sesión, así que se llama con el mismo código de la URL -- la RPC
    // valida server-side que el aviso sea del mismo gimnasio antes de
    // insertar en notificaciones_leidas (0007). Manejo de error
    // silencioso-pero-honesto: si falla, no rompe la pantalla ni deja el
    // botón colgado -- el cartel simplemente sigue visible (se lo vuelve a
    // mostrar la próxima vez, no es grave) con un aviso corto de que no se
    // guardó.
    const marcarAvisoLeido = async () => {
        if (!plan?.aviso_id) return;
        setMarcandoAviso(true);
        setAvisoError('');
        try {
            const { error: err } = await supabase.rpc('marcar_notificacion_leida', {
                p_codigo: codigo,
                p_notificacion_id: plan.aviso_id,
            });
            if (err) throw err;
            setAvisoOculto(true);
        } catch (_) {
            setAvisoError('No se pudo guardar. No es grave, se puede seguir usando la pantalla igual.');
        } finally {
            setMarcandoAviso(false);
        }
    };

    // Pinta esta pantalla también con el color del gimnasio -- antes solo se
    // usaba en el PDF, la pantalla en vivo se quedaba siempre en el rojo de
    // fábrica. AuthContext hace lo mismo para el lado del profesor; acá no
    // hay sesión (AuthProvider ve profile=null y ya resetea al default apenas
    // monta), así que hace falta este efecto aparte con el color que trae la
    // propia RPC.
    useEffect(() => {
        aplicarColorGimnasio(plan?.gimnasio_color_principal);
    }, [plan?.gimnasio_color_principal]);

    // Se llama una sola vez al montar (o si cambia el código de la URL):
    // esta pantalla no tiene sesión ni refresco automático, es un "ver y listo".
    useEffect(() => {
        let cancelado = false;
        setLoading(true);
        setError('');
        setPlan(null);
        setAvisoOculto(false);
        setAvisoError('');
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
                    setError(
                        'Este código no es válido o ya no está activo. Pedir al profesor un código nuevo.',
                    );
                } else if (esRateLimit(msg)) {
                    setError('Demasiadas consultas en poco tiempo. Intentar de nuevo en unos minutos.');
                } else {
                    setError('No se pudo cargar el plan en este momento. Intentar de nuevo más tarde.');
                }
            })
            .finally(() => {
                if (!cancelado) setLoading(false);
            });
        return () => {
            cancelado = true;
        };
    }, [codigo]);

    // Agrupada por semana y día con el mismo helper que usa el profe, para
    // que el alumno vea exactamente la estructura que se armó. Si la rutina
    // usa una sola semana (el caso normal), no se muestra ningún encabezado
    // de semana: la pantalla queda igual de simple que antes.
    const grupos = useMemo(() => agruparItemsRutina(plan?.rutina_items || []), [plan]);
    const variasSemanas = grupos.length > 1;

    // Un renglón por observación (textarea multilínea en el armador) ->
    // una lista de viñetas acá. Filtra líneas en blanco por si quedó algún
    // Enter de más al cargarlo.
    const observacionesPlan = useMemo(
        () =>
            (plan?.plan_notas || '')
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean),
        [plan],
    );

    const tieneRutina = !!plan?.rutina_nombre;
    const tienePlan = !!plan?.plan_nombre;

    return (
        <div className="mp-pagina min-h-[100dvh] bg-background text-foreground">
            <style>
                {ESTILOS_IMPRESION_RUTINA}
                {ESTILOS_IMPRESION_ALIMENTACION}
            </style>
            {imprimiendoSeccion === 'rutina' && (
                <RutinaImprimiblePDF
                    nombre={plan?.rutina_nombre}
                    items={plan?.rutina_items}
                    color={plan?.gimnasio_color_principal}
                    logoUrl={plan?.gimnasio_logo_url}
                    fechaInicio={plan?.rutina_fecha_inicio}
                    duracionSemanas={plan?.rutina_duracion_semanas}
                />
            )}
            {imprimiendoSeccion === 'alimentacion' && (
                <PlanAlimentacionImprimiblePDF
                    nombre={plan?.plan_nombre}
                    items={plan?.plan_items}
                    notas={plan?.plan_notas}
                    color={plan?.gimnasio_color_principal}
                    logoUrl={plan?.gimnasio_logo_url}
                    alumnoNombre={plan?.alumno_nombre}
                    fechaInicio={plan?.plan_fecha_inicio}
                    fechaFin={plan?.plan_fecha_fin}
                />
            )}
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
                                <LogoGimnasio
                                    nombre={plan.gimnasio_nombre}
                                    logoUrl={plan.gimnasio_logo_url}
                                />
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
                        {/* Recordatorio automático de cuota (migración 0015). A
                            diferencia del aviso manual de arriba, este NO tiene botón
                            "Entendido" ni se guarda en notificaciones_leidas: no existe
                            como fila, se arma solo en la RPC mientras la condición se
                            cumple, y desaparece solo cuando paga -- no hay nada que
                            "marcar como leído". */}
                        {plan.cuota_aviso_titulo && (
                            <section className="mp-no-imprimir rounded-2xl border-2 border-warn bg-warn/10 p-5 sm:p-6">
                                <div className="flex items-start gap-3">
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warn/20">
                                        <Wallet
                                            className="h-6 w-6 text-warn"
                                            strokeWidth={2.2}
                                            aria-hidden="true"
                                        />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xl font-extrabold sm:text-2xl">
                                            {plan.cuota_aviso_titulo}
                                        </p>
                                        <p className="mt-2 text-lg text-foreground">
                                            {plan.cuota_aviso_mensaje}
                                        </p>
                                    </div>
                                </div>
                            </section>
                        )}

                        {plan.aviso_id && !avisoOculto && (
                            <section
                                aria-live="polite"
                                className="mp-no-imprimir rounded-2xl border-2 border-primary bg-primary/10 p-5 sm:p-6"
                            >
                                <div className="flex items-start gap-3">
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/20">
                                        <Megaphone
                                            className="h-6 w-6 text-primary"
                                            strokeWidth={2.2}
                                            aria-hidden="true"
                                        />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xl font-extrabold sm:text-2xl">
                                            {plan.aviso_titulo}
                                        </p>
                                        <p className="mt-2 text-lg text-foreground">{plan.aviso_mensaje}</p>
                                    </div>
                                </div>
                                {avisoError && (
                                    <p className="mt-3 text-base font-semibold text-primary">{avisoError}</p>
                                )}
                                <button
                                    type="button"
                                    onClick={marcarAvisoLeido}
                                    disabled={marcandoAviso}
                                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-lg font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-60 sm:w-auto"
                                >
                                    {marcandoAviso ? 'Guardando...' : 'Entendido'}
                                </button>
                            </section>
                        )}

                        <section className="space-y-4 text-center sm:text-left">
                            <h1 className="font-display text-3xl font-extrabold leading-tight sm:text-4xl">
                                Hola, {plan.alumno_nombre}
                            </h1>
                            <p className="text-lg text-muted-foreground">
                                Acá está la rutina y el plan de alimentación.
                            </p>
                        </section>

                        <section aria-labelledby="mp-rutina-titulo" className="mp-seccion-rutina space-y-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h2
                                    id="mp-rutina-titulo"
                                    className="font-display text-2xl font-extrabold uppercase"
                                >
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

                            {plan.rutina_restringida ? (
                                <EstadoRestringido gimnasioNombre={plan.gimnasio_nombre} />
                            ) : !tieneRutina ? (
                                <EstadoVacio>
                                    Todavía no hay una rutina cargada, pedirla al profesor.
                                </EstadoVacio>
                            ) : (
                                <>
                                    <div className="rounded-2xl border border-border bg-card p-5">
                                        <p className="text-2xl font-bold">{plan.rutina_nombre}</p>
                                        {plan.rutina_descripcion && (
                                            <p className="mt-2 text-lg text-muted-foreground">
                                                {plan.rutina_descripcion}
                                            </p>
                                        )}
                                        {plan.rutina_duracion_semanas ? (
                                            <p className="mt-2 text-base text-muted-foreground">
                                                {plan.rutina_duracion_semanas} semana
                                                {plan.rutina_duracion_semanas === 1 ? '' : 's'}
                                            </p>
                                        ) : null}
                                    </div>

                                    {(plan.rutina_items || []).length === 0 ? (
                                        <EstadoVacio>
                                            Esta rutina todavía no tiene ejercicios cargados.
                                        </EstadoVacio>
                                    ) : (
                                        grupos.map(([nroSemana, dias]) => (
                                            <div key={nroSemana} className="space-y-4">
                                                {variasSemanas && (
                                                    <h3 className="rounded-2xl bg-secondary px-4 py-2 font-display text-lg font-bold uppercase">
                                                        Semana {nroSemana}
                                                    </h3>
                                                )}
                                                {dias.map(([dia, items]) => (
                                                    <div key={`${nroSemana}-${dia}`} className="space-y-3">
                                                        <h3 className="font-display text-xl font-bold uppercase text-primary">
                                                            {dia}
                                                        </h3>
                                                        {agruparPorBloque(agruparCombos(items)).map(
                                                            ([nombreBloque, delBloque], iBloque) => (
                                                                <div
                                                                    key={`${nombreBloque}-${iBloque}`}
                                                                    className="space-y-3"
                                                                >
                                                                    {nombreBloque && (
                                                                        <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground">
                                                                            {nombreBloque}
                                                                        </p>
                                                                    )}
                                                                    {delBloque.map((it) => {
                                                                        // Si el descanso quedó combinado ("60 s + 90 s"
                                                                        // porque los ejercicios del combo tienen
                                                                        // descansos distintos) no se ofrece el
                                                                        // cronómetro: sería ambiguo cuál de los dos usar.
                                                                        const descansoSeg =
                                                                            it.descanso?.includes(' + ')
                                                                                ? null
                                                                                : parsearDescanso(
                                                                                      it.descanso,
                                                                                  );
                                                                        return (
                                                                            <article
                                                                                key={it.key}
                                                                                className="mp-evitar-corte rounded-2xl border border-border bg-card p-5"
                                                                            >
                                                                                {it.esCombo ? (
                                                                                    <>
                                                                                        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-primary">
                                                                                            Superserie
                                                                                        </p>
                                                                                        <div className="flex items-stretch gap-1.5">
                                                                                            {it.comboItems.map(
                                                                                                (sub, i) => (
                                                                                                    <React.Fragment
                                                                                                        key={
                                                                                                            sub.key
                                                                                                        }
                                                                                                    >
                                                                                                        {i >
                                                                                                            0 && (
                                                                                                            <span
                                                                                                                className="flex shrink-0 items-center text-lg font-bold text-primary"
                                                                                                                aria-hidden="true"
                                                                                                            >
                                                                                                                +
                                                                                                            </span>
                                                                                                        )}
                                                                                                        <div className="min-w-0 flex-1 rounded-xl bg-secondary p-2">
                                                                                                            <p className="truncate text-sm font-bold leading-tight sm:text-base">
                                                                                                                {
                                                                                                                    sub.nombre
                                                                                                                }
                                                                                                            </p>
                                                                                                            {sub.grupo && (
                                                                                                                <p className="truncate text-xs text-muted-foreground">
                                                                                                                    {
                                                                                                                        sub.grupo
                                                                                                                    }
                                                                                                                </p>
                                                                                                            )}
                                                                                                            <div className="mt-2 space-y-0.5 text-sm">
                                                                                                                <p>
                                                                                                                    <span className="text-muted-foreground">
                                                                                                                        Series{' '}
                                                                                                                    </span>
                                                                                                                    <span className="font-bold">
                                                                                                                        {
                                                                                                                            sub.series
                                                                                                                        }
                                                                                                                    </span>
                                                                                                                </p>
                                                                                                                <p>
                                                                                                                    <span className="text-muted-foreground">
                                                                                                                        Reps{' '}
                                                                                                                    </span>
                                                                                                                    <span className="font-bold">
                                                                                                                        {
                                                                                                                            sub.reps
                                                                                                                        }
                                                                                                                    </span>
                                                                                                                </p>
                                                                                                                {sub.peso && (
                                                                                                                    <p>
                                                                                                                        <span className="text-muted-foreground">
                                                                                                                            Peso{' '}
                                                                                                                        </span>
                                                                                                                        <span className="font-bold">
                                                                                                                            {
                                                                                                                                sub.peso
                                                                                                                            }
                                                                                                                        </span>
                                                                                                                    </p>
                                                                                                                )}
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    </React.Fragment>
                                                                                                ),
                                                                                            )}
                                                                                        </div>
                                                                                        <p className="mt-3 text-base">
                                                                                            <span className="text-muted-foreground">
                                                                                                Descanso:{' '}
                                                                                            </span>
                                                                                            <span className="font-semibold">
                                                                                                {it.descanso ||
                                                                                                    '—'}
                                                                                            </span>
                                                                                        </p>
                                                                                    </>
                                                                                ) : (
                                                                                    <>
                                                                                        <p className="text-xl font-bold sm:text-2xl">
                                                                                            {it.nombre}
                                                                                        </p>
                                                                                        {it.grupo && (
                                                                                            <p className="mt-0.5 text-base text-muted-foreground">
                                                                                                {it.grupo}
                                                                                            </p>
                                                                                        )}
                                                                                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                                                                            <DatoEjercicio
                                                                                                label="Series"
                                                                                                valor={
                                                                                                    it.series
                                                                                                }
                                                                                            />
                                                                                            <DatoEjercicio
                                                                                                label="Reps"
                                                                                                valor={
                                                                                                    it.reps
                                                                                                }
                                                                                            />
                                                                                            <DatoEjercicio
                                                                                                label="Peso"
                                                                                                valor={
                                                                                                    it.peso ||
                                                                                                    '—'
                                                                                                }
                                                                                            />
                                                                                            <DatoEjercicio
                                                                                                label="Descanso"
                                                                                                valor={
                                                                                                    it.descanso ||
                                                                                                    '—'
                                                                                                }
                                                                                            />
                                                                                        </div>
                                                                                    </>
                                                                                )}
                                                                                {it.intensidad && (
                                                                                    <p className="mt-3 text-base">
                                                                                        <span className="text-muted-foreground">
                                                                                            Intensidad:{' '}
                                                                                        </span>
                                                                                        <span className="font-semibold">
                                                                                            {it.intensidad}
                                                                                        </span>
                                                                                    </p>
                                                                                )}
                                                                                {it.comentario && (
                                                                                    <p className="mt-3 rounded-xl border-2 border-primary/40 bg-primary/10 p-4 text-base">
                                                                                        {it.comentario}
                                                                                    </p>
                                                                                )}
                                                                                <div className="mp-no-imprimir mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                                                                                    {it.esCombo
                                                                                        ? it.comboItems
                                                                                              .filter(
                                                                                                  (sub) =>
                                                                                                      sub.mediaUrl,
                                                                                              )
                                                                                              .map((sub) => (
                                                                                                  <BotonVerDemo
                                                                                                      key={
                                                                                                          sub.key
                                                                                                      }
                                                                                                      item={
                                                                                                          sub
                                                                                                      }
                                                                                                      mostrarNombre
                                                                                                      onPreview={
                                                                                                          setPreviewItem
                                                                                                      }
                                                                                                  />
                                                                                              ))
                                                                                        : it.mediaUrl && (
                                                                                              <BotonVerDemo
                                                                                                  item={it}
                                                                                                  onPreview={
                                                                                                      setPreviewItem
                                                                                                  }
                                                                                              />
                                                                                          )}
                                                                                    {descansoSeg && (
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => {
                                                                                                cronometroIdRef.current += 1;
                                                                                                setCronometro(
                                                                                                    {
                                                                                                        duracion:
                                                                                                            descansoSeg,
                                                                                                        id: cronometroIdRef.current,
                                                                                                    },
                                                                                                );
                                                                                            }}
                                                                                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-secondary px-5 py-3 text-lg font-bold transition active:scale-[0.98] sm:w-auto"
                                                                                        >
                                                                                            <Timer
                                                                                                className="h-5 w-5"
                                                                                                aria-hidden="true"
                                                                                            />{' '}
                                                                                            Iniciar descanso
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            </article>
                                                                        );
                                                                    })}
                                                                </div>
                                                            ),
                                                        )}
                                                    </div>
                                                ))}
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

                            {plan.alimentacion_restringida ? (
                                <EstadoRestringido gimnasioNombre={plan.gimnasio_nombre} />
                            ) : !tienePlan ? (
                                <EstadoVacio>
                                    Todavía no hay un plan de alimentación cargado, pedirlo al profesor.
                                </EstadoVacio>
                            ) : (
                                <>
                                    <div className="rounded-2xl border border-border bg-card p-5">
                                        <p className="text-2xl font-bold">{plan.plan_nombre}</p>
                                    </div>

                                    {(plan.plan_items || []).length === 0 ? (
                                        <EstadoVacio>
                                            Este plan todavía no tiene comidas cargadas.
                                        </EstadoVacio>
                                    ) : (
                                        (plan.plan_items || []).map((comidaPlan, i) => (
                                            <div
                                                key={comidaPlan.key || i}
                                                className="mp-evitar-corte space-y-3"
                                            >
                                                <h3 className="font-display text-xl font-bold uppercase text-primary">
                                                    {comidaPlan.nombre || `Comida N.º ${i + 1}`}
                                                </h3>
                                                <p className="rounded-2xl border border-border bg-card p-5 text-lg">
                                                    {armarTextoAlimentos(comidaPlan.alimentos)}
                                                </p>
                                            </div>
                                        ))
                                    )}

                                    {observacionesPlan.length > 0 && (
                                        <div className="mp-evitar-corte space-y-3">
                                            <h3 className="font-display text-xl font-bold uppercase text-primary">
                                                Observaciones generales
                                            </h3>
                                            <ul className="space-y-2 rounded-2xl border border-border bg-card p-5">
                                                {observacionesPlan.map((linea, i) => (
                                                    <li key={i} className="flex gap-3 text-lg">
                                                        <span className="text-primary" aria-hidden="true">
                                                            •
                                                        </span>
                                                        <span>{linea}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
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
                    {previewItem && (
                        <PreviewMediaModal
                            nombre={previewItem.nombre}
                            url={previewItem.mediaUrl}
                            tipo={tipoDePreview(previewItem.mediaUrl)}
                            onClose={() => setPreviewItem(null)}
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default MiPlanPage;
