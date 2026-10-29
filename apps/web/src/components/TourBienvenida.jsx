import React from 'react';
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
