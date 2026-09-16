import React from 'react';
import { Card } from '@/components/ui-kit';
import { fmtFecha } from '@/lib/format';

// No hay columna de "fecha de baja" en rutinas_asignadas, así que a propósito
// solo se muestra desde cuándo la tenía, no hasta cuándo: inventar una fecha
// de fin a partir de otra cosa sería mentir.
const HistorialRutinas = ({ historial }) => {
    if (!historial || historial.length === 0) return null;
    return (
        <Card>
            <h3 className="font-display text-lg font-bold">Rutinas anteriores</h3>
            <ul className="mt-3 divide-y divide-border">
                {historial.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="text-sm">{h.nombre}</span>
                        <span className="text-xs text-muted-foreground">Desde el {fmtFecha(h.desde)}</span>
                    </li>
                ))}
            </ul>
        </Card>
    );
};

export default HistorialRutinas;
