import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, X } from 'lucide-react';

export const Card = ({ className = '', children }) => (
    <div className={`rounded-2xl border border-border bg-card p-5 ${className}`}>{children}</div>
);

export const Btn = ({ variant = 'primary', className = '', type = 'button', ...props }) => {
    // "danger" (Eliminar/Quitar/Borrar en toda la app) va con --destructive,
    // no con --primary: bug real encontrado en revisión (07/09/2026). El
    // color de peligro tiene que ser siempre el mismo rojo, sin importar el
    // color de marca que cada gimnasio elija -- si un profesor configurara,
    // por ejemplo, un rojo o un naranja como color principal, un botón
    // "Eliminar" en ese mismo tono se distinguiría peor que uno que sigue
    // siendo rojo fijo (--destructive nunca lo pisa colorTema.js, a
    // propósito -- ver el comentario ahí).
    const styles = {
        primary: 'bg-primary text-primary-foreground hover:brightness-110',
        ghost: 'border border-border text-foreground hover:border-primary',
        danger: 'border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground',
    };
    // whitespace-nowrap: reportado por Nalux (07/09/2026) que en el celular
    // se veían "letras encimadas". En la barra de arriba, botones como "Nuevo
    // alumno" se partían en dos renglones al no entrar, el botón crecía a lo
    // alto y de paso le comía el ancho al nombre del gimnasio, que quedaba
    // cortado ("Mi G..."). Sin cortar el texto, el botón ocupa un solo
    // renglón y el reparto de ancho de la barra queda estable.
    // hover:-translate-y-px: micro-interacción consistente en toda la app
    // (07/09/2026). Antes solo las tarjetas del panel "respondían" al pasar
    // por encima y los botones no, así que la sensación de la interfaz
    // cambiaba de pantalla en pantalla. disabled:translate-y-0 para que un
    // botón deshabilitado no se mueva (no hay nada que responder ahí).
    return (
        <button
            type={type}
            className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] hover:-translate-y-px disabled:translate-y-0 disabled:opacity-50 ${styles[variant]} ${className}`}
            {...props}
        />
    );
};

const controlClass =
    'w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none';

export const Field = ({ label, children, className = '' }) => (
    <label className={`flex flex-col gap-2 ${className}`}>
        {label && <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>}
        {children}
    </label>
);

export const Input = ({ className = '', ...props }) => <input className={`${controlClass} ${className}`} {...props} />;

export const Textarea = ({ className = '', ...props }) => (
    <textarea className={`${controlClass} min-h-[90px] ${className}`} {...props} />
);

export const Select = ({ className = '', children, ...props }) => (
    <select className={`${controlClass} ${className}`} {...props}>
        {children}
    </select>
);

// Pedido de Nalux (08/09/2026): un ojito para mostrar/ocultar en toda caja de
// contraseña de la app (login de profesor, login de alumno, restablecer
// contraseña, confirmación al eliminar cuenta). Se arma acá, un solo lugar,
// para no repetir el mismo botón cuatro veces. Cada pantalla sigue poniendo
// su propio ícono de candado a la izquierda si quiere (queda afuera de este
// componente); acá solo se resuelve el botón de la derecha y el
// type="password"/"text" que alterna.
export const PasswordInput = ({ className = '', ...props }) => {
    const [visible, setVisible] = React.useState(false);
    return (
        <div className="relative">
            <input type={visible ? 'text' : 'password'} className={`${controlClass} pr-10 ${className}`} {...props} />
            <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                // Fuera del orden de tab: es un atajo visual, no un campo del
                // formulario -- si quedara en el tab natural, interrumpiría el
                // paso de "Contraseña" al botón de enviar.
                tabIndex={-1}
                aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
            >
                {visible ? <EyeOff className="h-4 w-4" strokeWidth={1.8} /> : <Eye className="h-4 w-4" strokeWidth={1.8} />}
            </button>
        </div>
    );
};

// Transición de entrada y salida (07/09/2026): antes aparecía y desaparecía
// de golpe, lo que quedaba raro al lado del resto de la app. El fondo hace
// fade y la tarjeta entra creciendo apenas.
//
// A propósito NO se cierra al hacer clic en el fondo: la mayoría de estos
// modales son formularios largos (nuevo alumno, registrar pago, armar una
// rutina) y un clic al costado sin querer haría perder todo lo cargado. Se
// cierra con la X o con Escape, que son acciones deliberadas.
export const Modal = ({ open, onClose, title, children, wide = false }) => {
    React.useEffect(() => {
        if (!open) return undefined;
        const alPresionar = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        window.addEventListener('keydown', alPresionar);
        return () => window.removeEventListener('keydown', alPresionar);
    }, [open, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl border border-border bg-card p-6`}
                        initial={{ opacity: 0, scale: 0.96, y: -8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -8 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <h2 className="font-display text-xl font-bold">{title}</h2>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Cerrar"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border transition hover:border-primary"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export const Empty = ({ children }) => (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {children}
    </div>
);

// Esqueleto de carga con la forma de lo que viene después (07/09/2026):
// antes eran bloques grises parejos, así que al terminar de cargar el
// contenido "saltaba" a otra forma. Ahora imita una fila de lista real
// -- avatar redondo + un renglón de título y otro más corto de detalle --
// que es la silueta de casi todas las listas de la app (alumnos, pagos,
// ejercicios). El ancho del segundo renglón alterna para que no se lea
// como un patrón mecánico.
export const Loading = ({ rows = 3 }) => (
    <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-2xl border border-border p-4">
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-secondary" />
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3.5 w-2/5 animate-pulse rounded-full bg-secondary" />
                    <div className={`h-3 animate-pulse rounded-full bg-secondary ${i % 2 ? 'w-1/3' : 'w-1/4'}`} />
                </div>
            </div>
        ))}
    </div>
);

// border-destructive, no border-primary: mismo motivo que "danger" en Btn
// (ver arriba) -- un error tiene que leerse como error, no como el color de
// marca de turno.
export const ErrorBox = ({ children }) => (
    <div className="rounded-2xl border border-destructive/60 bg-destructive/10 p-4 text-sm text-foreground">
        {children}
    </div>
);

export const Badge = ({ children, className = '' }) => (
    <span
        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}
    >
        {children}
    </span>
);
