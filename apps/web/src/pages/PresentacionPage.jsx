import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import {
    Apple,
    ArrowRight,
    Bell,
    CalendarCheck,
    Check,
    ChevronDown,
    Dumbbell,
    History,
    Laptop,
    MessageCircle,
    MonitorSmartphone,
    Smartphone,
    Tablet,
    TrendingUp,
    UserCog,
    Users,
    Wallet,
    Building2,
    X,
} from 'lucide-react';
import { EMAIL_SOPORTE, KairoxFooterMark, Logo, ThemeToggle } from '@/components/AppLayout';
import Reveal from '@/components/Reveal';
import { CapturaCelular, CapturaPanel, CuadernoRayado, PlanillaExcel } from '@/components/landing/Mockups';
import {
    DIAS_PRUEBA,
    PERIODOS_PAGO,
    PLANES,
    PRECIOS_BORRADOR,
    enlaceWhatsApp,
    formatoPesos,
    precioPorMes,
} from '@/lib/planesSuscripcion';

// Página pública de presentación y precios (pedido de Nalux, 29/10/2026, tomando como ejemplo las
// páginas de otras apps del rubro: qué hace la app, para quién es, en qué pantallas funciona y los
// planes). Sin ProtectedRoute: es para quien todavía no tiene cuenta.
//
// El registro público de profesores está apagado en Supabase (21/09/2026): las cuentas las crea el
// equipo. Por eso los botones de prueba gratis abren WhatsApp con el equipo en vez de un alta.
// Estética: negro y dorado de la marca. Cabecera, portada, cierre y pie son siempre negros (clase `dark`);
// el resto sigue el tema claro/oscuro que elija la persona.
// Los precios salen de lib/planesSuscripcion.js y son un BORRADOR hasta que Nalux los confirme.

// Es la página de la marca RutNail (dorado), no la de un gimnasio: aunque quien la mire tenga sesión de un
// gimnasio con otro color, acá se fija el dorado de fábrica (las variables del contenedor pisan a las de la raíz).
const COLOR_RUTNAIL = {
    '--primary': '42 92% 54%',
    '--primary-foreground': '0 0% 8%',
    '--accent': '42 92% 54%',
    '--accent-foreground': '0 0% 8%',
    '--ring': '42 92% 54%',
};

// Nota: el texto dorado va como `text-amber-700 dark:text-primary` (el dorado de marca solo contrasta
// bien sobre negro; sobre fondo claro se usa un ámbar más oscuro).

const FUNCIONES = [
    {
        icon: Users,
        titulo: 'Alumnos y fichas',
        texto: 'Alta en segundos, ficha completa y estado de la cuota a la vista. Tus alumnos también pueden registrarse solos desde un enlace.',
    },
    {
        icon: Dumbbell,
        titulo: 'Rutinas y ejercicios',
        texto: 'Biblioteca con foto y video de cada ejercicio. Arma bloques, superseries y circuitos, asígnalos y descarga la rutina en PDF.',
    },
    {
        icon: Apple,
        titulo: 'Planes de alimentación',
        texto: 'Alimentos con macros y planes de comidas por alumno, con alternativas y opcionales.',
        aviso: 'Estándar y Pro',
    },
    {
        icon: CalendarCheck,
        titulo: 'Asistencia',
        texto: 'Marca quién vino cada día y mira la asistencia de cada alumno sin cuadernos.',
    },
    {
        icon: Wallet,
        titulo: 'Pagos y cuotas',
        texto: 'Planes de precios, descuentos y deudas. Registra el cobro, envía el comprobante por WhatsApp o PDF y anula con motivo si algo se cargó mal.',
    },
    {
        icon: Bell,
        titulo: 'Avisos y noticias',
        texto: 'Avisos por grupo de alumnos con registro de quién los leyó, aviso automático de cuota por vencer y noticias en el portal del alumno.',
    },
    {
        icon: TrendingUp,
        titulo: 'Progreso del alumno',
        texto: 'Cada alumno anota su peso y marca los entrenamientos que hizo. Tú ves cómo evoluciona.',
    },
    {
        icon: UserCog,
        titulo: 'Equipo con cuentas propias',
        texto: 'Crea la cuenta de tu recepción y tus entrenadores. Pausas o quitas el acceso cuando quieras.',
    },
    {
        icon: History,
        titulo: 'Historial de cambios',
        texto: 'Queda registrado quién cobró, quién anuló un pago y quién cambió un precio. Nadie puede borrarlo.',
    },
    {
        icon: Building2,
        titulo: 'Varios gimnasios',
        texto: 'Maneja más de un gimnasio con la misma cuenta y comparte tu biblioteca de ejercicios y rutinas entre ellos.',
        aviso: 'Estándar y Pro',
    },
];

