import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, Plus, Trash2 } from 'lucide-react';
import { Btn, Card, ErrorBox, Field, Modal, PasswordInput } from '@/components/ui-kit';

// "Mis gimnasios" (migración 0076, decisión de Nalux del 28/10/2026): una misma cuenta puede
// administrar varios gimnasios, cada uno con sus propios alumnos, pagos y planes. Acá se ve
// cuáles son, se abre otro, se agrega uno nuevo y se elimina el que está abierto.
//
// Solo lo ve un administrador del gimnasio abierto. "Eliminar este gimnasio" solo aparece si la
// cuenta tiene más de uno: con uno solo, borrarlo es lo mismo que "Eliminar cuenta" (más abajo).
const MisGimnasios = ({ profile, cambiarGimnasio, eliminarGimnasioActivo }) => {
    const navigate = useNavigate();
    const lista = profile?.misGimnasios ?? [];
    const [cambiandoA, setCambiandoA] = useState(null);
    const [error, setError] = useState('');
    const [eliminarAbierto, setEliminarAbierto] = useState(false);
    const [password, setPassword] = useState('');
    const [eliminarError, setEliminarError] = useState('');
    const [eliminando, setEliminando] = useState(false);

    if (profile?.role !== 'admin' || lista.length === 0) return null;

    const gimnasioAbierto = lista.find((g) => g.id === profile.gimnasio_id);
    const puedeEliminar = lista.length > 1 && gimnasioAbierto?.rol === 'admin';

    const abrir = async (g) => {
        if (cambiandoA || g.id === profile.gimnasio_id) return;
        setError('');
        setCambiandoA(g.id);
        const { error: errorCambio } = await cambiarGimnasio(g.id);
        if (errorCambio) {
            setError(errorCambio.message);
            setCambiandoA(null);
        }
    };

    const abrirEliminar = () => {
        setPassword('');
        setEliminarError('');
        setEliminarAbierto(true);
    };

    const cerrarEliminar = () => {
        if (eliminando) return;
        setEliminarAbierto(false);
    };

    const confirmarEliminar = async (e) => {
        e.preventDefault();
        setEliminando(true);
        setEliminarError('');
        const { error: errorEliminar } = await eliminarGimnasioActivo(password);
        if (errorEliminar) {
            setEliminarError(errorEliminar.message || 'No se pudo eliminar el gimnasio.');
            setEliminando(false);
        }
        // Sin error la página se recarga sola, ya sin ese gimnasio.
    };

    return (
        <>
            <Card className="mb-6">
                <div className="flex items-start gap-2.5">
                    <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <h2 className="font-display text-lg font-bold">Mis gimnasios</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Cada gimnasio tiene sus propios alumnos, pagos y planes. El que está abierto es el que se ve
                            en toda la aplicación.
                        </p>
                    </div>
                </div>

                <ul className="mt-4 space-y-2">
                    {lista.map((g) => {
                        const activo = g.id === profile.gimnasio_id;
                        return (
                            <li
                                key={g.id}
                                className={`flex min-h-[44px] items-center gap-3 rounded-xl border px-3 py-2 ${
                                    activo ? 'border-primary bg-primary/10' : 'border-border'
                                }`}
                            >
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.nombre}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {g.rol === 'admin' ? 'Administrador' : 'Staff'}
                                </span>
                                {activo ? (
                                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                                        <Check className="h-4 w-4" aria-hidden="true" /> Abierto
                                    </span>
                                ) : (
                                    <Btn
                                        variant="ghost"
                                        className="shrink-0 px-3 py-1.5 text-xs"
                                        onClick={() => abrir(g)}
                                        disabled={!!cambiandoA}
                                    >
                                        {cambiandoA === g.id ? 'Abriendo...' : 'Abrir'}
                                    </Btn>
                                )}
                            </li>
                        );
                    })}
                </ul>

                {error && (
                    <div className="mt-3">
                        <ErrorBox>{error}</ErrorBox>
                    </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                    <Btn variant="ghost" onClick={() => navigate('/onboarding?nuevo=1')}>
                        <Plus className="h-4 w-4" aria-hidden="true" /> Agregar otro gimnasio
                    </Btn>
                    {puedeEliminar && (
                        <Btn variant="danger" onClick={abrirEliminar}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar este gimnasio
                        </Btn>
                    )}
                </div>
            </Card>

            <Modal open={eliminarAbierto} onClose={cerrarEliminar} title="Eliminar este gimnasio">
                <form onSubmit={confirmarEliminar} className="space-y-4">
                    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
                        Se elimina <strong>{gimnasioAbierto?.nombre}</strong> con todo lo que tiene: alumnos, pagos,
                        asistencias, rutinas asignadas, planes de alimentación, fotos y avisos. Tus otros gimnasios no se
                        tocan. No se puede deshacer. Para confirmar, ingresar la contraseña de la cuenta.
                    </div>

                    <Field label="Contraseña">
                        <PasswordInput
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete="current-password"
                            required
                            autoFocus
                        />
                    </Field>

                    {eliminarError && <ErrorBox>{eliminarError}</ErrorBox>}

                    <div className="flex justify-end gap-2">
                        <Btn variant="ghost" type="button" onClick={cerrarEliminar} disabled={eliminando}>
                            Cancelar
                        </Btn>
                        <Btn variant="danger" type="submit" disabled={eliminando || !password}>
                            {eliminando ? 'Eliminando...' : 'Eliminar definitivamente'}
                        </Btn>
                    </div>
                </form>
            </Modal>
        </>
    );
};

export default MisGimnasios;
