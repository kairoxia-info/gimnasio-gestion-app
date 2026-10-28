import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge, Btn, Card, Empty, ErrorBox, Input } from '@/components/ui-kit';
import supabase from '@/lib/supabaseClient';
import { avisarCambioDeDatos } from '@/lib/offline';
import { ESTADOS_PAGO, estadoCuota, fmtFecha, money } from '@/lib/format';

const PagosAlumno = ({ pagos, config, onChange }) => {
    // Confirmación inline en dos pasos (10/09/2026, repaso general): antes era
    // un window.confirm(), el cartel nativo que en algunos navegadores no
    // aparece y deja el botón mudo. Acá pesa el doble porque cada pago es
    // también el comprobante numerado: si el borrado falla hay que verlo.
    //
    // Anular un pago (migración 0079) pide un MOTIVO y va por anular_pago(): la base anota
    // quién lo anuló, cuándo y cómo era el pago, y el administrador lo ve en "Historial".
    const [confirmandoBorrarId, setConfirmandoBorrarId] = useState(null);
    const [motivo, setMotivo] = useState('');
    const [borrando, setBorrando] = useState(false);
    const [error, setError] = useState('');

    const motivoValido = motivo.trim().length >= 3;

    const borrar = async (id) => {
        if (!motivoValido) return;
        setBorrando(true);
        setError('');
        try {
            const { error: errorAnular } = await supabase.rpc('anular_pago', { p_id: id, p_motivo: motivo.trim() });
            if (errorAnular) throw errorAnular;
            avisarCambioDeDatos('pagos');
            setConfirmandoBorrarId(null);
            setMotivo('');
            onChange();
        } catch (_) {
            setError('No se pudo anular el pago. Reintentar en unos minutos.');
        } finally {
            setBorrando(false);
        }
    };

    return (
        <div className="space-y-5">
            <Card>
                <h3 className="mb-3 font-display text-lg font-bold">Historial de pagos</h3>
                {error && (
                    <div className="mb-3">
                        <ErrorBox>{error}</ErrorBox>
                    </div>
                )}
                {pagos.length === 0 ? (
                    <Empty>Sin pagos registrados para este alumno.</Empty>
                ) : (
                    <ul className="divide-y divide-border">
                        {pagos.map((p) => (
                            <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                                <div>
                                    <p className="text-sm font-bold">{money(p.monto)}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {fmtFecha(p.fecha_pago)} · {fmtFecha(p.periodo_desde)} a{' '}
                                        {fmtFecha(p.periodo_hasta)} · {p.metodo || 'Efectivo'}
                                    </p>
                                    {p.notas && <p className="text-xs text-muted-foreground">{p.notas}</p>}
                                    {Number(p.monto_adeudado || 0) > 0 && (
                                        <p className="text-xs font-semibold text-warn">
                                            Debe {money(p.monto_adeudado)}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge className={ESTADOS_PAGO[estadoCuota(p, config)].className}>
                                        {ESTADOS_PAGO[estadoCuota(p, config)].label}
                                    </Badge>
                                    {confirmandoBorrarId === p.id ? (
                                        <div className="flex max-w-[260px] flex-col items-end gap-1.5">
                                            <span className="text-right text-xs text-muted-foreground">
                                                Se anula el comprobante N° {p.numero ?? '—'} y queda registrado quién lo anuló.
                                            </span>
                                            <Input
                                                value={motivo}
                                                onChange={(e) => setMotivo(e.target.value)}
                                                placeholder="Motivo de la anulación"
                                                maxLength={500}
                                                aria-label="Motivo de la anulación"
                                                autoFocus
                                            />
                                            <div className="flex gap-1.5">
                                                <Btn
                                                    variant="danger"
                                                    className="px-3 py-1.5 text-xs"
                                                    disabled={borrando || !motivoValido}
                                                    onClick={() => borrar(p.id)}
                                                >
                                                    {borrando ? 'Anulando...' : 'Anular pago'}
                                                </Btn>
                                                <Btn
                                                    variant="ghost"
                                                    className="px-3 py-1.5 text-xs"
                                                    disabled={borrando}
                                                    onClick={() => setConfirmandoBorrarId(null)}
                                                >
                                                    Cancelar
                                                </Btn>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            aria-label="Anular pago"
                                            onClick={() => {
                                                setMotivo('');
                                                setConfirmandoBorrarId(p.id);
                                            }}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-destructive"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
};

export default PagosAlumno;
