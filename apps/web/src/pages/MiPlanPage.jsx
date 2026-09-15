import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    AlertTriangle,
    Apple,
    CheckCircle2,
    Download,
    Dumbbell,
    Flame,
    Lock,
    Loader2,
    LogOut,
    Megaphone,
    Pause,
    Play,
    RotateCcw,
    Scale,
    Timer,
    Wallet,
    X,
} from 'lucide-react';
import supabase from '@/lib/supabaseClient';
import { ThemeToggle } from '@/components/AppLayout';
import {
    agruparCombos,
    agruparItemsRutina,
    agruparPorBloque,
    armarTextoAlimentos,
    esRepsPorTiempo,
    fmtFecha,
    resumenTipoGrupo,
    tieneSeriesDetalle,
    tipoDeGrupo,
} from '@/lib/format';
import { aplicarColorGimnasio } from '@/lib/colorTema';
import { ESTILOS_IMPRESION_RUTINA, RutinaImprimiblePDF } from '@/components/RutinaPDF';
import { ESTILOS_IMPRESION_ALIMENTACION, PlanAlimentacionImprimiblePDF } from '@/components/PlanAlimentacionPDF';
import { descargarComoPdf } from '@/lib/descargarPdf';
import { tipoDePreview } from '@/lib/mediaEjercicio';

// Mismo componente y mismo criterio de carga diferida que ya usa
// AlumnoPage.jsx (Progreso, del lado del profesor): recharts pesa ~100 KB,
// no tiene sentido bajarlo para todos los que solo miran la rutina o el
// plan de alimentación -- recién se pide cuando el alumno abre la pestaña
// "Progreso" (15/09/2026, pestaña nueva, ver el comentario de vista más
// abajo).
const GraficoPeso = React.lazy(() => import('@/components/GraficoPeso'));

// El campo "descanso" de cada ejercicio es texto libre que escribe el profe
// ("90 s", "1:30", "2 min", "60"...), no un número — así que hay que
// interpretarlo para poder arrancar el cronómetro. Si no se entiende, se
// devuelve null y el botón de descanso simplemente no aparece: preferimos no
// mostrar el cronómetro antes que mostrar una cuenta regresiva equivocada.
// Mismo cálculo de "días hasta" que ya usa DashboardPage.jsx/
// NotificacionesCampana.jsx del lado del profesor (lib/format.js,
// planesPorVencer()) -- acá se resuelve aparte porque el alumno ve cada
// aviso adentro de SU PROPIA pestaña (Rutina o Alimentación), no en un
// listado de varios alumnos como del otro lado, así que no vale la pena
// traer la función compartida para un solo cálculo de fecha.
const diasHastaFecha = (fecha) => {
    if (!fecha) return null;
    const hoyMedianoche = new Date();
    hoyMedianoche.setHours(0, 0, 0, 0);
    const f = new Date(`${fecha}T00:00:00`);
    return Math.round((f - hoyMedianoche) / 86400000);
};

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

// Bug reportado por Nalux (09/09/2026): "abrí un ejercicio para verlo y no
// tiene para sacarlo o volver atrás". Esta pantalla tenía su PROPIA copia,
// vieja, de tipoDePreview() -- exigía que el archivo fuera de nuestro bucket
// para cualquier preview (imagen o video), así que una foto de la biblioteca
// base (media_url externa, raw.githubusercontent.com -- son 500 de los 504
// ejercicios con media, ver migración 0041) nunca calificaba y el botón caía
// al link externo de siempre, abriendo una pestaña nueva sin vuelta atrás
// visible en el celular. Esto YA se había corregido en `lib/mediaEjercicio.js`
// (03/09/2026, mismo síntoma, "que haya una vuelta atrás para volver a la
// app") -- cualquier imagen entra al modal sin importar el host, solo el
// video sigue exigiendo ser archivo propio -- pero la corrección nunca
// llegó acá porque esta pantalla no importaba ese archivo compartido, tenía
// su propia copia desactualizada. Se reemplaza por el import.

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

