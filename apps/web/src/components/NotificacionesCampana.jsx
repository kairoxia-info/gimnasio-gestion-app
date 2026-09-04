import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { listAll } from '@/lib/data';
import { ESTADOS_PAGO, estadoCuota } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';

// Pedido de Nalux (03/09/2026): "que la misma aplicación tenga notificaciones
// (...) las cuotas vencidas o las que se estén por vencer o deudas, que
// lleguen como una notificación arriba, una campanita que avise y redirija a
// donde tiene que ir el profesor".
//
// A propósito solo cuotas (vencida / en gracia / por vencer / con deuda) --
// no "sin cuota": un alumno que nunca pagó no es una alerta urgente del
// mismo tipo, y en un gimnasio nuevo con muchos altas recientes llenaría la
// campanita de ruido en vez de mostrar lo que de verdad necesita acción.
//
// Vive en AppLayout, que se remonta en cada página (no hay un root
// persistente) -- por eso vuelve a pedir alumnos/pagos en cada navegación.
// Con el volumen real de un gimnasio (decenas de alumnos, no miles) es una
// consulta liviana, mismo criterio que ya usan DashboardPage/PagosPage.
const ORDEN_ESTADO = { vencido: 0, con_deuda: 1, en_gracia: 2, proximo: 3 };
const ESTADOS_A_MOSTRAR = new Set(Object.keys(ORDEN_ESTADO));

const NotificacionesCampana = () => {
    const { profile } = useAuth();
    const navigate = useNavigate();
    const [abierto, setAbierto] = useState(false);
    const [alumnos, setAlumnos] = useState([]);
    const [pagos, setPagos] = useState([]);
    const [config, setConfig] = useState(null);
    const cajaRef = useRef(null);

    useEffect(() => {
        Promise.all([
            listAll('alumnos', { filters: { activo: true }, sort: 'nombre' }),
            listAll('pagos'),
        ])
            .then(([a, p]) => {
                setAlumnos(a);
                setPagos(p);
            })
            .catch(() => {
                // Silencioso a propósito: la campanita es un plus, no algo
                // crítico -- si falla, simplemente no muestra nada, sin
                // tapar la pantalla real con un ErrorBox por esto.
            });
    }, []);

    // dias_gracia_cuota / dias_aviso_vencimiento viven en gimnasios, pero
    // useAuth().gimnasio solo trae nombre/logo_url/color_principal (ver
    // AuthContext.fetchProfile) -- no alcanza, hay que pedir la fila.
    useEffect(() => {
        if (!profile?.gimnasio_id) return;
        supabase
            .from('gimnasios')
            .select('dias_gracia_cuota, dias_aviso_vencimiento')
            .eq('id', profile.gimnasio_id)
            .single()
            .then(({ data }) => setConfig(data || null))
            .catch(() => setConfig(null));
    }, [profile?.gimnasio_id]);

    // Cerrar al tocar afuera del panel -- no hay ningún otro dropdown en la
    // app con este patrón, así que se resuelve acá con un listener simple.
    useEffect(() => {
        if (!abierto) return;
        const cerrarSiAfuera = (e) => {
            if (cajaRef.current && !cajaRef.current.contains(e.target)) setAbierto(false);
        };
        document.addEventListener('mousedown', cerrarSiAfuera);
        return () => document.removeEventListener('mousedown', cerrarSiAfuera);
    }, [abierto]);

    const items = useMemo(() => {
        const ultimoPorAlumno = new Map();
        pagos.forEach((p) => {
            const prev = ultimoPorAlumno.get(p.alumno_id);
            if (!prev || String(p.periodo_hasta || '') > String(prev.periodo_hasta || '')) {
                ultimoPorAlumno.set(p.alumno_id, p);
            }
        });

        return alumnos
            .map((alumno) => {
                const pago = ultimoPorAlumno.get(alumno.id);
                const estado = estadoCuota(pago, config);
                return { alumno, pago, estado };
            })
            .filter((x) => ESTADOS_A_MOSTRAR.has(x.estado))
            .sort((a, b) => {
                const porEstado = ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];
                if (porEstado !== 0) return porEstado;
                // Entre iguales, el que vence/venció antes primero.
                return String(a.pago?.periodo_hasta || '').localeCompare(String(b.pago?.periodo_hasta || ''));
            });
    }, [alumnos, pagos, config]);

    const irAlAlumno = (alumnoId) => {
        setAbierto(false);
        navigate(`/alumnos/${alumnoId}?tab=pagos`);
    };

    return (
        <div ref={cajaRef} className="relative">
            <button
                type="button"
                onClick={() => setAbierto((v) => !v)}
                aria-label={
                    items.length > 0
                        ? `Notificaciones: ${items.length} alumno(s) necesitan atención`
                        : 'Notificaciones'
                }
                aria-expanded={abierto}
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-foreground transition hover:border-primary active:scale-[0.96]"
            >
                <Bell className="h-5 w-5" strokeWidth={1.8} />
                {items.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                        {items.length > 9 ? '9+' : items.length}
                    </span>
                )}
            </button>

            {abierto && (
                // La campana no queda pegada al borde derecho de la pantalla
                // (el toggle de tema va después, en el header) -- anclar el
                // panel con right-0 relativo al botón lo desbordaba por la
                // izquierda en mobile (probado: quedaba con left:-26px a
                // 375px de ancho). Por eso en mobile es "fixed" con margen
                // fijo a los dos bordes (mismo recurso que ya usa el drawer
                // del menú lateral), y recién de sm en adelante vuelve a
                // anclarse como dropdown normal bajo la campana.
                <div className="fixed inset-x-4 top-[4.25rem] z-30 rounded-2xl border border-border bg-card shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[22rem]">
                    <div className="flex items-center justify-between border-b border-border px-4 py-3">
                        <p className="font-display text-sm font-bold uppercase tracking-wide">
                            Necesitan atención
                        </p>
                        {items.length > 0 && (
                            <span className="text-xs font-semibold text-muted-foreground">{items.length}</span>
                        )}
                    </div>

                    {items.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                            Todos los alumnos activos están al día. Buen trabajo.
                        </p>
                    ) : (
                        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                            {items.slice(0, 8).map(({ alumno, estado }) => (
                                <li key={alumno.id}>
                                    <button
                                        type="button"
                                        onClick={() => irAlAlumno(alumno.id)}
                                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-secondary"
                                    >
                                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                                            {alumno.nombre}
                                        </span>
                                        <span
                                            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${ESTADOS_PAGO[estado].className}`}
                                        >
                                            {ESTADOS_PAGO[estado].label}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    <button
                        type="button"
                        onClick={() => {
                            setAbierto(false);
                            navigate('/pagos');
                        }}
                        className="block w-full rounded-b-2xl border-t border-border px-4 py-3 text-center text-sm font-semibold text-primary transition hover:bg-secondary"
                    >
                        Ver todos en Pagos
                    </button>
                </div>
            )}
        </div>
    );
};

export default NotificacionesCampana;
