import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';

// El cajón del menú: fondo oscuro con fade + panel que entra deslizando
// desde la izquierda, cabecera con la marca y una X, lista de opciones con
// scroll propio y un pie fijo. Vivía adentro de AppLayout.jsx (panel del
// profesor); se sacó a este archivo el 21/09/2026 para que el portal del
// alumno (MiPlanPage.jsx) use EXACTAMENTE el mismo menú -- pedido de Nalux:
// "mismo componente/patrón que ya usás en el panel del profesor, no inventes
// un diseño nuevo". AppLayout lo sigue usando igual que antes: cero cambio
// visual para el profesor.
//
// Lo que este componente NO sabe: quién está logueado, el tour, la cola
// offline, la campanita. Todo eso sigue en AppLayout y entra por props
// (encabezado, pie, children). Acá solo hay cajón.
//
// Cierra con la X, tocando el fondo o con Escape (mismo criterio que el
// Modal de ui-kit.jsx); cerrar al elegir una opción lo decide quien arma la
// lista (onNavegar de NavLinksAnimados).

// Entrada en cascada + un brillo que recorre cada botón una sola vez,
// pedido de Nalux (07/09/2026): "que vallan desplegándose los botones del
// menu como si un rayo dorado pasara". Brillo neutro (blanco/plata, no
// dorado) a pedido suyo también: un dorado fijo desentonaría en un gimnasio
// cuyo color de marca no combine con él. Solo tiene sentido en un cajón que
// se abre a demanda -- en un sidebar fijo se vería como un parpadeo.
const contenedorMenuVariants = {
    oculto: {},
    visible: { transition: { staggerChildren: 0.045, delayChildren: 0.05 } },
};

const itemMenuVariants = {
    oculto: { opacity: 0, x: -14 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
};

// transform (no background-position) para que sea composición GPU, no
// repintado -- barato incluso repetido 12 veces.
const brilloVariants = {
    oculto: { opacity: 0, x: '-120%' },
    visible: {
        opacity: [0, 1, 0],
        x: ['-120%', '120%'],
        transition: { duration: 0.65, delay: 0.1, ease: 'easeInOut' },
    },
};

// Cada ítem es o una RUTA (`to`, NavLink de react-router, como en el panel
// del profesor) o un ESTADO (`clave` + `activo` + `onSelect`, un botón --
// las secciones del alumno son vistas, no páginas). Mismas clases, misma
// animación, mismo id para el tour en los dos casos.
//
// `pasoTourTo` (18/09/2026, tour de bienvenida): el `to` del ítem que el
// tour está señalando ahora mismo, o null si no hay recorrido activo. Cada
// ítem lleva un `id` fijo (`nav-tour-item-<to>`) para que AppLayout pueda
// medir su posición real con getBoundingClientRect() y ubicar la tarjeta
// del paso al lado.
export const NavLinksAnimados = ({ nav, onNavegar, pasoTourTo }) => {
    const reduceMotion = useReducedMotion();
    const claseBase = 'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition';
    const claseItem = (id, isActive) => {
        if (pasoTourTo) {
            return id === pasoTourTo
                ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background'
                : 'text-muted-foreground opacity-40';
        }
        return isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground';
    };

    const renderItem = (item) => {
        const { label, icon: Icon } = item;
        const id = item.to ?? item.clave;
        if (item.to) {
            return (
                <NavLink
                    id={`nav-tour-item-${id}`}
                    to={item.to}
                    onClick={onNavegar}
                    className={({ isActive }) => `${claseBase} ${claseItem(id, isActive)}`}
                >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                    {label}
                </NavLink>
            );
        }
        return (
            <button
                type="button"
                id={`nav-tour-item-${id}`}
                aria-current={item.activo ? 'page' : undefined}
                onClick={() => {
                    item.onSelect?.();
                    onNavegar?.();
                }}
                className={`${claseBase} w-full text-left ${claseItem(id, item.activo)}`}
            >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                {label}
            </button>
        );
    };

    if (reduceMotion) {
        // Sin animación si el sistema la pidió apagada -- mismo criterio que
        // ya usa Reveal.jsx en el resto de la app.
        return (
            <nav className="flex flex-col gap-1">
                {nav.map((item) => (
                    <React.Fragment key={item.to ?? item.clave}>{renderItem(item)}</React.Fragment>
                ))}
            </nav>
        );
    }

    return (
        <motion.nav
            className="flex flex-col gap-1"
            variants={contenedorMenuVariants}
            initial="oculto"
            animate="visible"
        >
            {nav.map((item) => (
                <motion.div
                    key={item.to ?? item.clave}
                    variants={itemMenuVariants}
                    className="relative overflow-hidden rounded-xl"
                >
                    {renderItem(item)}
                    <motion.span
                        aria-hidden="true"
                        variants={brilloVariants}
                        className="pointer-events-none absolute inset-y-0 left-0 w-2/3 skew-x-[-20deg]"
                        style={{
                            background:
                                'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                        }}
                    />
                </motion.div>
            ))}
        </motion.nav>
    );
};

// AnimatePresence: el fondo hace fade y el panel entra deslizando desde la
// izquierda, y lo mismo a la inversa al cerrar -- consistente con el brillo
// del menú, en vez de un corte seco.
//
// Cabecera fija / menú con scroll propio / pie fijo: con la ventana poco
// alta no se cortan las opciones de abajo ni el pie por debajo del borde.
const CajonMenu = ({ abierto, onCerrar, encabezado, pie, children }) => {
    useEffect(() => {
        if (!abierto) return undefined;
        const alPresionar = (e) => {
            if (e.key === 'Escape') onCerrar?.();
        };
        window.addEventListener('keydown', alPresionar);
        return () => window.removeEventListener('keydown', alPresionar);
    }, [abierto, onCerrar]);

    return (
        <AnimatePresence>
            {abierto && (
                <div className="fixed inset-0 z-50">
                    <motion.div
                        className="absolute inset-0 bg-black/70"
                        onClick={onCerrar}
                        role="presentation"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    />
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Menú"
                        className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-border bg-background py-6"
                        initial={{ x: '-100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '-100%' }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <div className="mb-6 flex shrink-0 items-center justify-between gap-3 px-4">
                            <div className="min-w-0 flex-1">{encabezado}</div>
                            <button
                                type="button"
                                onClick={onCerrar}
                                aria-label="Cerrar menú"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto px-4">{children}</div>
                        {pie && <div className="shrink-0 px-4 pt-4">{pie}</div>}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default CajonMenu;
