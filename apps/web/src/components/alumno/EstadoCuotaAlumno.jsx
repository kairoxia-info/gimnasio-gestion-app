import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Btn, Card } from '@/components/ui-kit';
import { ESTADOS_PAGO, estadoCuota, fmtFecha, ultimoPagoDeAlumno } from '@/lib/format';

/* ---------------- Pagos del alumno ---------------- */

// Registrar/cobrar un pago vive SOLO en Pagos (PagosPage.jsx) desde acá.
// Antes esta ficha tenía su PROPIO formulario de pago, más viejo e
// incompleto: sin pago parcial (monto_adeudado), sin "activar sin cobrar",
// sin comprobante numerado, adivinaba la duración del período comparando
// contra 4 strings fijos en vez de usar configuracion_periodos, y calculaba
// el estado de cuota con una función aparte de 3 estados (sin la config de
// días de gracia/aviso del gimnasio) en vez de estadoCuota(), la misma que
// ya usan Pagos/Dashboard/la campanita. Podía mostrar "Atrasado" ACÁ y
// "Con deuda" en Pagos para el MISMO alumno al mismo tiempo -- inconsistencia
// real, no cosmética.
//
// Se saca la duplicación: "Registrar pago" manda a Pagos con el alumno ya
// elegido (reusa ahí todo lo bueno, comprobante incluido) y acá queda una
// vista de estado + historial en modo lectura, con el mismo cálculo que el
// resto de la app.
// Sacada de PagosAlumno y movida afuera de las pestañas (pedido de Nalux,
// 09/09/2026: "en la ficha del alumno cuando se ve que tiene una cuota
// vencida... el botón cobrar que también esté ahí") -- antes solo se veía
// entrando a la pestaña "Pagos"; ahora está siempre visible, sin importar en
// qué pestaña esté el profesor, igual que "Acceso del alumno". Con borde de
// color cuando la cuota está vencida o con deuda, para que se note a simple
// vista sin tener que leer el texto.
const EstadoCuotaAlumno = ({ alumnoId, pagos, config }) => {
    const navigate = useNavigate();
    // Bug reportado por Nalux (15/09/2026): cobró de verdad (efectivo,
    // comprobante numerado) y la ficha seguía mostrando el estado del pago
    // ANTERIOR ("Sin cobrar", con deuda). Causa: `pagos` viene ordenado por
    // fecha_pago (listAll con sort: '-fecha_pago', más abajo) y acá se
    // asumía que pagos[0] era siempre "el último" -- pero dos pagos
    // registrados el mismo día calendario (fecha_pago igual) quedan
    // empatados en ese sort, y cuál gana el empate no es determinístico.
    // Le pasó justo a un alumno con un pago viejo "Sin cobrar" y uno nuevo
    // real, los dos con fecha_pago de hoy. DashboardPage.jsx y PagosPage.jsx
    // ya resolvían esto bien (comparan periodo_hasta directo, no confían en
    // el orden del array) -- ultimoPagoDeAlumno() es ese mismo criterio ya
    // compartido, correctamente desempatado por created_at. Usarlo acá
    // también hace que la ficha, el Dashboard y Pagos siempre coincidan en
    // cuál es "el pago que manda".
    const ultimo = ultimoPagoDeAlumno(alumnoId, pagos);
    const estado = estadoCuota(ultimo, config);
    const atencion = estado === 'vencido' || estado === 'con_deuda';

    return (
        <Card className={`mb-6 ${atencion ? 'border-2 border-destructive/60' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Estado de cuota
                    </p>
                    <p
                        className={`mt-2 font-display text-2xl font-extrabold ${atencion ? 'text-destructive' : ''}`}
                    >
                        {ESTADOS_PAGO[estado].label}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {ultimo
                            ? `Último pago ${fmtFecha(ultimo.fecha_pago)} · cubre hasta ${fmtFecha(ultimo.periodo_hasta)}`
                            : 'Sin pagos registrados'}
                    </p>
                </div>
                <Btn onClick={() => navigate(`/pagos?alumno=${alumnoId}`)}>
                    <Plus className="h-4 w-4" /> Cobrar
                </Btn>
            </div>
        </Card>
    );
};

export default EstadoCuotaAlumno;
