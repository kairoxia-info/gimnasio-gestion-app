import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Archive, Megaphone, Plus, RotateCcw } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { createRec, listAll, updateRec } from '@/lib/data';
import { SEGMENTOS_NOTIFICACION, fmtFecha, segmentoNotificacion } from '@/lib/format';

const vacio = { titulo: '', mensaje: '', segmento: 'todos' };

// Mismo orden que el CHECK de la tabla notificaciones (0007 SECCIÓN 1) --
// 'todos' primero porque es la opción por defecto y la más usada.
const SEGMENTOS = ['todos', 'al_dia', 'proximo', 'vencido', 'con_deuda', 'sin_cuota'];

// Avisos segmentados por estado de cuota (Bloque G6): el staff arma un aviso
// una sola vez y le llega solo al segmento que corresponde -- el alumno lo ve
// como un cartel en /mi-plan/:codigo (ver_plan_por_codigo ya calcula su
// segmento server-side, mismo criterio que segmentoNotificacion acá).
//
// Esta pantalla NUNCA escribe en notificaciones_leidas -- esa tabla es de
// SOLO LECTURA para el staff (RLS + GRANT recortado a SELECT, 0007 SECCIÓN
// 2/4). Las filas nacen únicamente cuando el alumno toca "Entendido" en
// MiPlanPage, vía la RPC marcar_notificacion_leida().
const AvisosPage = () => {
    const [notificaciones, setNotificaciones] = useState([]);
    const [leidas, setLeidas] = useState([]);
    const [alumnos, setAlumnos] = useState([]);
    const [pagos, setPagos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);
    // Aviso cuyo detalle de lectura se está mirando (quiénes leyeron y
    // quiénes no), o null si el panel está cerrado.
    const [detalle, setDetalle] = useState(null);

    const cargar = () => {
        setLoading(true);
        Promise.all([
            listAll('notificaciones', { sort: '-created_at' }),
            // Sin filtro: se trae una sola vez y se cuenta por aviso en JS
            // (mismo patrón que rutinas_asignadas en RutinasPage) -- más
            // barato que un listAll por tarjeta.
            listAll('notificaciones_leidas'),
            listAll('alumnos', { filters: { activo: true } }),
            listAll('pagos'),
        ])
            .then(([n, l, a, p]) => {
                setNotificaciones(n);
                setLeidas(l);
                setAlumnos(a);
                setPagos(p);
                setError('');
            })
            .catch(() => setError('No se pudieron cargar los avisos.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    // Cantidad de alumnos activos que caen HOY en cada segmento -- mismo
    // criterio EXACTO que ver_plan_por_codigo() calcula en SQL
    // (segmentoNotificacion, lib/format.js). De acá sale tanto el contador en
    // vivo del selector del modal como el "Y" de "X / Y leyeron" de cada
    // aviso ya creado.
    const audienciaPorSegmento = useMemo(() => {
        const conteo = { todos: alumnos.length, al_dia: 0, proximo: 0, vencido: 0, con_deuda: 0, sin_cuota: 0 };
        alumnos.forEach((a) => {
            const seg = segmentoNotificacion(a, pagos);
            conteo[seg] = (conteo[seg] || 0) + 1;
        });
        return conteo;
    }, [alumnos, pagos]);

    const leidosDe = (avisoId) => leidas.filter((l) => l.notificacion_id === avisoId).length;

    const abrirNuevo = () => {
        setForm(vacio);
        setEditId(null);
        setOpen(true);
    };

    const abrirEditar = (aviso) => {
        setForm({ titulo: aviso.titulo || '', mensaje: aviso.mensaje || '', segmento: aviso.segmento || 'todos' });
        setEditId(aviso.id);
        setOpen(true);
    };

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = { titulo: form.titulo, mensaje: form.mensaje, segmento: form.segmento };
            if (editId) await updateRec('notificaciones', editId, payload);
            else await createRec('notificaciones', payload);
            setOpen(false);
            cargar();
        } catch (_) {
            setError(editId ? 'No se pudo guardar el aviso.' : 'No se pudo crear el aviso.');
        } finally {
            setSaving(false);
        }
    };

    // Quiénes leyeron y quiénes no. Los que faltan salen de restarle los que
    // leyeron a la audiencia REAL de hoy (el segmento se recalcula, no se
    // guarda) -- por eso un alumno que cambió de segmento desde que se creó
    // el aviso ya no aparece como pendiente: hoy ese aviso no le toca.
    const detalleLectura = (aviso) => {
        const idsLeyeron = new Set(
            leidas.filter((l) => l.notificacion_id === aviso.id).map((l) => l.alumno_id),
        );
        const audiencia = alumnos.filter(
            (a) => aviso.segmento === 'todos' || segmentoNotificacion(a, pagos) === aviso.segmento,
        );
        return {
            leyeron: audiencia.filter((a) => idsLeyeron.has(a.id)),
            faltan: audiencia.filter((a) => !idsLeyeron.has(a.id)),
        };
    };

    // Archivar/reactivar es reversible -- a propósito sin window.confirm
    // (a diferencia de un borrado real, que acá ni existe: los avisos nunca
    // se eliminan, se archivan para conservar el historial de "quién leyó
    // qué" en notificaciones_leidas).
    const toggleActiva = async (aviso) => {
        try {
            await updateRec('notificaciones', aviso.id, { activa: !aviso.activa });
            cargar();
        } catch (_) {
            setError('No se pudo actualizar el aviso.');
        }
    };

    const activos = notificaciones.filter((n) => n.activa);
    const archivados = notificaciones.filter((n) => !n.activa);

    const renderAviso = (n) => {
        const y = audienciaPorSegmento[n.segmento] ?? 0;
        const x = leidosDe(n.id);
        return (
            <Card key={n.id}>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                            <Megaphone className="h-5 w-5 text-primary" strokeWidth={2} />
                        </span>
                        <div>
                            <p className="font-display text-base font-bold">{n.titulo}</p>
                            <p className="text-xs text-muted-foreground">{fmtFecha(n.created_at)}</p>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                        <Badge className="border-border text-muted-foreground">
                            {SEGMENTOS_NOTIFICACION[n.segmento] || n.segmento}
                        </Badge>
                        {!n.activa && <Badge className="border-primary/60 text-primary">Archivado</Badge>}
                    </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{n.mensaje}</p>
                <button
                    type="button"
                    onClick={() => setDetalle(n)}
                    className="mt-3 text-xs font-semibold text-primary hover:underline"
                >
                    {x} / {y} leyeron — ver quiénes
                </button>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirEditar(n)}>
                        Editar
                    </Btn>
                    {n.activa ? (
                        <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => toggleActiva(n)}>
                            <Archive className="h-3.5 w-3.5" /> Archivar
                        </Btn>
                    ) : (
                        <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => toggleActiva(n)}>
                            <RotateCcw className="h-3.5 w-3.5" /> Reactivar
                        </Btn>
                    )}
                </div>
            </Card>
        );
    };

    return (
        <AppLayout
            title="Avisos"
            subtitle="Enviar un aviso segmentado por estado de cuota. Le llega solo, sin necesidad de que el alumno tenga sesión."
            actions={
                <Btn onClick={abrirNuevo}>
                    <Plus className="h-4 w-4" /> Nuevo aviso
                </Btn>
            }
        >
            <Helmet>
                <title>Avisos | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Avisos segmentados por estado de cuota para los alumnos del gimnasio."
                />
            </Helmet>

            {error && (
                <div className="mb-4">
                    <ErrorBox>{error}</ErrorBox>
                </div>
            )}

            {loading ? (
                <Loading rows={4} />
            ) : notificaciones.length === 0 ? (
                <Empty>Todavía no hay ningún aviso creado. Empezar con el botón &ldquo;Nuevo aviso&rdquo;.</Empty>
            ) : (
                <div className="space-y-8">
                    <div>
                        <h2 className="mb-3 font-display text-lg font-bold">Activos</h2>
                        {activos.length === 0 ? (
                            <Empty>No hay avisos activos.</Empty>
                        ) : (
                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{activos.map(renderAviso)}</div>
                        )}
                    </div>

                    {archivados.length > 0 && (
                        <div>
                            <h2 className="mb-3 font-display text-lg font-bold">Archivados</h2>
                            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                {archivados.map(renderAviso)}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Editar aviso' : 'Nuevo aviso'}>
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Título">
                        <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required />
                    </Field>
                    <Field label="Mensaje">
                        <Textarea
                            value={form.mensaje}
                            onChange={(e) => setForm({ ...form, mensaje: e.target.value })}
                            required
                        />
                    </Field>
                    <Field label="A quién le llega">
                        <Select value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })}>
                            {SEGMENTOS.map((s) => (
                                <option key={s} value={s}>
                                    {SEGMENTOS_NOTIFICACION[s]} ({audienciaPorSegmento[s] ?? 0})
                                </option>
                            ))}
                        </Select>
                    </Field>

                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpen(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear aviso'}
                        </Btn>
                    </div>
                </form>
            </Modal>

            <Modal open={!!detalle} onClose={() => setDetalle(null)} title={detalle?.titulo || 'Lectura del aviso'}>
                {detalle &&
                    (() => {
                        const { leyeron, faltan } = detalleLectura(detalle);
                        return (
                            <div className="space-y-5">
                                <div>
                                    <h3 className="text-sm font-bold text-ok">Leyeron ({leyeron.length})</h3>
                                    {leyeron.length === 0 ? (
                                        <p className="mt-1 text-sm text-muted-foreground">Todavía nadie.</p>
                                    ) : (
                                        <ul className="mt-2 space-y-1 text-sm">
                                            {leyeron.map((a) => (
                                                <li key={a.id}>{a.nombre}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-warn">Todavía no lo vieron ({faltan.length})</h3>
                                    {faltan.length === 0 ? (
                                        <p className="mt-1 text-sm text-muted-foreground">Lo vieron todos.</p>
                                    ) : (
                                        <ul className="mt-2 space-y-1 text-sm">
                                            {faltan.map((a) => (
                                                <li key={a.id}>{a.nombre}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    El alumno queda como &quot;leído&quot; cuando abre su link del QR y toca
                                    &quot;Entendido&quot;.
                                </p>
                            </div>
                        );
                    })()}
            </Modal>
        </AppLayout>
    );
};

export default AvisosPage;
