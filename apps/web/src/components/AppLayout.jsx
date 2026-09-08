import React, { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTheme } from 'next-themes';
import {
    Apple,
    Building2,
    CalendarCheck,
    ChefHat,
    ClipboardList,
    Dumbbell,
    LayoutDashboard,
    LogOut,
    Megaphone,
    Menu,
    Moon,
    Settings,
    Sun,
    Tag,
    Users,
    Wallet,
    WifiOff,
    X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import NotificacionesCampana from '@/components/NotificacionesCampana';
import { listAll, updateRec } from '@/lib/data';
import { estadoCuota, ultimoPagoDeAlumno } from '@/lib/format';
import { onCambioCola, verCola } from '@/lib/offline';

const NAV = [
    { to: '/panel', label: 'Panel', icon: LayoutDashboard },
    { to: '/alumnos', label: 'Alumnos', icon: Users },
    { to: '/ejercicios', label: 'Ejercicios', icon: Dumbbell },
    { to: '/rutinas', label: 'Rutinas de ejercicios', icon: ClipboardList },
    { to: '/alimentos', label: 'Alimentos', icon: Apple },
    { to: '/planes-alimentacion', label: 'Planes de alimentación', icon: ChefHat },
    { to: '/asistencia', label: 'Asistencia', icon: CalendarCheck },
    { to: '/pagos', label: 'Pagos', icon: Wallet },
    { to: '/avisos', label: 'Avisos', icon: Megaphone },
    { to: '/precios', label: 'Precios', icon: Tag },
    { to: '/configuracion', label: 'Configuración', icon: Settings },
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
                className={`${size.badge} inline-flex shrink-0 items-center justify-center rounded-xl border border-[#8f9db2]/30 bg-[#8f9db2]/10`}
            >
                <Dumbbell aria-hidden="true" className={`${size.icon} text-[#aebbcf]`} strokeWidth={2.2} />
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
                    <span className="kx-shimmer">Kairox</span> IA
                </span>
            </span>
        </div>
    );
};

// Marca del GIMNASIO del profe logueado (logo + nombre, cargados en el
// onboarding/Configuración) — esto es lo que tiene que resaltar *adentro* de
// la app, no la marca de Kairox (esa vive aparte, en KairoxFooterMark).
//
// Reportado por Nalux (03/09/2026): "la imagen logo está bien, después el
// nombre del gym, que se vea al lado del logo arriba en el banner, no tan
// grande que sea chico y sutil". Antes, en cuanto el gimnasio tenía logo
// cargado, el nombre desaparecía por completo (el <img> se devolvía solo, sin
// texto al lado) — solo se veía el nombre en el caso sin-logo, ahí sí bien
// grande porque tenía que cargar solo con todo el peso visual de la marca.
// Ahora el logo (o el ícono genérico de respaldo si todavía no subió uno) y
// el nombre van siempre juntos; el tratamiento del texto cambia según el
// caso: chico/gris/sin mayúsculas al lado de un logo real (el logo ya es la
// marca, el nombre es apoyo), grande/en mayúsculas cuando el nombre ES la
// única marca disponible (sin logo, tiene que sostener el peso solo).
const GIMNASIO_TEXT_SIZES = {
    'h-9': { icon: 'h-4 w-4', text: 'text-sm' },
    'h-10': { icon: 'h-[18px] w-[18px]', text: 'text-base' },
    'h-12': { icon: 'h-5 w-5', text: 'text-lg' },
};

const GIMNASIO_NOMBRE_JUNTO_A_LOGO_SIZES = {
    'h-9': 'text-[11px]',
    'h-10': 'text-xs',
    'h-12': 'text-sm',
};

