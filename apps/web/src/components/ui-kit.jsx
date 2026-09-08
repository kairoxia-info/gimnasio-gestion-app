import React from 'react';
import { X } from 'lucide-react';

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
    return (
        <button
            type={type}
            className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 ${styles[variant]} ${className}`}
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

export const Modal = ({ open, onClose, title, children, wide = false }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-10">
            <div
                className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl border border-border bg-card p-6`}
            >
                <div className="mb-5 flex items-start justify-between gap-4">
                    <h2 className="font-display text-xl font-bold">{title}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
};

export const Empty = ({ children }) => (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {children}
    </div>
);

export const Loading = ({ rows = 3 }) => (
    <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-secondary" />
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
