import { Empty, Modal } from '@/components/ui-kit';
import { armarTextoAlimentos, macrosDeComida, resumenMacros } from '@/lib/format';

// Vista de solo lectura del plan: las comidas en el mismo orden y
// con el mismo texto armado que sale en el PDF y que ve el
// alumno, sin ningún campo editable.
const VerPlanModal = ({ planViendo, onClose, alimentosPorId }) => (
    <Modal open={!!planViendo} onClose={onClose} title={planViendo?.nombre || 'Plan de alimentación'} wide>
        {planViendo &&
            ((planViendo.items || []).length === 0 ? (
                <Empty>Este plan todavía no tiene comidas cargadas.</Empty>
            ) : (
                <div className="space-y-3">
                    {(planViendo.items || []).map((comida, i) => {
                        // Macros estimados por comida (Fase 2.4, 13/09/2026):
                        // solo cuenta lo que se puede calcular -- ver el
                        // comentario de macrosDeComida() en lib/format.js.
                        const macros = resumenMacros(macrosDeComida(comida, alimentosPorId));
                        return (
                            <div key={comida.key || i} className="rounded-2xl border border-border p-4">
                                <p className="font-display text-base font-bold">{comida.nombre}</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {armarTextoAlimentos(comida.alimentos) || 'Sin alimentos cargados.'}
                                </p>
                                {macros && <p className="mt-1.5 text-xs font-semibold text-primary">{macros}</p>}
                            </div>
                        );
                    })}
                    {planViendo.notas && (
                        <div className="rounded-2xl border border-border bg-secondary p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Observaciones
                            </p>
                            <p className="mt-1 whitespace-pre-line text-sm">{planViendo.notas}</p>
                        </div>
                    )}
                </div>
            ))}
    </Modal>
);

export default VerPlanModal;
