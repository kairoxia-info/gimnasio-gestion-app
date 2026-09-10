import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Info, Plus, Search, UserRound, X } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea } from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import { ESTADOS_ALUMNO, antiguedad, estadoAlumno, fmtFecha, hoy, money } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';

// Pedido de Nalux (08/09/2026): la foto pasa de "pegar una URL" a "subir el
// archivo" -- en la práctica el profesor tiene la foto guardada en el
// celular o la compu, no un link ya público. Mismo criterio que el logo del
// gimnasio (ConfiguracionPage.jsx): 2 MB de tope, solo estos tres formatos
// (mismo límite que ya impone el bucket 'alumnos-fotos', migración 0036).
const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const vacio = {
    nombre: '',
    contacto: '',
    email: '',
    fecha_alta: hoy(),
    fecha_nacimiento: '',
    dni: '',
    contacto_emergencia: '',
    objetivo: '',
    foto_url: '',
    activo: true,
    pendiente: false,
    observaciones_salud: '',
    plan_precio_nombre: '',
};

// Texto de referencia para el ícono de info: qué significa cada estado, en
// las palabras de Nalux. "Pendiente" cubre dos orígenes a propósito — ver
// estadoAlumno() en format.js.
const AYUDA_ESTADOS = [
    ['activo', 'Está entrenando. Cuenta en las estadísticas y aparece en pagos/asistencia.'],
    [
        'pendiente',
        'Cargado pero todavía no arrancó — se anotó solo con el link de invitación y falta aprobarlo, o lo marcaste así a propósito (ej. "se anotó pero no vino todavía").',
    ],
    ['inactivo', 'Dado de baja, no entrena más por ahora.'],
];