// Timer real de circuito por intervalos (Fase 2.3, 13/09/2026): a diferencia
// de CronometroModal (que cuenta UNA vez y se queda esperando a que el
// alumno toque el siguiente ejercicio a mano), este recorre SOLO la
// secuencia entera -- cada ejercicio de cada ronda, con su descanso -- sin
// que el alumno tenga que tocar nada entre pasos. Es el mismo mecanismo de
// beep+vibración al cambiar de paso, mismo diseño visual, solo que
// encadenado automáticamente.
const IntervaloModal = ({ delBloque, onClose }) => {
    const config = delBloque[0] || {};
    const rondas = Math.max(1, Number(config.rondas) || 1);
    const tiempoTrabajo = Math.max(1, Number(config.tiempoTrabajo) || 40);
    const tiempoDescansoEj = Math.max(0, Number(config.tiempoDescansoEj) || 0);
    const descansoRondasSeg = parsearDescanso(config.descansoRondas) || 0;

    // Secuencia plana de pasos (trabajo/descanso intercalados, ronda por
    // ronda). Armada una sola vez al abrir -- no depende de nada que cambie
    // mientras el timer está corriendo.
    const secuencia = useMemo(() => {
        const pasos = [];
        for (let r = 1; r <= rondas; r += 1) {
            delBloque.forEach((it, i) => {
                pasos.push({ tipo: 'trabajo', nombre: it.nombre, duracion: tiempoTrabajo, ronda: r });
                const esUltimoEjercicioDeLaRonda = i === delBloque.length - 1;
                if (!esUltimoEjercicioDeLaRonda && tiempoDescansoEj > 0) {
                    pasos.push({ tipo: 'descanso', duracion: tiempoDescansoEj, ronda: r });
                }
            });
            const esUltimaRonda = r === rondas;
            if (!esUltimaRonda && descansoRondasSeg > 0) {
                pasos.push({ tipo: 'descanso-ronda', duracion: descansoRondasSeg, ronda: r });
            }
        }
        return pasos;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [pasoActual, setPasoActual] = useState(0);
    const [restante, setRestante] = useState(secuencia[0]?.duracion || 0);
    const [corriendo, setCorriendo] = useState(true);
    const [terminado, setTerminado] = useState(secuencia.length === 0);
    const finRef = useRef(Date.now() + (secuencia[0]?.duracion || 0) * 1000);
    const avisadoRef = useRef(false);

    useEffect(() => {
        if (!corriendo || terminado) return undefined;
        const id = setInterval(() => {
            const seg = Math.max(0, Math.ceil((finRef.current - Date.now()) / 1000));
            setRestante(seg);
            if (seg <= 0 && !avisadoRef.current) {
                avisadoRef.current = true;
                reproducirBeep();
                if (navigator.vibrate) navigator.vibrate(200);
                // Medio segundo de aire antes de pasar al siguiente paso --
                // que el beep se termine de escuchar antes de que cambie el
                // nombre del ejercicio en pantalla.
                setTimeout(() => {
                    setPasoActual((p) => {
                        const siguiente = p + 1;
                        if (siguiente >= secuencia.length) {
                            setTerminado(true);
                            setCorriendo(false);
                            if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300]);
                            return p;
                        }
                        finRef.current = Date.now() + secuencia[siguiente].duracion * 1000;
                        avisadoRef.current = false;
                        setRestante(secuencia[siguiente].duracion);
                        return siguiente;
                    });
                }, 400);
            }
        }, 250);
        return () => clearInterval(id);
    }, [corriendo, terminado, secuencia]);

    const pausarOReanudar = () => {
        if (corriendo) {
            setCorriendo(false);
        } else {
            finRef.current = Date.now() + restante * 1000;
            avisadoRef.current = restante <= 0;
            setCorriendo(true);
        }
    };

    const paso = secuencia[pasoActual] || {};
    const porcentaje = paso.duracion
        ? Math.min(100, Math.round(((paso.duracion - restante) / paso.duracion) * 100))
        : 0;
    const esTrabajo = paso.tipo === 'trabajo';
    const tituloPaso = terminado
        ? '¡Circuito terminado!'
        : esTrabajo
          ? paso.nombre
          : paso.tipo === 'descanso-ronda'
            ? `Descanso · fin de ronda ${paso.ronda}`
            : 'Descanso';

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Circuito por intervalos"
            className="mp-no-imprimir fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
            <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-xl">
                <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                        {terminado ? 'Listo' : `Ronda ${paso.ronda || 1} de ${rondas}`}
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>

                <p className="mt-2 text-xl font-bold leading-tight">{tituloPaso}</p>

                {!terminado && (
                    <>
                        <p
                            className={`mt-2 font-display text-7xl font-extrabold tabular-nums ${
                                esTrabajo ? 'text-primary' : 'text-foreground'
                            }`}
                        >
                            {formatearMmSs(restante)}
                        </p>
                        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-secondary">
                            <div
                                className={`h-full rounded-full transition-all ${esTrabajo ? 'bg-primary' : 'bg-muted-foreground'}`}
                                style={{ width: `${porcentaje}%` }}
                            />
                        </div>
                    </>
                )}

                <div className="mt-6 flex gap-3">
                    {!terminado && (
                        <button
                            type="button"
                            onClick={pausarOReanudar}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-lg font-bold text-primary-foreground transition active:scale-[0.98]"
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
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-border px-5 py-4 text-lg font-bold transition active:scale-[0.98]"
                    >
                        {terminado ? 'Cerrar' : 'Salir'}
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
// Bug reportado por Nalux (09/09/2026): "abrí un ejercicio para verlo y no
// tiene para sacarlo o volver atrás". La "X" sí existía, pero este modal se
// centraba con flex sin overflow -- con una foto de ejercicio alta (algo muy
// común, la mayoría son fotos verticales) más el encabezado, el conjunto
// superaba el alto de la pantalla y el centrado por flex empujaba el
// encabezado (con la "X") por ARRIBA del borde visible, sin ninguna forma de
// scrollear para alcanzarlo. Se agregan tres salidas, no solo una: overflow
// vertical en el fondo (si no entra, se puede scrollear hasta el encabezado),
// clic afuera de la tarjeta (acá no hay ningún formulario que perder, a
// diferencia del Modal de ui-kit.jsx) y la tecla Escape.
const PreviewMediaModal = ({ nombre, url, tipo, onClose }) => {
    useEffect(() => {
        const alPresionar = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', alPresionar);
        return () => window.removeEventListener('keydown', alPresionar);
    }, [onClose]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={`Demostración de ${nombre}`}
            onClick={onClose}
            className="mp-no-imprimir fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-10"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg rounded-3xl border border-border bg-card p-4 shadow-xl"
            >
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
                        className="mx-auto h-auto max-h-[60vh] w-auto max-w-full rounded-2xl bg-black"
                    />
                ) : (
                    <img
                        src={url}
                        alt={`Demostración de ${nombre}`}
                        className="mx-auto h-auto max-h-[60vh] w-auto max-w-full rounded-2xl"
                    />
                )}
            </div>
        </div>
    );
};

// Mensajes literales que devuelve la RPC ver_plan_por_codigo (migración
// 0006_acceso_alumno_por_codigo.sql). Comparamos con una regex laxa en vez
// de igualdad estricta para no depender de mayúsculas exactas, pero seguimos
// siendo específicos: cualquier otro error de Postgres cae al mensaje
// genérico de abajo, nunca se le muestra el texto crudo al alumno.
//
// Los mensajes de la RPC vienen CON acentos ("Código de acceso inválido") y
// estas regex estaban escritas SIN acentos, así que nunca coincidían: a un
// alumno con el código vencido se le mostraba "No se pudo cargar el plan en
// este momento, intentar más tarde" para siempre, en vez de decirle que pida
// un código nuevo al profesor. Encontrado probando en vivo el 11/09/2026 y
// confirmado contra la base (la RPC devuelve exactamente "Código de acceso
// inválido"). Se normaliza el texto antes de comparar, así deja de depender
// de los acentos además de las mayúsculas.
const sinAcentos = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const esCodigoInvalido = (msg = '') => /codigo de acceso invalido/i.test(sinAcentos(msg));
const esRateLimit = (msg = '') => /demasiadas consultas/i.test(sinAcentos(msg));

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
//
// Pedido de Nalux (07/09/2026): que los cuatro entren en UNA línea también en
// el celular (antes iban de a dos, en dos filas). Para eso cada caja tiene que
// ser más angosta, así que en pantalla chica bajan el padding y el cuerpo de
// letra -- el valor sigue siendo lo más grande y en negrita, que es lo que el
// alumno busca de un vistazo. break-words evita que un valor largo escrito a
// mano por el profe ("12 por lado") desborde la caja.
const DatoEjercicio = ({ label, valor }) => (
    <div className="rounded-xl bg-secondary p-2 text-center sm:p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:text-sm">
            {label}
        </p>
        <p className="mt-0.5 break-words text-lg font-extrabold leading-tight sm:mt-1 sm:text-3xl">
            {valor}
        </p>
    </div>
);

// La fila de datos del ejercicio. Eran cuatro cajas fijas (series, reps,
// peso, descanso); desde el 15/09/2026 (pedido de Nalux) un ejercicio medido
// en segundos/minutos no muestra peso -- a una bicicleta de 20 minutos no le
// corresponden kilos -- y las series solo aparecen si el profesor puso
// alguna, porque ahí pasaron a ser opcionales. La cantidad de columnas sale
// de cuántas cajas quedan: si no, las que sobreviven se estiran raro o queda
// un hueco en la fila.
const COLUMNAS_DATOS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

const DatosDelEjercicio = ({ it }) => {
    const datos = [];
    if (String(it.series ?? '').trim()) datos.push({ label: 'Series', valor: it.series });
    datos.push({ label: 'Reps', valor: it.reps });
    if (!esRepsPorTiempo(it.reps)) datos.push({ label: 'Peso', valor: it.peso || '—' });
    datos.push({ label: 'Descanso', valor: it.descanso || '—' });
    return (
        <div className={`mt-4 grid gap-1.5 sm:gap-3 ${COLUMNAS_DATOS[datos.length] || 'grid-cols-4'}`}>
            {datos.map((d) => (
                <DatoEjercicio key={d.label} label={d.label} valor={d.valor} />
            ))}
        </div>
    );
};

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
                Pasar por {gimnasioNombre || 'el gimnasio'} para renovarla y volver a verlo.
            </p>
        </div>
    </div>
);

