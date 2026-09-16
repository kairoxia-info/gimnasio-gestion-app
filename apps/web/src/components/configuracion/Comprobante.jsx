import React, { useState } from 'react';
import { Btn, Card, ErrorBox, Field, Textarea } from '@/components/ui-kit';
import { updateRec } from '@/lib/data';

const Comprobante = ({ gimnasioFull, setGimnasioFull, comprobanteTexto, setComprobanteTexto }) => {
    const [comprobanteSaving, setComprobanteSaving] = useState(false);
    const [comprobanteError, setComprobanteError] = useState('');
    const [comprobanteOk, setComprobanteOk] = useState(false);

    const guardarComprobante = async (e) => {
        e.preventDefault();
        if (!gimnasioFull?.id) return;
        setComprobanteSaving(true);
        setComprobanteError('');
        setComprobanteOk(false);
        try {
            const actualizado = await updateRec('gimnasios', gimnasioFull.id, {
                comprobante_texto_pie: comprobanteTexto,
            });
            setGimnasioFull((g) => ({ ...g, ...actualizado }));
            setComprobanteOk(true);
            setTimeout(() => setComprobanteOk(false), 2000);
        } catch (_) {
            setComprobanteError('No se pudo guardar. Si no es administrador, no tiene permiso.');
        } finally {
            setComprobanteSaving(false);
        }
    };

    return (
        <Card className="mb-8">
            <h2 className="font-display text-lg font-bold">Comprobante</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                El texto chico que va al pie de cada comprobante de pago (ver Pagos).
            </p>
            <form onSubmit={guardarComprobante} className="mt-4 space-y-4">
                <Field label="Texto de pie">
                    <Textarea
                        value={comprobanteTexto}
                        onChange={(e) => setComprobanteTexto(e.target.value.slice(0, 255))}
                        rows={2}
                        maxLength={255}
                    />
                    <span className="text-xs text-muted-foreground">{comprobanteTexto.length}/255</span>
                </Field>
                {comprobanteError && <ErrorBox>{comprobanteError}</ErrorBox>}
                <div className="flex items-center gap-3">
                    <Btn type="submit" disabled={comprobanteSaving || !gimnasioFull}>
                        {comprobanteSaving ? 'Guardando...' : 'Guardar'}
                    </Btn>
                    {comprobanteOk && <span className="text-sm font-semibold text-ok">Guardado.</span>}
                </div>
            </form>
        </Card>
    );
};

export default Comprobante;
