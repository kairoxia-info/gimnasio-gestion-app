import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Badge, Card, Empty, ErrorBox, Loading, Select } from '@/components/ui-kit';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';
import { fmtFecha, money } from '@/lib/format';
import { AYUDAS } from '@/lib/guiaDeUso';

// Historial de cambios (migración 0079, pedido de Nalux del 28/10/2026): quién cargó, editó o
// anuló un pago y quién tocó los precios. Solo lo ve el administrador. La base lo garantiza
// (la política de lectura exige rol admin y nadie puede escribir ni borrar la bitácora); esta
// pantalla solo evita mostrarle al staff algo que no puede abrir.
const LIMITE = 500;

const ACCIONES = {
    alta: { label: 'Registró', className: 'border-primary text-primary' },
    edicion: { label: 'Editó', className: 'border-warn text-warn' },
    baja: { label: 'Eliminó', className: 'border-destructive text-destructive' },
    anulacion: { label: 'Anuló', className: 'border-destructive text-destructive' },
};

const ROLES = { admin: 'Administrador', staff: 'Staff' };

// Campos que no aportan al leer el "antes y después" de una edición.
const CAMPOS_IGNORADOS = new Set(['id', 'gimnasio_id', 'created_at', 'registrado_por', 'client_id']);

const ETIQUETAS = {
    monto: 'Monto',
    monto_adeudado: 'Adeudado',
    fecha_pago: 'Fecha de pago',
    periodo_desde: 'Período desde',
    periodo_hasta: 'Período hasta',
    metodo: 'Método',
    notas: 'Notas',
    descuento: 'Descuento',
    interes: 'Interés',
    estado: 'Estado',
    numero: 'Comprobante N°',
    nombre: 'Nombre',
    precio: 'Precio',
    periodo: 'Período',
    dias_semana: 'Días por semana',
    interes_mora: 'Interés por mora',
    activo: 'Activo',
    plan_precio_nombre: 'Plan',
    fecha_alta: 'Alta',
    dias: 'Días',
    porcentaje: 'Porcentaje',
};

const verValor = (campo, valor) => {
    if (valor === null || valor === undefined || valor === '') return '—';
    if (campo === 'monto' || campo === 'monto_adeudado' || campo === 'precio') return money(valor);
    if (campo.startsWith('periodo_') || campo === 'fecha_pago' || campo === 'fecha_alta') return fmtFecha(valor);
    if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
    return String(valor);
};

