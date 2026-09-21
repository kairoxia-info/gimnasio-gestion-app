import React from 'react';
import { Play, Timer } from 'lucide-react';
import { esRepsPorTiempo, filasDeSeries, resumenSeries, tieneSeriesDetalle } from '@/lib/format';
import { tipoDePreview } from '@/lib/mediaEjercicio';

// Cómo se ve UN ejercicio en el portal del alumno (MiPlanPage.jsx), versión
// compacta (21/09/2026, pedido de Nalux): "que se vean parecidas a como
// salen en el PDF de la rutina -- más compactas, sin que ocupe tanto lugar".
//
// Antes cada ejercicio era una tarjeta de ~240px en el celular: nombre,
// grupo, series, intensidad, el comentario en una caja grande y dos botones
// a lo ancho ("Ver cómo se hace", "Iniciar descanso"). Seis ejercicios eran
// casi 1.500px de scroll. Ahora es UNA fila, como en el PDF (nombre a la
// izquierda, series x reps a la derecha), con lo que el PDF no tiene -- las
// dos acciones -- como íconos chicos a la derecha, con 44px de área de toque
// y aria-label (pedido explícito de Nalux al confirmar: no perder
// accesibilidad al sacar el texto). ~70px por ejercicio.
//
// Lo que se decidió NO tocar: la ficha del profesor y el PDF siguen igual.
// Marcar el día como hecho, el cronómetro de descanso, el circuito por
// intervalos y la demostración se llaman exactamente igual que antes -- esto
// solo cambia cómo se dibuja cada ejercicio, no qué hace.
const BotonIcono = ({ onClick, href, label, Icon }) => {
    const clase =
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-primary transition hover:border-primary active:scale-95';
    if (href) {
        return (
            <a href={href} target="_blank" rel="noreferrer" aria-label={label} title={label} className={clase}>
                <Icon className="h-5 w-5" aria-hidden="true" />
            </a>
        );
    }
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label} className={clase}>
            <Icon className="h-5 w-5" aria-hidden="true" />
        </button>
    );
};

// Demostración: modal propio si es un archivo nuestro (imagen/video del
// bucket), link externo en pestaña nueva si no -- mismo criterio que tenía
// BotonVerDemo antes de este cambio (lib/mediaEjercicio.js).
const BotonDemo = ({ item, label, onPreview }) =>
    tipoDePreview(item.mediaUrl) ? (
        <BotonIcono onClick={() => onPreview(item)} label={label} Icon={Play} />
    ) : (
        <BotonIcono href={item.mediaUrl} label={label} Icon={Play} />
    );

// Grupo · descanso · peso · intensidad en una sola línea gris. Un valor
// combinado vacío de una superserie viene como "—" (combinarValor en
// lib/format.js): se filtra, mostrar "Intensidad: —" no aporta nada.
const conValor = (v) => v && String(v).trim() && String(v).trim() !== '—';

const lineaDetalle = (it, { conDescanso = true } = {}) =>
    [
        it.grupo,
        conDescanso && it.descanso ? it.descanso : null,
        !esRepsPorTiempo(it.reps) && it.peso && !tieneSeriesDetalle(it) ? `${it.peso} kg` : null,
        conValor(it.intensidad) ? it.intensidad : null,
    ]
        .filter(conValor)
        .join(' · ');

// Pirámide / drop set: las series en una sola línea ("12×20 kg · 10×25 kg")
// en vez de una fila por serie.
const lineaSeriesDetalle = (it) =>
    filasDeSeries(it)
        .map((s) => `${s.reps || '—'}${s.peso ? `×${s.peso} kg` : ''}`)
        .join(' · ');

const Comentario = ({ texto, className = '' }) =>
    texto ? <p className={`text-xs italic text-muted-foreground ${className}`}>{texto}</p> : null;

const FilaEjercicioAlumno = ({ it, descansoSeg, onPreview, onDescanso }) => {
    if (it.esCombo) {
        return (
            <article className="mp-evitar-corte overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center gap-2 bg-secondary/60 px-3 py-1.5">
                    <p className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-wide text-primary">
                        Superserie
                        {conValor(it.descanso) && (
                            <span className="normal-case tracking-normal text-muted-foreground">
                                {' '}· descanso {it.descanso}
                            </span>
                        )}
                        {conValor(it.intensidad) && (
                            <span className="normal-case tracking-normal text-muted-foreground">
                                {' '}· {it.intensidad}
                            </span>
                        )}
                    </p>
                    {descansoSeg && (
                        <BotonIcono onClick={() => onDescanso(descansoSeg)} label="Iniciar descanso" Icon={Timer} />
                    )}
                </div>
                {it.comboItems.map((sub) => (
                    <div key={sub.key} className="flex items-center gap-2 border-t border-border px-3 py-2">
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold leading-tight">{sub.nombre}</p>
                            {lineaDetalle(sub, { conDescanso: false }) && (
                                <p className="text-xs text-muted-foreground">{lineaDetalle(sub, { conDescanso: false })}</p>
                            )}
                        </div>
                        <p className="shrink-0 text-base font-extrabold tabular-nums">{resumenSeries(sub)}</p>
                        {sub.mediaUrl && (
                            <BotonDemo item={sub} label={`Ver demostración de ${sub.nombre}`} onPreview={onPreview} />
                        )}
                    </div>
                ))}
                <Comentario texto={it.comentario} className="border-t border-border px-3 py-2" />
            </article>
        );
    }

    const detalle = lineaDetalle(it);
    const piramide = tieneSeriesDetalle(it);
    return (
        <article className="mp-evitar-corte rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-tight">{it.nombre}</p>
                    {piramide && <p className="text-xs text-muted-foreground">{lineaSeriesDetalle(it)}</p>}
                    {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
                    <Comentario texto={it.comentario} />
                </div>
                <p className="shrink-0 text-base font-extrabold tabular-nums">
                    {piramide ? `${filasDeSeries(it).length} series` : resumenSeries(it)}
                </p>
                {it.mediaUrl && <BotonDemo item={it} label="Ver demostración" onPreview={onPreview} />}
                {descansoSeg && (
                    <BotonIcono onClick={() => onDescanso(descansoSeg)} label="Iniciar descanso" Icon={Timer} />
                )}
            </div>
        </article>
    );
};

export default FilaEjercicioAlumno;
