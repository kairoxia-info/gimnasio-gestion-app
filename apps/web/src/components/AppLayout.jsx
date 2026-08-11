import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
    Apple,
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
import { LOGO_URL } from '@/lib/data';

const NAV = [
    { to: '/panel', label: 'Panel', icon: LayoutDashboard },
    { to: '/alumnos', label: 'Alumnos', icon: Users },
    { to: '/ejercicios', label: 'Ejercicios', icon: Dumbbell },
    { to: '/alimentos', label: 'Alimentos', icon: Apple },
    { to: '/asistencia', label: 'Asistencia', icon: CalendarCheck },
    { to: '/pagos', label: 'Pagos', icon: Wallet },
    { to: '/configuracion', label: 'Precios', icon: Settings },
];

export const Logo = ({ className = 'h-10' }) => (
    <img
        src={LOGO_URL}
        alt="Fitness Gym Place"
        className={`${className} w-auto object-contain mix-blend-multiply dark:mix-blend-screen dark:invert`}
    />
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
    const { logout, user } = useAuth();
    const navigate = useNavigate();

    const salir = () => {
        logout();
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
                            <Logo className="h-12" />
                        </Link>
                        {links}
                    </div>
                    <div className="space-y-2 px-1">
                        <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                        <button
                            type="button"
                            onClick={salir}
                            className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium transition hover:border-primary active:scale-[0.98]"
                        >
                            <LogOut className="h-4 w-4" strokeWidth={1.9} /> Cerrar sesión
                        </button>
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
                            <div className="lg:hidden">
                                <Logo className="h-9" />
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
                        <div className="mb-6 flex items-center justify-between">
                            <Logo className="h-10" />
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                aria-label="Cerrar menú"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border"
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
                    </div>
                </div>
            )}
        </div>
    );
};

export default AppLayout;
