import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTheme } from 'next-themes';
import {
    AlertTriangle,
    Apple,
    Building2,
    CalendarCheck,
    ChefHat,
    ChevronDown,
    ClipboardList,
    Dumbbell,
    LayoutDashboard,
    LogOut,
    Megaphone,
    Menu,
    Moon,
    Newspaper,
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
import TarjetaTour, { PASOS_TOUR } from '@/components/TourBienvenida';
import { AyudaInfo } from '@/components/ui-kit';
import { listAll, updateRec } from '@/lib/data';
import { estadoCuota, fmtFecha, money, ultimoPagoDeAlumno } from '@/lib/format';
import { descartarFallido, onCambioCola, onCambioColaFallida, verCola, verColaFallida } from '@/lib/offline';
import { copiarAlPortapapeles } from '@/lib/copiar';

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
    { to: '/noticias', label: 'Noticias', icon: Newspaper },
    { to: '/precios', label: 'Precios', icon: Tag },
    { to: '/configuracion', label: 'Configuración', icon: Settings },
];

// Marca propia de la app: RutNail (14/09/2026, reemplaza al wordmark de
// texto "Gestión GYM Kairox IA" + ícono de mancuerna que había antes). Nalux
// mandó el archivo del logo ya armado (fondo transparente, letras doradas +
// mancuerna adentro del círculo) -- acá solo se muestra como imagen, sin
// reconstruir nada de eso a mano. Usado en LoginPage/OnboardingPage/
// ResetPasswordPage con alturas fijas distintas; w-auto + object-contain
// hace que el ancho escale solo, sin deformar el logo ni recortarlo.
export const Logo = ({ className = 'h-10' }) => (
    <img src="/logo-rutnail.png" alt="RutNail" className={`${className} w-auto object-contain`} />
);

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
// el nombre van siempre juntos.
//
// Vuelta atrás (15/09/2026, pedido de Nalux: "poné más grande el título del
// gimnasio... que tenga una letra más grande igual que el logo"): el
// tratamiento chico/gris de acá arriba quedó chico de más al lado de un logo
// real -- ahora el nombre pesa lo mismo que el logo (texto grande, color
// pleno, negrita) tenga o no tenga logo cargado el gimnasio.
const GIMNASIO_TEXT_SIZES = {
    'h-9': { icon: 'h-4 w-4', text: 'text-sm' },
    'h-10': { icon: 'h-[18px] w-[18px]', text: 'text-base' },
    'h-12': { icon: 'h-5 w-5', text: 'text-lg' },
};

const GIMNASIO_NOMBRE_JUNTO_A_LOGO_SIZES = {
    'h-9': 'text-lg',
    'h-10': 'text-xl',
    'h-12': 'text-2xl',
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
                <span className={`min-w-0 truncate font-extrabold leading-none tracking-tight text-foreground ${textoSize}`}>
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

// Firma chica de la plataforma, para adentro de la app y para las pantallas
// públicas sin sesión (autorregistro, login del alumno) — a propósito
// discreta: el logo GRANDE de RutNail tiene que resaltar en el login del
// profesor, no acá, donde el protagonista es el gimnasio de cada profe
// (GimnasioMark, arriba) o directamente no hay ninguna marca de gimnasio
// todavía que mostrar. "Kairox IA" (14/09/2026, pedido de Nalux) lleva a la
// página oficial del creador -- se abre en pestaña nueva porque saca al
// visitante de la app a un sitio externo, mismo criterio que cualquier otro
// link externo de esta app (ej. WhatsApp).
//
// El logo chico de abajo (mismo día, pedido de Nalux: "que no ocupe mucho
// lugar pero que se vea") es el único lugar donde RutNail aparece DENTRO de
// la app ya logueada -- todo lo demás en esa pantalla es la marca del
// gimnasio del profe, así que esto queda chico y sin negrita a propósito,
// para no competir con eso (h-8/opacity-90, 14/09/2026: "no se ve bien el
// logo... agrandalo mas" -- h-5/opacity-70 quedaba demasiado chico y apagado
// para leerse bien; ver también el recorte del PNG en public/logo-
// rutnail.png, que tenía mucho margen transparente alrededor del dibujo
// real y lo hacía ver más chico todavía a cualquier tamaño).
//
// "Soporte" (03/09/2026): mailto directo a equipokairox.ia@gmail.com -- se
// muestra la palabra, no la dirección entera, mismo criterio visual que
// "Kairox IA" arriba (subrayado punteado, discreto) para que cualquiera
// entienda de un vistazo que es un link, sin ocupar más lugar que un mail
// escrito entero.
//
// Reportado por Nalux (15/09/2026): "el botón soporte no anda". El link en sí
// está bien armado (href="mailto:...") -- lo que pasa es que un mailto:
// depende de que el sistema operativo tenga un cliente de mail configurado
// (Outlook, Mail de Windows, etc.); si no hay ninguno, el clic no hace
// ABSOLUTAMENTE NADA visible -- ni un error, ni una pestaña nueva, nada --
// así que se lee exactamente como "no anda". Es el mismo problema de fondo
// que ya se corrigió para el botón "Copiar" del link del alumno (ver
// lib/copiar.js): una acción que puede fallar en silencio necesita un
// respaldo con feedback en pantalla. Acá el respaldo es copiar el mail al
// portapapeles en el mismo clic -- si el cliente de mail abre, mejor; si no
// abre nada, igual queda la dirección copiada y un aviso confirmándolo, en
// vez de que parezca un botón roto.
const EMAIL_SOPORTE = 'equipokairox.ia@gmail.com';

export const KairoxFooterMark = () => {
    const [copiado, setCopiado] = useState(false);

    const onSoporteClick = async () => {
        const ok = await copiarAlPortapapeles(EMAIL_SOPORTE);
        if (ok) {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2500);
        }
    };

    return (
        <div className="flex flex-col items-center gap-1.5">
            <p className="text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Creado por{' '}
                <a
                    href="https://kairox-ia.vercel.app/#inicio"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-dotted underline-offset-2 transition hover:text-foreground"
                >
                    Kairox IA
                </a>
            </p>
            <a
                href={`mailto:${EMAIL_SOPORTE}`}
                onClick={onSoporteClick}
                className="text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 underline decoration-dotted underline-offset-2 transition hover:text-foreground"
            >
                {copiado ? `Copiado: ${EMAIL_SOPORTE}` : 'Soporte'}
            </a>
            <img src="/logo-rutnail.png" alt="RutNail" className="mt-0.5 h-8 w-auto object-contain opacity-90" />
        </div>
    );
};

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