const CAPTURAS = [
    {
        clave: 'alumnos',
        titulo: 'Alumnos',
        src: '/capturas/alumnos.jpg',
        alt: 'Lista de alumnos con su estado, plan y objetivo',
        texto: 'Cada alumno con su ficha, su plan y su estado. Buscas, filtras por activos o inactivos y abres la ficha con un toque.',
    },
    {
        clave: 'rutinas',
        titulo: 'Rutinas',
        src: '/capturas/rutinas.jpg',
        alt: 'Biblioteca de rutinas con las acciones para ver, editar, asignar y descargar en PDF',
        texto: 'Tu biblioteca de rutinas: las ves, las editas, las duplicas, las asignas a tus alumnos y las descargas en PDF.',
    },
    {
        clave: 'ejercicios',
        titulo: 'Ejercicios',
        src: '/capturas/ejercicios.jpg',
        alt: 'Biblioteca de ejercicios con filtros por grupo muscular',
        texto: 'Más de 500 ejercicios ya cargados, con filtros por grupo muscular y demostración. Y puedes sumar los tuyos.',
    },
];

const PARA_QUIEN = [
    'Gimnasios de barrio y centros de musculación',
    'Boxes de CrossFit y funcional',
    'Entrenadores personales con alumnos propios',
    'Estudios de pilates, yoga y baile',
    'Dueños con más de una sede',
];

const HOY_VS_RUTNAIL = [
    ['La planilla de cuotas que nunca cierra', 'Cada alumno con su estado: al día, por vencer o vencido'],
    ['Rutinas en PDF y papel que se pierden', 'La rutina en el celular del alumno, siempre actualizada'],
    ['Preguntar por WhatsApp quién pagó', 'Pagos con comprobante y un historial que no se puede borrar'],
    ['Un cuaderno en recepción', 'Asistencia del día en la pantalla, desde cualquier dispositivo'],
];

const PASOS = [
    ['Crea tu gimnasio', 'Nombre, logo y color de tu marca. Tus alumnos verán tu gimnasio, no el nuestro.'],
    ['Carga tus precios y tus alumnos', 'Define cuánto cobras y da de alta a tu gente, o deja que se registren solos.'],
    ['Asigna rutinas y cobra', 'Elige una rutina de la biblioteca, asígnala y registra la primera cuota.'],
];

const FAQ = [
    [
        '¿Tengo que instalar algo?',
        'No. El panel funciona en el navegador de tu computadora, tablet o celular. Tus alumnos entran desde su celular con usuario y contraseña, sin descargar nada.',
    ],
    [
        '¿Mis alumnos pagan por usar la app?',
        'No. El portal del alumno es gratis para ellos y está incluido en tu plan.',
    ],
    [
        '¿Cobran comisión sobre las cuotas de mis alumnos?',
        'No. RutNail registra los pagos que tú recibes (efectivo, transferencia, etc.); el dinero va directo a tu cuenta.',
    ],
    [
        '¿Y si me paso del límite de alumnos?',
        'Te avisamos antes de llegar al tope y puedes cambiar al plan siguiente cuando quieras. Tus datos no se borran.',
    ],
    [
        '¿Es difícil de usar?',
        'No hace falta ser experto. La primera vez te mostramos un recorrido por el menú, cada pantalla tiene un ícono "i" que explica qué hace cada botón y hay una Guía de uso con buscador.',
    ],
    [
        '¿Qué pasa con la información de mis alumnos?',
        'Cada gimnasio ve únicamente lo suyo. Los alumnos aceptan los términos y la política de privacidad la primera vez que entran, y los cambios importantes quedan en el historial.',
    ],
    [
        '¿Puedo tener más de 5 gimnasios?',
        'Sí. Escríbenos y armamos un plan a medida para tu cantidad de sedes.',
    ],
    [
        '¿Puedo probarlo antes de contratar?',
        `Sí: ${DIAS_PRUEBA} días gratis, sin tarjeta y sin compromiso. Escríbenos por WhatsApp y dejamos tu gimnasio listo para que lo pruebes con tus alumnos.`,
    ],
    [
        '¿Qué pasa cuando termina la prueba?',
        'Eliges un plan para seguir. Si no, tu cuenta queda en solo lectura unos días y luego se pausa; no se borra nada y puedes retomarla cuando quieras.',
    ],
];