const MiPlanPage = () => {
    const { codigo } = useParams();
    const navigate = useNavigate();
    const [plan, setPlan] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Solo para el cartel "sin conexión" de abajo -- no cambia en nada cómo
    // se pide el plan (eso lo resuelve public/sw.js sirviendo la última
    // respuesta guardada si no hay red). navigator.onLine puede arrancar en
    // true por unos segundos aunque no haya señal real (algunos navegadores
    // solo detectan que "hay una red" wifi/datos, no que esa red llegue a
    // internet) -- por eso esto es un aviso, no la fuente de verdad de si el
    // plan que se ve es viejo o no.
    const [sinConexion, setSinConexion] = useState(!navigator.onLine);
    useEffect(() => {
        const marcarOnline = () => setSinConexion(false);
        const marcarOffline = () => setSinConexion(true);
        window.addEventListener('online', marcarOnline);
        window.addEventListener('offline', marcarOffline);
        return () => {
            window.removeEventListener('online', marcarOnline);
            window.removeEventListener('offline', marcarOffline);
        };
    }, []);
    // { duracion, id } del cronómetro activo, o null si está cerrado. El id
    // incremental (no solo la duración) es a propósito: si dos ejercicios
    // comparten el mismo descanso ("90 s" los dos) y se pide el segundo
    // mientras el primero sigue contando, la duración por sí sola no cambia
    // -React no re-renderiza con un valor de estado idéntico- y el
    // cronómetro viejo seguiría mostrando su cuenta a mitad de camino en vez
    // de arrancar de nuevo.
    const [cronometro, setCronometro] = useState(null);
    const cronometroIdRef = useRef(0);
    // Circuito por intervalos activo (Fase 2.3, 13/09/2026): guarda los
    // items del bloque que se está corriendo, o null si no hay ninguno
    // abierto. A diferencia del cronómetro de descanso, acá no hace falta
    // un "id" para forzar remontaje -- IntervaloModal se desmonta y se
    // vuelve a montar solo con abrir/cerrar (onClose pone esto en null).
    const [intervaloActivo, setIntervaloActivo] = useState(null);
    // Ejercicio cuya demostración se está mostrando en el modal de preview
    // ("Ver cómo se hace"), o null si está cerrado.
    const [previewItem, setPreviewItem] = useState(null);
    // 'rutina' | 'alimentacion' | null. Controla qué sección queda visible
    // a la hora de imprimir (ver ESTILOS_IMPRESION_RUTINA/
    // ESTILOS_IMPRESION_ALIMENTACION) — así "Descargar rutina" y "Descargar
    // plan de comida" arman cada uno su propio PDF con solo lo que
    // corresponde, en vez de un único PDF con todo mezclado.
    const [imprimiendoSeccion, setImprimiendoSeccion] = useState(null);
    // Si la generación del PDF falla (navegador viejo, quedarse sin señal
    // justo cuando va a bajar la librería), el alumno tiene que enterarse:
    // antes el diálogo de impresión al menos aparecía o no, ahora sin aviso
    // el botón parecería no hacer nada.
    const [errorPdf, setErrorPdf] = useState('');
    // Cartel de aviso (Bloque G6): "Entendido" se resuelve 100% client-side
    // sin recargar la página. avisoOculto es un estado APARTE de `plan` (no
    // se muta plan.aviso_id) para no tener que reconstruir el objeto entero
    // que ya viene tal cual de la RPC.
    const [avisoOculto, setAvisoOculto] = useState(false);
    const [marcandoAviso, setMarcandoAviso] = useState(false);
    const [avisoError, setAvisoError] = useState('');

    // Monta la hoja de la sección pedida y, en cuanto está en el DOM, genera
    // y baja el PDF (lib/descargarPdf.js). Antes esto abría el diálogo de
    // impresión y había que elegir "Guardar como PDF" a mano -- pedido de
    // Nalux (07/09/2026) que baje directo, que en el celular es mucho más
    // claro. requestAnimationFrame espera al frame siguiente para que React
    // ya haya montado la hoja antes de fotografiarla.
    const descargarSeccion = async (seccion) => {
        setImprimiendoSeccion(seccion);
        setErrorPdf('');
        const esRutina = seccion === 'rutina';
        try {
            // descargarComoPdf espera solo a que React termine de montar la
            // hoja, así que no hace falta coordinar el momento desde acá.
            await descargarComoPdf(
                esRutina ? '.rutina-pdf-hoja' : '.alimentacion-pdf-hoja',
                `${esRutina ? 'Rutina' : 'Plan de alimentación'} - ${plan?.alumno_nombre || 'alumno'}`,
            );
        } catch (_) {
            setErrorPdf('No se pudo generar el PDF. Probar de nuevo.');
        } finally {
            setImprimiendoSeccion(null);
        }
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

    // Fases 2.6 (Tareas) + 2.7 (historial de cargas), 13/09/2026. Decisión de
    // Nalux (preguntada antes de tocar código): por primera vez el alumno
    // ESCRIBE algo desde esta pantalla -- migración 0050, dos RPC nuevas
    // (marcar_entrenamiento_hecho/alumno_cargar_peso), mismo patrón de
    // seguridad que el resto (resuelven el alumno por el código de la URL,
    // nunca por un ID). diasHechosHoy arranca con lo que ya trae la RPC
    // inicial (dias_completados_hoy, ya filtrado a HOY del lado del server) y
    // se completa localmente cuando el alumno toca el botón -- así no hace
    // falta volver a pedir el plan entero solo para reflejar un check.
    const [diasHechosHoy, setDiasHechosHoy] = useState(() => new Set());
    const [marcandoDia, setMarcandoDia] = useState(null);
    const [errorMarcarDia, setErrorMarcarDia] = useState('');

    useEffect(() => {
        setDiasHechosHoy(new Set(plan?.dias_completados_hoy || []));
    }, [plan]);

    const marcarDiaHecho = async (nroSemana, dia) => {
        const clave = `${nroSemana}|${dia}`;
        if (diasHechosHoy.has(clave) || marcandoDia) return;
        setMarcandoDia(clave);
        setErrorMarcarDia('');
        try {
            const { error: err } = await supabase.rpc('marcar_entrenamiento_hecho', {
                p_codigo: codigo,
                p_semana: nroSemana,
                p_dia: dia,
            });
            if (err) throw err;
            setDiasHechosHoy((prev) => new Set(prev).add(clave));
            // Si ya se abrió "Progreso" antes en esta visita, la racha que
            // muestra ahí quedaría vieja hasta salir y volver a entrar a la
            // pestaña -- la actualiza de una, para que marcar "Hecho" se
            // sienta como parte de la misma racha, no algo aparte. Si
            // todavía no se abrió esa pestaña ni hace falta: se pide fresca
            // la primera vez que se entre.
            if (progresoYaPedidoRef.current) cargarProgreso();
        } catch (_) {
            setErrorMarcarDia('No se pudo guardar. Probar de nuevo.');
        } finally {
            setMarcandoDia(null);
        }
    };

    // Si el alumno ya cargó hoy, alumno_cargar_peso() actualiza esa misma
    // fila en vez de duplicar -- por eso el botón dice siempre "Guardar",
    // nunca hace falta distinguir "primera carga" de "corrección". El
    // historial YA se ve acá también, desde que existe la pestaña
    // "Progreso" (15/09/2026, ver vista/cargarProgreso más abajo) -- antes
    // ese historial solo lo veía el profe en su propia ficha.
    const [pesoInput, setPesoInput] = useState('');
    const [guardandoPeso, setGuardandoPeso] = useState(false);
    const [pesoGuardado, setPesoGuardado] = useState(false);
    const [errorPeso, setErrorPeso] = useState('');

    const guardarPeso = async () => {
        const valor = Number(String(pesoInput).replace(',', '.'));
        if (!Number.isFinite(valor) || valor <= 0 || valor > 400) {
            setErrorPeso('Ingresar un peso válido, en kg.');
            return;
        }
        setGuardandoPeso(true);
        setErrorPeso('');
        try {
            const { error: err } = await supabase.rpc('alumno_cargar_peso', {
                p_codigo: codigo,
                p_peso: valor,
            });
            if (err) throw err;
            setPesoGuardado(true);
            // El peso recién guardado tiene que aparecer en el gráfico sin
            // tener que salir y volver a entrar a la pestaña -- se vuelve a
            // pedir el progreso (mismo costo que ya paga "ver el plan": no
            // suma un límite nuevo, ver el comentario de la RPC).
            cargarProgreso();
        } catch (_) {
            setErrorPeso('No se pudo guardar. Probar de nuevo.');
        } finally {
            setGuardandoPeso(false);
        }
    };

    // Pestañas del panel (15/09/2026, pedido de Nalux: "separes por paginas
    // plan ejercicio y plan alimentacion, asi es mas correcto y no se
    // mezclan en una misma hoja... agregaras otro modulo dentro sobre
    // progresos, algo que sirva como motivacion"). Antes rutina y
    // alimentación vivían una abajo de la otra en la misma hoja larga --
    // ya se había intentado distinguirlas con una franja de color al
    // costado (09/09/2026), pero seguían mezcladas al bajar. Mismo patrón
    // de pestañas que ya usa AlumnoPage.jsx del lado del profesor
    // (Entrenamiento / Nutrición / Progreso / Asistencia / Pagos), ahora
    // también acá.
    const [vista, setVista] = useState('rutina'); // 'rutina' | 'alimentacion' | 'progreso'
    const [progreso, setProgreso] = useState(null); // { historial_peso, entrenamientos_ultima_semana } | null
    const [cargandoProgreso, setCargandoProgreso] = useState(false);
    const [errorProgreso, setErrorProgreso] = useState('');
    // Se pide recién al abrir la pestaña por primera vez (no de entrada con
    // el resto del plan): la mayoría de las visitas van a ser para ver la
    // rutina de hoy, y esto es un viaje de red aparte que no todas esas
    // visitas necesitan.
    const progresoYaPedidoRef = useRef(false);

    const cargarProgreso = async () => {
        setCargandoProgreso(true);
        setErrorProgreso('');
        try {
            const { data, error: err } = await supabase.rpc('ver_progreso_alumno', { p_codigo: codigo });
            if (err) throw err;
            const fila = Array.isArray(data) ? data[0] : data;
            setProgreso(fila || { historial_peso: [], entrenamientos_ultima_semana: 0 });
        } catch (_) {
            setErrorProgreso('No se pudo cargar el progreso. Probar de nuevo.');
        } finally {
            setCargandoProgreso(false);
        }
    };

    useEffect(() => {
        if (vista === 'progreso' && !progresoYaPedidoRef.current) {
            progresoYaPedidoRef.current = true;
            cargarProgreso();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vista]);

    // Pinta esta pantalla también con el color del gimnasio -- antes solo se
    // usaba en el PDF, la pantalla en vivo se quedaba siempre en el rojo de
    // fábrica. AuthContext hace lo mismo para el lado del profesor; acá no
    // hay sesión (AuthProvider ve profile=null y ya resetea al default apenas
    // monta), así que hace falta este efecto aparte con el color que trae la
    // propia RPC.
    useEffect(() => {
        aplicarColorGimnasio(plan?.gimnasio_color_principal);
    }, [plan?.gimnasio_color_principal]);

    // Se pide al montar (o si cambia el código de la URL) y, en silencio,
    // cada vez que el alumno vuelve a esta pestaña -- mismo mecanismo que ya
    // usa NotificacionesCampana.jsx del lado del profesor (visibilitychange +
    // focus). Reportado por Nalux (15/09/2026): "cambié el plan vencido de
    // comida pero la alerta sigue estando" -- esta pantalla decía en el
    // comentario de acá arriba "no tiene sesión ni refresco automático, es
    // un ver y listo", literal: se pedía UNA sola vez al montar y nunca más.
    // Si el profesor corrige la fecha mientras el alumno ya tenía esta
    // pestaña abierta (el caso real de probar las dos pantallas juntas, una
    // al lado de la otra), no había forma de que se enterara sin cerrar y
    // volver a entrar a mano.
    //
    // mostrarCargando=false en el refresco silencioso: no tiene sentido
    // tapar toda la pantalla con "Cargando tu plan..." cada vez que el
    // alumno vuelve de mirar otra app -- solo se actualiza `plan` en
    // silencio cuando llega la respuesta nueva, sin sacarlo de donde estaba
    // parado ni resetear nada mientras tanto.
    useEffect(() => {
        let cancelado = false;

        const cargarPlan = (mostrarCargando) => {
            if (mostrarCargando) {
                setLoading(true);
                setError('');
                setPlan(null);
                setAvisoOculto(false);
                setAvisoError('');
            }
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
                    if (mostrarCargando) {
                        setAvisoOculto(false);
                        setAvisoError('');
                    }
                })
                .catch((err) => {
                    if (cancelado) return;
                    // El refresco silencioso, si falla (sin señal justo en ese
                    // instante, por ejemplo), no reemplaza el plan que ya se
                    // estaba viendo por una pantalla de error -- eso sí sería
                    // peor que no actualizar nada.
                    if (!mostrarCargando) return;
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
                    if (cancelado || !mostrarCargando) return;
                    setLoading(false);
                });
        };

        cargarPlan(true);

        const alVolver = () => {
            if (document.visibilityState === 'visible') cargarPlan(false);
        };
        document.addEventListener('visibilitychange', alVolver);
        window.addEventListener('focus', alVolver);

        return () => {
            cancelado = true;
            document.removeEventListener('visibilitychange', alVolver);
            window.removeEventListener('focus', alVolver);
        };
    }, [codigo]);

    // Por si el celular es compartido con otra persona, o el alumno quiere
    // volver a entrar con otro usuario -- manda de nuevo al login
    // (AlumnoLoginPage.jsx). Ya no hay ninguna "sesión" que borrar acá: desde
    // el 14/09/2026 /alumno siempre pide usuario y contraseña, no queda
    // guardado nada en localStorage (ver el comentario en AlumnoLoginPage.jsx).
    const cerrarSesion = () => {
        navigate('/alumno', { replace: true });
    };

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
    // null = sin fecha de vencimiento cargada (no se avisa nada); negativo =
    // ya venció; 0-7 = por vencer dentro de la semana.
    const diasHastaRutina = diasHastaFecha(plan?.rutina_fecha_fin);
    const diasHastaPlan = diasHastaFecha(plan?.plan_fecha_fin);

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
                    fechaFin={plan?.rutina_fecha_fin}
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
                {/* Actualizado (07/09/2026): desde la migración 0028 el ingreso es
                    con usuario y contraseña, no sin ellos -- este texto había
                    quedado desactualizado desde antes de ese cambio. */}
                <meta
                    name="description"
                    content="Rutina de entrenamiento y plan de alimentación del alumno, con acceso mediante usuario y contraseña."
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
                    <Link to="/alumno" className="text-sm font-semibold text-primary hover:underline">
                        Volver a ingresar
                    </Link>
                </div>
            )}

            {!loading && !error && plan && (
                <>
                    <header className="border-b border-border bg-card px-4 py-5 sm:px-6">
                        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 lg:max-w-5xl">
                            <div className="flex min-w-0 items-center gap-3">
                                <LogoGimnasio
                                    nombre={plan.gimnasio_nombre}
                                    logoUrl={plan.gimnasio_logo_url}
                                />
                                <p className="truncate text-lg font-extrabold uppercase tracking-tight sm:text-xl">
                                    {plan.gimnasio_nombre || 'Tu gimnasio'}
                                </p>
                            </div>
                            <div className="mp-no-imprimir flex shrink-0 items-center gap-2">
                                <ThemeToggle />
                                <button
                                    type="button"
                                    onClick={cerrarSesion}
                                    aria-label="Cerrar sesión"
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:text-foreground"
                                >
                                    <LogOut className="h-4 w-4" strokeWidth={2} />
                                </button>
                            </div>
                        </div>
                    </header>

                    {sinConexion && (
                        <p className="mp-no-imprimir bg-warn/15 px-4 py-2 text-center text-xs font-semibold text-warn">
                            Sin conexión -- mostrando la última versión guardada.
                        </p>
                    )}

                    {errorPdf && (
                        <p className="mp-no-imprimir bg-destructive/15 px-4 py-2 text-center text-xs font-semibold text-destructive">
                            {errorPdf}
                        </p>
                    )}

                    {/* lg:max-w-5xl (09/09/2026, pedido de Nalux: "desde la
                        computadora quiero que se vea bien... ponelo bien a lo
                        ancho"). En el celular sigue igual: max-w-2xl no llega a
                        aplicarse nunca abajo de 672px de ancho. */}
                    <main className="mx-auto max-w-2xl space-y-10 px-4 py-8 sm:px-6 lg:max-w-5xl">
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

                        {/* Pestañas (15/09/2026): antes rutina y alimentación vivían
                            una abajo de la otra en la misma hoja larga -- la franja
                            de color de cada una (ver más abajo) ayudaba a distinguirlas
                            al bajar, pero seguían mezcladas. Ahora son vistas
                            separadas de verdad, mismo patrón que ya usa AlumnoPage.jsx
                            del lado del profesor. mp-no-imprimir: esto no tiene
                            sentido en el PDF, que siempre es de una sola sección
                            (RutinaImprimiblePDF/PlanAlimentacionImprimiblePDF, más
                            arriba, son componentes aparte -- cambiar de pestaña acá
                            no les afecta en nada). */}
                        <div className="mp-no-imprimir flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5">
                            {[
                                { valor: 'rutina', label: 'Rutina', Icono: Dumbbell },
                                { valor: 'alimentacion', label: 'Alimentación', Icono: Apple },
                                { valor: 'progreso', label: 'Progreso', Icono: Flame },
                            ].map(({ valor, label, Icono }) => (
                                <button
                                    key={valor}
                                    type="button"
                                    onClick={() => setVista(valor)}
                                    className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-base font-bold transition ${
                                        vista === valor
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    <Icono className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Banda de encabezado con color propio por sección (queda
                            igual aunque ahora estén en pestañas separadas -- Rutina
                            con el color del gimnasio, Alimentación con --ok, mismo
                            criterio ya aprobado el 09/09/2026). */}
                        {vista === 'rutina' && (
                        <section aria-labelledby="mp-rutina-titulo" className="mp-seccion-rutina space-y-5">
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-l-4 border-primary bg-primary/10 px-4 py-3">
                                <h2
                                    id="mp-rutina-titulo"
                                    className="font-display text-2xl font-extrabold uppercase text-primary"
                                >
                                    Tu rutina
                                </h2>
                                {tieneRutina && (
                                    <button
                                        type="button"
                                        onClick={() => descargarSeccion('rutina')}
                                        disabled={imprimiendoSeccion === 'rutina'}
                                        className="mp-no-imprimir inline-flex items-center justify-center gap-2 rounded-xl border-2 border-primary px-4 py-2.5 text-base font-bold text-primary transition active:scale-[0.98] disabled:opacity-60"
                                    >
                                        <Download className="h-5 w-5" aria-hidden="true" />{' '}
                                        {imprimiendoSeccion === 'rutina' ? 'Generando...' : 'Descargar en PDF'}
                                    </button>
                                )}
                            </div>

                            {/* Aviso de vencimiento (15/09/2026, pedido de Nalux:
                                "que haya alertas cuando se vencen los planes de
                                rutina de ejercicio y de alimentación") -- mismo
                                criterio de 7 días que ya usa el aviso de cuota más
                                arriba y la tarjeta "Planes por vencer" del profesor
                                (lib/format.js, planesPorVencer()). Si no hay
                                rutina_fecha_fin cargada (plan sin fecha, o
                                bloqueado por cuota vencida -- ver
                                ver_plan_por_codigo(), ahí ya viene en null), no se
                                inventa ningún vencimiento. */}
                            {diasHastaRutina !== null && diasHastaRutina <= 7 && (
                                <div
                                    className={`mp-no-imprimir flex items-start gap-3 rounded-2xl border-2 p-4 sm:p-5 ${
                                        diasHastaRutina < 0
                                            ? 'border-destructive bg-destructive/10'
                                            : 'border-warn bg-warn/10'
                                    }`}
                                >
                                    <span
                                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                            diasHastaRutina < 0 ? 'bg-destructive/20' : 'bg-warn/20'
                                        }`}
                                    >
                                        <Dumbbell
                                            className={`h-5 w-5 ${diasHastaRutina < 0 ? 'text-destructive' : 'text-warn'}`}
                                            strokeWidth={2.2}
                                            aria-hidden="true"
                                        />
                                    </span>
                                    <p
                                        className={`text-base font-semibold sm:text-lg ${
                                            diasHastaRutina < 0 ? 'text-destructive' : 'text-warn'
                                        }`}
                                    >
                                        {diasHastaRutina < 0
                                            ? `Tu rutina venció el ${fmtFecha(plan.rutina_fecha_fin)}. Pedile al profesor una rutina nueva.`
                                            : diasHastaRutina === 0
                                              ? 'Tu rutina vence hoy. Pedile al profesor una rutina nueva.'
                                              : `Tu rutina vence en ${diasHastaRutina} ${diasHastaRutina === 1 ? 'día' : 'días'} (${fmtFecha(plan.rutina_fecha_fin)}).`}
                                    </p>
                                </div>
                            )}

                            {plan.rutina_restringida ? (
                                <EstadoRestringido gimnasioNombre={plan.gimnasio_nombre} />
                            ) : !tieneRutina ? (
                                <EstadoVacio>
                                    Todavía no hay una rutina cargada, pedirla al profesor.
                                </EstadoVacio>
                            ) : (
                                <>
                                    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
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
                                                {dias.map(([dia, items]) => {
                                                    const claveDia = `${nroSemana}|${dia}`;
                                                    const diaCompletadoHoy = diasHechosHoy.has(claveDia);
                                                    return (
                                                    <div key={`${nroSemana}-${dia}`} className="space-y-3">
                                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                                            <h3 className="font-display text-xl font-bold uppercase text-primary">
                                                                {dia}
                                                            </h3>
                                                            <button
                                                                type="button"
                                                                onClick={() => marcarDiaHecho(nroSemana, dia)}
                                                                disabled={diaCompletadoHoy || marcandoDia === claveDia}
                                                                className={`mp-no-imprimir inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition active:scale-[0.98] disabled:opacity-70 ${
                                                                    diaCompletadoHoy
                                                                        ? 'bg-ok/15 text-ok'
                                                                        : 'bg-primary text-primary-foreground'
                                                                }`}
                                                            >
                                                                {diaCompletadoHoy ? (
                                                                    <>
                                                                        <CheckCircle2
                                                                            className="h-4 w-4"
                                                                            aria-hidden="true"
                                                                        />{' '}
                                                                        Completado hoy
                                                                    </>
                                                                ) : marcandoDia === claveDia ? (
                                                                    'Guardando...'
                                                                ) : (
                                                                    'Marcar como hecho'
                                                                )}
                                                            </button>
                                                        </div>
                                                        {agruparPorBloque(agruparCombos(items)).map(
                                                            ([nombreBloque, delBloque], iBloque) => (
                                                                <div
                                                                    key={`${nombreBloque}-${iBloque}`}
                                                                    className="space-y-3"
                                                                >
                                                                    {nombreBloque && (
                                                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                                                            <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground">
                                                                                {nombreBloque}
                                                                                {resumenTipoGrupo(delBloque) && (
                                                                                    <span className="ml-2 block text-sm font-bold normal-case text-primary sm:inline sm:text-base">
                                                                                        {resumenTipoGrupo(delBloque)}
                                                                                    </span>
                                                                                )}
                                                                            </p>
                                                                            {tipoDeGrupo(delBloque) === 'intervalo' && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setIntervaloActivo(delBloque)}
                                                                                    className="mp-no-imprimir inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition active:scale-[0.98]"
                                                                                >
                                                                                    <Play className="h-4 w-4" aria-hidden="true" /> Iniciar circuito
                                                                                </button>
                                                                            )}
                                                                        </div>
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
                                                                                className="mp-evitar-corte rounded-2xl border border-border bg-card p-4 sm:p-5"
                                                                            >
                                                                                {it.esCombo ? (
                                                                                    <>
                                                                                        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-primary">
                                                                                            Superserie
                                                                                        </p>
                                                                                        {/* En una sola fila también en el celular
                                                                                            (09/09/2026, pedido de Nalux: "quisiera que
                                                                                            las superseries se vean en una línea así como
                                                                                            en la computadora"). Antes era flex-col abajo
                                                                                            de 640px y los ejercicios del combo quedaban
                                                                                            uno debajo del otro, que se lee como si fueran
                                                                                            ejercicios sueltos, no una superserie. */}
                                                                                        <div className="flex flex-row items-stretch gap-1.5">
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
                                                                                                                className="flex shrink-0 items-center justify-center text-lg font-bold text-primary"
                                                                                                                aria-hidden="true"
                                                                                                            >
                                                                                                                +
                                                                                                            </span>
                                                                                                        )}
                                                                                                        <div className="min-w-0 flex-1 rounded-xl bg-secondary p-2.5">
                                                                                                            {/* Sin truncar en el celular: con
                                                                                                                dos al lado el nombre entra en
                                                                                                                dos renglones, pero completo --
                                                                                                                cortarlo dejaría al alumno sin
                                                                                                                saber qué ejercicio es. */}
                                                                                                            <p className="text-base font-bold leading-tight">
                                                                                                                {
                                                                                                                    sub.nombre
                                                                                                                }
                                                                                                            </p>
                                                                                                            {sub.grupo && (
                                                                                                                <p className="text-sm text-muted-foreground">
                                                                                                                    {
                                                                                                                        sub.grupo
                                                                                                                    }
                                                                                                                </p>
                                                                                                            )}
                                                                                                            <div className="mt-2 space-y-0.5 text-base">
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
                                                                                        {tieneSeriesDetalle(it) ? (
                                                                                            // Series desglosadas (Fase 2.3, 13/09/2026):
                                                                                            // pirámides, drop sets -- cada serie con su
                                                                                            // propio peso/reps. Mismo criterio de letra
                                                                                            // grande que el resto de esta pantalla ("hay
                                                                                            // personas grandes que tienen que leer
                                                                                            // también", pedido de Nalux).
                                                                                            <div className="mt-4 space-y-1.5">
                                                                                                {it.seriesDetalle.map((s, i) => (
                                                                                                    <div
                                                                                                        key={i}
                                                                                                        className="flex items-center gap-3 rounded-xl bg-secondary p-2.5 sm:p-3"
                                                                                                    >
                                                                                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary sm:h-10 sm:w-10 sm:text-base">
                                                                                                            {i + 1}
                                                                                                        </span>
                                                                                                        <span className="text-lg font-extrabold sm:text-2xl">
                                                                                                            {s.reps || '—'} reps
                                                                                                        </span>
                                                                                                        {s.peso && (
                                                                                                            <span className="ml-auto text-lg font-extrabold sm:text-2xl">
                                                                                                                {s.peso} kg
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </div>
                                                                                                ))}
                                                                                                <p className="pt-1 text-base">
                                                                                                    <span className="text-muted-foreground">
                                                                                                        Descanso entre series:{' '}
                                                                                                    </span>
                                                                                                    <span className="font-semibold">
                                                                                                        {it.descanso || '—'}
                                                                                                    </span>
                                                                                                </p>
                                                                                            </div>
                                                                                        ) : (
                                                                                            // Un ejercicio por tiempo (bici 20
                                                                                            // min, plancha 30 seg) no muestra
                                                                                            // peso, y las series solo si el
                                                                                            // profesor puso alguna -- pedido de
                                                                                            // Nalux (15/09/2026). Las cajas que
                                                                                            // quedan se reparten el ancho en vez
                                                                                            // de dejar un hueco.
                                                                                            <DatosDelEjercicio it={it} />
                                                                                        )}
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
                                                    );
                                                })}
                                            </div>
                                        ))
                                    )}
                                </>
                            )}
                        </section>
                        )}

                        {/* Pestaña "Progreso" (15/09/2026, pedido de Nalux: "un módulo
                            sobre progresos, algo que sirva como motivación") -- el
                            campo de peso de hoy que ya existía (Fase 2.7) se mudó
                            para acá, y se le suma lo que antes el alumno no podía
                            ver: su propia evolución (gráfico, mismo componente que ya
                            usa el profesor) y una racha de entrenamientos de la
                            última semana. ver_progreso_alumno() (migración 0055) es
                            la primera función pública de solo lectura que le muestra
                            al alumno su propio historial -- hasta acá solo podía
                            escribir (cargar su peso), nunca ver hacia atrás. */}
                        {vista === 'progreso' && (
                        <section aria-labelledby="mp-progreso-titulo" className="space-y-5">
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-l-4 border-primary bg-primary/10 px-4 py-3">
                                <h2
                                    id="mp-progreso-titulo"
                                    className="font-display text-2xl font-extrabold uppercase text-primary"
                                >
                                    Tu progreso
                                </h2>
                            </div>

                            <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                                        <Scale className="h-6 w-6 text-primary" strokeWidth={2.2} aria-hidden="true" />
                                    </span>
                                    <p className="text-xl font-extrabold">Tu peso de hoy</p>
                                </div>
                                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                                    <div className="relative flex-1">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            step="0.1"
                                            min="1"
                                            max="400"
                                            placeholder="Ej: 72.5"
                                            value={pesoInput}
                                            onChange={(e) => {
                                                setPesoInput(e.target.value);
                                                setPesoGuardado(false);
                                            }}
                                            className="w-full rounded-xl border border-border bg-background px-4 py-3 pr-12 text-lg font-semibold"
                                        />
                                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground">
                                            kg
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={guardarPeso}
                                        disabled={guardandoPeso || !pesoInput}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-lg font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-60 sm:w-auto"
                                    >
                                        {guardandoPeso ? (
                                            'Guardando...'
                                        ) : pesoGuardado ? (
                                            <>
                                                <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Guardado
                                            </>
                                        ) : (
                                            'Guardar'
                                        )}
                                    </button>
                                </div>
                                {errorPeso && (
                                    <p className="mt-3 text-base font-semibold text-destructive">{errorPeso}</p>
                                )}
                            </div>

                            {cargandoProgreso ? (
                                <div className="rounded-2xl border border-border bg-card p-8 text-center text-base text-muted-foreground">
                                    Cargando tu progreso...
                                </div>
                            ) : errorProgreso ? (
                                <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 text-base font-semibold text-destructive">
                                    {errorProgreso}
                                </div>
                            ) : progreso ? (
                                <>
                                    {/* Racha motivacional: entrenamientos marcados como
                                        hechos (botón "Marcar como hecho" de cada día,
                                        Fase 2.6) en los últimos 7 días. Sin racha
                                        todavía no es un error ni algo para lamentar --
                                        el mensaje cambia según haya o no haya, nunca
                                        en tono de reto. */}
                                    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
                                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-warn/15">
                                            <Flame className="h-7 w-7 text-warn" strokeWidth={2.2} aria-hidden="true" />
                                        </span>
                                        <div>
                                            <p className="font-display text-3xl font-extrabold">
                                                {progreso.entrenamientos_ultima_semana}{' '}
                                                <span className="text-lg font-semibold text-muted-foreground">
                                                    {progreso.entrenamientos_ultima_semana === 1
                                                        ? 'entrenamiento'
                                                        : 'entrenamientos'}{' '}
                                                    esta semana
                                                </span>
                                            </p>
                                            <p className="mt-1 text-base text-muted-foreground">
                                                {progreso.entrenamientos_ultima_semana === 0
                                                    ? 'Marcá "Hecho" en tu rutina de hoy para empezar la racha.'
                                                    : progreso.entrenamientos_ultima_semana >= 4
                                                      ? '¡Muy bien! Seguí así.'
                                                      : 'Vas bien, un poco más y sostenés la racha.'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                                        <h3 className="mb-4 font-display text-lg font-bold">Evolución del peso</h3>
                                        {progreso.historial_peso.length < 2 ? (
                                            <p className="text-base text-muted-foreground">
                                                Cargá tu peso un par de veces más para empezar a ver el gráfico.
                                            </p>
                                        ) : (
                                            <div className="h-56">
                                                <React.Suspense
                                                    fallback={
                                                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                                            Cargando el gráfico...
                                                        </div>
                                                    }
                                                >
                                                    <GraficoPeso
                                                        serie={progreso.historial_peso.map((p) => ({
                                                            fecha: fmtFecha(p.fecha).slice(0, 5),
                                                            peso: Number(p.peso),
                                                        }))}
                                                    />
                                                </React.Suspense>
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : null}
                        </section>
                        )}

                        {vista === 'alimentacion' && (
                        <section
                            aria-labelledby="mp-alimentacion-titulo"
                            className="mp-seccion-alimentacion space-y-5"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-l-4 border-ok bg-ok/10 px-4 py-3">
                                <h2
                                    id="mp-alimentacion-titulo"
                                    className="font-display text-2xl font-extrabold uppercase text-ok"
                                >
                                    Tu plan de alimentación
                                </h2>
                                {tienePlan && (
                                    <button
                                        type="button"
                                        onClick={() => descargarSeccion('alimentacion')}
                                        disabled={imprimiendoSeccion === 'alimentacion'}
                                        className="mp-no-imprimir inline-flex items-center justify-center gap-2 rounded-xl border-2 border-ok px-4 py-2.5 text-base font-bold text-ok transition active:scale-[0.98] disabled:opacity-60"
                                    >
                                        <Download className="h-5 w-5" aria-hidden="true" />{' '}
                                        {imprimiendoSeccion === 'alimentacion' ? 'Generando...' : 'Descargar en PDF'}
                                    </button>
                                )}
                            </div>

                            {/* Mismo aviso de vencimiento que en la pestaña Rutina,
                                acá con el plan de alimentación. */}
                            {diasHastaPlan !== null && diasHastaPlan <= 7 && (
                                <div
                                    className={`mp-no-imprimir flex items-start gap-3 rounded-2xl border-2 p-4 sm:p-5 ${
                                        diasHastaPlan < 0
                                            ? 'border-destructive bg-destructive/10'
                                            : 'border-warn bg-warn/10'
                                    }`}
                                >
                                    <span
                                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                            diasHastaPlan < 0 ? 'bg-destructive/20' : 'bg-warn/20'
                                        }`}
                                    >
                                        <Apple
                                            className={`h-5 w-5 ${diasHastaPlan < 0 ? 'text-destructive' : 'text-warn'}`}
                                            strokeWidth={2.2}
                                            aria-hidden="true"
                                        />
                                    </span>
                                    <p
                                        className={`text-base font-semibold sm:text-lg ${
                                            diasHastaPlan < 0 ? 'text-destructive' : 'text-warn'
                                        }`}
                                    >
                                        {diasHastaPlan < 0
                                            ? `Tu plan de alimentación venció el ${fmtFecha(plan.plan_fecha_fin)}. Pedile al profesor uno nuevo.`
                                            : diasHastaPlan === 0
                                              ? 'Tu plan de alimentación vence hoy. Pedile al profesor uno nuevo.'
                                              : `Tu plan de alimentación vence en ${diasHastaPlan} ${diasHastaPlan === 1 ? 'día' : 'días'} (${fmtFecha(plan.plan_fecha_fin)}).`}
                                    </p>
                                </div>
                            )}

                            {plan.alimentacion_restringida ? (
                                <EstadoRestringido gimnasioNombre={plan.gimnasio_nombre} />
                            ) : !tienePlan ? (
                                <EstadoVacio>
                                    Todavía no hay un plan de alimentación cargado, pedirlo al profesor.
                                </EstadoVacio>
                            ) : (
                                <>
                                    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
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
                                                <h3 className="font-display text-xl font-bold uppercase text-ok">
                                                    {comidaPlan.nombre || `Comida N.º ${i + 1}`}
                                                </h3>
                                                <p className="rounded-2xl border border-border bg-card p-4 text-base sm:p-5 sm:text-lg">
                                                    {armarTextoAlimentos(comidaPlan.alimentos)}
                                                </p>
                                            </div>
                                        ))
                                    )}

                                    {observacionesPlan.length > 0 && (
                                        <div className="mp-evitar-corte space-y-3">
                                            <h3 className="font-display text-xl font-bold uppercase text-ok">
                                                Observaciones generales
                                            </h3>
                                            <ul className="space-y-2 rounded-2xl border border-border bg-card p-4 sm:p-5">
                                                {observacionesPlan.map((linea, i) => (
                                                    <li key={i} className="flex gap-3 text-base sm:text-lg">
                                                        <span className="text-ok" aria-hidden="true">
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
                        )}
                    </main>

                    {cronometro !== null && (
                        <CronometroModal
                            key={cronometro.id}
                            duracionInicial={cronometro.duracion}
                            onClose={() => setCronometro(null)}
                        />
                    )}
                    {intervaloActivo && (
                        <IntervaloModal delBloque={intervaloActivo} onClose={() => setIntervaloActivo(null)} />
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
