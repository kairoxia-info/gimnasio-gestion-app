import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, PlayCircle, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Btn, Card, ContenidoAyuda, Empty, Input } from '@/components/ui-kit';
import { useAuth } from '@/contexts/AuthContext';
import { AYUDAS, MODULOS_GUIA } from '@/lib/guiaDeUso';

// Guía de uso (pedido de Nalux, 29/10/2026): qué hace cada pantalla y cada botón, en un solo lugar.
// El contenido sale de lib/guiaDeUso.js, el mismo que muestra el ícono "i" de cada pantalla y el
// recorrido de bienvenida, así que nunca se contradicen. Cada persona ve solo lo que puede usar.

const PRIMEROS_PASOS_ADMIN = [
    'Precios: define qué cobras y por cuánto tiempo.',
    'Configuración: nombre, logo, color y reglas de cuota.',
    'Alumnos: da de alta a tus alumnos (o activa el enlace para que se registren solos).',
    'Ejercicios y Rutinas: arma las rutinas y asígnalas.',
    'Pagos: registra el primer cobro.',
    'Equipo: crea la cuenta de las personas que trabajan contigo.',
];

const PRIMEROS_PASOS_EQUIPO = [
    'Alumnos: abre la ficha del alumno para ver su rutina, su plan y sus pagos.',
    'Asistencia: marca presente o ausente cada día.',
    'Pagos: registra los cobros; si algo se cargó mal, se anula con un motivo.',
    'Rutinas y Planes de alimentación: asígnalos a los alumnos.',
];

const GuiaPage = () => {
    const { profile, reiniciarTour } = useAuth();
    const navigate = useNavigate();
    const esAdmin = profile?.role === 'admin';
    const [busqueda, setBusqueda] = useState('');

    const modulos = useMemo(() => {
        const visibles = MODULOS_GUIA.filter((m) => esAdmin || !m.soloAdmin);
        const q = busqueda.trim().toLowerCase();
        if (!q) return visibles;
        return visibles.filter((m) => {
            const a = AYUDAS[m.clave];
            const texto = [m.titulo, a.resumen, ...(a.botones || []).flatMap((b) => [b.nombre, b.que])].join(' ').toLowerCase();
            return texto.includes(q);
        });
    }, [esAdmin, busqueda]);

    const verRecorrido = () => {
        reiniciarTour();
        navigate('/panel');
    };

    return (
        <AppLayout title="Guía de uso" subtitle="Qué hace cada pantalla y cada botón de RutNail.">
            <Helmet>
                <title>Guía de uso | RutNail</title>
                <meta name="description" content="Qué hace cada pantalla y cada botón de la aplicación." />
            </Helmet>

            <div className="mb-6 grid gap-4 lg:grid-cols-2">
                <Card>
                    <h2 className="font-display text-lg font-bold">Para empezar</h2>
                    <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                        {(esAdmin ? PRIMEROS_PASOS_ADMIN : PRIMEROS_PASOS_EQUIPO).map((p) => (
                            <li key={p}>{p}</li>
                        ))}
                    </ol>
                </Card>
                <Card>
                    <h2 className="font-display text-lg font-bold">Ayuda en cada pantalla</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Junto al título de cada pantalla hay un ícono <strong>i</strong>: tócalo y te explica para qué sirve
                        esa pantalla y qué hace cada botón. También puedes volver a ver el recorrido de bienvenida.
                    </p>
                    <Btn variant="ghost" className="mt-3" onClick={verRecorrido}>
                        <PlayCircle className="h-4 w-4" /> Ver el recorrido de nuevo
                    </Btn>
                </Card>
            </div>

            <div className="relative mb-4">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar un botón o una palabra (por ejemplo: anular, WhatsApp, PDF)..."
                    aria-label="Buscar en la guía"
                    className="pl-9"
                />
            </div>

            {modulos.length === 0 ? (
                <Empty>No hay nada en la guía con esa palabra. Prueba con otra.</Empty>
            ) : (
                <div className="space-y-3">
                    {modulos.map((m) => (
                        <details
                            key={m.clave}
                            open={!!busqueda.trim()}
                            className="group rounded-2xl border border-border bg-card"
                        >
                            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
                                <span className="font-display text-base font-bold">
                                    {m.titulo}
                                    {m.soloAdmin && (
                                        <span className="ml-2 align-middle text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                            Solo administrador
                                        </span>
                                    )}
                                </span>
                                <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition group-open:rotate-180" />
                            </summary>
                            <div className="space-y-3 border-t border-border px-5 py-4 text-sm">
                                <ContenidoAyuda ayuda={AYUDAS[m.clave]} />
                                <Link
                                    to={m.ruta}
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                                >
                                    Ir a {m.titulo} <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                            </div>
                        </details>
                    ))}
                </div>
            )}
        </AppLayout>
    );
};

export default GuiaPage;
