import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
    Apple,
    Building2,
    CalendarCheck,
    Dumbbell,
    LayoutDashboard,
    LogOut,
    Menu,
    Moon,
    Settings,
    Sun,
    Users,
    Wallet,
    X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const NAV = [
    { to: '/panel', label: 'Panel', icon: LayoutDashboard },
    { to: '/alumnos', label: 'Alumnos', icon: Users },
    { to: '/ejercicios', label: 'Ejercicios', icon: Dumbbell },
    { to: '/alimentos', label: 'Alimentos', icon: Apple },
    { to: '/asistencia', label: 'Asistencia', icon: CalendarCheck },
    { to: '/pagos', label: 'Pagos', icon: Wallet },
    { to: '/configuracion', label: 'Precios', icon: Settings },
];

// Wordmark propio (ícono + texto), a propósito sin ninguna imagen externa:
// el LOGO_URL viejo apuntaba al logo real de otro gimnasio (asset de la
// demo de Hostinger Horizons), no algo que podamos usar como marca propia.
// Mapeo de tamaño porque los 6 lugares donde se usa <Logo> pasan alturas
// fijas distintas (sidebar, header mobile, drawer, login, onboarding,
// restablecer contraseña) — sin esto el texto no escala junto al ícono.
// "badge" es la insignia cuadrada de fondo; "icon" siempre queda notoriamente
// más chico que "badge" (icono con margen adentro, no pegado a los bordes).
const LOGO_SIZES = {
    'h-9': { badge: 'h-8 w-8', icon: 'h-4 w-4', text: 'text-sm' },
    'h-10': { badge: 'h-9 w-9', icon: 'h-[18px] w-[18px]', text: 'text-base' },
    'h-12': { badge: 'h-11 w-11', icon: 'h-5 w-5', text: 'text-lg' },
    'h-20': { badge: 'h-16 w-16', icon: 'h-8 w-8', text: 'text-3xl' },
    'h-24': { badge: 'h-[4.5rem] w-[4.5rem]', icon: 'h-9 w-9', text: 'text-4xl' },
};

export const Logo = ({ className = 'h-10' }) => {
    const size = LOGO_SIZES[className] || LOGO_SIZES['h-10'];
    return (
        <div className={`${className} inline-flex w-auto items-center gap-2.5 text-foreground`}>
            <span
                className={`${size.badge} inline-flex shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10`}
            >
                <Dumbbell aria-hidden="true" className={`${size.icon} text-primary`} strokeWidth={2.2} />
            </span>
            {/* Dos líneas a propósito: "Gestión GYM Kairox IA" entero no
                entra en una sola línea sin desbordar ni la tarjeta de login
                ni el sidebar angosto (medido: 431px de texto vs ~302px
                disponibles en la tarjeta). Partido, cada línea es la mitad
                de ancho y entra cómodo en cualquiera de los 6 contextos. */}
            <span
                className={`font-display ${size.text} whitespace-nowrap font-extrabold uppercase leading-[1.05] tracking-tight`}
            >
                <span className="block">Gestión GYM</span>
                <span className="block">
                    <span className="text-primary">Kairox</span> IA
                </span>
            </span>
        </div>
    );
};

// Marca del GIMNASIO del profe logueado (nombre + logo propio, cargados en el
// onboarding) — esto es lo que tiene que resaltar *adentro* de la app, no la
// marca de Kairox. Si todavía no subió logo, cae a un ícono genérico + el
// nombre en texto (con truncate: el nombre del gimnasio es arbitrario, puede
// ser mucho más largo que "Gestión GYM Kairox IA").
const GIMNASIO_TEXT_SIZES = {
    'h-9': { icon: 'h-4 w-4', text: 'text-sm' },
    'h-10': { icon: 'h-[18px] w-[18px]', text: 'text-base' },
    'h-12': { icon: 'h-5 w-5', text: 'text-lg' },
};

