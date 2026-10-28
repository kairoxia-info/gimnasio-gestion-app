import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Navigate } from 'react-router-dom';
import { KeyRound, Pause, Play, Plus, Trash2, UserPlus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PasswordInput } from '@/components/ui-kit';
import { useAuth } from '@/contexts/AuthContext';
import supabase from '@/lib/supabaseClient';
import { validarContrasena } from '@/lib/validacionPassword';

// Equipo (migración 0080, pedido de Nalux del 28/10/2026): el administrador le crea a cada
// empleado su propio usuario y contraseña. El empleado entra solo a este gimnasio y todo lo que
// toca en pagos y precios queda en el Historial. Solo lo ve el administrador; las reglas de
// verdad están en la base y en la función "equipo" (verifican el rol en el servidor).

// El mensaje de una función de Supabase que respondió con error (viene en el cuerpo de la respuesta).
const mensajeDeError = async (error, porDefecto) => {
    try {
        const cuerpo = await error?.context?.json?.();
        if (cuerpo?.error) return cuerpo.error;
    } catch (_) {
        // sin cuerpo legible: se usa el mensaje por defecto
    }
    return porDefecto;
};

const llamarEquipo = async (body) => {
    const { data, error } = await supabase.functions.invoke('equipo', { body });
    if (error) return { error: await mensajeDeError(error, 'No se pudo completar la acción. Reintentar en unos minutos.') };
    if (data?.error) return { error: data.error };
    return { data };
};

const vacio = { nombre: '', apellido: '', email: '', password: '' };