const AlumnosPage = () => {
    const { profile } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [alumnos, setAlumnos] = useState([]);
    const [planes, setPlanes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    const [q, setQ] = useState('');
    const [filtroEstado, setFiltroEstado] = useState('todos');
    const [mostrarAyudaEstados, setMostrarAyudaEstados] = useState(false);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);
    // Confirmación inline por fila para "Eliminar" (09/09/2026, reportado por
    // Nalux: "cuando quiero eliminar un alumno no se elimina"). Antes usaba
    // window.confirm() -- el único lugar de esta pantalla con ese cartel
    // nativo en vez del patrón "¿Seguro?" que ya usa el resto de la app, y
    // sin manejo de error si el borrado fallaba (quedaba mudo, sin avisar
    // nada). Se unifica con el mismo patrón, y ahora si falla se ve.
    const [confirmandoBorrarId, setConfirmandoBorrarId] = useState(null);
    const [borrando, setBorrando] = useState(false);

    // Archivo de foto elegido para subir a Storage (mismo criterio que
    // logoFile en ConfiguracionPage.jsx). fotoPreview es el object URL local
    // para mostrarlo antes de guardar; sin archivo nuevo, se sigue mostrando
    // form.foto_url (la foto que ya tenía el alumno, si la tenía).
    const [fotoFile, setFotoFile] = useState(null);
    const [fotoPreview, setFotoPreview] = useState('');
    const [fotoError, setFotoError] = useState('');
    const fotoInputRef = useRef(null);

    const cargar = () => {
        setLoading(true);
        Promise.all([listAll('alumnos', { sort: 'nombre' }), listAll('configuracion_precios', { sort: 'nombre' })])
            .then(([a, p]) => {
                setAlumnos(a);
                setPlanes(p);
                setError('');
            })
            .catch(() => setError('No se pudieron cargar los alumnos.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    // Llegar con "?editar=<id>" (desde el botón "Editar datos" de la ficha del
    // alumno, o de la campanita "faltan sus datos") abre directo el modal de
    // edición de ese alumno -- la ficha no tiene su propio formulario, reusa
    // este. Espera a que `alumnos` esté cargado; después limpia el parámetro
    // (replace) para que cerrar el modal no lo reabra al recargar.
    useEffect(() => {
        if (loading) return;
        const editarId = searchParams.get('editar');
        if (!editarId) return;
        const alumno = alumnos.find((a) => a.id === editarId);
        if (alumno) abrirEditar(alumno);
        setSearchParams(
            (prev) => {
                const siguiente = new URLSearchParams(prev);
                siguiente.delete('editar');
                return siguiente;
            },
            { replace: true },
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, loading, alumnos]);

    const limpiarFoto = () => {
        setFotoFile(null);
        setFotoPreview('');
        setFotoError('');
        if (fotoInputRef.current) fotoInputRef.current.value = '';
    };

    const abrirNuevo = () => {
        setForm(vacio);
        setEditId(null);
        limpiarFoto();
        setOpen(true);
    };

    const abrirEditar = (a) => {
        setForm({
            nombre: a.nombre || '',
            contacto: a.contacto || '',
            email: a.email || '',
            fecha_alta: String(a.fecha_alta || '').slice(0, 10) || hoy(),
            fecha_nacimiento: String(a.fecha_nacimiento || '').slice(0, 10),
            dni: a.dni || '',
            contacto_emergencia: a.contacto_emergencia || '',
            objetivo: a.objetivo || '',
            foto_url: a.foto_url || '',
            activo: !!a.activo,
            pendiente: !!a.pendiente,
            observaciones_salud: a.observaciones_salud || '',
            plan_precio_nombre: a.plan_precio_nombre || '',
        });
        setEditId(a.id);
        limpiarFoto();
        setOpen(true);
    };

    const onFotoChange = (e) => {
        const file = e.target.files?.[0];
        setFotoError('');
        if (!file) {
            setFotoFile(null);
            setFotoPreview('');
            return;
        }
        if (!MIME_TO_EXT[file.type]) {
            setFotoError('La foto debe ser PNG, JPG o WEBP.');
            e.target.value = '';
            return;
        }
        if (file.size > MAX_FOTO_BYTES) {
            setFotoError('La foto no puede pesar más de 2 MB.');
            e.target.value = '';
            return;
        }
        setFotoFile(file);
        setFotoPreview(URL.createObjectURL(file));
    };

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        setWarning('');
        try {
            // fecha_nacimiento es opcional y es DATE en la base: un '' (el
            // input vacío) rompe el insert/update ("invalid input syntax for
            // type date"), a diferencia de un campo TEXT donde '' es válido.
            // Postgres sí acepta null.
            //
            // foto_url NO se toca acá cuando hay fotoFile: si la subida de
            // abajo falla, este guardado tiene que dejar intacta la foto que
            // ya hubiera (nunca pisarla con vacío antes de saber si la nueva
            // se subió bien) — mismo criterio que media_url en
            // EjerciciosPage.jsx.
            const payload = { ...form, fecha_nacimiento: form.fecha_nacimiento || null };

            let id = editId;
            if (editId) await updateRec('alumnos', editId, payload);
            else {
                const creado = await createRec('alumnos', payload);
                id = creado.id;
            }

            // La foto se sube DESPUÉS de guardar el alumno, nunca antes: la
            // policy del bucket 'alumnos-fotos' (migración 0036) exige que ya
            // exista una fila real de alumnos con ese id.
            if (fotoFile && profile?.gimnasio_id && id) {
                try {
                    const ext = MIME_TO_EXT[fotoFile.type];
                    const path = `${profile.gimnasio_id}/${id}.${ext}`;
                    const { error: uploadError } = await supabase.storage
                        .from('alumnos-fotos')
                        .upload(path, fotoFile, { upsert: true });
                    if (uploadError) throw uploadError;

                    const {
                        data: { publicUrl },
                    } = supabase.storage.from('alumnos-fotos').getPublicUrl(path);

                    await updateRec('alumnos', id, { foto_url: publicUrl });
                } catch (_) {
                    setWarning(
                        'El alumno se guardó, pero la foto no se pudo subir. Se puede volver a intentar editando el alumno.',
                    );
                }
            }

            setOpen(false);
            limpiarFoto();
            cargar();
        } catch (_) {
            setError('No se pudo guardar el alumno.');
        } finally {
            setSaving(false);
        }
    };

    const borrar = async (id) => {
        setBorrando(true);
        setError('');
        try {
            await removeRec('alumnos', id);
            setConfirmandoBorrarId(null);
            cargar();
        } catch (_) {
            setError('No se pudo eliminar el alumno. Reintentar en unos minutos.');
        } finally {
            setBorrando(false);
        }
    };

    const filtrados = alumnos.filter((a) => {
        if (filtroEstado !== 'todos' && estadoAlumno(a) !== filtroEstado) return false;
        if (q.trim() && !a.nombre?.toLowerCase().includes(q.trim().toLowerCase())) return false;
        return true;
    });

    // Cuánta gente hay en cada estado, para mostrarlo directo en el chip del
    // filtro (Nalux pidió que activo/inactivo/pendiente sea "más accesible y
    // fácil de mostrar" sin tener que clickear cada chip para enterarse).
    const conteos = useMemo(() => {
        const c = { todos: alumnos.length, activo: 0, pendiente: 0, inactivo: 0 };
        alumnos.forEach((a) => {
            c[estadoAlumno(a)] += 1;
        });
        return c;
    }, [alumnos]);

    return (
        <AppLayout
            title={
                <span className="inline-flex flex-wrap items-center gap-3">
                    Alumnos
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-bold normal-case text-primary">
                        {alumnos.length} {alumnos.length === 1 ? 'alumno' : 'alumnos'}
                    </span>
                </span>
            }
            subtitle="Ficha de cada alumno con estado, antigüedad y observaciones de salud."
            actions={
                <Btn onClick={abrirNuevo}>
                    <Plus className="h-4 w-4" /> Nuevo alumno
                </Btn>
            }
        >
            <Helmet>
                <title>Alumnos | Gestión GYM Kairox IA</title>
                <meta
                    name="description"
                    content="Listado de alumnos del gimnasio con estado, antigüedad, contacto y observaciones de salud."
                />
            </Helmet>

            <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar alumno"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
            </div>

            <div className="relative mb-6 flex flex-wrap items-center gap-2">
                {[
                    ['todos', 'Todos'],
                    ['activo', 'Activos'],
                    ['pendiente', 'Pendientes'],
                    ['inactivo', 'Inactivos'],
                ].map(([valor, etiqueta]) => (
                    <button
                        key={valor}
                        type="button"
                        onClick={() => setFiltroEstado(valor)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                            filtroEstado === valor
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {valor === 'pendiente' && conteos.pendiente > 0 && filtroEstado !== 'pendiente' && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                        )}
                        {etiqueta} ({conteos[valor]})
                    </button>
                ))}

                <button
                    type="button"
                    onClick={() => setMostrarAyudaEstados((v) => !v)}
                    aria-expanded={mostrarAyudaEstados}
                    aria-label="Qué significa cada estado"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:border-primary hover:text-primary"
                >
                    <Info className="h-4 w-4" aria-hidden="true" />
                </button>

                {mostrarAyudaEstados && (
                    <div className="absolute left-0 top-full z-10 mt-2 w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-sm font-bold">Qué significa cada estado</p>
                            <button
                                type="button"
                                onClick={() => setMostrarAyudaEstados(false)}
                                aria-label="Cerrar"
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border"
                            >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        </div>
                        <dl className="space-y-3">
                            {AYUDA_ESTADOS.map(([valor, texto]) => (
                                <div key={valor}>
                                    <dt className={`text-xs font-bold ${ESTADOS_ALUMNO[valor].className.split(' ')[0]}`}>
                                        {ESTADOS_ALUMNO[valor].label}
                                    </dt>
                                    <dd className="mt-0.5 text-xs text-muted-foreground">{texto}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                )}
            </div>

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}
            {warning && !error && (
                <div className="mb-4 flex items-start gap-2 rounded-2xl border border-border bg-secondary p-4 text-sm text-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={1.8} />
                    <span>{warning}</span>
                </div>
            )}

            {loading ? (
                <Loading rows={4} />
            ) : filtrados.length === 0 ? (
                <Empty>
                    {alumnos.length === 0 ? (
                        <>Todavía no hay alumnos cargados. Empezar con el botón &ldquo;Nuevo alumno&rdquo;.</>
                    ) : (
                        'No hay alumnos que coincidan con estos filtros.'
                    )}
                </Empty>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filtrados.map((a) => (
                        <div
                            key={a.id}
                            className="flex flex-col rounded-2xl border border-border bg-card p-5 transition hover:border-primary"
                        >
                            <div className="flex items-start gap-4">
                                {a.foto_url ? (
                                    <img
                                        src={a.foto_url}
                                        alt={a.nombre}
                                        className="h-14 w-14 rounded-xl object-cover"
                                    />
                                ) : (
                                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary">
                                        <UserRound className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-display text-lg font-bold">{a.nombre}</p>
                                    <p className="text-xs text-muted-foreground">{antiguedad(a.fecha_alta)}</p>
                                </div>
                                <Badge className={ESTADOS_ALUMNO[estadoAlumno(a)].className}>
                                    {ESTADOS_ALUMNO[estadoAlumno(a)].label}
                                </Badge>
                            </div>

                            <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
                                <div>Alta: {fmtFecha(a.fecha_alta)}</div>
                                {a.contacto && <div>Contacto: {a.contacto}</div>}
                                {a.email && <div>Correo: {a.email}</div>}
                                {a.plan_precio_nombre && <div>Plan: {a.plan_precio_nombre}</div>}
                                {a.objetivo && <div>Objetivo: {a.objetivo}</div>}
                            </dl>

                            {a.observaciones_salud && (
                                <p className="mt-3 rounded-xl border border-primary/40 bg-primary/10 p-3 text-xs">
                                    Salud: {a.observaciones_salud}
                                </p>
                            )}

                            <div className="mt-5 flex flex-wrap gap-2">
                                <Link
                                    to={`/alumnos/${a.id}`}
                                    className="inline-flex items-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                                >
                                    Abrir ficha
                                </Link>
                                <Btn variant="ghost" className="px-3 py-2 text-xs" onClick={() => abrirEditar(a)}>
                                    Editar
                                </Btn>
                                {estadoAlumno(a) === 'pendiente' && (
                                    // Antes activaba acá mismo con solo activo=true --
                                    // Nalux (09/09/2026): "cuando se apruebe ya el
                                    // alumno tenga acceso a su plataforma", así que
                                    // aprobar ahora también le crea usuario y
                                    // contraseña, y hay que poder mostrárselos al
                                    // profesor (con el botón de WhatsApp) -- eso ya
                                    // vive en la ficha (tarjeta "Acceso del alumno"),
                                    // no tiene sentido duplicarlo acá en la lista.
                                    <Link
                                        to={`/alumnos/${a.id}`}
                                        className="inline-flex items-center rounded-xl border border-primary px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
                                    >
                                        Revisar y activar
                                    </Link>
                                )}
                                {confirmandoBorrarId === a.id ? (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-xs text-muted-foreground">
                                            ¿Eliminar para siempre? Se borra también su historial.
                                        </span>
                                        <Btn
                                            variant="danger"
                                            className="px-3 py-2 text-xs"
                                            disabled={borrando}
                                            onClick={() => borrar(a.id)}
                                        >
                                            {borrando ? 'Eliminando...' : 'Sí, eliminar'}
                                        </Btn>
                                        <Btn
                                            variant="ghost"
                                            className="px-3 py-2 text-xs"
                                            disabled={borrando}
                                            onClick={() => setConfirmandoBorrarId(null)}
                                        >
                                            Cancelar
                                        </Btn>
                                    </div>
                                ) : (
                                    <Btn
                                        variant="danger"
                                        className="px-3 py-2 text-xs"
                                        onClick={() => setConfirmandoBorrarId(a.id)}
                                    >
                                        Eliminar
                                    </Btn>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Editar alumno' : 'Nuevo alumno'}>
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Nombre y apellido">
                        <Input
                            value={form.nombre}
                            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                            required
                        />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Teléfono / contacto">
                            <Input
                                value={form.contacto}
                                onChange={(e) => setForm({ ...form, contacto: e.target.value })}
                            />
                        </Field>
                        <Field label="Correo">
                            <Input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                            />
                        </Field>
                        <Field label="Fecha de alta">
                            <Input
                                type="date"
                                value={form.fecha_alta}
                                onChange={(e) => setForm({ ...form, fecha_alta: e.target.value })}
                            />
                        </Field>
                        {/* Pedido de Nalux (07/09/2026): que el plan sea obligatorio
                            al dar de alta. Sin plan, después el cobro arranca sin
                            precio y hay que acordarse de cuál le corresponde a cada
                            uno -- que era justo la parte que se prestaba a
                            confusión. Los planes salen de Precios, ya cargados por
                            el profesor; si todavía no hay ninguno se avisa y se
                            manda para allá, en vez de dejar un select vacío que no
                            se puede completar. */}
                        <Field label="Plan contratado">
                            {planes.length === 0 ? (
                                <p className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5 text-xs text-warn">
                                    Todavía no hay planes cargados.{' '}
                                    <Link to="/precios" className="font-semibold underline">
                                        Cargar precios
                                    </Link>{' '}
                                    y volver para poder dar de alta al alumno.
                                </p>
                            ) : (
                                <Select
                                    value={form.plan_precio_nombre}
                                    onChange={(e) => setForm({ ...form, plan_precio_nombre: e.target.value })}
                                    required
                                >
                                    <option value="">Elegir un plan...</option>
                                    {planes.map((p) => (
                                        <option key={p.id} value={p.nombre}>
                                            {p.nombre} — {money(p.precio)}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Field label="Fecha de nacimiento (opcional)">
                            <Input
                                type="date"
                                value={form.fecha_nacimiento}
                                onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })}
                            />
                            <span className="text-xs text-muted-foreground">
                                Para el aviso de cumpleaños en el panel general.
                            </span>
                        </Field>
                        <Field label="DNI (opcional)">
                            <Input
                                value={form.dni}
                                onChange={(e) => setForm({ ...form, dni: e.target.value })}
                            />
                        </Field>
                        <Field label="Contacto de emergencia (opcional)">
                            <Input
                                value={form.contacto_emergencia}
                                onChange={(e) => setForm({ ...form, contacto_emergencia: e.target.value })}
                                placeholder="Nombre y teléfono"
                            />
                        </Field>
                        <Field label="Objetivo (opcional)">
                            <Input
                                value={form.objetivo}
                                onChange={(e) => setForm({ ...form, objetivo: e.target.value })}
                                placeholder="Bajar de peso, ganar masa muscular..."
                            />
                        </Field>
                    </div>
                    <Field label="Foto (opcional)">
                        <div className="flex items-center gap-3">
                            {fotoPreview || form.foto_url ? (
                                <img
                                    src={fotoPreview || form.foto_url}
                                    alt="Foto del alumno"
                                    className="h-12 w-12 shrink-0 rounded-xl border border-border object-cover"
                                />
                            ) : (
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
                                    <UserRound className="h-5 w-5" strokeWidth={1.6} />
                                </div>
                            )}
                            <input
                                ref={fotoInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={onFotoChange}
                                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground file:transition hover:file:brightness-110"
                            />
                        </div>
                        <span className="text-xs text-muted-foreground">PNG, JPG o WEBP. Máximo 2 MB.</span>
                        {fotoError && <ErrorBox>{fotoError}</ErrorBox>}
                    </Field>
                    <Field label="Observaciones de salud, lesiones o restricciones">
                        <Textarea
                            value={form.observaciones_salud}
                            onChange={(e) => setForm({ ...form, observaciones_salud: e.target.value })}
                        />
                    </Field>
                    <Field label="Estado">
                        <div className="flex flex-wrap gap-2">
                            {['activo', 'pendiente', 'inactivo'].map((valor) => {
                                const seleccionado = estadoAlumno(form) === valor;
                                return (
                                    <button
                                        key={valor}
                                        type="button"
                                        onClick={() =>
                                            setForm((f) => ({
                                                ...f,
                                                activo: valor === 'activo',
                                                pendiente: valor === 'pendiente',
                                            }))
                                        }
                                        aria-pressed={seleccionado}
                                        className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                                            seleccionado
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'border-border text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        {ESTADOS_ALUMNO[valor].label}
                                    </button>
                                );
                            })}
                        </div>
                        <span className="text-xs text-muted-foreground">
                            &ldquo;Pendiente&rdquo; sirve tanto para alguien que se anotó solo con el link de
                            invitación (falta aprobarlo) como para alguien cargado manualmente que todavía no
                            arrancó.
                        </span>
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpen(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Btn>
                    </div>
                </form>
            </Modal>
        </AppLayout>
    );
};

export default AlumnosPage;
