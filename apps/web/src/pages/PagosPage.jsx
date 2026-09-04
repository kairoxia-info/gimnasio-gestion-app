import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Printer, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { createRec, listAll } from '@/lib/data';
import { ESTADOS_PAGO, deudaEstimada, estadoCuota, fmtFecha, hoy, money } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';

// Nalux pidió estas tres formas de cobro, ni más ni menos. `pagos.metodo` es
// texto libre en la base, así que la lista vive acá y no hace falta migración.
const METODOS = ['Efectivo', 'Transferencia', 'Tarjeta de crédito'];

// Misma técnica que el PDF de rutinas/planes (MiPlanPage): la hoja vive
// escondida en el DOM y en impresión se apaga TODO lo demás con visibility
// (no display:none, que rompería el layout de la página de atrás).
const ESTILOS_IMPRESION = `
.cp-hoja { display: none; }
.cp-hoja.cp-en-pantalla { display: block; }
@media print {
  @page { size: A4; margin: 18mm; }
  body * { visibility: hidden !important; }
  .cp-hoja, .cp-hoja * { visibility: visible !important; }
  .cp-hoja {
    display: block !important;
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    color: #000;
    background: #fff;
  }
}
`;

const vacioPago = {
    alumno_id: '',
    plan: '',
    monto: '',
    monto_adeudado: '',
    fecha_pago: hoy(),
    periodo_desde: hoy(),
    periodo_hasta: '',
    descuento: '',
    interes: '',
    metodo: METODOS[0],
    notas: '',
};