// Lo que cambió en una edición, campo por campo.
const cambiosDe = (antes, despues) => {
    if (!antes || !despues) return [];
    return Object.keys(despues)
        .filter((k) => !CAMPOS_IGNORADOS.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
        .map((k) => ({ campo: k, antes: antes[k], despues: despues[k] }));
};

// Lo más importante de un pago o plan que desapareció, para poder reconstruirlo a ojo.
const datosDe = (fila) =>
    Object.keys(fila || {})
        .filter((k) => !CAMPOS_IGNORADOS.has(k) && ETIQUETAS[k] && fila[k] !== null && fila[k] !== '')
        .map((k) => ({ campo: k, valor: fila[k] }));

const HistorialPage = () => {
    const { profile, loading: cargandoPerfil } = useAuth();
    const [filas, setFilas] = useState([]);
    // Personas del equipo de este gimnasio (equipo_listar, 0080): el filtro las ofrece a todas, aunque
    // todavía no hayan hecho ningún cambio anotado.
    const [equipo, setEquipo] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filtroAutor, setFiltroAutor] = useState('todos');
    const [filtroAccion, setFiltroAccion] = useState('todas');
    const [abierta, setAbierta] = useState(null);

    const zona = profile?.gimnasios?.zona_horaria || undefined;
    const esAdmin = profile?.role === 'admin';

    useEffect(() => {
        if (!esAdmin) return;
        setLoading(true);
        supabase
            .from('bitacora')
            .select('id, user_id, autor_nombre, autor_rol, accion, tabla, resumen, motivo, antes, despues, creado_en')
            .order('creado_en', { ascending: false })
            .limit(LIMITE)
            .then(({ data, error: errorCarga }) => {
                if (errorCarga) {
                    setError('No se pudo cargar el historial.');
                } else {
                    setFilas(data ?? []);
                    setError('');
                }
                setLoading(false);
            });
    }, [esAdmin]);

    useEffect(() => {
        if (!esAdmin) return;
        supabase.rpc('equipo_listar').then(({ data }) => setEquipo(data ?? []));
    }, [esAdmin]);

    // Todo el equipo del gimnasio + quien aparezca en el historial (por ejemplo alguien que ya no está).
    const autores = useMemo(() => {
        const mapa = new Map();
        equipo.forEach((p) => mapa.set(p.user_id, p.nombre || p.email || 'Sin nombre'));
        filas.forEach((f) => {
            const clave = f.user_id ?? 'sistema';
            if (!mapa.has(clave)) mapa.set(clave, f.autor_nombre || 'Sistema');
        });
        return [...mapa.entries()];
    }, [equipo, filas]);

    const visibles = filas.filter((f) => {
        if (filtroAutor !== 'todos' && (f.user_id ?? 'sistema') !== filtroAutor) return false;
        if (filtroAccion !== 'todas' && f.accion !== filtroAccion) return false;
        return true;
    });

    if (!cargandoPerfil && profile && !esAdmin) {
        return <Navigate to="/panel" replace />;
    }

    const fechaHora = (iso) =>
        new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short', timeZone: zona });

    return (
        <AppLayout
            ayuda={AYUDAS.historial}
            title="Historial de cambios"
            subtitle="Quién tocó los pagos y los precios, y cuándo."
        >
            <Helmet>
                <title>Historial de cambios | RutNail</title>
                <meta name="description" content="Registro de quién cargó, editó o anuló pagos y cambió precios." />
            </Helmet>

            {error && (
                <div className="mb-4">
                    <ErrorBox>{error}</ErrorBox>
                </div>
            )}

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <Select
                    value={filtroAutor}
                    onChange={(e) => setFiltroAutor(e.target.value)}
                    aria-label="Filtrar por persona"
                >
                    <option value="todos">Todas las personas</option>
                    {autores.map(([id, nombre]) => (
                        <option key={id} value={id}>
                            {nombre}
                        </option>
                    ))}
                </Select>
                <Select
                    value={filtroAccion}
                    onChange={(e) => setFiltroAccion(e.target.value)}
                    aria-label="Filtrar por acción"
                >
                    <option value="todas">Todas las acciones</option>
                    {Object.entries(ACCIONES).map(([clave, { label }]) => (
                        <option key={clave} value={clave}>
                            {label}
                        </option>
                    ))}
                </Select>
            </div>

            {loading ? (
                <Loading />
            ) : visibles.length === 0 ? (
                <Empty>Todavía no hay cambios registrados con estos filtros.</Empty>
            ) : (
                <Card>
                    <ul className="divide-y divide-border">
                        {visibles.map((f) => {
                            const accion = ACCIONES[f.accion] ?? ACCIONES.edicion;
                            const cambios = f.accion === 'edicion' ? cambiosDe(f.antes, f.despues) : [];
                            const datos = f.accion === 'anulacion' || f.accion === 'baja' ? datosDe(f.antes) : [];
                            const tieneDetalle = cambios.length > 0 || datos.length > 0;
                            return (
                                <li key={f.id} className="py-3">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold">
                                                {f.autor_nombre || 'Sistema'}
                                                {f.autor_rol && (
                                                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                        {ROLES[f.autor_rol] ?? f.autor_rol}
                                                    </span>
                                                )}
                                            </p>
                                            <p className="mt-0.5 text-sm">
                                                <Badge className={`mr-2 ${accion.className}`}>{accion.label}</Badge>
                                                {f.resumen}
                                            </p>
                                            {f.motivo && (
                                                <p className="mt-1 text-xs text-muted-foreground">Motivo: {f.motivo}</p>
                                            )}
                                        </div>
                                        <p className="shrink-0 text-xs text-muted-foreground">{fechaHora(f.creado_en)}</p>
                                    </div>

                                    {tieneDetalle && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => setAbierta(abierta === f.id ? null : f.id)}
                                                className="mt-2 text-xs font-semibold text-primary"
                                            >
                                                {abierta === f.id ? 'Ocultar detalle' : 'Ver detalle'}
                                            </button>
                                            {abierta === f.id && (
                                                <ul className="mt-2 space-y-1 rounded-xl border border-border bg-secondary p-3 text-xs">
                                                    {cambios.map((c) => (
                                                        <li key={c.campo}>
                                                            <span className="font-semibold">
                                                                {ETIQUETAS[c.campo] ?? c.campo}:
                                                            </span>{' '}
                                                            {verValor(c.campo, c.antes)} → {verValor(c.campo, c.despues)}
                                                        </li>
                                                    ))}
                                                    {datos.map((d) => (
                                                        <li key={d.campo}>
                                                            <span className="font-semibold">{ETIQUETAS[d.campo]}:</span>{' '}
                                                            {verValor(d.campo, d.valor)}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    {filas.length >= LIMITE && (
                        <p className="mt-3 text-xs text-muted-foreground">
                            Se muestran los últimos {LIMITE} cambios.
                        </p>
                    )}
                </Card>
            )}
        </AppLayout>
    );
};

export default HistorialPage;