const GimnasioMark = ({ className = 'h-10' }) => {
    const { gimnasio } = useAuth();
    const [imgFailed, setImgFailed] = useState(false);
    const nombre = gimnasio?.nombre || 'Tu gimnasio';

    if (gimnasio?.logo_url && !imgFailed) {
        const textoSize = GIMNASIO_NOMBRE_JUNTO_A_LOGO_SIZES[className] || GIMNASIO_NOMBRE_JUNTO_A_LOGO_SIZES['h-10'];
        return (
            <div className={`${className} inline-flex w-auto min-w-0 items-center gap-2`}>
                <img
                    src={gimnasio.logo_url}
                    alt={nombre}
                    title={nombre}
                    onError={() => setImgFailed(true)}
                    className="h-full w-auto max-w-full shrink-0 rounded-lg object-contain"
                />
                <span className={`min-w-0 truncate font-semibold leading-none tracking-tight text-muted-foreground ${textoSize}`}>
                    {nombre}
                </span>
            </div>
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

// Menú del celular con entrada en cascada + un brillo que recorre cada
// botón una sola vez, pedido de Nalux (07/09/2026): "que vallan
// desplegándose los botones del menu como si un rayo dorado pasara".
// Reemplazado por un brillo neutro (blanco/plata, no dorado) a pedido suyo
// también: un dorado fijo desentonaría en un gimnasio cuyo color de marca
// no combine con él, mientras que este blanco translúcido queda bien
// encima de cualquier color que el profesor elija en Configuración.
//
// A propósito SOLO se usa acá, en el drawer del celular (que se abre/cierra
// a demanda) -- nunca en el sidebar fijo de la computadora. AppLayout se
// remonta en cada cambio de página (cada pantalla lo envuelve por separado,
// no hay un layout persistente a nivel de rutas), así que animar el sidebar
// se vería como un parpadeo en cada click de navegación, no como un menú
// "que se despliega". El drawer sí es un despliegue real, a pedido del
// profesor, así que ahí el efecto tiene sentido y se ve una vez por apertura.
const contenedorMenuVariants = {
    oculto: {},
    visible: { transition: { staggerChildren: 0.045, delayChildren: 0.05 } },
};

const itemMenuVariants = {
    oculto: { opacity: 0, x: -14 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
};

// El brillo en sí: una franja diagonal translúcida que atraviesa el botón
// una vez, con un pequeño delay para que se sienta "detrás" de la aparición
// del texto, no encima. transform (no background-position) para que sea
// composición GPU, no repintado -- barato incluso repetido 11 veces.
const brilloVariants = {
    oculto: { opacity: 0, x: '-120%' },
    visible: {
        opacity: [0, 1, 0],
        x: ['-120%', '120%'],
        transition: { duration: 0.65, delay: 0.1, ease: 'easeInOut' },
    },
};

const NavLinksAnimados = ({ nav, onNavegar }) => {
    const reduceMotion = useReducedMotion();
    if (reduceMotion) {
        // Sin animación si el sistema la pidió apagada -- mismo criterio que
        // ya usa Reveal.jsx en el resto de la app.
        return (
            <nav className="flex flex-col gap-1">
                {nav.map(({ to, label, icon: Icon }) => (
                    <NavLink
                        key={to}
                        to={to}
                        onClick={onNavegar}
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
    }

    return (
        <motion.nav
            className="flex flex-col gap-1"
            variants={contenedorMenuVariants}
            initial="oculto"
            animate="visible"
        >
            {nav.map(({ to, label, icon: Icon }) => (
                <motion.div key={to} variants={itemMenuVariants} className="relative overflow-hidden rounded-xl">
                    <NavLink
                        to={to}
                        onClick={onNavegar}
                        className={({ isActive }) =>
                            `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                                isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                            }`
                        }
                    >
                        <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                        {label}
                    </NavLink>
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

// Pedido de Nalux (04/09/2026): que el panel se pueda seguir usando si se
// corta el wifi del gimnasio, y que avise cuándo hay algo (asistencia,
// pagos) guardado en el celular todavía sin mandar. navigator.onLine puede
// arrancar en true por unos segundos aunque no haya señal real -- por eso
// esto es un aviso, no la fuente de verdad de si un dato en pantalla está
// actualizado.
const useEstadoOffline = () => {
    const [sinConexion, setSinConexion] = useState(!navigator.onLine);
    const [pendientes, setPendientes] = useState(() => verCola().length);

    useEffect(() => {
        const marcarOnline = () => setSinConexion(false);
        const marcarOffline = () => setSinConexion(true);
        window.addEventListener('online', marcarOnline);
        window.addEventListener('offline', marcarOffline);
        const desuscribir = onCambioCola((cola) => setPendientes(cola.length));
        return () => {
            window.removeEventListener('online', marcarOnline);
            window.removeEventListener('offline', marcarOffline);
            desuscribir();
        };
    }, []);

    return { sinConexion, pendientes };
};

const AppLayout = ({ title, subtitle, actions, children }) => {
    const [open, setOpen] = useState(false);
    const { signOut, user, profile } = useAuth();
    const navigate = useNavigate();
    const { sinConexion, pendientes } = useEstadoOffline();

    const salir = async () => {
        // Cerrar sesión limpia la cola de sincronización de este celular
        // (AuthContext.jsx) -- si todavía hay algo sin mandar, se perdería.
        // Nunca debería pasar en el uso normal (se manda solo apenas vuelve
        // la señal), pero si justo se corta de nuevo a mitad de camino, hay
        // que avisar antes de perderlo.
        if (pendientes > 0) {
            const seguir = window.confirm(
                `Todavía hay ${pendientes} ${pendientes === 1 ? 'cambio' : 'cambios'} sin mandar (asistencia o pagos cargados sin conexión). Si cerrás sesión ahora se pierden. ¿Cerrar igual?`,
            );
            if (!seguir) return;
        }
        await signOut();
        navigate('/login', { replace: true });
    };

    // Política "dar de baja" (Configuración, migraciones 0020/0021): cuando
    // un alumno vence la cuota (pasado el plazo de gracia), pasa a
    // activo=false solo. No hay pg_cron acá -- alcanza con chequear esto una
    // vez por día, la primera vez que un profesor autenticado abre cualquier
    // pantalla (AppLayout envuelve TODAS), en vez de instalar infraestructura
    // de scheduling nueva para algo que no necesita correr a un minuto
    // exacto. localStorage guarda la última fecha en que corrió, por
    // gimnasio, para no repetir la consulta en cada click de navegación.
    useEffect(() => {
        const gimnasioId = profile?.gimnasio_id;
        if (!gimnasioId) return undefined;

        const clave = `chequeoVencimiento:${gimnasioId}`;
        const hoyStr = new Date().toISOString().slice(0, 10);
        let cancelado = false;
        try {
            if (localStorage.getItem(clave) === hoyStr) return undefined;
        } catch (_) {
            // Sin localStorage (modo privado estricto, etc.): sigue igual,
            // simplemente va a volver a chequear en la próxima carga.
        }

        (async () => {
            try {
                const [gim] = await listAll('gimnasios', { filters: { id: gimnasioId } });
                if (cancelado || gim?.politica_vencimiento_cuota !== 'dar_de_baja') {
                    if (!cancelado) {
                        try {
                            localStorage.setItem(clave, hoyStr);
                        } catch (_) {
                            // nada que hacer sin localStorage
                        }
                    }
                    return;
                }

                const [alumnos, pagos] = await Promise.all([
                    listAll('alumnos', { filters: { activo: true } }),
                    listAll('pagos'),
                ]);
                if (cancelado) return;

                const config = { dias_gracia_cuota: gim.dias_gracia_cuota };
                const idsABajar = alumnos
                    .filter((a) => {
                        const estado = estadoCuota(ultimoPagoDeAlumno(a.id, pagos), config);
                        return estado === 'vencido' || estado === 'con_deuda';
                    })
                    .map((a) => a.id);

                if (idsABajar.length > 0 && !cancelado) {
                    await Promise.all(idsABajar.map((id) => updateRec('alumnos', id, { activo: false })));
                }
                if (!cancelado) {
                    try {
                        localStorage.setItem(clave, hoyStr);
                    } catch (_) {
                        // nada que hacer sin localStorage
                    }
                }
            } catch (_) {
                // Silencioso a propósito: si falla (red, permisos), no se
                // guarda la fecha -- se vuelve a intentar en la próxima
                // pantalla que abra, en vez de quedar un día entero sin
                // aplicar la baja por un error transitorio.
            }
        })();

        return () => {
            cancelado = true;
        };
    }, [profile?.gimnasio_id]);

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
                {/* Reportado por Nalux (07/09/2026): en la computadora, con la ventana
                    poco alta (zoom del navegador, laptop de resolución baja, ventana
                    sin maximizar), no se veían ni el botón "Cerrar sesión" ni la marca
                    "Gestión GYM Kairox IA". Causa: todo el sidebar era un solo bloque
                    de alto fijo (h-screen) sin scroll propio -- si el menú de 11 ítems
                    más el pie no entraban en el alto disponible, lo que sobraba se
                    cortaba por debajo del borde, sin ninguna forma de llegar ahí (ni la
                    página scrollea, porque el aside es sticky y queda fijo en la
                    ventana). Ahora solo el menú del medio tiene scroll propio si hace
                    falta; el logo arriba y el pie (correo, Cerrar sesión, marca) quedan
                    siempre fijos y visibles, sin importar cuán baja sea la ventana. */}
                <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border py-6 lg:flex">
                    <div className="shrink-0 px-4">
                        <Link to="/panel" className="mb-8 block px-1">
                            <GimnasioMark className="h-12" />
                        </Link>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4">{links}</div>
                    <div className="shrink-0 space-y-3 px-4 pt-3">
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
                                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border lg:hidden"
                            >
                                <Menu className="h-5 w-5" />
                            </button>
                            <div className="min-w-0 lg:hidden">
                                <GimnasioMark className="h-9" />
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-2">
                                <NotificacionesCampana />
                                {/* El botón de acción de cada pantalla ("Nuevo alumno",
                                    "Registrar pago", etc.) sale de esta barra en el
                                    celular y pasa a la fila de abajo. Reportado por
                                    Nalux (07/09/2026) como "letras encimadas": en 375px
                                    no entran a la vez el nombre del gimnasio y un botón
                                    con texto, así que el nombre quedaba cortado en
                                    "Mi G..." y el botón se partía en dos renglones.
                                    Abajo entra entero y además es más fácil de tocar. */}
                                <div className="hidden items-center gap-2 sm:flex">{actions}</div>
                                <ThemeToggle />
                            </div>
                        </div>
                        {actions && (
                            <div className="flex flex-wrap gap-2 px-4 pb-3 sm:hidden [&>*]:flex-1">{actions}</div>
                        )}
                    </header>

                    {(sinConexion || pendientes > 0) && (
                        <div className="flex items-center justify-center gap-2 bg-warn/15 px-4 py-2 text-center text-xs font-semibold text-warn">
                            <WifiOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
                            {sinConexion
                                ? 'Sin conexión -- mostrando lo último cargado. Lo que hagas ahora se manda solo apenas vuelva la señal.'
                                : `Sincronizando ${pendientes} ${pendientes === 1 ? 'pendiente' : 'pendientes'}...`}
                        </div>
                    )}

                    <div className="px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
                        {(title || subtitle) && (
                            <div className="mb-7">
                                {/* Sin uppercase (07/09/2026): el título de cada pantalla
                                    en mayúscula sostenida ("PANEL GENERAL", "PAGOS Y CAJA")
                                    le daba a toda la navegación un tono de cartel de
                                    gimnasio de fierros. Las mayúsculas quedan reservadas
                                    para la marca -- el wordmark de Kairox y el nombre del
                                    gimnasio -- que es donde aportan identidad en vez de
                                    volumen. */}
                                {title && (
                                    <h1 className="font-display text-3xl font-extrabold sm:text-4xl">
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

            {/* AnimatePresence: antes esto aparecía y desaparecía de golpe
                (if (open) return null-equivalente). Ahora el fondo hace fade y
                el panel entra deslizando desde la izquierda, y lo mismo a la
                inversa al cerrar -- consistente con el brillo del menú de
                abajo, en vez de un corte seco al lado de una animación nueva. */}
            <AnimatePresence>
                {open && (
                    <div className="fixed inset-0 z-50 lg:hidden">
                        <motion.div
                            className="absolute inset-0 bg-black/70"
                            onClick={() => setOpen(false)}
                            role="presentation"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                        />
                        <motion.div
                            className="absolute inset-y-0 left-0 w-72 border-r border-border bg-background px-4 py-6"
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        >
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
                            <NavLinksAnimados nav={NAV} onNavegar={() => setOpen(false)} />
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
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default AppLayout;
