import React, { useMemo, useState } from 'react';
import { Card, Input } from '@/components/ui-kit';
import { createRec, removeRec, updateRec } from '@/lib/data';

/* ---------------- Asistencia del alumno ---------------- */

const AsistenciaAlumno = ({ alumnoId, asistencias, onChange }) => {
    const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
    const mapa = useMemo(() => {
        const m = {};
        asistencias.forEach((a) => {
            m[a.fecha] = a;
        });
        return m;
    }, [asistencias]);

    const [año, mesNum] = mes.split('-').map(Number);
    const primero = new Date(año, mesNum - 1, 1);
    const dias = new Date(año, mesNum, 0).getDate();
    const offset = (primero.getDay() + 6) % 7;

    const marcar = async (fecha) => {
        const actual = mapa[fecha];
        if (!actual) await createRec('asistencias', { alumno_id: alumnoId, fecha, presente: true });
        else if (actual.presente) await updateRec('asistencias', actual.id, { presente: false });
        else await removeRec('asistencias', actual.id);
        onChange();
    };

    const presentes = asistencias.filter((a) => a.presente && a.fecha.startsWith(mes)).length;
    const ausentes = asistencias.filter((a) => !a.presente && a.fecha.startsWith(mes)).length;

    // % sobre los días REGISTRADOS del mes, no sobre los días del mes: un día
    // sin registro no es una falta (nadie lo marcó), así que meterlo en el
    // divisor haría que el porcentaje baje solo por días que el profesor no
    // tocó. Sin registros en el mes no hay porcentaje que mostrar.
    const registrados = presentes + ausentes;
    const porcentaje = registrados > 0 ? Math.round((presentes / registrados) * 100) : null;

    // Faltas seguidas contando desde el registro más reciente hacia atrás,
    // sobre todo el historial (no solo el mes que se está mirando). Corta en
    // el primer presente. Igual que arriba, los días sin registro no cuentan
    // como falta: solo lo que el profesor marcó ausente expresamente.
    const rachaFaltas = useMemo(() => {
        const ordenadas = [...asistencias].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        let racha = 0;
        for (const a of ordenadas) {
            if (a.presente) break;
            racha += 1;
        }
        return racha;
    }, [asistencias]);

    return (
        <Card>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="font-display text-lg font-bold">Calendario de asistencia</h3>
                    <p className="text-xs text-muted-foreground">
                        Un clic: presente. Dos: ausente. Tres: sin registro.
                    </p>
                </div>
                <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-auto" />
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] uppercase text-muted-foreground">
                {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'].map((d) => (
                    <span key={d}>{d}</span>
                ))}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
                {Array.from({ length: offset }).map((_, i) => (
                    <span key={`x${i}`} />
                ))}
                {Array.from({ length: dias }).map((_, i) => {
                    const dia = String(i + 1).padStart(2, '0');
                    const fecha = `${mes}-${dia}`;
                    const reg = mapa[fecha];
                    // bg-destructive, no bg-primary: mismo bug que en
                    // AsistenciaPage.jsx (corregido 07/09/2026, ver ese
                    // archivo) -- este calendario cíclico es un componente
                    // paralelo y se había quedado afuera de ese arreglo.
                    const estilo = !reg
                        ? 'border-border text-muted-foreground hover:border-primary'
                        : reg.presente
                          ? 'border-transparent bg-[hsl(var(--ok))] text-white'
                          : 'border-transparent bg-destructive text-destructive-foreground';
                    return (
                        <button
                            key={fecha}
                            type="button"
                            onClick={() => marcar(fecha)}
                            className={`aspect-square rounded-xl border text-sm font-semibold transition active:scale-95 ${estilo}`}
                        >
                            {i + 1}
                        </button>
                    );
                })}
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
                En el mes: <span className="font-bold text-ok">{presentes} presentes</span> ·{' '}
                <span className="font-bold text-destructive">{ausentes} ausentes</span>
                {porcentaje !== null && (
                    <>
                        {' · '}
                        <span className="font-bold text-foreground">{porcentaje}% de asistencia</span>
                    </>
                )}
            </p>
            {rachaFaltas > 0 && (
                <p className="mt-1 text-sm text-warn">
                    {rachaFaltas === 1 ? 'Viene de 1 falta' : `Viene de ${rachaFaltas} faltas seguidas`}.
                </p>
            )}
        </Card>
    );
};

export default AsistenciaAlumno;