// `pasoTourTo` (18/09/2026, tour de bienvenida): el `to` del ítem que el
// tour está señalando ahora mismo, o null si no hay ningún recorrido activo.
// Cada NavLink lleva un `id` fijo (`nav-tour-item-<to>`) para que AppLayout
// pueda medir su posición real en pantalla con getBoundingClientRect() y
// ubicar la tarjeta del paso al lado -- sin eso no hay forma de saber dónde
// cayó cada ítem, sobre todo con la animación de entrada de abajo.
const NavLinksAnimados = ({ nav, onNavegar, pasoTourTo }) => {
    const reduceMotion = useReducedMotion();
    const claseItem = (to, isActive) => {
        if (pasoTourTo) {
            return to === pasoTourTo
                ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background'
                : 'text-muted-foreground opacity-40';
        }
        return isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground';
    };

    if (reduceMotion) {
        // Sin animación si el sistema la pidió apagada -- mismo criterio que
        // ya usa Reveal.jsx en el resto de la app.
        return (
            <nav className="flex flex-col gap-1">
                {nav.map(({ to, label, icon: Icon }) => (
                    <NavLink
                        key={to}
                        id={`nav-tour-item-${to}`}
                        to={to}
                        onClick={onNavegar}
                        className={({ isActive }) =>
                            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${claseItem(to, isActive)}`
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
                        id={`nav-tour-item-${to}`}
                        to={to}
                        onClick={onNavegar}
                        className={({ isActive }) =>
                            `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${claseItem(to, isActive)}`
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
    // Bug real encontrado en la auditoría final (15/09/2026): antes, si algo
    // fallaba al sincronizar por un motivo que NO era de red, se descartaba
    // solo -- el contador de "pendientes" bajaba a 0 igual, sin que quedara
    // ningún rastro visible de que algo no se guardó. lib/offline.js ahora
    // mueve esos casos a una segunda cola (fallidos) que NUNCA se vacía
    // sola -- hace falta que el profesor la vea y la resuelva a mano.
    const [fallidos, setFallidos] = useState(() => verColaFallida());

    useEffect(() => {
        const marcarOnline = () => setSinConexion(false);
        const marcarOffline = () => setSinConexion(true);
        window.addEventListener('online', marcarOnline);
        window.addEventListener('offline', marcarOffline);
        const desuscribir = onCambioCola((cola) => setPendientes(cola.length));
        const desuscribirFallidos = onCambioColaFallida(setFallidos);
        return () => {
            window.removeEventListener('online', marcarOnline);
            window.removeEventListener('offline', marcarOffline);
            desuscribir();
            desuscribirFallidos();
        };
    }, []);

    return { sinConexion, pendientes, fallidos };
};

// "Pago"/"Asistencia" + fecha + monto (si hay) -- lo mínimo para que el
// profesor reconozca DE QUÉ carga se trata sin tener que abrir nada. No hay
// nombre de alumno a mano acá (lib/offline.js es un módulo genérico, no
// tiene la lista de alumnos cargada) -- se orienta por fecha/monto, que
// alcanza para ubicarlo en Pagos/Asistencia de ese día.
const resumenFallido = (item) => {
    if (item.tipo === 'pago') {
        const monto = item.payload?.monto;
        return `Pago${monto ? ` de ${money(monto)}` : ''} del ${fmtFecha(item.payload?.fecha_pago)}`;
    }
    if (item.tipo === 'asistencia') {
        return `Asistencia del ${fmtFecha(item.payload?.fecha)}`;
    }
    return 'Un cambio sin identificar';
};

const AppLayout = ({ title, subtitle, ayuda, actions, children }) => {
    const [open, setOpen] = useState(false);
    const [confirmandoSalir, setConfirmandoSalir] = useState(false);
    // Pedido de Nalux (15/09/2026): "esa parte... ocupa mucho lugar" -- el
    // pie del menú (mail, Cerrar sesión, marca Kairox) apilaba 5 líneas
    // siempre visibles. Arranca plegado (lo que más se usa es navegar, no
    // ver el propio mail) y se abre con la flechita cuando hace falta.
    const [mostrarCuenta, setMostrarCuenta] = useState(false);
    const { signOut, user, profile, marcarTourVisto } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { sinConexion, pendientes, fallidos } = useEstadoOffline();

    // Tour de bienvenida (rediseñado 18/09/2026, a pedido de Nalux con
    // capturas de otra app como referencia): se dispara solo en el primer
    // aterrizaje real en /panel -- no con un deep-link directo a /pagos o
    // /alumnos -- y solo mientras profiles.tour_visto siga en false (una vez
    // por cuenta, para siempre). El contenido de cada paso vive en
    // TourBienvenida.jsx; acá se resuelve la parte que sí depende del
    // cajón real: abrirlo solo, señalar el ítem correspondiente y medir
    // dónde cae para ubicar la tarjeta al lado.
    const [pasoTour, setPasoTour] = useState(0);
    const guiaActiva = profile?.tour_visto === false && location.pathname === '/panel';
    const pasoActual = PASOS_TOUR[pasoTour];

    useEffect(() => {
        if (guiaActiva) setOpen(true);
    }, [guiaActiva]);

    // Cualquier forma de salir del recorrido -- Escape, tocar el fondo, la X
    // de la tarjeta o llegar al final -- lo marca como visto para siempre
    // (mismo criterio ya aplicado en otras partes de la app: aparece una
    // sola vez, sin excepciones). Cierre optimista: se oculta al toque, sin
    // esperar la respuesta de la RPC.
    const finalizarTour = () => {
        if (!guiaActiva) return;
        setPasoTour(0);
        marcarTourVisto();
    };

    // Cerrar el menú con Escape, además de la X / tocar afuera / elegir una
    // opción -- mismo criterio que el Modal de ui-kit.jsx.
    useEffect(() => {
        // Al cerrar el menú, el aviso de "hay cambios sin mandar" vuelve a
        // cero: si no, la próxima vez que se abre aparece ya confirmando algo
        // que el profesor no volvió a pedir.
        if (!open) {
            setConfirmandoSalir(false);
            return undefined;
        }
        const alPresionar = (e) => {
            if (e.key === 'Escape') {
                finalizarTour();
                setOpen(false);
            }
        };
        window.addEventListener('keydown', alPresionar);
        return () => window.removeEventListener('keydown', alPresionar);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, guiaActiva]);

    // Posición de la tarjeta del paso actual: se mide el ítem real del menú
    // (getBoundingClientRect) recién cuando el cajón terminó de animar su
    // entrada (280ms, mismo valor que la transición de abajo) -- medir antes
    // daría la posición de arranque (fuera de pantalla, a la izquierda). Si
    // no entra al lado (menos de 340px libres, típico en un teléfono), la
    // tarjeta se ancla abajo de todo en vez de calcular una posición que
    // terminaría cortada por el borde derecho.
    const [posicionTour, setPosicionTour] = useState(null);
    useEffect(() => {
        if (!guiaActiva || !open) {
            setPosicionTour(null);
            return undefined;
        }
        const medir = () => {
            const el = document.getElementById(`nav-tour-item-${pasoActual.to}`);
            if (!el) return;
            // Con 11 ítems no entran todos en el alto del cajón sin scroll --
            // sin esto, los últimos pasos (Precios, Configuración) señalarían
            // un ítem fuera de la vista. Instantáneo (no 'smooth') para que
            // el getBoundingClientRect() de abajo ya lea la posición final.
            el.scrollIntoView({ block: 'nearest' });
            const r = el.getBoundingClientRect();
            const anchoTarjeta = 320;
            const margen = 16;
            if (window.innerWidth - r.right < anchoTarjeta + margen * 2) {
                setPosicionTour('mobile');
                return;
            }
            setPosicionTour({
                top: Math.max(margen, Math.min(r.top, window.innerHeight - 260)),
                left: r.right + margen,
            });
        };
        const t = setTimeout(medir, 300);
        window.addEventListener('resize', medir);
        return () => {
            clearTimeout(t);
            window.removeEventListener('resize', medir);
        };
    }, [guiaActiva, open, pasoActual]);

    const salir = async (forzar = false) => {
        // Cerrar sesión limpia la cola de sincronización de este celular
        // (AuthContext.jsx) -- si todavía hay algo sin mandar, se perdería.
        // Nunca debería pasar en el uso normal (se manda solo apenas vuelve
        // la señal), pero si justo se corta de nuevo a mitad de camino, hay
        // que avisar antes de perderlo.
        //
        // El aviso lo dibuja la app, no window.confirm() (10/09/2026, repaso
        // general): con el cartel nativo, un navegador que lo suprime devuelve
        // false y ahí "Cerrar sesión" dejaba de funcionar del todo, sin
        // explicación -- el mismo síntoma que Nalux reportó en Rutinas.
        //
        // fallidos también avisa acá (15/09/2026): limpiarTodoOffline() borra
        // las dos colas para que un profesor distinto en el mismo celular no
        // vea nada de este -- si hay algo que falló de verdad y todavía no se
        // resolvió, cerrar sesión ahora lo saca de la vista para siempre.
        if ((pendientes > 0 || fallidos.length > 0) && !forzar) {
            setConfirmandoSalir(true);
            return;
        }
        setConfirmandoSalir(false);
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

    return (
        <div className="min-h-screen bg-background">
            {/* Pedido de Nalux (10/09/2026): "en pantalla grande el menú está
                fijo y no desplegable, quiero que sea desplegable". Antes la
                computadora tenía un <aside> permanente que ocupaba espacio
                siempre; ahora el menú es el mismo cajón desplegable en todos
                los tamaños -- se abre con el botón de menú, se cierra al
                elegir una opción, tocar afuera o con la X. Un solo menú en
                vez de dos, y sin el parpadeo que tendría un sidebar animado
                (AppLayout se remonta en cada navegación). */}
            <div className="mx-auto flex w-full max-w-[110rem]">
                <main className="min-w-0 flex-1">
                    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
                        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
                            <button
                                type="button"
                                onClick={() => setOpen(true)}
                                aria-label="Abrir menú"
                                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border transition hover:border-primary"
                            >
                                <Menu className="h-5 w-5" />
                            </button>
                            <Link to="/panel" className="min-w-0">
                                <GimnasioMark className="h-9" />
                            </Link>
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
                                ? 'Sin conexión -- mostrando lo último guardado. Lo que hagas ahora se enviará automáticamente en cuanto vuelva la señal.'
                                : `Sincronizando ${pendientes} ${pendientes === 1 ? 'pendiente' : 'pendientes'}...`}
                        </div>
                    )}

                    {/* Bug real encontrado en la auditoría final (15/09/2026): antes,
                        si un pago o asistencia cargado sin conexión fallaba al
                        sincronizar por un motivo que NO era de red, se descartaba
                        solo -- el profesor nunca se enteraba de que algo no se
                        guardó. A propósito NO se cierra solo ni con un tiempo, ni al
                        cambiar de pantalla: se queda ahí hasta que el profesor
                        revisa cada ítem y toca "Ya lo resolví". */}
                    {fallidos.length > 0 && (
                        <div className="space-y-2 bg-destructive/10 px-4 py-3 text-destructive">
                            <p className="flex items-center justify-center gap-2 text-center text-xs font-bold">
                                <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
                                {fallidos.length === 1
                                    ? 'Hubo un problema al guardar esto -- revisar si hace falta registrarlo de nuevo:'
                                    : `Hubo un problema al guardar estos ${fallidos.length} cambios -- revisar si hace falta registrarlos de nuevo:`}
                            </p>
                            <ul className="mx-auto max-w-md space-y-1.5">
                                {fallidos.map((item) => (
                                    <li
                                        key={item.id}
                                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/60 px-3 py-1.5 text-xs"
                                    >
                                        <span className="font-semibold">{resumenFallido(item)}</span>
                                        <button
                                            type="button"
                                            onClick={() => descartarFallido(item.id)}
                                            className="shrink-0 rounded-lg border border-destructive/40 px-2 py-1 font-semibold transition hover:bg-destructive/10"
                                        >
                                            Ya lo resolví
                                        </button>
                                    </li>
                                ))}
                            </ul>
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
                                {/* `ayuda` (16/09/2026): el ícono "i" va pegado al título
                                    de cada pantalla, en un solo lugar, en vez de que cada
                                    página lo arme por su cuenta. Cada página pasa su propio
                                    texto; sin texto, AyudaInfo no renderiza nada. */}
                                {title && (
                                    <div className="flex flex-wrap items-center gap-3">
                                        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">
                                            {title}
                                        </h1>
                                        <AyudaInfo texto={ayuda} />
                                    </div>
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
                    <div className="fixed inset-0 z-50">
                        <motion.div
                            className="absolute inset-0 bg-black/70"
                            onClick={() => {
                                finalizarTour();
                                setOpen(false);
                            }}
                            role="presentation"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                        />
                        {/* Header fijo / menú con scroll propio / pie fijo -- mismo
                            criterio que tenía el <aside> viejo, para que con la
                            ventana poco alta no se corten "Cerrar sesión" ni la
                            marca por debajo del borde. */}
                        <motion.div
                            className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-border bg-background py-6"
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <div className="mb-6 flex shrink-0 items-center justify-between gap-3 px-4">
                                <GimnasioMark className="h-10" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        finalizarTour();
                                        setOpen(false);
                                    }}
                                    aria-label="Cerrar menú"
                                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto px-4">
                                <NavLinksAnimados
                                    nav={NAV}
                                    onNavegar={() => setOpen(false)}
                                    pasoTourTo={guiaActiva ? pasoActual.to : null}
                                />
                            </div>
                            <div className="shrink-0 px-4 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setMostrarCuenta((v) => !v)}
                                    aria-expanded={mostrarCuenta}
                                    className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-primary"
                                >
                                    <span className="min-w-0 flex-1 truncate text-left">{user?.email}</span>
                                    <ChevronDown
                                        className={`h-4 w-4 shrink-0 transition-transform ${mostrarCuenta ? 'rotate-180' : ''}`}
                                    />
                                </button>
                                {mostrarCuenta && (
                                    <div className="mt-3 space-y-3">
                                        {confirmandoSalir ? (
                                            <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                                                <p className="text-xs text-muted-foreground">
                                                    {pendientes > 0 &&
                                                        `Hay ${pendientes} ${pendientes === 1 ? 'cambio' : 'cambios'} sin enviar (asistencia o pagos registrados sin conexión). `}
                                                    {fallidos.length > 0 &&
                                                        `Hay ${fallidos.length} ${fallidos.length === 1 ? 'cambio' : 'cambios'} que no se pudo${fallidos.length === 1 ? '' : 'n'} guardar y todavía no se resolvió. `}
                                                    Si se cierra sesión ahora se pierden.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => salir(true)}
                                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground transition active:scale-[0.98]"
                                                >
                                                    <LogOut className="h-4 w-4" /> Cerrar igual
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirmandoSalir(false)}
                                                    className="flex w-full items-center justify-center rounded-xl border border-border px-3 py-2 text-sm font-medium transition hover:border-primary active:scale-[0.98]"
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => salir()}
                                                className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium transition hover:border-primary active:scale-[0.98]"
                                            >
                                                <LogOut className="h-4 w-4" /> Cerrar sesión
                                            </button>
                                        )}
                                        <KairoxFooterMark />
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {guiaActiva && open && posicionTour && (
                <TarjetaTour
                    paso={pasoTour + 1}
                    total={PASOS_TOUR.length}
                    titulo={NAV.find((n) => n.to === pasoActual.to)?.label}
                    texto={pasoActual.texto}
                    posicion={posicionTour}
                    esPrimero={pasoTour === 0}
                    esUltimo={pasoTour === PASOS_TOUR.length - 1}
                    onAtras={() => setPasoTour((p) => Math.max(0, p - 1))}
                    onSiguiente={() =>
                        pasoTour === PASOS_TOUR.length - 1
                            ? finalizarTour()
                            : setPasoTour((p) => p + 1)
                    }
                    onCerrar={finalizarTour}
                />
            )}
        </div>
    );
};

export default AppLayout;
