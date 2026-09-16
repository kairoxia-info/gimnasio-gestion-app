import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Btn, Card, ErrorBox, Field, Input } from '@/components/ui-kit';
import { updateRec } from '@/lib/data';

const VencimientoCuotas = ({ gimnasioFull, setGimnasioFull, vencForm, setVencForm }) => {
    const [vencSaving, setVencSaving] = useState(false);
    const [vencError, setVencError] = useState('');
    const [vencOk, setVencOk] = useState(false);

    const guardarVencimientos = async (e) => {
        e.preventDefault();
        if (!gimnasioFull?.id) return;
        setVencSaving(true);
        setVencError('');
        setVencOk(false);
        try {
            const actualizado = await updateRec('gimnasios', gimnasioFull.id, {
                dias_gracia_cuota: Math.max(0, Number(vencForm.dias_gracia_cuota || 0)),
                dias_aviso_vencimiento: Math.max(0, Number(vencForm.dias_aviso_vencimiento || 0)),
                politica_vencimiento_cuota: vencForm.politica_vencimiento_cuota,
                restringir_rutina: !!vencForm.restringir_rutina,
                restringir_alimentacion: !!vencForm.restringir_alimentacion,
            });
            setGimnasioFull((g) => ({ ...g, ...actualizado }));
            setVencOk(true);
            setTimeout(() => setVencOk(false), 2000);
        } catch (_) {
            setVencError('No se pudo guardar. Si no es administrador, no tiene permiso.');
        } finally {
            setVencSaving(false);
        }
    };

    return (
        <Card className="mb-8">
            <h2 className="font-display text-lg font-bold">Vencimiento de cuotas</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Cuándo el sistema considera que un alumno pasó a deber. El porcentaje de recargo se
                configura en cada plan, más abajo (&quot;Interés por mora&quot;).
            </p>
            <form onSubmit={guardarVencimientos} className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Días de gracia después del vencimiento">
                        <Input
                            type="number"
                            min="0"
                            value={vencForm.dias_gracia_cuota}
                            onChange={(e) =>
                                setVencForm({ ...vencForm, dias_gracia_cuota: e.target.value })
                            }
                        />
                        <span className="text-xs text-muted-foreground">
                            0 = apenas se le vence ya queda como atrasado. 7 = tiene una semana más para
                            pagar antes de que cuente como deuda (y antes de que se le aplique el
                            recargo).
                        </span>
                    </Field>
                    <Field label="Avisar con cuántos días de anticipación">
                        <Input
                            type="number"
                            min="0"
                            value={vencForm.dias_aviso_vencimiento}
                            onChange={(e) =>
                                setVencForm({ ...vencForm, dias_aviso_vencimiento: e.target.value })
                            }
                        />
                        <span className="text-xs text-muted-foreground">
                            Cuántos días antes del vencimiento aparece como &quot;Próximo a vencer&quot;
                            en el panel y en Pagos.
                        </span>
                    </Field>
                </div>

                {/* Política de alumno vencido (migraciones 0020/0021), pedido de
                    Nalux (03/09/2026). Caja con borde/ícono de aviso a propósito
                    -- es una decisión delicada (puede ocultarle el plan a un
                    alumno o darlo de baja solo) y tiene que leerse con atención
                    antes de tocarla, no pasar desapercibida entre el resto de
                    los campos de la pantalla. */}
                <div className="space-y-4 rounded-2xl border-2 border-warn bg-warn/10 p-4">
                    <div className="flex items-start gap-2.5">
                        <AlertTriangle
                            className="mt-0.5 h-5 w-5 shrink-0 text-warn"
                            strokeWidth={2.2}
                            aria-hidden="true"
                        />
                        <div>
                            <p className="font-display text-base font-bold">Alumno con cuota vencida</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Qué pasa, además del cartel de aviso, cuando a un alumno se le vence la
                                cuota (pasado el plazo de gracia de arriba). Leer bien antes de
                                cambiarlo: puede ocultarle su plan o darlo de baja sin que haga falta
                                nada más.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {[
                            { valor: 'dejar', label: 'Dejarlo como está' },
                            { valor: 'restringir', label: 'Restringirle el acceso' },
                            { valor: 'dar_de_baja', label: 'Darlo de baja' },
                        ].map((op) => (
                            <button
                                key={op.valor}
                                type="button"
                                onClick={() =>
                                    setVencForm({ ...vencForm, politica_vencimiento_cuota: op.valor })
                                }
                                aria-pressed={vencForm.politica_vencimiento_cuota === op.valor}
                                className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                                    vencForm.politica_vencimiento_cuota === op.valor
                                        ? 'border-warn bg-warn text-black'
                                        : 'border-border text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {op.label}
                            </button>
                        ))}
                    </div>

                    {vencForm.politica_vencimiento_cuota === 'dejar' && (
                        <p className="text-xs text-muted-foreground">
                            No cambia nada de lo que ya hay hoy: el alumno sigue viendo su rutina y su
                            plan de comidas igual, solo con el cartel de aviso (si está prendido más
                            abajo en &quot;Recordatorio automático&quot;).
                        </p>
                    )}

                    {vencForm.politica_vencimiento_cuota === 'restringir' && (
                        <div className="space-y-2 border-t border-warn/40 pt-3">
                            <p className="text-xs text-muted-foreground">
                                En su link personal (el que abre sin login), en vez del contenido tildado
                                de abajo va a ver un cartel de &quot;cuota vencida, pasar por el
                                gimnasio&quot;. Apenas se le registre el pago vuelve a ver todo -- no se
                                borra nada. La rutina y el plan de comidas se restringen por separado,
                                porque uno puede seguir vigente aunque el otro no.
                            </p>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={!!vencForm.restringir_rutina}
                                    onChange={(e) =>
                                        setVencForm({ ...vencForm, restringir_rutina: e.target.checked })
                                    }
                                    className="h-4 w-4 rounded border-border accent-[hsl(var(--warn))]"
                                />
                                Ocultarle la rutina de ejercicios
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={!!vencForm.restringir_alimentacion}
                                    onChange={(e) =>
                                        setVencForm({
                                            ...vencForm,
                                            restringir_alimentacion: e.target.checked,
                                        })
                                    }
                                    className="h-4 w-4 rounded border-border accent-[hsl(var(--warn))]"
                                />
                                Ocultarle el plan de alimentación
                            </label>
                        </div>
                    )}

                    {vencForm.politica_vencimiento_cuota === 'dar_de_baja' && (
                        <p className="border-t border-warn/40 pt-3 text-xs text-muted-foreground">
                            Pasa a &quot;inactivo&quot;, igual que si se lo diera de baja a mano: sigue en
                            el sistema con todo su historial de pagos, asistencia y rutinas, pero deja de
                            contar como alumno activo (se puede reactivar cuando pague). No es
                            instantáneo al minuto que vence: se aplica solo la próxima vez que se entra a
                            la app.
                        </p>
                    )}
                </div>

                {vencError && <ErrorBox>{vencError}</ErrorBox>}
                <div className="flex items-center gap-3">
                    <Btn type="submit" disabled={vencSaving || !gimnasioFull}>
                        {vencSaving ? 'Guardando...' : 'Guardar'}
                    </Btn>
                    {vencOk && <span className="text-sm font-semibold text-ok">Guardado.</span>}
                </div>
            </form>
        </Card>
    );
};

export default VencimientoCuotas;
