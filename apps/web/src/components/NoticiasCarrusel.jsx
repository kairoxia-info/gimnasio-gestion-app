import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Newspaper } from 'lucide-react';
import NoticiaVista from '@/components/NoticiaVista';

// Carrusel de noticias del portal del alumno (migración 0069, pedido de
// Nalux 21/09/2026): con una sola noticia se muestra fija; con más de una,
// pasan solas cada 6 segundos y el alumno también las puede correr a mano
// -- deslizando con el dedo en el celular, con las flechas en la
// computadora, o tocando los puntitos en cualquiera de los dos.
//
// Sin librería de carrusel a propósito: es un track flex con translateX y
// tres gestos. Mismo espíritu que el cronómetro (MiPlanPage.jsx): lo justo,
// sin bajar nada nuevo para el celular del alumno.
//
// El alto lo decide la noticia más alta (son items de una misma fila flex,
// así que el contenedor toma el máximo y las más bajas se centran). Así una
// imagen no se recorta nunca (ver NoticiaVista) y el layout no salta al
// pasar de una a otra.
const INTERVALO_MS = 6000;
const UMBRAL_SWIPE_PX = 40;

const NoticiasCarrusel = ({ noticias }) => {
    const lista = Array.isArray(noticias) ? noticias : [];
    const varias = lista.length > 1;
    const [indice, setIndice] = useState(0);
    const [pausado, setPausado] = useState(false);
    const touchInicioX = useRef(null);

    // Si cambia la lista (refresco silencioso del plan) y el índice quedó
    // fuera de rango, volver al principio en vez de mostrar un hueco.
    useEffect(() => {
        if (indice >= lista.length) setIndice(0);
    }, [lista.length, indice]);

    // Pasar solo. Respeta "reducir movimiento" del sistema: ahí no se mueve
    // solo, solo a mano -- una tira que cambia sola es justo lo que esa
    // preferencia pide evitar.
    useEffect(() => {
        if (!varias || pausado) return undefined;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
        const t = setInterval(() => setIndice((i) => (i + 1) % lista.length), INTERVALO_MS);
        return () => clearInterval(t);
    }, [varias, pausado, lista.length]);

    if (lista.length === 0) return null;

    const ir = (i) => setIndice((i + lista.length) % lista.length);

    const onTouchStart = (e) => {
        touchInicioX.current = e.touches[0]?.clientX ?? null;
        setPausado(true);
    };
    const onTouchEnd = (e) => {
        const inicio = touchInicioX.current;
        touchInicioX.current = null;
        setPausado(false);
        if (inicio === null || !varias) return;
        const fin = e.changedTouches[0]?.clientX ?? inicio;
        const delta = fin - inicio;
        if (Math.abs(delta) < UMBRAL_SWIPE_PX) return;
        ir(delta < 0 ? indice + 1 : indice - 1);
    };

    return (
        <section
            aria-label="Noticias del gimnasio"
            className="mp-no-imprimir space-y-3"
            onMouseEnter={() => setPausado(true)}
            onMouseLeave={() => setPausado(false)}
        >
            {/* Título pedido por Nalux: sin él no quedaba claro que esto es
                distinto de Avisos (el cartel con "Entendido" de más abajo). */}
            <div className="flex items-center gap-2">
                <Newspaper className="h-5 w-5 text-primary" strokeWidth={2.2} aria-hidden="true" />
                <h2 className="font-display text-lg font-extrabold uppercase tracking-wide text-primary">
                    Noticias
                </h2>
            </div>

            <div className="relative">
                <div
                    className="overflow-hidden rounded-2xl"
                    onTouchStart={onTouchStart}
                    onTouchEnd={onTouchEnd}
                >
                    <div
                        className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
                        style={{ transform: `translateX(-${indice * 100}%)` }}
                    >
                        {lista.map((n, i) => (
                            <div
                                key={i}
                                className="flex w-full shrink-0 items-stretch justify-center"
                                aria-hidden={i !== indice}
                            >
                                <NoticiaVista noticia={n} />
                            </div>
                        ))}
                    </div>
                </div>

                {varias && (
                    <>
                        {/* Flechas: solo con mouse (desktop). En el celular sobra
                            con el dedo, y taparían parte de la imagen. */}
                        <button
                            type="button"
                            onClick={() => ir(indice - 1)}
                            aria-label="Noticia anterior"
                            className="absolute left-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow transition hover:bg-background sm:inline-flex"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => ir(indice + 1)}
                            aria-label="Noticia siguiente"
                            className="absolute right-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow transition hover:bg-background sm:inline-flex"
                        >
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    </>
                )}
            </div>

            {varias && (
                <div className="flex justify-center gap-2" role="tablist" aria-label="Elegir noticia">
                    {lista.map((_, i) => (
                        <button
                            key={i}
                            type="button"
                            role="tab"
                            aria-selected={i === indice}
                            aria-label={`Noticia ${i + 1} de ${lista.length}`}
                            onClick={() => ir(i)}
                            // Área de toque generosa (44px) aunque el puntito se vea chico.
                            className="flex h-11 w-11 items-center justify-center"
                        >
                            <span
                                className={`block rounded-full transition-all ${
                                    i === indice ? 'h-2.5 w-6 bg-primary' : 'h-2.5 w-2.5 bg-muted-foreground/40'
                                }`}
                            />
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
};

export default NoticiasCarrusel;