const EquipoPage = () => {
    const { profile, loading: cargandoPerfil } = useAuth();
    const esAdmin = profile?.role === 'admin';

    const [equipo, setEquipo] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [aviso, setAviso] = useState('');

    const [altaAbierta, setAltaAbierta] = useState(false);
    const [form, setForm] = useState(vacio);
    const [guardando, setGuardando] = useState(false);
    const [altaError, setAltaError] = useState('');

    const [claveDe, setClaveDe] = useState(null);
    const [claveNueva, setClaveNueva] = useState('');
    const [claveError, setClaveError] = useState('');
    const [cambiandoClave, setCambiandoClave] = useState(false);

    const [quitando, setQuitando] = useState(null);
    const [trabajando, setTrabajando] = useState(null);

    const cargar = useCallback(() => {
        setLoading(true);
        supabase.rpc('equipo_listar').then(({ data, error: errorCarga }) => {
            if (errorCarga) {
                setError('No se pudo cargar el equipo.');
            } else {
                setEquipo(data ?? []);
                setError('');
            }
            setLoading(false);
        });
    }, []);

    useEffect(() => {
        if (esAdmin) cargar();
    }, [esAdmin, cargar]);

    if (!cargandoPerfil && profile && !esAdmin) {
        return <Navigate to="/panel" replace />;
    }

    const abrirAlta = () => {
        setForm(vacio);
        setAltaError('');
        setAltaAbierta(true);
    };

    const crear = async (e) => {
        e.preventDefault();
        setAltaError('');
        const errorPass = form.password ? validarContrasena(form.password, 8, { exigirMinusculaYNumero: true }) : '';
        if (errorPass) {
            setAltaError(errorPass);
            return;
        }
        setGuardando(true);
        const { data, error: errorCrear } = await llamarEquipo({ accion: 'crear', ...form });
        setGuardando(false);
        if (errorCrear) {
            setAltaError(errorCrear);
            return;
        }
        setAltaAbierta(false);
        setAviso(
            data?.creado
                ? 'Cuenta creada. Comparte con la persona su correo y su contraseña para que pueda ingresar.'
                : 'Esa persona ya tenía cuenta: ahora también tiene acceso a este gimnasio, con su contraseña de siempre.',
        );
        cargar();
    };

    const alternarEstado = async (persona) => {
        setTrabajando(persona.user_id);
        setError('');
        setAviso('');
        const { error: errorEstado } = await supabase.rpc('equipo_cambiar_estado', {
            p_user_id: persona.user_id,
            p_activo: !persona.activo,
        });
        setTrabajando(null);
        if (errorEstado) {
            setError('No se pudo cambiar el acceso. Reintentar en unos minutos.');
            return;
        }
        cargar();
    };

    const abrirClave = (persona) => {
        setClaveDe(persona);
        setClaveNueva('');
        setClaveError('');
    };

    const cambiarClave = async (e) => {
        e.preventDefault();
        const errorPass = validarContrasena(claveNueva, 8, { exigirMinusculaYNumero: true });
        if (errorPass) {
            setClaveError(errorPass);
            return;
        }
        setCambiandoClave(true);
        const { error: errorClave } = await llamarEquipo({
            accion: 'cambiar_clave',
            user_id: claveDe.user_id,
            password: claveNueva,
        });
        setCambiandoClave(false);
        if (errorClave) {
            setClaveError(errorClave);
            return;
        }
        setClaveDe(null);
        setAviso('Contraseña cambiada. Comparte la nueva con la persona.');
    };

    const quitar = async (persona) => {
        setTrabajando(persona.user_id);
        setError('');
        setAviso('');
        const { error: errorQuitar } = await llamarEquipo({ accion: 'quitar', user_id: persona.user_id });
        setTrabajando(null);
        setQuitando(null);
        if (errorQuitar) {
            setError(errorQuitar);
            return;
        }
        setAviso('La persona ya no tiene acceso al gimnasio.');
        cargar();
    };

    return (
        <AppLayout
            ayuda="Las personas que trabajan contigo. Cada una entra con su propio correo y contraseña, solo a este gimnasio, y puede registrar pagos, anularlos y editar precios; todo queda anotado en el Historial con su nombre. No puede cambiar la configuración del gimnasio ni ver el Historial."
            title="Equipo"
            subtitle="Cuentas del personal que trabaja en este gimnasio."
            actions={
                <Btn onClick={abrirAlta}>
                    <Plus className="h-4 w-4" /> Agregar persona
                </Btn>
            }
        >
            <Helmet>
                <title>Equipo | RutNail</title>
                <meta name="description" content="Cuentas del personal del gimnasio: agregar, pausar y quitar." />
            </Helmet>

            {error && (
                <div className="mb-4">
                    <ErrorBox>{error}</ErrorBox>
                </div>
            )}
            {aviso && (
                <div className="mb-4 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-sm">{aviso}</div>
            )}

            {loading ? (
                <Loading />
            ) : equipo.length === 0 ? (
                <Empty>Todavía no hay nadie en el equipo.</Empty>
            ) : (
                <Card>
                    <ul className="divide-y divide-border">
                        {equipo.map((persona) => {
                            const esStaff = persona.rol === 'staff';
                            return (
                                <li key={persona.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold">
                                            {persona.nombre || persona.email}
                                            {persona.soy_yo && (
                                                <span className="ml-2 text-xs font-normal text-muted-foreground">(tú)</span>
                                            )}
                                        </p>
                                        {persona.nombre && (
                                            <p className="truncate text-xs text-muted-foreground">{persona.email}</p>
                                        )}
                                        <div className="mt-1 flex gap-1.5">
                                            <Badge className="border-border text-muted-foreground">
                                                {esStaff ? 'Staff' : 'Administrador'}
                                            </Badge>
                                            {!persona.activo && (
                                                <Badge className="border-warn text-warn">Acceso pausado</Badge>
                                            )}
                                        </div>
                                    </div>

                                    {esStaff &&
                                        (quitando === persona.user_id ? (
                                            <div className="flex flex-wrap items-center justify-end gap-2">
                                                <span className="max-w-[240px] text-xs text-muted-foreground">
                                                    Pierde el acceso. Si no trabaja en otro gimnasio, su cuenta se borra.
                                                    Lo que registró queda en el Historial.
                                                </span>
                                                <Btn
                                                    variant="danger"
                                                    className="px-3 py-1.5 text-xs"
                                                    disabled={trabajando === persona.user_id}
                                                    onClick={() => quitar(persona)}
                                                >
                                                    Quitar
                                                </Btn>
                                                <Btn
                                                    variant="ghost"
                                                    className="px-3 py-1.5 text-xs"
                                                    onClick={() => setQuitando(null)}
                                                >
                                                    Cancelar
                                                </Btn>
                                            </div>
                                        ) : (
                                            <div className="flex flex-wrap gap-2">
                                                <Btn
                                                    variant="ghost"
                                                    className="px-3 py-1.5 text-xs"
                                                    disabled={trabajando === persona.user_id}
                                                    onClick={() => alternarEstado(persona)}
                                                >
                                                    {persona.activo ? (
                                                        <>
                                                            <Pause className="h-3.5 w-3.5" /> Pausar
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Play className="h-3.5 w-3.5" /> Reactivar
                                                        </>
                                                    )}
                                                </Btn>
                                                <Btn
                                                    variant="ghost"
                                                    className="px-3 py-1.5 text-xs"
                                                    onClick={() => abrirClave(persona)}
                                                >
                                                    <KeyRound className="h-3.5 w-3.5" /> Contraseña
                                                </Btn>
                                                <Btn
                                                    variant="danger"
                                                    className="px-3 py-1.5 text-xs"
                                                    onClick={() => setQuitando(persona.user_id)}
                                                    aria-label="Quitar del equipo"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Btn>
                                            </div>
                                        ))}
                                </li>
                            );
                        })}
                    </ul>
                </Card>
            )}

            <Modal open={altaAbierta} onClose={() => !guardando && setAltaAbierta(false)} title="Agregar persona al equipo">
                <form onSubmit={crear} className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Nombre">
                            <Input
                                value={form.nombre}
                                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                                required
                                maxLength={80}
                                autoFocus
                            />
                        </Field>
                        <Field label="Apellido">
                            <Input
                                value={form.apellido}
                                onChange={(e) => setForm({ ...form, apellido: e.target.value })}
                                maxLength={80}
                            />
                        </Field>
                    </div>
                    <Field label="Correo electrónico">
                        <Input
                            type="email"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            required
                            maxLength={200}
                            autoComplete="off"
                        />
                    </Field>
                    <Field label="Contraseña">
                        <PasswordInput
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                            autoComplete="new-password"
                            placeholder="Mínimo 8, con mayúscula, minúscula y número"
                        />
                    </Field>
                    <p className="text-xs text-muted-foreground">
                        Si el correo ya tiene una cuenta (por ejemplo trabaja en otro gimnasio), solo se le da acceso a este y
                        entra con su contraseña de siempre: en ese caso la contraseña de arriba se ignora.
                    </p>
                    {altaError && <ErrorBox>{altaError}</ErrorBox>}
                    <div className="flex justify-end gap-2">
                        <Btn variant="ghost" type="button" onClick={() => setAltaAbierta(false)} disabled={guardando}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={guardando}>
                            <UserPlus className="h-4 w-4" /> {guardando ? 'Creando...' : 'Agregar'}
                        </Btn>
                    </div>
                </form>
            </Modal>

            <Modal
                open={!!claveDe}
                onClose={() => !cambiandoClave && setClaveDe(null)}
                title={`Nueva contraseña${claveDe?.nombre ? ` para ${claveDe.nombre}` : ''}`}
            >
                <form onSubmit={cambiarClave} className="space-y-4">
                    <Field label="Contraseña nueva">
                        <PasswordInput
                            value={claveNueva}
                            onChange={(e) => setClaveNueva(e.target.value)}
                            autoComplete="new-password"
                            placeholder="Mínimo 8, con mayúscula, minúscula y número"
                            required
                            autoFocus
                        />
                    </Field>
                    {claveError && <ErrorBox>{claveError}</ErrorBox>}
                    <div className="flex justify-end gap-2">
                        <Btn variant="ghost" type="button" onClick={() => setClaveDe(null)} disabled={cambiandoClave}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={cambiandoClave}>
                            {cambiandoClave ? 'Guardando...' : 'Cambiar contraseña'}
                        </Btn>
                    </div>
                </form>
            </Modal>
        </AppLayout>
    );
};

export default EquipoPage;
