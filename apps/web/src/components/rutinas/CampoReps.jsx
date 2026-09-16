import { Input, Select } from '@/components/ui-kit';
import { UNIDADES_REPS, armarReps, descomponerReps } from '@/lib/format';

// UNIDADES_REPS/descomponerReps/armarReps viven en lib/format.js: la
// pantalla del alumno y la ficha del profesor también necesitan saber si un
// ejercicio se mide en tiempo (para no mostrarle kilos a una bici).
//
// Número arriba, selector de unidad abajo -- APILADOS, no lado a lado.
// Primer intento fue en una sola fila (número + selector) y, probado en
// vivo, la columna "Reps" de esta grilla mide apenas ~53px de ancho total
// (grid-cols con 4 columnas iguales) -- repartida entre dos controles
// quedaba casi ilegible (el número a 26px de ancho, más angosto todavía que
// el bug original que se estaba corrigiendo). Apilado, cada control usa el
// ancho COMPLETO de la columna por separado, y entra cómodo. Mismo criterio
// que el campo Series de más abajo: padding forzado con `!` porque el Input
// compartido ya trae el suyo de fábrica (una className normal no lo pisa),
// y sin las flechitas nativas de type=number, que en una columna así de
// angosta ya se comprobó que tapan el dígito.
const CampoReps = ({ value, onChange }) => {
    const { cantidad, unidad } = descomponerReps(value);
    return (
        <div className="space-y-1">
            <Input
                type="number"
                value={cantidad}
                onChange={(e) => onChange(armarReps(e.target.value, unidad))}
                className="!px-1.5 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                placeholder="10"
            />
            <Select
                value={unidad}
                onChange={(e) => onChange(armarReps(cantidad, e.target.value))}
                className="!px-1.5 !py-1 text-xs"
                aria-label="Unidad (repeticiones, segundos o minutos)"
            >
                {UNIDADES_REPS.map((u) => (
                    <option key={u.valor} value={u.valor}>
                        {u.label}
                    </option>
                ))}
            </Select>
        </div>
    );
};

export default CampoReps;
