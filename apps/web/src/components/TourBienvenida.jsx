import React from 'react';
import { X } from 'lucide-react';
import { Btn } from '@/components/ui-kit';

// Demo de bienvenida, rediseñada el 18/09/2026 a pedido de Nalux ("así como
// tiene y muestra las tarjetas quiero", con capturas de otra app -- Drivvo --
// como referencia): en vez de un cuadro centrado y desconectado de la
// pantalla, cada paso resalta el ítem real del menú del que habla, con una
// tarjeta chica flotando al lado. AppLayout.jsx es quien renderiza todo esto
// (abre el cajón, mide la posición del ítem, aplica el resaltado) -- este
// archivo solo guarda el CONTENIDO de cada paso, en el mismo orden que el
// array NAV de AppLayout.jsx, para que se pueda recorrer con el mismo índice.
export const PASOS_TOUR = [
    {
        to: '/panel',
        texto: '¡Bienvenido a RutNail! Este recorrido rápido te muestra qué hay en cada sección. Aquí, en el Panel, ves de un vistazo alumnos activos, asistencia de la semana y caja del mes.',
    },
    {
        to: '/alumnos',
        texto: 'Registra a tus alumnos y accede a la ficha completa de cada uno: rutina, plan de alimentación, progreso, asistencia y pagos.',
    },
    {
        to: '/ejercicios',
        texto: 'La biblioteca de ejercicios, con 500 ya incluidos y foto o video de cómo se hacen. Puedes agregar los tuyos.',
    },
    {
        to: '/rutinas',
        texto: 'Crea cada rutina una sola vez y asígnala a todos los alumnos que la necesiten.',
    },
    {
        to: '/alimentos',
        texto: 'Tu biblioteca de alimentos, con calorías y macronutrientes por porción.',
    },
    {
        to: '/planes-alimentacion',
        texto: 'Crea planes de comidas y asígnalos a tus alumnos, igual que las rutinas.',
    },
    {
        to: '/asistencia',
        texto: 'Marca presente o ausente cada día, para todos tus alumnos activos.',
    },
    {
        to: '/pagos',
        texto: 'Registra cada cobro. La aplicación lleva automáticamente la caja del mes y el estado de cuota de cada alumno.',
    },
    {
        to: '/avisos',
        texto: 'Envía mensajes a tus alumnos según el estado de su cuota.',
    },
    {
        to: '/noticias',
        texto: 'Sube una foto o arma un cartel con título y texto (una promoción, un evento, un cambio de horario) y tus alumnos lo ven arriba de todo al abrir su rutina.',
    },
    {
        to: '/precios',
        texto: 'Define qué cobras y por cuánto tiempo, con descuentos y recargo por mora si lo deseas.',
    },
    {
        to: '/configuracion',
        texto: 'Nombre, logo, color y reglas de tu gimnasio. Un buen lugar para empezar. Ante cualquier duda, busca el ícono "i" de cada pantalla.',
    },
];

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
