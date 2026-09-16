import React, { useEffect, useState } from 'react';
import { Btn, Card, ErrorBox, Textarea } from '@/components/ui-kit';
import { updateRec } from '@/lib/data';

/* ---------------- Notas privadas del profesor ---------------- */

// Fase 2.1 (13/09/2026), pedido de Nalux. A diferencia de "Observaciones de
// salud" (arriba, en la cabecera de la ficha) esto NUNCA lo ve el alumno:
// es para que el profesor anote contexto o recordatorios propios ("prefiere
// entrenar de mañana", "pidió bajar la intensidad de piernas"). Por eso la
// columna nueva (notas_internas) no se agrega a ver_plan_por_codigo() -- la
// función que arma lo que ve el alumno en /mi-plan/:codigo tiene una lista
// blanca explícita de columnas, así que con no tocarla alcanza para que
// quede fuera.
const NotasPrivadas = ({ alumnoId, notasIniciales }) => {
    const [notas, setNotas] = useState(notasIniciales || '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const [guardado, setGuardado] = useState(false);

    // Si se navega a otro alumno sin desmontar este componente (no pasa hoy,
    // AppLayout se remonta por ruta, pero cuesta nada cubrirlo) no queda la
    // nota del alumno anterior pisando la del nuevo.
    useEffect(() => {
        setNotas(notasIniciales || '');
        setGuardado(false);
    }, [alumnoId, notasIniciales]);

    const guardar = async () => {
        setGuardando(true);
        setError('');
        setGuardado(false);
        try {
            await updateRec('alumnos', alumnoId, { notas_internas: notas.trim() || null });
            setGuardado(true);
        } catch (_) {
            setError('No se pudo guardar la nota. Reintentar en unos minutos.');
        } finally {
            setGuardando(false);
        }
    };

    const cambio = notas !== (notasIniciales || '');

    return (
        <Card className="mb-6">
            <h2 className="font-display text-lg font-bold">Notas privadas</h2>
            <p className="mt-1 text-xs text-muted-foreground">
                Solo las ve el profesor. El alumno nunca tiene acceso a esto.
            </p>
            <Textarea
                className="mt-3"
                rows={3}
                value={notas}
                onChange={(e) => {
                    setNotas(e.target.value);
                    setGuardado(false);
                }}
                placeholder="Contexto, recordatorios, preferencias del alumno..."
            />
            {error && (
                <div className="mt-2">
                    <ErrorBox>{error}</ErrorBox>
                </div>
            )}
            <div className="mt-3 flex items-center gap-3">
                <Btn
                    variant="ghost"
                    className="px-4 py-2 text-xs"
                    disabled={guardando || !cambio}
                    onClick={guardar}
                >
                    {guardando ? 'Guardando...' : 'Guardar nota'}
                </Btn>
                {guardado && !cambio && <span className="text-xs text-ok">Guardado.</span>}
            </div>
        </Card>
    );
};

export default NotasPrivadas;
