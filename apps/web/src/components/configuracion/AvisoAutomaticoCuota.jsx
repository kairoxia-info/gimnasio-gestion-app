import React, { useState } from 'react';
import { Btn, Card, ErrorBox, Field, Input, Textarea } from '@/components/ui-kit';
import { updateRec } from '@/lib/data';

const AvisoAutomaticoCuota = ({ gimnasioFull, setGimnasioFull, avisoCuotaForm, setAvisoCuotaForm }) => {
    const [avisoCuotaSaving, setAvisoCuotaSaving] = useState(false);
    const [avisoCuotaError, setAvisoCuotaError] = useState('');
    const [avisoCuotaOk, setAvisoCuotaOk] = useState(false);

    const guardarAvisoCuota = async (e) => {
        e.preventDefault();
        if (!gimnasioFull?.id) return;
        setAvisoCuotaSaving(true);
        setAvisoCuotaError('');
        setAvisoCuotaOk(false);
        try {
            const actualizado = await updateRec('gimnasios', gimnasioFull.id, {
                aviso_cuota_activo: avisoCuotaForm.activo,
                aviso_cuota_titulo: avisoCuotaForm.titulo,
                aviso_cuota_mensaje: avisoCuotaForm.mensaje,
            });
            setGimnasioFull((g) => ({ ...g, ...actualizado }));
            setAvisoCuotaOk(true);
            setTimeout(() => setAvisoCuotaOk(false), 2000);
        } catch (_) {
            setAvisoCuotaError('No se pudo guardar. Si no es administrador, no tiene permiso.');
        } finally {
            setAvisoCuotaSaving(false);
        }
    };

    return (
        <Card className="mb-8">
            <h2 className="font-display text-lg font-bold">Aviso automático de cuota</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Un recordatorio que le aparece solo al alumno en su plan cuando se le acerca o se le vence
                la cuota -- no hace falta crearlo a mano cada vez. Desaparece solo cuando paga.
            </p>
            <form onSubmit={guardarAvisoCuota} className="mt-4 space-y-4">
                <label className="flex items-center gap-3 text-sm">
                    <input
                        type="checkbox"
                        checked={avisoCuotaForm.activo}
                        onChange={(e) =>
                            setAvisoCuotaForm({ ...avisoCuotaForm, activo: e.target.checked })
                        }
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    Mostrárselo al alumno
                </label>
                <Field label="Título">
                    <Input
                        value={avisoCuotaForm.titulo}
                        onChange={(e) => setAvisoCuotaForm({ ...avisoCuotaForm, titulo: e.target.value })}
                        placeholder="Tu cuota está por vencer"
                    />
                </Field>
                <Field label="Mensaje">
                    <Textarea
                        value={avisoCuotaForm.mensaje}
                        onChange={(e) =>
                            setAvisoCuotaForm({ ...avisoCuotaForm, mensaje: e.target.value })
                        }
                        rows={3}
                    />
                    <span className="text-xs text-muted-foreground">
                        Se puede usar {'{nombre}'}, {'{vence}'}, {'{plan}'} y {'{gimnasio}'} -- se
                        reemplazan solos por los datos de cada alumno.
                    </span>
                </Field>
                {avisoCuotaError && <ErrorBox>{avisoCuotaError}</ErrorBox>}
                <div className="flex items-center gap-3">
                    <Btn type="submit" disabled={avisoCuotaSaving || !gimnasioFull}>
                        {avisoCuotaSaving ? 'Guardando...' : 'Guardar'}
                    </Btn>
                    {avisoCuotaOk && <span className="text-sm font-semibold text-ok">Guardado.</span>}
                </div>
            </form>
        </Card>
    );
};

export default AvisoAutomaticoCuota;
