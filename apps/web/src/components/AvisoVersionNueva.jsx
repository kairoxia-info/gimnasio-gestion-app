/* global __VERSION_APP__ */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';

// Aviso de versión nueva (pedido de Nalux, 03/11/2026): cuando se sube una versión nueva, a quien tiene
// la app abierta (profesor, equipo o alumno) le aparece un cartel con "Actualizar". No se recarga sola
// sin preguntar: el profesor podría estar a mitad de cargar un pago y lo perdería.
//
// Cómo sabe que hay una versión nueva: cada compilación escribe /version.json con un identificador y
// deja ese mismo identificador dentro del código (plugins/vite-plugin-version-app.js). Si el de
// /version.json ya no coincide con el de la app que está corriendo, se subió otra versión.
// "obligatoria" (aviso-version.json, para un arreglo urgente) saca el botón "Después".

const CADA_MS = 5 * 60_000; // revisa cada 5 minutos con la app abierta
const MINIMO_ENTRE_CONSULTAS_MS = 60_000; // y al volver a la pestaña, como mucho una vez por minuto
const POSPONER_MS = 30 * 60_000; // "Después" lo esconde media hora

// En la presentación y los términos no hay nada que perder ni nadie trabajando: no se molesta al visitante.
const RUTAS_SIN_AVISO = ['/', '/presentacion', '/terminos'];

const AvisoVersionNueva = () => {
    const { pathname } = useLocation();
    const [nueva, setNueva] = useState(null);
    const [pospuestaHasta, setPospuestaHasta] = useState(0);
    const ultimaConsulta = useRef(0);

    const revisar = useCallback(async () => {
        if (Date.now() - ultimaConsulta.current < MINIMO_ENTRE_CONSULTAS_MS) return;
        ultimaConsulta.current = Date.now();
        try {
            const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!r.ok) return;
            const datos = await r.json();
            if (datos?.version && datos.version !== __VERSION_APP__) setNueva(datos);
        } catch (_) {
            // sin conexión o archivo inexistente: se vuelve a probar en la próxima vuelta
        }
    }, []);

    useEffect(() => {
        if (!import.meta.env.PROD) return undefined;
        // La primera consulta espera un poco: no compite con la carga inicial de la app.
        const inicio = setTimeout(revisar, 15_000);
        const intervalo = setInterval(revisar, CADA_MS);
        const alVolver = () => {
            if (document.visibilityState === 'visible') revisar();
        };
        document.addEventListener('visibilitychange', alVolver);
        window.addEventListener('focus', alVolver);
        return () => {
            clearTimeout(inicio);
            clearInterval(intervalo);
            document.removeEventListener('visibilitychange', alVolver);
            window.removeEventListener('focus', alVolver);
        };
    }, [revisar]);

    if (!nueva || RUTAS_SIN_AVISO.includes(pathname)) return null;
    if (!nueva.obligatoria && Date.now() < pospuestaHasta) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed inset-x-4 bottom-4 z-50 mb-[env(safe-area-inset-bottom)] rounded-2xl border border-primary/60 bg-card p-4 text-foreground shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[22rem]"
        >
            <div className="flex items-start gap-3">
                <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={2.2} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="font-semibold">Hay una versión nueva de RutNail</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {nueva.mensaje ||
                            (nueva.obligatoria
                                ? 'Es una actualización importante: actualiza para seguir usando la app.'
                                : 'Actualiza para ver las mejoras. Si estás cargando algo, termina primero.')}
                    </p>
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition active:scale-[0.98]"
                        >
                            Actualizar
                        </button>
                        {!nueva.obligatoria && (
                            <button
                                type="button"
                                onClick={() => setPospuestaHasta(Date.now() + POSPONER_MS)}
                                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold transition hover:border-primary active:scale-[0.98]"
                            >
                                Después
                            </button>
                        )}
                    </div>
                </div>
                {!nueva.obligatoria && (
                    <button
                        type="button"
                        onClick={() => setPospuestaHasta(Date.now() + POSPONER_MS)}
                        aria-label="Cerrar aviso"
                        className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>
        </div>
    );
};

export default AvisoVersionNueva;