const Titulo = ({ etiqueta, children, sub }) => (
    <div className="mx-auto max-w-2xl text-center">
        {etiqueta && (
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-primary">{etiqueta}</p>
        )}
        <h2 className="font-display mt-2 text-balance text-3xl font-bold sm:text-4xl">{children}</h2>
        {sub && <p className="mt-3 text-base text-muted-foreground">{sub}</p>}
    </div>
);

const BotonPrincipal = ({ href, children, className = '' }) => (
    <a
        href={href}
        className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-base font-bold text-primary-foreground transition hover:-translate-y-px hover:brightness-110 active:scale-[0.98] ${className}`}
    >
        {children}
    </a>
);

const Dispositivo = ({ icon: Icon, titulo, texto }) => (
    <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-amber-700 dark:text-primary">
            <Icon className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <div>
            <p className="font-semibold">{titulo}</p>
            <p className="text-sm text-muted-foreground">{texto}</p>
        </div>
    </div>
);

const Incluye = ({ ok, children }) => (
    <li className={`flex items-start gap-2 text-sm ${ok ? '' : 'text-muted-foreground line-through decoration-muted-foreground/40'}`}>
        {ok ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2.5} />
        ) : (
            <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        )}
        <span>{children}</span>
    </li>
);

const PresentacionPage = () => {
    const [periodoClave, setPeriodoClave] = useState('mensual');
    const periodo = PERIODOS_PAGO.find((p) => p.clave === periodoClave);
    const [capturaClave, setCapturaClave] = useState('alumnos');
    const captura = CAPTURAS.find((c) => c.clave === capturaClave);


    return (
        <div style={COLOR_RUTNAIL} className="relative min-h-[100dvh] overflow-x-clip bg-background text-foreground">
            <Helmet>
                <title>RutNail | Gestión para gimnasios</title>
                <meta
                    name="description"
                    content="Alumnos, rutinas, alimentación, asistencia y pagos de tu gimnasio en un solo lugar, y la rutina en el celular de cada alumno."
                />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap" rel="stylesheet" />
            </Helmet>

            {PRECIOS_BORRADOR && (
                <div className="bg-warn/20 px-4 py-2 text-center text-xs font-semibold text-warn">
                    Borrador interno: los precios de esta página son de ejemplo y todavía no están confirmados.
                </div>
            )}

            <header className="dark sticky top-0 z-30 border-b border-border bg-background/90 text-foreground backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
                    <Logo className="h-9" />
                    <nav aria-label="Secciones" className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
                        <a href="#por-dentro" className="transition hover:text-foreground">Por dentro</a>
                        <a href="#funciones" className="transition hover:text-foreground">Funciones</a>
                        <a href="#pantallas" className="transition hover:text-foreground">En tu pantalla</a>
                        <a href="#precios" className="transition hover:text-foreground">Precios</a>
                        <a href="#preguntas" className="transition hover:text-foreground">Preguntas</a>
                    </nav>
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <Link
                            to="/login"
                            className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-semibold transition hover:border-primary"
                        >
                            Ingresar
                        </Link>
                    </div>
                </div>
            </header>

            <main>
                {/* Portada */}
                <section className="dark relative bg-background px-4 pb-20 pt-14 text-foreground sm:px-6 sm:pt-20">
                    <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-0 h-[34rem] w-[34rem] rounded-full bg-primary/15 blur-3xl" />
                    <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-primary">Gestión para gimnasios</p>
                            <h1 className="font-display mt-3 text-balance text-4xl font-extrabold leading-[1.08] sm:text-5xl lg:text-6xl">
                                Tu gimnasio en orden. La rutina en el celular de cada alumno.
                            </h1>
                            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                                Alumnos, rutinas, alimentación, asistencia y cobros en un solo lugar. Sin planillas,
                                sin cuadernos y sin perseguir a nadie por WhatsApp.
                            </p>
                            <div className="mt-8 flex flex-wrap items-center gap-3">
                                <BotonPrincipal href={enlaceWhatsApp(`Hola, quiero probar RutNail ${DIAS_PRUEBA} días gratis`)}>
                                    Probar {DIAS_PRUEBA} días gratis <ArrowRight className="h-5 w-5" />
                                </BotonPrincipal>
                                <a
                                    href="#precios"
                                    className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-border px-6 py-3 text-base font-semibold transition hover:border-primary"
                                >
                                    Ver precios
                                </a>
                            </div>
                            <p className="mt-4 text-sm text-muted-foreground">
                                {DIAS_PRUEBA} días gratis · Sin tarjeta · Sin compromiso
                            </p>
                        </div>

                        <div className="relative mx-auto w-full max-w-xl">
                            <div className="hidden sm:block">
                                <CapturaPanel src="/capturas/alumnos.jpg" alt="Lista de alumnos en el panel de RutNail" className="max-w-md" />
                            </div>
                            <div className="mx-auto w-[200px] sm:absolute sm:-bottom-8 sm:-right-2 sm:w-[34%]">
                                <CapturaCelular src="/capturas/portal.jpg" alt="Rutina del alumno en su celular" />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Para quién */}
                <section className="border-y border-border bg-card/40 px-4 py-14 sm:px-6">
                    <div className="mx-auto max-w-6xl">
                        <Titulo etiqueta="Para quién es" sub="Si tienes alumnos, rutinas y cuotas, RutNail es para ti.">
                            Hecho para quienes entrenan gente
                        </Titulo>
                        <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-3">
                            {PARA_QUIEN.map((t) => (
                                <li key={t} className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium">
                                    {t}
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                {/* Hoy vs RutNail */}
                <section className="px-4 py-16 sm:px-6">
                    <div className="mx-auto max-w-5xl">
                        <Titulo
                            etiqueta="El problema de hoy"
                            sub="Cuadernos rayados y planillas de Excel que nadie entiende: el mayor dolor de cabeza de los gimnasios."
                        >
                            Pusiste un gimnasio, no una oficina
                        </Titulo>

                        <div className="mt-12 grid items-center gap-10 md:grid-cols-2">
                            <Reveal y={16}>
                                <CuadernoRayado />
                            </Reveal>
                            <Reveal y={16} delay={0.1}>
                                <PlanillaExcel />
                            </Reveal>
                        </div>

                        <div className="mt-14 grid gap-3">
                            {HOY_VS_RUTNAIL.map(([antes, ahora]) => (
                                <Reveal key={antes} y={12}>
                                    <div className="grid items-center gap-2 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 sm:gap-6 sm:p-5">
                                        <p className="flex items-start gap-2 text-sm text-muted-foreground">
                                            <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" strokeWidth={2.5} />
                                            {antes}
                                        </p>
                                        <p className="flex items-start gap-2 text-sm font-semibold">
                                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2.5} />
                                            {ahora}
                                        </p>
                                    </div>
                                </Reveal>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Así se ve por dentro */}
                <section id="por-dentro" className="scroll-mt-20 px-4 py-16 sm:px-6">
                    <div className="mx-auto max-w-5xl">
                        <Titulo etiqueta="Por dentro" sub="Capturas reales del panel, con datos de ejemplo.">
                            Así se ve RutNail
                        </Titulo>
                        <div
                            role="tablist"
                            aria-label="Pantallas del panel"
                            className="mx-auto mt-8 flex w-fit max-w-full flex-wrap justify-center gap-1 rounded-2xl border border-border bg-card p-1"
                        >
                            {CAPTURAS.map((c) => (
                                <button
                                    key={c.clave}
                                    type="button"
                                    role="tab"
                                    aria-selected={c.clave === capturaClave}
                                    onClick={() => setCapturaClave(c.clave)}
                                    className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold transition ${
                                        c.clave === capturaClave
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {c.titulo}
                                </button>
                            ))}
                        </div>
                        <div className="mt-8 grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
                            <CapturaPanel src={captura.src} alt={captura.alt} />
                            <div>
                                <h3 className="font-display text-2xl font-bold">{captura.titulo}</h3>
                                <p className="mt-3 text-muted-foreground">{captura.texto}</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Funciones */}
                <section id="funciones" className="scroll-mt-20 border-y border-border bg-card/40 px-4 py-16 sm:px-6">
                    <div className="mx-auto max-w-6xl">
                        <Titulo etiqueta="Funciones" sub="Todo lo que necesitas para llevar el día a día, sin módulos sueltos.">
                            Una sola app para todo el gimnasio
                        </Titulo>
                        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {FUNCIONES.map(({ icon: Icon, titulo, texto, aviso }) => (
                                <Reveal key={titulo} y={14}>
                                    <article className="h-full rounded-2xl border border-border bg-card p-5">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-amber-700 dark:text-primary">
                                                <Icon className="h-5 w-5" strokeWidth={1.8} />
                                            </span>
                                            {aviso && (
                                                <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-primary">
                                                    {aviso}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="font-display mt-4 text-lg font-bold">{titulo}</h3>
                                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{texto}</p>
                                    </article>
                                </Reveal>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Pantallas */}
                <section id="pantallas" className="scroll-mt-20 px-4 py-16 sm:px-6">
                    <div className="mx-auto max-w-6xl">
                        <Titulo
                            etiqueta="En tu pantalla"
                            sub="El panel se adapta al tamaño de cada pantalla y tus alumnos lo usan desde el celular."
                        >
                            Funciona donde estés
                        </Titulo>

                        <div className="mt-12 grid items-center gap-12 lg:grid-cols-2">
                            <div>
                                <h3 className="font-display text-xl font-bold">Para ti y tu equipo</h3>
                                <p className="mt-1 text-sm text-muted-foreground">El panel de administración, desde el navegador.</p>
                                <div className="mt-6 space-y-5">
                                    <Dispositivo icon={Laptop} titulo="Computadora" texto="El panel completo, ideal para armar rutinas y revisar los cobros del mes." />
                                    <Dispositivo icon={Tablet} titulo="Tablet" texto="Perfecta para la recepción: asistencia y cobros a mano." />
                                    <Dispositivo icon={Smartphone} titulo="Celular" texto="Marca asistencia y registra un pago desde el piso del gimnasio." />
                                </div>
                            </div>

                            <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
                                <h3 className="font-display text-xl font-bold">Para tus alumnos</h3>
                                <p className="mt-1 text-sm text-muted-foreground">Su propio portal, con la marca de tu gimnasio.</p>
                                <div className="mt-6 grid items-center gap-6 sm:grid-cols-[auto_1fr]">
                                    <CapturaCelular src="/capturas/portal.jpg" alt="El portal del alumno en su celular" className="max-w-[190px]" />
                                    <ul className="space-y-3 text-sm">
                                        {[
                                            'Ve su rutina día por día, con la demostración de cada ejercicio',
                                            'Marca los entrenamientos que hizo y anota su peso',
                                            'Consulta su plan de alimentación y cómo pagar la cuota',
                                            'Si se queda sin señal, ve la última rutina que cargó',
                                            'Entra con usuario y contraseña, sin descargar nada',
                                        ].map((t) => (
                                            <li key={t} className="flex items-start gap-2">
                                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2.5} />
                                                {t}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Cómo empezar */}
                <section className="border-y border-border bg-card/40 px-4 py-16 sm:px-6">
                    <div className="mx-auto max-w-5xl">
                        <Titulo etiqueta="Cómo empezar">Funcionando en tres pasos</Titulo>
                        <ol className="mt-10 grid gap-4 md:grid-cols-3">
                            {PASOS.map(([t, d], i) => (
                                <li key={t} className="rounded-2xl border border-border bg-card p-5">
                                    <span className="font-display flex h-9 w-9 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                                        {i + 1}
                                    </span>
                                    <h3 className="font-display mt-4 text-lg font-bold">{t}</h3>
                                    <p className="mt-1.5 text-sm text-muted-foreground">{d}</p>
                                </li>
                            ))}
                        </ol>
                    </div>
                </section>

                {/* Precios */}
                <section id="precios" className="scroll-mt-20 px-4 py-16 sm:px-6">
                    <div className="mx-auto max-w-6xl">
                        <Titulo
                            etiqueta="Precios"
                            sub={`Prueba ${DIAS_PRUEBA} días gratis con cualquier plan. Sin comisión sobre tus cuotas y sin permanencia.`}
                        >
                            Elige el plan que te queda cómodo
                        </Titulo>

                        <div
                            role="group"
                            aria-label="Período de pago"
                            className="mx-auto mt-8 flex w-fit max-w-full flex-wrap justify-center gap-1 rounded-2xl border border-border bg-card p-1"
                        >
                            {PERIODOS_PAGO.map((p) => (
                                <button
                                    key={p.clave}
                                    type="button"
                                    aria-pressed={p.clave === periodoClave}
                                    onClick={() => setPeriodoClave(p.clave)}
                                    className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold transition ${
                                        p.clave === periodoClave
                                            ? 'bg-primary text-primary-foreground'
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {p.etiqueta}
                                    {p.descuento > 0 && (
                                        <span className="ml-1.5 text-xs font-bold">−{Math.round(p.descuento * 100)}%</span>
                                    )}
                                </button>
                            ))}
                        </div>

                        <div className="mt-10 grid gap-5 lg:grid-cols-3">
                            {PLANES.map((plan) => {
                                const porMes = precioPorMes(plan, periodo);
                                return (
                                    <article
                                        key={plan.clave}
                                        className={`relative flex flex-col rounded-3xl border bg-card p-6 ${
                                            plan.destacado ? 'border-2 border-primary shadow-xl' : 'border-border'
                                        }`}
                                    >
                                        {plan.destacado && (
                                            <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                                                El que más conviene
                                            </span>
                                        )}
                                        <h3 className="font-display text-xl font-bold">{plan.nombre}</h3>
                                        <p className="mt-1 min-h-[40px] text-sm text-muted-foreground">{plan.resumen}</p>
                                        <p className="mt-5">
                                            <span className="font-display text-4xl font-extrabold tabular-nums">
                                                {formatoPesos(porMes)}
                                            </span>
                                            <span className="text-sm text-muted-foreground"> / mes</span>
                                        </p>
                                        <p className="mt-1 min-h-[20px] text-xs text-muted-foreground">
                                            {periodo.meses > 1
                                                ? `Pagas ${formatoPesos(porMes * periodo.meses)} cada ${periodo.meses} meses`
                                                : 'Pago mes a mes'}
                                        </p>

                                        <ul className="mt-6 space-y-2.5 border-t border-border pt-5">
                                            <Incluye ok>
                                                <strong>{plan.gimnasios}</strong> {plan.gimnasios === 1 ? 'gimnasio' : 'gimnasios'}
                                            </Incluye>
                                            <Incluye ok>
                                                {plan.alumnos === null ? (
                                                    <strong>Alumnos ilimitados</strong>
                                                ) : (
                                                    <>
                                                        Hasta <strong>{plan.alumnos}</strong> alumnos
                                                    </>
                                                )}
                                            </Incluye>
                                            <Incluye ok>Rutinas y biblioteca de ejercicios</Incluye>
                                            <Incluye ok>Asistencia, pagos y avisos</Incluye>
                                            <Incluye ok>Portal del alumno con tu marca</Incluye>
                                            <Incluye ok>Equipo con cuentas propias</Incluye>
                                            <Incluye ok>Historial de cambios</Incluye>
                                            <Incluye ok={plan.alimentacion}>Alimentos y planes de alimentación</Incluye>
                                            <Incluye ok={plan.gimnasios > 1}>Biblioteca compartida entre gimnasios</Incluye>
                                        </ul>

                                        <BotonPrincipal
                                            href={enlaceWhatsApp(`Hola, quiero probar el plan ${plan.nombre} de RutNail ${DIAS_PRUEBA} días gratis`)}
                                            className={`mt-7 w-full ${plan.destacado ? '' : '!bg-transparent !text-foreground border border-border hover:!border-primary hover:!brightness-100'}`}
                                        >
                                            Probar {DIAS_PRUEBA} días gratis
                                        </BotonPrincipal>
                                    </article>
                                );
                            })}
                        </div>

                        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
                            ¿Tienes más de 5 gimnasios o necesitas algo a medida?{' '}
                            <a
                                href={enlaceWhatsApp('Hola, tengo una consulta por más de 5 gimnasios en RutNail')}
                                className="font-semibold text-amber-700 dark:text-primary underline underline-offset-2"
                            >
                                Escríbenos
                            </a>{' '}
                            y armamos un plan para ti.
                        </p>
                    </div>
                </section>

                {/* Preguntas */}
                <section id="preguntas" className="scroll-mt-20 border-t border-border bg-card/40 px-4 py-16 sm:px-6">
                    <div className="mx-auto max-w-3xl">
                        <Titulo etiqueta="Preguntas frecuentes">Lo que todo dueño pregunta antes de empezar</Titulo>
                        <div className="mt-10 space-y-3">
                            {FAQ.map(([p, r]) => (
                                <details key={p} className="group rounded-2xl border border-border bg-card">
                                    <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold [&::-webkit-details-marker]:hidden">
                                        {p}
                                        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition group-open:rotate-180" />
                                    </summary>
                                    <p className="border-t border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground">{r}</p>
                                </details>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Cierre */}
                <section className="dark relative bg-background px-4 py-20 text-foreground sm:px-6">
                    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto h-72 max-w-3xl -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
                    <div className="relative mx-auto max-w-2xl text-center">
                        <MonitorSmartphone className="mx-auto h-10 w-10 text-amber-700 dark:text-primary" strokeWidth={1.6} />
                        <h2 className="font-display mt-4 text-balance text-3xl font-bold sm:text-4xl">
                            Deja las planillas y empieza a entrenar mejor a tu gente
                        </h2>
                        <p className="mt-3 text-muted-foreground">
                            {DIAS_PRUEBA} días gratis, sin tarjeta y sin compromiso. Escríbenos y dejamos tu gimnasio listo para probar.
                        </p>
                        <div className="mt-7 flex justify-center">
                            <BotonPrincipal href={enlaceWhatsApp(`Hola, quiero probar RutNail ${DIAS_PRUEBA} días gratis`)}>
                                <MessageCircle className="h-5 w-5" /> Escribir por WhatsApp
                            </BotonPrincipal>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="dark border-t border-border bg-background px-4 py-10 text-foreground sm:px-6">
                <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
                    <nav aria-label="Accesos" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
                        <Link to="/login" className="hover:text-foreground">Ingreso del profesor</Link>
                        <Link to="/ingreso-equipo" className="hover:text-foreground">Ingreso del equipo</Link>
                        <Link to="/alumno" className="hover:text-foreground">Ingreso del alumno</Link>
                        <Link to="/terminos" className="hover:text-foreground">Términos y privacidad</Link>
                        <a href={enlaceWhatsApp('Hola, quiero consultar por RutNail')} className="hover:text-foreground">WhatsApp</a>
                        <a href={`mailto:${EMAIL_SOPORTE}`} className="hover:text-foreground">Correo</a>
                    </nav>
                    <KairoxFooterMark />
                </div>
            </footer>
        </div>
    );
};

export default PresentacionPage;
