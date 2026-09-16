import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Btn, Card, ConfirmInlineActions, ErrorBox, Field, Input } from '@/components/ui-kit';
import supabase from '@/lib/supabaseClient';

// Archivado manual de pagos (migración 0024, 04/09/2026). NUNCA
// automático a propósito: cada fila de pagos es también el comprobante
// numerado, borrarla pierde la posibilidad de reimprimirlo. El profesor
// elige la fecha de corte y confirma en dos pasos (mismo patrón que
// "Quitar" en RutinasPage.jsx -- nada de window.confirm) antes de que se
// dispare archivar_pagos_hasta().
const ArchivoPagos = () => {
    const [archivoFechaCorte, setArchivoFechaCorte] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 12);
        return d.toISOString().slice(0, 10);
    });
    const [archivoConfirmando, setArchivoConfirmando] = useState(false);
    const [archivoLoading, setArchivoLoading] = useState(false);
    const [archivoError, setArchivoError] = useState('');
    const [archivoResultado, setArchivoResultado] = useState(null);

    // Primer click: solo pide confirmación (no ejecuta nada todavía). El
    // RPC en sí (archivar_pagos_hasta) recién se llama desde
    // confirmarArchivado(), después de que el profesor vio la advertencia y
    // apretó "Sí, archivar".
    const pedirConfirmacionArchivado = () => {
        setArchivoError('');
        setArchivoResultado(null);
        setArchivoConfirmando(true);
    };

    const confirmarArchivado = async () => {
        setArchivoLoading(true);
        setArchivoError('');
        try {
            const { data, error } = await supabase.rpc('archivar_pagos_hasta', {
                p_fecha_corte: archivoFechaCorte,
            });
            if (error) throw error;
            const fila = Array.isArray(data) ? data[0] : data;
            setArchivoResultado({
                meses: fila?.meses_afectados ?? 0,
                pagos: fila?.pagos_archivados ?? 0,
            });
            setArchivoConfirmando(false);
        } catch (_) {
            setArchivoError('No se pudo archivar. Si no es administrador, no tiene permiso.');
        } finally {
            setArchivoLoading(false);
        }
    };

    return (
        <Card className="mb-8 border-2 border-warn/60">
            <div className="flex items-start gap-2.5">
                <AlertTriangle
                    className="mt-0.5 h-5 w-5 shrink-0 text-warn"
                    strokeWidth={2.2}
                    aria-hidden="true"
                />
                <div>
                    <h2 className="font-display text-lg font-bold">Archivo de pagos</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Comprime en un resumen mensual (y borra el detalle fila por fila) los pagos
                        anteriores a la fecha elegida. Los comprobantes de esos pagos dejan de poder
                        reimprimirse -- el gráfico de &quot;Ingresos por mes&quot; del panel sigue
                        mostrando el total igual, solo que ya sin el detalle de cada pago.
                    </p>
                </div>
            </div>

            <div className="mt-4 max-w-xs">
                <Field label="Archivar pagos anteriores a">
                    <Input
                        type="date"
                        value={archivoFechaCorte}
                        onChange={(e) => {
                            setArchivoFechaCorte(e.target.value);
                            setArchivoConfirmando(false);
                            setArchivoResultado(null);
                        }}
                    />
                </Field>
            </div>

            {archivoError && (
                <div className="mt-3">
                    <ErrorBox>{archivoError}</ErrorBox>
                </div>
            )}

            {archivoResultado && (
                <p className="mt-3 text-sm font-semibold text-ok">
                    Se archivaron {archivoResultado.pagos} pago{archivoResultado.pagos === 1 ? '' : 's'} de{' '}
                    {archivoResultado.meses} mes{archivoResultado.meses === 1 ? '' : 'es'}.
                </p>
            )}

            <div className="mt-4">
                {archivoConfirmando ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                            ¿Seguro? No se van a poder reimprimir esos comprobantes.
                        </span>
                        <ConfirmInlineActions
                            confirmLabel="Sí, archivar"
                            ejecutandoLabel="Archivando..."
                            ejecutando={archivoLoading}
                            onConfirmar={confirmarArchivado}
                            onCancelar={() => setArchivoConfirmando(false)}
                        />
                    </div>
                ) : (
                    <Btn variant="ghost" onClick={pedirConfirmacionArchivado} disabled={!archivoFechaCorte}>
                        Archivar pagos anteriores a esa fecha
                    </Btn>
                )}
            </div>
        </Card>
    );
};

export default ArchivoPagos;
