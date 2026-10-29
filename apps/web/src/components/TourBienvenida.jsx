import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Btn } from '@/components/ui-kit';

// Demo de bienvenida, rediseñada el 18/09/2026 a pedido de Nalux (con capturas de otra app como
// referencia): cada paso resalta el ítem real del menú del que habla, con una tarjeta chica flotando al
// lado. AppLayout.jsx es quien renderiza todo esto (abre el cajón, mide la posición del ítem, aplica el
// resaltado). El CONTENIDO de los pasos (uno por ítem del menú, en su mismo orden, uno para el
// administrador y otro para el equipo) vive en lib/guiaDeUso.js, junto con la ayuda de cada pantalla y
// la Guía de uso, para que digan siempre lo mismo.

// Tarjeta flotante de un paso. `posicion` la calcula AppLayout.jsx midiendo
// el ítem real del menú (getBoundingClientRect): { top, left } en pantallas
// donde entra al lado del cajón (288px + la tarjeta + margen), o el string
// 'mobile' cuando no entra -- ahí se ancla abajo de todo, a lo ancho, en vez
// de intentar calcular una posición que en un teléfono angosto terminaría
// cortada.
const TarjetaTour = ({
    paso,
    total,
    titulo,
    texto,
    posicion,
    esPrimero,
    esUltimo,
    onAtras,
    onSiguiente,
    onCerrar,
}) => (
    <div
        role="dialog"
        aria-modal="true"
        aria-label={`Paso ${paso} de ${total}: ${titulo}`}
        style={posicion === 'mobile' ? undefined : { top: posicion.top, left: posicion.left }}
        className={
            posicion === 'mobile'
                ? 'fixed inset-x-3 bottom-3 z-[60] max-w-sm rounded-2xl border border-border bg-card p-4 shadow-2xl sm:inset-x-auto'
                : 'fixed z-[60] w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-card p-4 shadow-2xl'
        }
    >
        <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">
                Paso {paso} de {total}
            </p>
            <button
                type="button"
                onClick={onCerrar}
                aria-label="Cerrar recorrido"
                className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:text-foreground"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
        <p className="mt-1 font-display text-base font-bold">{titulo}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{texto}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
            {!esPrimero ? (
                <Btn variant="ghost" className="px-3 py-1.5 text-xs" onClick={onAtras}>
                    Atrás
                </Btn>
            ) : (
                <span />
            )}
            <Btn className="px-3 py-1.5 text-xs" onClick={onSiguiente}>
                {esUltimo ? 'Completar' : 'Próximo'}
            </Btn>
        </div>
    </div>
);

export default TarjetaTour;

// Alto del espacio que se agrega al final del menú mientras corre el recorrido en un teléfono (la
// tarjeta, anclada abajo, mide hasta ~260 px): así hasta el último ítem puede subir sin quedar tapado.
export const TOUR_ESPACIO_MOVIL_PX = 300;

// Dónde ubicar la tarjeta del paso actual, midiendo el ítem REAL del menú (id nav-tour-item-<id>).
// Se mide recién cuando el cajón terminó de entrar deslizando y el ítem dejó de moverse: en una carga
// lenta la animación tarda más que 300 ms y el ítem se medía todavía fuera de la pantalla (la tarjeta
// quedaba cortada a la izquierda). En un teléfono (menos de 640 px) la tarjeta se ancla abajo
// ('mobile') y el ítem sube arriba del menú para que no quede tapado. Lo usa el portal del alumno;
// AppLayout.jsx tiene su propia copia de la lógica (la del panel).
export const usePosicionTour = ({ activo, abierto, idItem }) => {
    const [posicion, setPosicion] = useState(null);
    useEffect(() => {
        if (!activo || !abierto) {
            setPosicion(null);
            return undefined;
        }
        let anterior = null;
        let intentos = 0;
        let reloj = null;
        const medir = () => {
            intentos += 1;
            const el = document.getElementById(`nav-tour-item-${idItem}`);
            if (!el) return;
            el.scrollIntoView({ block: window.innerWidth < 640 ? 'start' : 'nearest' });
            const r = el.getBoundingClientRect();
            const quieto = anterior && Math.abs(anterior.left - r.left) < 1 && Math.abs(anterior.top - r.top) < 1;
            anterior = { left: r.left, top: r.top };
            // Todavía entrando (o recién montado): esperar a la próxima medición.
            if (r.left < 0 || (!quieto && intentos < 20)) return;
            // Ya está quieto: se deja de medir cada 150 ms (solo vuelve a medir si cambia el tamaño).
            clearInterval(reloj);
            const anchoTarjeta = 320;
            const margen = 16;
            if (window.innerWidth - r.right < anchoTarjeta + margen * 2) {
                setPosicion('mobile');
                return;
            }
            setPosicion({
                top: Math.max(margen, Math.min(r.top, window.innerHeight - 260)),
                left: r.right + margen,
            });
        };
        reloj = setInterval(medir, 150);
        window.addEventListener('resize', medir);
        return () => {
            clearInterval(reloj);
            window.removeEventListener('resize', medir);
        };
    }, [activo, abierto, idItem]);
    return posicion;
};
