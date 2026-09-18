import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Btn, Card, ErrorBox, Field, Modal, PasswordInput } from '@/components/ui-kit';

// Eliminar cuenta (migración 0035), pedido de Nalux (08/09/2026): borrado
// definitivo e inmediato, pide la contraseña de nuevo antes de ejecutar
// (eliminarCuenta() en AuthContext ya se encarga de reautenticar). Modal
// en vez de la confirmación inline que usa "Archivo de pagos": acá hace
// falta pedir la contraseña, no solo un "¿Seguro?".
const EliminarCuenta = ({ esAdminConGimnasio, eliminarCuenta, signOut }) => {
    const [eliminarAbierto, setEliminarAbierto] = useState(false);
    const [eliminarPassword, setEliminarPassword] = useState('');
    const [eliminarError, setEliminarError] = useState('');
    const [eliminarLoading, setEliminarLoading] = useState(false);
    const [eliminarHecho, setEliminarHecho] = useState(false);

    const abrirEliminarCuenta = () => {
        setEliminarPassword('');
        setEliminarError('');
        setEliminarHecho(false);
        setEliminarAbierto(true);
    };

    const cerrarEliminarCuenta = () => {
        if (eliminarLoading || eliminarHecho) return; // no se cierra a mitad de la operación
        setEliminarAbierto(false);
    };

    const confirmarEliminarCuenta = async (e) => {
        e.preventDefault();
        setEliminarLoading(true);
        setEliminarError('');
        try {
            const { error } = await eliminarCuenta(eliminarPassword);
            if (error) {
                setEliminarError(error.message || 'No se pudo eliminar la cuenta.');
                return;
            }
            setEliminarHecho(true);
            // Deja ver la confirmación un momento antes de cerrar la sesión --
            // mismo criterio de tiempo que ResetPasswordPage.jsx al terminar.
            setTimeout(() => signOut(), 2200);
        } finally {
            setEliminarLoading(false);
        }
    };

    return (
        <>
            {/* Eliminar cuenta (migración 0035), pedido de Nalux (08/09/2026).
                border-destructive (no warn): a diferencia de "Archivo de pagos"
                -- que se puede corregir cargando pagos de nuevo a mano -- esto
                es irreversible por completo. */}
            <Card className="mb-8 border-2 border-destructive/60">
                <div className="flex items-start gap-2.5">
                    <AlertTriangle
                        className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
                        strokeWidth={2.2}
                        aria-hidden="true"
                    />
                    <div>
                        <h2 className="font-display text-lg font-bold">Eliminar cuenta</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {esAdminConGimnasio ? (
                                <>
                                    Borra el gimnasio completo: alumnos, pagos, rutinas, planes de
                                    alimentación, asistencias, ejercicios propios y todo lo demás registrado
                                    en esta cuenta. No se puede deshacer.
                                </>
                            ) : (
                                <>
                                    Borra tu acceso a este gimnasio. Los datos del gimnasio (alumnos, pagos,
                                    etc.) no se ven afectados -- son del administrador, no de tu cuenta.
                                </>
                            )}
                        </p>
                    </div>
                </div>

                <div className="mt-4">
                    <Btn variant="danger" onClick={abrirEliminarCuenta}>
                        Eliminar mi cuenta
                    </Btn>
                </div>
            </Card>

            <Modal
                open={eliminarAbierto}
                onClose={cerrarEliminarCuenta}
                title={eliminarHecho ? 'Cuenta eliminada' : 'Eliminar cuenta'}
            >
                {eliminarHecho ? (
                    <div className="flex flex-col items-center gap-3 py-4 text-center">
                        <CheckCircle2 className="h-12 w-12 text-ok" strokeWidth={1.6} />
                        <p className="text-sm text-foreground">
                            La cuenta y sus datos se eliminaron. Ya se puede registrar una cuenta nueva con el
                            mismo correo.
                        </p>
                        <p className="text-xs text-muted-foreground">Cerrando sesión...</p>
                    </div>
                ) : (
                    <form onSubmit={confirmarEliminarCuenta} className="space-y-4">
                        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
                            {esAdminConGimnasio
                                ? 'Esta acción borra el gimnasio entero, con todo lo que tiene registrado, para siempre.'
                                : 'Esta acción borra tu acceso a este gimnasio para siempre.'}{' '}
                            Para confirmar, ingresar la contraseña de la cuenta.
                        </div>

                        <Field label="Contraseña">
                            <PasswordInput
                                value={eliminarPassword}
                                onChange={(e) => setEliminarPassword(e.target.value)}
                                placeholder="••••••••"
                                autoComplete="current-password"
                                required
                                autoFocus
                            />
                        </Field>

                        {eliminarError && <ErrorBox>{eliminarError}</ErrorBox>}

                        <div className="flex justify-end gap-2">
                            <Btn variant="ghost" type="button" onClick={cerrarEliminarCuenta} disabled={eliminarLoading}>
                                Cancelar
                            </Btn>
                            <Btn variant="danger" type="submit" disabled={eliminarLoading || !eliminarPassword}>
                                {eliminarLoading ? 'Eliminando...' : 'Eliminar definitivamente'}
                            </Btn>
                        </div>
                    </form>
                )}
            </Modal>
        </>
    );
};

export default EliminarCuenta;