const GimnasioMark = ({ className = 'h-10' }) => {
    const { gimnasio } = useAuth();
    const [imgFailed, setImgFailed] = useState(false);
    const nombre = gimnasio?.nombre || 'Tu gimnasio';

    if (gimnasio?.logo_url && !imgFailed) {
        return (
            <img
                src={gimnasio.logo_url}
                alt={nombre}
                title={nombre}
                onError={() => setImgFailed(true)}
                className={`${className} w-auto max-w-full shrink-0 rounded-lg object-contain`}
            />
        );
    }

    const size = GIMNASIO_TEXT_SIZES[className] || GIMNASIO_TEXT_SIZES['h-10'];
    return (
        <div className={`${className} inline-flex w-auto min-w-0 items-center gap-2 text-foreground`}>
            <Building2 className={`${size.icon} shrink-0 text-primary`} strokeWidth={2.2} />
            <span
                className={`font-display ${size.text} min-w-0 truncate font-extrabold uppercase leading-none tracking-tight`}
            >
                {nombre}
            </span>
        </div>
    );
};

// Firma chica de la plataforma, para adentro de la app — a propósito discreta:
// "Gestión GYM Kairox IA" tiene que resaltar en el login, no acá, donde el
// protagonista es el gimnasio de cada profe (GimnasioMark, arriba).
const KairoxFooterMark = () => (
    <p className="text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        Gestión GYM Kairox IA
    </p>
);

const ThemeToggle = () => {
    const { theme, setTheme } = useTheme();
    const dark = theme !== 'light';
    return (
        <button
            type="button"
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            aria-label="Cambiar modo de color"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-foreground transition hover:border-primary active:scale-[0.96]"
        >
            {dark ? <Sun className="h-5 w-5" strokeWidth={1.8} /> : <Moon className="h-5 w-5" strokeWidth={1.8} />}
        </button>
    );
};

export { ThemeToggle };

const AppLayout = ({ title, subtitle, actions, children }) => {
    const [open, setOpen] = useState(false);
    const { signOut, user } = useAuth();
    const navigate = useNavigate();

    const salir = async () => {
        await signOut();
        navigate('/login', { replace: true });
    };

    const links = (
        <nav className="flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
                <NavLink
                    key={to}
                    to={to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                            isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                        }`
                    }
                >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                    {label}
                </NavLink>
            ))}
        </nav>
    );

    return (
        <div className="min-h-screen bg-background">
            <div className="mx-auto flex w-full max-w-[110rem]">
                <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-border px-4 py-6 lg:flex">
                    <div>
                        <Link to="/panel" className="mb-8 block px-1">
                            <GimnasioMark className="h-12" />
                        </Link>
                        {links}
                    </div>
                    <div className="space-y-3 px-1">
                        <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                        <button
                            type="button"
                            onClick={salir}
                            className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium transition hover:border-primary active:scale-[0.98]"
                        >
                            <LogOut className="h-4 w-4" strokeWidth={1.9} /> Cerrar sesión
                        </button>
                        <KairoxFooterMark />
                    </div>
                </aside>

                <main className="min-w-0 flex-1">
                    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
                        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
                            <button
                                type="button"
                                onClick={() => setOpen(true)}
                                aria-label="Abrir menú"
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border lg:hidden"
                            >
                                <Menu className="h-5 w-5" />
                            </button>
                            <div className="min-w-0 lg:hidden">
                                <GimnasioMark className="h-9" />
                            </div>
                            <div className="ml-auto flex items-center gap-2">
                                {actions}
                                <ThemeToggle />
                            </div>
                        </div>
                    </header>

                    <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
                        {(title || subtitle) && (
                            <div className="mb-7">
                                {title && (
                                    <h1 className="font-display text-3xl font-extrabold uppercase sm:text-4xl">
                                        {title}
                                    </h1>
                                )}
                                {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
                            </div>
                        )}
                        {children}
                    </div>
                </main>
            </div>

            {open && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div
                        className="absolute inset-0 bg-black/70"
                        onClick={() => setOpen(false)}
                        role="presentation"
                    />
                    <div className="absolute inset-y-0 left-0 w-72 border-r border-border bg-background px-4 py-6">
                        <div className="mb-6 flex items-center justify-between gap-3">
                            <GimnasioMark className="h-10" />
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                aria-label="Cerrar menú"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        {links}
                        <button
                            type="button"
                            onClick={salir}
                            className="mt-6 flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium"
                        >
                            <LogOut className="h-4 w-4" /> Cerrar sesión
                        </button>
                        <div className="mt-3">
                            <KairoxFooterMark />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AppLayout;
