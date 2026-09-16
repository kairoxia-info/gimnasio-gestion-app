import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge, Card, ConfirmInlineActions, Empty, ErrorBox } from '@/components/ui-kit';
import { removeRec } from '@/lib/data';
import { ESTADOS_PAGO, estadoCuota, fmtFecha, money } from '@/lib/format';

const PagosAlumno = ({ pagos, config, onChange }) => {
    // Confirmación inline en dos pasos (10/09/2026, repaso general): antes era
    // un window.confirm(), el cartel nativo que en algunos navegadores no
    // aparece y deja el botón mudo. Acá pesa el doble porque cada pago es
    // también el comprobante numerado: si el borrado falla hay que verlo.
    const [confirmandoBorrarId, setConfirmandoBorrarId] = useState(null);
    const [borrando, setBorrando] = useState(false);
    const [error, setError] = useState('');

    const borrar = async (id) => {
        setBorrando(true);
        setError('');
        try {
            await removeRec('pagos', id);
            setConfirmandoBorrarId(null);
            onChange();
        } catch (_) {
            setError('No se pudo eliminar el pago. Reintentar en unos minutos.');
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
                                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                                            <span className="text-xs text-muted-foreground">
                                                Se pierde el comprobante N° {p.numero ?? '—'}.
                                            </span>
                                            <ConfirmInlineActions
                                                className="px-3 py-1.5 text-xs"
                                                ejecutando={borrando}
                                                onConfirmar={() => borrar(p.id)}
                                                onCancelar={() => setConfirmandoBorrarId(null)}
                                            />
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            aria-label="Eliminar pago"
                                            onClick={() => setConfirmandoBorrarId(p.id)}
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
