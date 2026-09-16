import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from 'lucide-react';
import { Btn, Card, ErrorBox, Field, Input, Modal, Textarea } from '@/components/ui-kit';
import { macrosDeComida, resumenMacros } from '@/lib/format';

// Arma los "renglones" para mostrar: los alimentos que comparten `grupo`
// (alternativas, "elegí uno") se muestran juntos en un solo renglón; cada
// alimento sin grupo es su propio renglón. Separado del array plano de
// alimentos (que es lo que se guarda tal cual) solo para el render -- no
// cambia cómo se persiste, solo cómo se agrupa visualmente.
const renglonesDe = (alimentosComida) => {
    const gruposVistos = new Set();
    const renglones = [];
    alimentosComida.forEach((it) => {
        if (it.grupo) {
            if (gruposVistos.has(it.grupo)) return;
            gruposVistos.add(it.grupo);
            renglones.push({
                tipo: 'grupo',
                grupoId: it.grupo,
                items: alimentosComida.filter((x) => x.grupo === it.grupo),
            });
        } else {
            renglones.push({ tipo: 'solo', item: it });
        }
    });
    return renglones;
};

const PlanFormModal = ({
    open,
    onClose,
    editId,
    guardar,
    nombre,
    setNombre,
    comidas,
    filtros,
    setFiltros,
    alimentos,
    alimentosPorId,
    seleccion,
    creandoAlimento,
    notas,
    setNotas,
    formError,
    saving,
    agregarComida,
    moverComida,
    quitarComida,
    renombrarComida,
    agregarAlimentoAComida,
    quitarAlimentoDeComida,
    editarCantidad,
    toggleOpcional,
    desagrupar,
    toggleSeleccion,
    agruparSeleccionados,
    crearYAgregarAlimento,
}) => (
    <Modal open={open} onClose={onClose} title={editId ? 'Editar plan de alimentación' : 'Nuevo plan de alimentación'} wide>
        <form onSubmit={guardar} className="space-y-5">
            <Field label="Nombre del plan">
                <Input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Bajo en carbohidratos"
                    required
                />
            </Field>

            <div className="space-y-4">
                {comidas.map((c, i) => {
                    const filtro = filtros[c.key] || '';
                    const yaElegidos = new Set(c.alimentos.map((it) => it.alimentoId));
                    const filtrados = alimentos
                        .filter((a) => !yaElegidos.has(a.id))
                        .filter(
                            (a) =>
                                !filtro.trim() ||
                                a.nombre?.toLowerCase().includes(filtro.trim().toLowerCase()),
                        );
                    const hayExacto = alimentos.some(
                        (a) => a.nombre?.toLowerCase() === filtro.trim().toLowerCase(),
                    );
                    const seleccionComida = seleccion[c.key] || new Set();

                    return (
                        <Card key={c.key}>
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <Input
                                    value={c.nombre}
                                    onChange={(e) => renombrarComida(c.key, e.target.value)}
                                    className="max-w-[220px] font-display text-base font-bold"
                                    aria-label="Nombre de esta comida"
                                />
                                <div className="flex shrink-0 gap-1">
                                    <button
                                        type="button"
                                        aria-label="Subir comida"
                                        disabled={i === 0}
                                        onClick={() => moverComida(c.key, -1)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border disabled:opacity-30"
                                    >
                                        <ArrowUp className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Bajar comida"
                                        disabled={i === comidas.length - 1}
                                        onClick={() => moverComida(c.key, 1)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border disabled:opacity-30"
                                    >
                                        <ArrowDown className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Quitar ${c.nombre}`}
                                        disabled={comidas.length === 1}
                                        onClick={() => quitarComida(c.key)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-primary disabled:opacity-30"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Macros estimados (Fase 2.4, 13/09/2026): se
                                recalcula en vivo a medida que se cargan
                                alimentos, mismo dato que después se ve en la
                                vista de solo lectura. */}
                            {resumenMacros(macrosDeComida(c, alimentosPorId)) && (
                                <p className="mb-3 text-xs font-semibold text-primary">
                                    {resumenMacros(macrosDeComida(c, alimentosPorId))}
                                </p>
                            )}

                            {c.alimentos.length > 1 && (
                                <p className="mb-2 text-xs text-muted-foreground">
                                    Marcar dos o más para agruparlos como alternativas -- el alumno elige
                                    uno solo, no tiene que comer todos.
                                </p>
                            )}

                            {c.alimentos.length > 0 && (
                                <div className="mb-3 space-y-2">
                                    {renglonesDe(c.alimentos).map((r) =>
                                        r.tipo === 'grupo' ? (
                                            <div
                                                key={r.grupoId}
                                                className="rounded-xl border-2 border-primary/60 bg-primary/5 p-2.5"
                                            >
                                                <div className="mb-1.5 flex items-center justify-between px-1">
                                                    <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                                                        Elegir uno
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => desagrupar(c.key, r.grupoId)}
                                                        className="text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                                                    >
                                                        Desagrupar
                                                    </button>
                                                </div>
                                                <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                                                    {r.items.map((it) => (
                                                        <li
                                                            key={it.alimentoId}
                                                            className="flex flex-wrap items-center gap-3 px-3 py-2"
                                                        >
                                                            <span className="min-w-0 basis-full text-sm font-medium sm:basis-auto sm:flex-1">
                                                                {it.nombre}
                                                            </span>
                                                            <Input
                                                                value={it.cantidad}
                                                                onChange={(e) =>
                                                                    editarCantidad(
                                                                        c.key,
                                                                        it.alimentoId,
                                                                        e.target.value,
                                                                    )
                                                                }
                                                                placeholder="Cantidad"
                                                                className="w-24 shrink-0"
                                                            />
                                                            <button
                                                                type="button"
                                                                aria-label={`Quitar ${it.nombre}`}
                                                                onClick={() =>
                                                                    quitarAlimentoDeComida(c.key, it.alimentoId)
                                                                }
                                                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-primary"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ) : (
                                            // Checkbox+nombre agrupados con basis-full en mobile: el
                                            // renglón completo (checkbox + nombre + cantidad + Opcional +
                                            // eliminar) no entra en una fila de celular sin que el campo
                                            // de cantidad quede ilegible -- con flex-wrap y este grupo
                                            // ocupando toda la línea, cantidad/Opcional/eliminar bajan a
                                            // su propia fila en vez de comprimirse (bug encontrado en
                                            // revisión mobile, 04/09/2026).
                                            <div
                                                key={r.item.alimentoId}
                                                className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2"
                                            >
                                                <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Elegir ${r.item.nombre} para agrupar como alternativa`}
                                                        checked={seleccionComida.has(r.item.alimentoId)}
                                                        onChange={() =>
                                                            toggleSeleccion(c.key, r.item.alimentoId)
                                                        }
                                                        className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                                                    />
                                                    <span className="min-w-0 flex-1 text-sm font-medium">
                                                        {r.item.nombre}
                                                        {r.item.opcional && (
                                                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                                                (opcional)
                                                            </span>
                                                        )}
                                                    </span>
                                                </div>
                                                <Input
                                                    value={r.item.cantidad}
                                                    onChange={(e) =>
                                                        editarCantidad(c.key, r.item.alimentoId, e.target.value)
                                                    }
                                                    placeholder="Cantidad"
                                                    className="w-24 shrink-0"
                                                />
                                                <button
                                                    type="button"
                                                    aria-pressed={r.item.opcional}
                                                    onClick={() => toggleOpcional(c.key, r.item.alimentoId)}
                                                    className={`shrink-0 rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition ${
                                                        r.item.opcional
                                                            ? 'border-primary bg-primary text-primary-foreground'
                                                            : 'border-border text-muted-foreground hover:text-foreground'
                                                    }`}
                                                >
                                                    Opcional
                                                </button>
                                                <button
                                                    type="button"
                                                    aria-label={`Quitar ${r.item.nombre}`}
                                                    onClick={() =>
                                                        quitarAlimentoDeComida(c.key, r.item.alimentoId)
                                                    }
                                                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-primary"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ),
                                    )}
                                    {seleccionComida.size >= 2 && (
                                        <Btn
                                            variant="ghost"
                                            className="px-3 py-1.5 text-xs"
                                            onClick={() => agruparSeleccionados(c.key)}
                                        >
                                            Agrupar los {seleccionComida.size} tildados como alternativas
                                        </Btn>
                                    )}
                                </div>
                            )}

                            <div className="relative">
                                <Search
                                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                <Input
                                    value={filtro}
                                    onChange={(e) => setFiltros((f) => ({ ...f, [c.key]: e.target.value }))}
                                    placeholder="Buscar o escribir un alimento nuevo..."
                                    className="pl-9"
                                />
                            </div>
                            {(filtrados.length > 0 || filtro.trim()) && (
                                <div className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-border">
                                    <ul className="divide-y divide-border">
                                        {filtrados.map((a) => (
                                            <li key={a.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => agregarAlimentoAComida(c.key, a)}
                                                    className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-secondary"
                                                >
                                                    <span>{a.nombre}</span>
                                                    <span className="text-xs text-primary">Agregar</span>
                                                </button>
                                            </li>
                                        ))}
                                        {filtro.trim() && !hayExacto && (
                                            <li>
                                                <button
                                                    type="button"
                                                    disabled={creandoAlimento}
                                                    onClick={() =>
                                                        crearYAgregarAlimento(c.key, filtro.trim())
                                                    }
                                                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-primary hover:bg-secondary disabled:opacity-50"
                                                >
                                                    <Plus className="h-3.5 w-3.5 shrink-0" />
                                                    {creandoAlimento
                                                        ? 'Creando...'
                                                        : `Crear "${filtro.trim()}" y agregarlo a tu biblioteca`}
                                                </button>
                                            </li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </Card>
                    );
                })}
            </div>

            <Btn variant="ghost" onClick={agregarComida}>
                <Plus className="h-4 w-4" /> Agregar comida
            </Btn>

            <Field label="Notas (opcional)">
                <Textarea
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    placeholder="Preparación, aclaraciones..."
                />
            </Field>

            {formError && <ErrorBox>{formError}</ErrorBox>}

            <div className="flex justify-end gap-2 pt-2">
                <Btn variant="ghost" onClick={onClose}>
                    Cancelar
                </Btn>
                <Btn type="submit" disabled={saving}>
                    {saving ? 'Guardando...' : 'Guardar'}
                </Btn>
            </div>
        </form>
    </Modal>
);

export default PlanFormModal;