// ---------------------------------------------------------------------------
// Comprobante. Nalux fue explícita: "hazlo bien que se vea bien, nada de letra
// sobreencimada ni letra chica nada, un comprobante del tamaño que debe ser".
// Por eso: cuerpo en 12pt (no 8-9pt como suelen salir los tickets), interlínea
// holgada, cada dato en su propia fila de una tabla (nada de posicionamiento
// absoluto que se pueda encimar) y el total bien grande al final.
// ---------------------------------------------------------------------------
const Comprobante = ({ pago, alumno, gimnasio, enPantalla = false }) => {
    if (!pago) return null;
    const color = gimnasio?.color_principal || '#E10600';
    const filas = [
        ['Alumno', alumno?.nombre || '—'],
        ['Fecha de pago', fmtFecha(pago.fecha_pago)],
        ['Período', `${fmtFecha(pago.periodo_desde)} al ${fmtFecha(pago.periodo_hasta)}`],
        ['Plan', pago.notas || '—'],
        ['Forma de pago', pago.metodo || '—'],
    ];
    if (Number(pago.descuento || 0) > 0) filas.push(['Descuento aplicado', `${pago.descuento}%`]);
    if (Number(pago.interes || 0) > 0) filas.push(['Recargo por mora', `${pago.interes}%`]);

    return (
        // El color y el fondo van en el style inline, no solo en el @media
        // print: si dependieran de la regla de impresión, la hoja hereda el
        // blanco del tema oscuro y los valores quedan blanco sobre blanco
        // (pasó exactamente eso al inspeccionarla en pantalla).
        <div
            className={`cp-hoja${enPantalla ? ' cp-en-pantalla' : ''}`}
            style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '12pt',
                lineHeight: 1.6,
                color: '#000',
                background: '#fff',
            }}
        >
            <div style={{ borderBottom: `3pt solid ${color}`, paddingBottom: '10pt', marginBottom: '18pt' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                        <tr>
                            <td style={{ verticalAlign: 'middle' }}>
                                {gimnasio?.logo_url && (
                                    <img
                                        src={gimnasio.logo_url}
                                        alt=""
                                        style={{ height: '54pt', width: 'auto', display: 'block' }}
                                    />
                                )}
                            </td>
                            <td style={{ verticalAlign: 'middle', textAlign: 'right' }}>
                                <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>{gimnasio?.nombre || 'Gimnasio'}</div>
                                <div style={{ fontSize: '13pt', marginTop: '4pt' }}>
                                    Comprobante N.º {String(pago.numero ?? '—').padStart(4, '0')}
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <h1 style={{ fontSize: '15pt', fontWeight: 'bold', margin: '0 0 14pt' }}>Comprobante de pago</h1>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                    {filas.map(([etiqueta, valor]) => (
                        <tr key={etiqueta}>
                            <td
                                style={{
                                    padding: '7pt 10pt 7pt 0',
                                    borderBottom: '0.5pt solid #ccc',
                                    width: '38%',
                                    color: '#444',
                                }}
                            >
                                {etiqueta}
                            </td>
                            <td style={{ padding: '7pt 0', borderBottom: '0.5pt solid #ccc', fontWeight: 'bold' }}>
                                {valor}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '18pt' }}>
                <tbody>
                    <tr>
                        <td style={{ fontSize: '14pt' }}>Importe recibido</td>
                        <td style={{ fontSize: '20pt', fontWeight: 'bold', textAlign: 'right', color }}>
                            {money(pago.monto)}
                        </td>
                    </tr>
                    {Number(pago.monto_adeudado || 0) > 0 && (
                        <tr>
                            <td style={{ fontSize: '14pt', paddingTop: '8pt' }}>Saldo pendiente</td>
                            <td style={{ fontSize: '16pt', fontWeight: 'bold', textAlign: 'right', paddingTop: '8pt' }}>
                                {money(pago.monto_adeudado)}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>

            {pago.notas && (
                <p style={{ marginTop: '18pt', fontSize: '11pt' }}>
                    <strong>Observaciones:</strong> {pago.notas}
                </p>
            )}

            {gimnasio?.comprobante_texto_pie && (
                <p style={{ marginTop: '28pt', fontSize: '10pt', color: '#555', borderTop: '0.5pt solid #ccc', paddingTop: '10pt' }}>
                    {gimnasio.comprobante_texto_pie}
                </p>
            )}
        </div>
    );
};

const PagosPage = () => {
    const { profile } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [alumnos, setAlumnos] = useState([]);
    const [pagos, setPagos] = useState([]);
    const [planes, setPlanes] = useState([]);
    const [periodos, setPeriodos] = useState([]);
    const [descuentos, setDescuentos] = useState([]);
    const [gimnasio, setGimnasio] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [busqueda, setBusqueda] = useState('');
    const [filtroEstado, setFiltroEstado] = useState('todos');

    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacioPago);
    const [saving, setSaving] = useState(false);
    const [sinCobrar, setSinCobrar] = useState(false);

    // Comprobante que se está mirando. Nalux pidió poder VERLO en la app y no
    // solo imprimirlo, así que se muestra en un modal y desde ahí se imprime
    // si hace falta — la misma hoja sirve para las dos cosas.
    const [comprobante, setComprobante] = useState(null);

    const cargar = () => {
        setLoading(true);
        return Promise.all([
            listAll('alumnos', { sort: 'nombre' }),
            listAll('pagos', { sort: '-fecha_pago' }),
            listAll('configuracion_precios'),
            listAll('configuracion_periodos'),
            listAll('configuracion_descuentos'),
        ])
            .then(([a, p, pl, per, desc]) => {
                setAlumnos(a);
                setPagos(p);
                setPlanes(pl);
                setPeriodos(per);
                setDescuentos(desc.filter((d) => d.activo));
                setError('');
            })
            .catch(() => setError('No se pudieron cargar los pagos.'))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        cargar();
    }, []);

    // La configuración de vencimientos (días de gracia / de aviso) vive en
    // `gimnasios` y useAuth().gimnasio solo trae nombre/logo/color, así que se
    // pide la fila entera acá — igual que hace ConfiguracionPage.
    useEffect(() => {
        if (!profile?.gimnasio_id) return;
        supabase
            .from('gimnasios')
            .select('*')
            .eq('id', profile.gimnasio_id)
            .single()
            .then(({ data }) => setGimnasio(data || null))
            .catch(() => setGimnasio(null));
    }, [profile?.gimnasio_id]);

    const resumen = useMemo(() => {
        const mes = new Date().toISOString().slice(0, 7);
        const cajaMes = pagos
            .filter((p) => String(p.fecha_pago || '').startsWith(mes))
            .reduce((acc, p) => acc + Number(p.monto || 0), 0);

        const ultimo = new Map();
        pagos.forEach((p) => {
            const prev = ultimo.get(p.alumno_id);
            if (!prev || String(p.periodo_hasta || '') > String(prev.periodo_hasta || '')) ultimo.set(p.alumno_id, p);
        });

        const filas = alumnos
            .filter((a) => a.activo)
            .map((a) => {
                const pago = ultimo.get(a.id);
                const estado = estadoCuota(pago, gimnasio);
                return { alumno: a, pago, estado, deuda: deudaEstimada(a, estado, planes) };
            });

        const cuenta = (e) => filas.filter((f) => f.estado === e).length;

        // Deuda total = solo saldos REALES cargados por el profesor (pagos
        // parciales / activaciones sin cobrar). No suma la deuda estimada de
        // los vencidos: esa es una proyección para mostrar en la fila, no plata
        // que alguien haya declarado que se debe.
        const deudaTotal = filas.reduce((acc, f) => acc + Number(f.pago?.monto_adeudado || 0), 0);

        return {
            cajaMes,
            filas,
            deudaTotal,
            alDia: cuenta('al_dia'),
            proximos: cuenta('proximo') + cuenta('en_gracia'),
            vencidos: cuenta('vencido'),
            conDeuda: cuenta('con_deuda'),
            sinCuota: cuenta('sin_cuota'),
        };
    }, [alumnos, pagos, planes, gimnasio]);

    const filasVisibles = resumen.filas.filter((f) => {
        if (filtroEstado !== 'todos' && f.estado !== filtroEstado) return false;
        if (busqueda.trim() && !f.alumno.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
        return true;
    });

    const nombre = (id) => alumnos.find((a) => a.id === id)?.nombre || 'Alumno';

    const abrirCobro = (alumnoId = '') => {
        setForm({ ...vacioPago, alumno_id: alumnoId });
        setSinCobrar(false);
        setOpen(true);
    };

    // Llegar con "?alumno=<id>" (ej. desde el botón "Registrar pago" de la
    // ficha del alumno, o desde la campanita de notificaciones) abre el
    // modal de cobro con ese alumno ya elegido, en vez de obligar a
    // buscarlo de nuevo en el selector. Se limpia el parámetro apenas se
    // usa (replace, sin agregar entrada al historial) para que "Cancelar" o
    // cerrar el modal no lo vuelva a abrir solo si se recarga la página.
    useEffect(() => {
        const alumnoId = searchParams.get('alumno');
        if (!alumnoId) return;
        abrirCobro(alumnoId);
        setSearchParams((prev) => {
            const siguiente = new URLSearchParams(prev);
            siguiente.delete('alumno');
            return siguiente;
        }, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // Al elegir un plan se completan precio, descuento, recargo y el período
    // que cubre. Todo sigue siendo editable a mano después.
    //
    // El período se resuelve buscando su cantidad de días en
    // configuracion_periodos (migración 0014) por NOMBRE -- antes esto
    // adivinaba la duración comparando p.periodo contra 4 strings fijos
    // ('Semanal'/'Diario'/'Trimestral'/'Anual'), lo que dejaba mudo a
    // cualquier período que Nalux creara ella misma (una "Clase suelta", un
    // "Pase de 15 días") — el sistema los trataba como un mes completo sin
    // avisar. Si el nombre no matchea ningún período cargado (plan viejo con
    // texto libre, p. ej. los "Mensual"/"Trimestral" de ejemplo que siembra
    // create_gimnasio() en minúscula), cae a 30 días como piso razonable en
    // vez de romper el cálculo.
    const aplicarPlan = (nombrePlan) => {
        const p = planes.find((x) => x.nombre === nombrePlan);
        if (!p) {
            setForm((f) => ({ ...f, plan: nombrePlan }));
            return;
        }
        const periodo = periodos.find((x) => x.nombre === p.periodo);
        const dias = Number(periodo?.dias) || 30;
        const hasta = new Date(`${form.periodo_desde || hoy()}T00:00:00`);
        hasta.setDate(hasta.getDate() + dias);

        setForm((f) => ({
            ...f,
            plan: nombrePlan,
            monto: String(p.precio || ''),
            descuento: String(p.descuento || ''),
            interes: String(p.interes_mora || ''),
            periodo_hasta: hasta.toISOString().slice(0, 10),
            notas: p.nombre,
        }));
    };

    const totalACobrar = useMemo(() => {
        const base = Number(form.monto || 0);
        const desc = (base * Number(form.descuento || 0)) / 100;
        const mora = (base * Number(form.interes || 0)) / 100;
        return Math.max(0, base - desc + mora);
    }, [form.monto, form.descuento, form.interes]);

    const guardar = async (e) => {
        e.preventDefault();
        if (!form.alumno_id) return;
        setSaving(true);
        setError('');
        try {
            // "Activar sin cobrar": queda el período cubierto pero con importe
            // 0 y TODO el total como saldo pendiente, así el alumno aparece
            // "Con deuda" en vez de aparecer como si hubiera pagado.
            const cobrado = sinCobrar ? 0 : totalACobrar;
            const adeudado = sinCobrar ? totalACobrar : Number(form.monto_adeudado || 0);

            const creado = await createRec('pagos', {
                alumno_id: form.alumno_id,
                monto: cobrado,
                monto_adeudado: adeudado,
                fecha_pago: form.fecha_pago,
                periodo_desde: form.periodo_desde,
                periodo_hasta: form.periodo_hasta || null,
                descuento: Number(form.descuento || 0),
                interes: Number(form.interes || 0),
                metodo: sinCobrar ? 'Sin cobrar' : form.metodo,
                notas: form.notas,
            });
            setOpen(false);
            await cargar();
            setComprobante(creado);
        } catch (_) {
            setError('No se pudo registrar el pago.');
        } finally {
            setSaving(false);
        }
    };

    const alumnoDe = (pago) => alumnos.find((a) => a.id === pago?.alumno_id);

    return (
        <AppLayout
            title="Pagos y caja"
            subtitle="Cobrar, ver quién debe y reimprimir cualquier comprobante."
            actions={
                <Btn onClick={() => abrirCobro()}>
                    <Plus className="h-4 w-4" /> Registrar pago
                </Btn>
            }
        >
            <Helmet>
                <title>Pagos y caja | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Resumen de caja mensual, estado de cuota de cada alumno e historial completo de pagos registrados."
                />
                <style>{ESTILOS_IMPRESION}</style>
            </Helmet>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {loading ? (
                <Loading rows={5} />
            ) : (
                <div className="space-y-8">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        <div className="rounded-2xl border border-border bg-primary p-5 text-primary-foreground">
                            <p className="text-xs font-semibold uppercase tracking-wide opacity-90">Cobrado este mes</p>
                            <p className="mt-3 font-display text-3xl font-extrabold">{money(resumen.cajaMes)}</p>
                        </div>
                        <Card>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Deuda total
                            </p>
                            <p className="mt-3 font-display text-3xl font-extrabold text-warn">
                                {money(resumen.deudaTotal)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Saldos pendientes cargados (pagos parciales y activaciones sin cobrar).
                            </p>
                        </Card>
                        <Card>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Estado de los alumnos
                            </p>
                            <div className="mt-3 space-y-1 text-sm">
                                <p>
                                    <span className="font-bold text-ok">{resumen.alDia}</span> al día ·{' '}
                                    <span className="font-bold text-warn">{resumen.proximos}</span> por vencer
                                </p>
                                <p>
                                    <span className="font-bold text-primary">{resumen.vencidos}</span> atrasados ·{' '}
                                    <span className="font-bold text-warn">{resumen.conDeuda}</span> con deuda ·{' '}
                                    <span className="font-bold text-muted-foreground">{resumen.sinCuota}</span> sin
                                    cuota
                                </p>
                            </div>
                        </Card>
                    </div>

                    <div>
                        <div className="mb-4 grid gap-3 sm:grid-cols-[2fr,1fr]">
                            <div className="relative">
                                <Search
                                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                <Input
                                    value={busqueda}
                                    onChange={(e) => setBusqueda(e.target.value)}
                                    placeholder="Buscar alumno por nombre..."
                                    className="pl-9"
                                    aria-label="Buscar alumno por nombre"
                                />
                            </div>
                            <Select
                                value={filtroEstado}
                                onChange={(e) => setFiltroEstado(e.target.value)}
                                aria-label="Filtrar por estado de cuota"
                            >
                                <option value="todos">Todos los estados</option>
                                {Object.entries(ESTADOS_PAGO).map(([valor, { label }]) => (
                                    <option key={valor} value={valor}>
                                        {label}
                                    </option>
                                ))}
                            </Select>
                        </div>

                        <Card className="p-0">
                            <h2 className="px-5 py-4 font-display text-lg font-bold">Estado por alumno</h2>
                            {filasVisibles.length === 0 ? (
                                <div className="p-5">
                                    <Empty>Ningún alumno activo coincide con estos filtros.</Empty>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[44rem] text-sm">
                                        <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                                            <tr>
                                                <th className="px-5 py-3 text-left">Alumno</th>
                                                <th className="px-5 py-3 text-left">Último pago</th>
                                                <th className="px-5 py-3 text-left">Cubre hasta</th>
                                                <th className="px-5 py-3 text-left">Estado</th>
                                                <th className="px-5 py-3 text-right">Cobrar</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {filasVisibles.map(({ alumno, pago, estado, deuda }) => (
                                                <tr key={alumno.id}>
                                                    <td className="px-5 py-3 font-semibold">
                                                        <Link
                                                            to={`/alumnos/${alumno.id}`}
                                                            className="hover:text-primary"
                                                        >
                                                            {alumno.nombre}
                                                        </Link>
                                                    </td>
                                                    <td className="px-5 py-3 text-muted-foreground">
                                                        {pago
                                                            ? `${money(pago.monto)} · ${fmtFecha(pago.fecha_pago)}`
                                                            : '—'}
                                                        {Number(pago?.monto_adeudado || 0) > 0 && (
                                                            <span className="block text-xs font-semibold text-warn">
                                                                Debe {money(pago.monto_adeudado)}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3 text-muted-foreground">
                                                        {pago ? fmtFecha(pago.periodo_hasta) : '—'}
                                                    </td>
                                                    <td className="px-5 py-3">
                                                        <Badge className={ESTADOS_PAGO[estado].className}>
                                                            {ESTADOS_PAGO[estado].label}
                                                        </Badge>
                                                        {deuda && (
                                                            <span className="mt-1 block text-xs text-muted-foreground">
                                                                Le tocaría {money(deuda.total)}
                                                                {deuda.recargo > 0 && ' con recargo'}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3 text-right">
                                                        <Btn
                                                            variant="ghost"
                                                            className="px-3 py-1.5 text-xs"
                                                            onClick={() => abrirCobro(alumno.id)}
                                                        >
                                                            Cobrar
                                                        </Btn>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </Card>
                    </div>

                    <Card>
                        <h2 className="mb-3 font-display text-lg font-bold">Comprobantes emitidos</h2>
                        {pagos.length === 0 ? (
                            <Empty>Todavía no registraste pagos.</Empty>
                        ) : (
                            <ul className="divide-y divide-border">
                                {pagos.slice(0, 20).map((p) => (
                                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                        <div>
                                            <p className="text-sm font-semibold">
                                                N.º {String(p.numero ?? '—').padStart(4, '0')} · {nombre(p.alumno_id)}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {fmtFecha(p.fecha_pago)} · {p.metodo || 'Efectivo'}
                                                {Number(p.monto_adeudado || 0) > 0
                                                    ? ` · debe ${money(p.monto_adeudado)}`
                                                    : ''}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <p className="font-display text-lg font-bold">{money(p.monto)}</p>
                                            <Btn
                                                variant="ghost"
                                                className="px-3 py-1.5 text-xs"
                                                onClick={() => setComprobante(p)}
                                            >
                                                Ver comprobante
                                            </Btn>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                </div>
            )}

            <Modal open={open} onClose={() => setOpen(false)} title="Registrar pago">
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Alumno">
                        <Select
                            value={form.alumno_id}
                            onChange={(e) => setForm({ ...form, alumno_id: e.target.value })}
                            required
                        >
                            <option value="">Elegir un alumno...</option>
                            {alumnos
                                .filter((a) => a.activo)
                                .map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.nombre}
                                    </option>
                                ))}
                        </Select>
                    </Field>

                    <Field label="Plan">
                        <Select value={form.plan} onChange={(e) => aplicarPlan(e.target.value)}>
                            <option value="">Sin plan (monto libre)</option>
                            {planes
                                .filter((p) => p.activo)
                                .map((p) => (
                                    <option key={p.id} value={p.nombre}>
                                        {p.nombre} — {money(p.precio)}
                                    </option>
                                ))}
                        </Select>
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Monto del plan">
                            <Input
                                type="number"
                                value={form.monto}
                                onChange={(e) => setForm({ ...form, monto: e.target.value })}
                                required
                            />
                        </Field>
                        <Field label="Forma de pago">
                            <Select
                                value={form.metodo}
                                onChange={(e) => setForm({ ...form, metodo: e.target.value })}
                                disabled={sinCobrar}
                            >
                                {METODOS.map((m) => (
                                    <option key={m} value={m}>
                                        {m}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Fecha de pago">
                            <Input
                                type="date"
                                value={form.fecha_pago}
                                onChange={(e) => setForm({ ...form, fecha_pago: e.target.value })}
                            />
                        </Field>
                        <Field label="Cubre desde">
                            <Input
                                type="date"
                                value={form.periodo_desde}
                                onChange={(e) => setForm({ ...form, periodo_desde: e.target.value })}
                            />
                        </Field>
                        <Field label="Cubre hasta">
                            <Input
                                type="date"
                                value={form.periodo_hasta}
                                onChange={(e) => setForm({ ...form, periodo_hasta: e.target.value })}
                            />
                        </Field>
                        {descuentos.length > 0 && (
                            <Field label="Aplicar descuento">
                                <Select
                                    defaultValue=""
                                    onChange={(e) => {
                                        const d = descuentos.find((x) => x.nombre === e.target.value);
                                        if (d) setForm((f) => ({ ...f, descuento: String(d.porcentaje) }));
                                    }}
                                >
                                    <option value="">Sin descuento con nombre...</option>
                                    {descuentos.map((d) => (
                                        <option key={d.id} value={d.nombre}>
                                            {d.nombre} (-{d.porcentaje}%)
                                        </option>
                                    ))}
                                </Select>
                                <span className="text-xs text-muted-foreground">
                                    Pisa el % de acá abajo. Se puede seguir editando a mano después.
                                </span>
                            </Field>
                        )}
                        <Field label="Descuento (%)">
                            <Input
                                type="number"
                                value={form.descuento}
                                onChange={(e) => setForm({ ...form, descuento: e.target.value })}
                            />
                        </Field>
                        <Field label="Recargo por mora (%)">
                            <Input
                                type="number"
                                value={form.interes}
                                onChange={(e) => setForm({ ...form, interes: e.target.value })}
                            />
                        </Field>
                        <Field label="Saldo que queda debiendo">
                            <Input
                                type="number"
                                value={form.monto_adeudado}
                                onChange={(e) => setForm({ ...form, monto_adeudado: e.target.value })}
                                disabled={sinCobrar}
                                placeholder="0"
                            />
                            <span className="text-xs text-muted-foreground">
                                Para pagos parciales: lo que te queda por cobrarle.
                            </span>
                        </Field>
                    </div>

                    <Field label="Observaciones">
                        <Textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
                    </Field>

                    <label className="flex items-start gap-3 rounded-xl border border-border p-4">
                        <input
                            type="checkbox"
                            checked={sinCobrar}
                            onChange={(e) => setSinCobrar(e.target.checked)}
                            className="mt-1 h-4 w-4"
                        />
                        <span className="text-sm">
                            <span className="font-semibold">Activar sin cobrar</span>
                            <span className="block text-xs text-muted-foreground">
                                Le habilita el período igual, sin recibir plata. Queda registrado como deuda
                                completa ({money(totalACobrar)}) y el alumno aparece &quot;Con deuda&quot;.
                            </span>
                        </span>
                    </label>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary px-4 py-3">
                        <span className="text-sm text-muted-foreground">
                            {sinCobrar ? 'Queda debiendo' : 'Total a cobrar'}
                        </span>
                        <span className="font-display text-2xl font-extrabold">{money(totalACobrar)}</span>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpen(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : sinCobrar ? 'Activar sin cobrar' : 'Cobrar'}
                        </Btn>
                    </div>
                </form>
            </Modal>

            <Modal
                open={!!comprobante}
                onClose={() => setComprobante(null)}
                title={`Comprobante N.º ${String(comprobante?.numero ?? '').padStart(4, '0')}`}
                wide
            >
                {/* La hoja se muestra tal cual se imprime (fondo blanco y texto
                    negro siempre, no sigue el tema de la app) para que lo que
                    ve en pantalla sea exactamente lo que sale por impresora. */}
                <div className="overflow-x-auto rounded-xl border border-border bg-white p-6">
                    <Comprobante
                        pago={comprobante}
                        alumno={alumnoDe(comprobante)}
                        gimnasio={gimnasio}
                        enPantalla
                    />
                </div>
                <div className="mt-4 flex justify-end gap-2">
                    <Btn variant="ghost" onClick={() => setComprobante(null)}>
                        Cerrar
                    </Btn>
                    <Btn onClick={() => window.print()}>
                        <Printer className="h-4 w-4" /> Imprimir
                    </Btn>
                </div>
            </Modal>
        </AppLayout>
    );
};

export default PagosPage;
