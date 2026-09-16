import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Eye, EyeOff, Lock, Plus, Search } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import {
    Badge,
    Btn,
    ConfirmInlineActions,
    Empty,
    ErrorBox,
    Field,
    Input,
    Loading,
    Modal,
    Select,
} from '@/components/ui-kit';
import { createRec, listAll, removeRec, updateRec } from '@/lib/data';
import supabase from '@/lib/supabaseClient';

const CATEGORIAS = ['Proteínas', 'Carbohidratos', 'Grasas', 'Frutas', 'Verduras', 'Lácteos', 'Suplementos', 'Otros'];

// Porción de referencia con unidad para SELECCIONAR (14/09/2026, reportado
// por Nalux probando "Nuevo alimento": "no tiene la opción de poner
// gramos, unidad, ml y esas unidades básicas para seleccionar" -- antes era
// un campo de texto libre entero). La columna `alimentos.unidad` en la base
// sigue siendo texto libre (no hace falta migración) -- lo que cambia es
// que el formulario arma ese texto a partir de tres campos: cantidad +
// unidad básica (este select) + una aclaración opcional entre paréntesis,
// para los casos como "1 unidad (120 g)" o "30 g (puñado)".
const UNIDADES_BASICAS = ['g', 'ml', 'unidad', 'cda', 'cdta', 'taza', 'porción', 'scoop'];

// {cantidad, tipo, aclaración} -> "100 g" | "1 unidad (120 g)". primerNumero()
// en lib/format.js (usado para calcular macros) solo necesita que el texto
// EMPIECE con el número -- cualquiera de las dos formas sirve.
const armarUnidad = (cantidad, tipo, aclaracion) => {
    const base = `${cantidad || '1'} ${tipo || 'g'}`.trim();
    return aclaracion?.trim() ? `${base} (${aclaracion.trim()})` : base;
};

// Camino inverso, para poder editar un alimento ya cargado sin perder lo
// que tenía escrito. Best-effort: si el texto no calza con el patrón
// "número + unidad (aclaración)", se guarda entero en la aclaración y
// cantidad/tipo quedan en un default razonable -- se puede corregir a
// mano, no rompe nada ni se pierde el dato original.
const descomponerUnidad = (texto) => {
    const t = String(texto || '').trim();
    const conParentesis = t.match(/^(.*?)\s*\((.+)\)\s*$/);
    const sinParentesis = conParentesis ? conParentesis[1].trim() : t;
    const aclaracionParentesis = conParentesis ? conParentesis[2].trim() : '';
    const m = sinParentesis.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!m) {
        return { unidadCantidad: '1', unidadTipo: 'g', unidadAclaracion: t };
    }
    const tipoCrudo = m[2].trim().toLowerCase();
    const tipo = UNIDADES_BASICAS.includes(tipoCrudo) ? tipoCrudo : 'g';
    // Si lo que escribieron antes de la unidad NO era una unidad básica
    // conocida (ej. "100 g" viejo con otra palabra rara), esa palabra no se
    // pierde: se suma adelante de la aclaración en vez de tirarla.
    const aclaracion =
        tipo === tipoCrudo || !tipoCrudo
            ? aclaracionParentesis
            : [tipoCrudo, aclaracionParentesis].filter(Boolean).join(' ');
    return { unidadCantidad: m[1], unidadTipo: tipo, unidadAclaracion: aclaracion };
};

const vacio = {
    nombre: '',
    categoria: CATEGORIAS[0],
    unidadCantidad: '100',
    unidadTipo: 'g',
    unidadAclaracion: '',
    calorias: '',
    proteinas: '',
    carbohidratos: '',
    grasas: '',
};

const num = (v) => (v === '' || v === null ? 0 : Number(v));

const AlimentosPage = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filtro, setFiltro] = useState('todos');
    const [busqueda, setBusqueda] = useState('');
    const [filtroNutricion, setFiltroNutricion] = useState('todos'); // 'todos' | 'con' | 'sin'
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(vacio);
    const [editId, setEditId] = useState(null);
    const [saving, setSaving] = useState(false);
    // Confirmación inline por alimento, mismo patrón "¿Seguro?" que Alumnos
    // (10/09/2026, repaso general): antes el botón "Eliminar" borraba de una
    // sin preguntar y sin manejar el error -- si el borrado fallaba quedaba
    // mudo y el alimento seguía en la lista sin explicación.
    const [confirmandoBorrarId, setConfirmandoBorrarId] = useState(null);
    const [borrando, setBorrando] = useState(false);

    // Ver/ocultar (14/09/2026, migración 0054, pedido de Nalux: la
    // biblioteca base de ~150 alimentos es compartida entre TODOS los
    // gimnasios -- no se puede editar ni borrar (afectaría a los demás),
    // pero cada gimnasio puede ocultar los que no use, sin tocar la fila de
    // nadie más. `biblioteca_ocultos` es la misma tabla que ahora también
    // usa EjerciciosPage.jsx -- una fila ahí por "este gimnasio no quiere
    // ver este ítem global", nunca se borra el ítem en sí.
    const [ocultosIds, setOcultosIds] = useState(() => new Set());
    const [ocultando, setOcultando] = useState(null);
    // Pestaña separada para ver los ocultos (14/09/2026, segundo pedido de
    // Nalux, hecho primero en EjerciciosPage.jsx: "que se puedan ver en otra
    // página o separado, así después el profe ve los que tiene oculto").
    // Antes "Ver ocultos" los mezclaba de vuelta en la MISMA lista,
    // atenuados, y encima seguían pasando por categoría/búsqueda -- acá es
    // una pestaña aparte con la lista completa, sin depender de qué filtro
    // haya quedado puesto en la biblioteca.
    const [vista, setVista] = useState('biblioteca'); // 'biblioteca' | 'ocultos'

    const cargar = () => {
        setLoading(true);
        Promise.all([
            listAll('alimentos', { sort: 'nombre' }),
            listAll('biblioteca_ocultos', { filters: { tabla: 'alimentos' } }),
        ])
            .then(([r, ocultos]) => {
                setItems(r);
                setOcultosIds(new Set(ocultos.map((o) => o.item_id)));
                setError('');
            })
            .catch(() => setError('No se pudo cargar la biblioteca de alimentos.'))
            .finally(() => setLoading(false));
    };

    useEffect(cargar, []);

    // Ocultar/mostrar es un simple insert/delete en biblioteca_ocultos --
    // sin removeRec() porque esa tabla no tiene columna `id` (su clave es
    // compuesta: gimnasio_id + tabla + item_id), así que el delete se hace
    // directo acá, filtrando por item_id (RLS ya limita a las propias).
    const alternarOculto = async (itemId, yaOculto) => {
        setOcultando(itemId);
        setError('');
        try {
            if (yaOculto) {
                const { error: err } = await supabase
                    .from('biblioteca_ocultos')
                    .delete()
                    .eq('tabla', 'alimentos')
                    .eq('item_id', itemId);
                if (err) throw err;
                setOcultosIds((prev) => {
                    const next = new Set(prev);
                    next.delete(itemId);
                    return next;
                });
            } else {
                await createRec('biblioteca_ocultos', { tabla: 'alimentos', item_id: itemId });
                setOcultosIds((prev) => new Set(prev).add(itemId));
            }
        } catch (_) {
            setError('No se pudo actualizar. Reintentar en unos minutos.');
        } finally {
            setOcultando(null);
        }
    };

    const borrar = async (id) => {
        setBorrando(true);
        setError('');
        try {
            await removeRec('alimentos', id);
            setConfirmandoBorrarId(null);
            cargar();
        } catch (_) {
            setError('No se pudo eliminar el alimento. Reintentar en unos minutos.');
        } finally {
            setBorrando(false);
        }
    };

    const categorias = useMemo(
        () => Array.from(new Set([...CATEGORIAS, ...items.map((i) => i.categoria).filter(Boolean)])),
        [items],
    );

    // Los de la biblioteca base son los que no pertenecen a ningún gimnasio
    // (gimnasio_id NULL, migración 0054); el resto los cargó este gimnasio.
    const cantidadBase = items.filter((a) => !a.gimnasio_id).length;
    const cantidadPropios = items.length - cantidadBase;
    const cantidadOcultos = items.filter((a) => ocultosIds.has(a.id)).length;

    // Si se destapa el último oculto estando parado en esa pestaña, sin esto
    // quedaba una pantalla vacía sin forma de volver: la pestaña "Ocultos"
    // solo se dibuja cuando cantidadOcultos > 0, así que al llegar a 0 con
    // vista en 'ocultos' no había ningún botón "Biblioteca" para volver.
    useEffect(() => {
        if (cantidadOcultos === 0 && vista === 'ocultos') setVista('biblioteca');
    }, [cantidadOcultos, vista]);

    // Los 4 filtros se combinan con AND, mismo criterio que en Ejercicios:
    // categoría sigue siendo chips (la más usada), información nutricional es
    // un select chico, y el buscador reduce por nombre. Los ocultos SIEMPRE
    // se caen de acá -- tienen su propia pestaña (ver `ocultos` más abajo).
    const visibles = items.filter((a) => {
        if (ocultosIds.has(a.id)) return false;
        if (filtro !== 'todos' && a.categoria !== filtro) return false;
        if (filtroNutricion === 'con' && !a.calorias) return false;
        if (filtroNutricion === 'sin' && a.calorias) return false;
        if (busqueda.trim() && !a.nombre?.toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
        return true;
    });

    // Lista completa de ocultos para su propia pestaña -- sin pasar por
    // ningún filtro de la biblioteca.
    const ocultos = items.filter((a) => ocultosIds.has(a.id));

    const guardar = async (e) => {
        e.preventDefault();
        setSaving(true);
        // Payload armado explícito (no ...form): form trae unidadCantidad/
        // unidadTipo/unidadAclaracion, que no son columnas de la tabla --
        // acá se combinan en el único campo `unidad` que sí lo es.
        const payload = {
            nombre: form.nombre,
            categoria: form.categoria,
            unidad: armarUnidad(form.unidadCantidad, form.unidadTipo, form.unidadAclaracion),
            calorias: num(form.calorias),
            proteinas: num(form.proteinas),
            carbohidratos: num(form.carbohidratos),
            grasas: num(form.grasas),
        };
        try {
            if (editId) await updateRec('alimentos', editId, payload);
            else await createRec('alimentos', payload);
            setOpen(false);
            cargar();
        } catch (_) {
            setError('No se pudo guardar el alimento.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppLayout
            title={
                <span className="inline-flex flex-wrap items-center gap-3">
                    Biblioteca de alimentos
                    {/* Pedido de Nalux (07/09/2026): esta biblioteca era la
                        única de las tres sin contador arriba. */}
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-bold normal-case text-primary">
                        {items.length} {items.length === 1 ? 'alimento' : 'alimentos'}
                    </span>
                </span>
            }
            subtitle={
                cantidadBase > 0
                    ? `${cantidadBase} alimentos ya vienen precargados${
                          cantidadPropios > 0
                              ? `, y ${cantidadPropios} ${cantidadPropios === 1 ? 'es propio' : 'son propios'} de este gimnasio`
                              : ''
                      }. Se pueden sumar más propios, y ocultar los que no se usen.`
                    : 'Cargar cada alimento una vez con su información nutricional y reutilizarlo en los planes.'
            }
            actions={
                <Btn
                    onClick={() => {
                        setForm(vacio);
                        setEditId(null);
                        setOpen(true);
                    }}
                >
                    <Plus className="h-4 w-4" /> Nuevo alimento
                </Btn>
            }
        >
            <Helmet>
                <title>Biblioteca de alimentos | RutNail</title>
                <meta
                    name="description"
                    content="Alimentos con calorías y macros por porción para armar planes de alimentación personalizados."
                />
            </Helmet>

            {/* Pestañas Biblioteca/Ocultos (14/09/2026, mismo patrón que
                EjerciciosPage.jsx): solo aparece si hay algo oculto -- con 0
                ocultos no hay nada que separar. */}
            {cantidadOcultos > 0 && (
                <div className="mb-4 flex gap-2 border-b border-border">
                    <button
                        type="button"
                        onClick={() => setVista('biblioteca')}
                        className={`border-b-2 px-1 pb-2 text-sm font-semibold transition ${
                            vista === 'biblioteca'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        Biblioteca
                    </button>
                    <button
                        type="button"
                        onClick={() => setVista('ocultos')}
                        className={`border-b-2 px-1 pb-2 text-sm font-semibold transition ${
                            vista === 'ocultos'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        Ocultos ({cantidadOcultos})
                    </button>
                </div>
            )}

            {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}

            {vista === 'ocultos' ? (
                // Pestaña "Ocultos": lista completa, sin pasar por ningún
                // filtro de la biblioteca -- todos son predefinidos (los
                // propios se borran, no se ocultan), así que la tarjeta/fila
                // es más simple: sin Editar/Eliminar.
                <>
                    <p className="mb-4 text-sm text-muted-foreground">
                        Alimentos que ocultaste en este gimnasio. Dejás de verlos vos, pero podés volver a
                        mostrarlos cuando quieras.
                    </p>
                    {loading ? (
                        <Loading rows={4} />
                    ) : (
                        <>
                            <div className="space-y-3 sm:hidden">
                                {ocultos.map((a) => (
                                    <div key={a.id} className="rounded-2xl border border-border bg-card p-4 opacity-80">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <p className="min-w-0 font-semibold">{a.nombre}</p>
                                            <Badge className="border-border text-muted-foreground">
                                                {a.categoria || '—'}
                                            </Badge>
                                        </div>
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {a.unidad || '100 g'} · {a.calorias || 0} kcal
                                        </p>
                                        <Btn
                                            variant="ghost"
                                            className="mt-3 w-full px-3 py-1.5 text-xs"
                                            disabled={ocultando === a.id}
                                            onClick={() => alternarOculto(a.id, true)}
                                        >
                                            <Eye className="h-3.5 w-3.5" /> Mostrar de nuevo
                                        </Btn>
                                    </div>
                                ))}
                            </div>
                            <div className="hidden overflow-x-auto rounded-2xl border border-border sm:block">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                                        <tr>
                                            <th className="px-4 py-3">Alimento</th>
                                            <th className="px-4 py-3">Categoría</th>
                                            <th className="px-4 py-3">Porción</th>
                                            <th className="px-4 py-3">Kcal</th>
                                            <th className="px-4 py-3" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border bg-card">
                                        {ocultos.map((a) => (
                                            <tr key={a.id}>
                                                <td className="px-4 py-3 font-semibold">{a.nombre}</td>
                                                <td className="px-4 py-3">
                                                    <Badge className="border-border text-muted-foreground">
                                                        {a.categoria || '—'}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-3 text-muted-foreground">{a.unidad || '100 g'}</td>
                                                <td className="px-4 py-3">{a.calorias || 0}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex justify-end">
                                                        <Btn
                                                            variant="ghost"
                                                            className="px-3 py-1.5 text-xs"
                                                            disabled={ocultando === a.id}
                                                            onClick={() => alternarOculto(a.id, true)}
                                                        >
                                                            <Eye className="h-3.5 w-3.5" /> Mostrar
                                                        </Btn>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </>
            ) : (
                <>
                    <div className="mb-4 grid gap-3 sm:grid-cols-[2fr,1fr]">
                        <div className="relative">
                            <Search
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <Input
                                value={busqueda}
                                onChange={(e) => setBusqueda(e.target.value)}
                                placeholder="Buscar por nombre..."
                                className="pl-9"
                                aria-label="Buscar alimento por nombre"
                            />
                        </div>
                        <Select
                            value={filtroNutricion}
                            onChange={(e) => setFiltroNutricion(e.target.value)}
                            aria-label="Filtrar por información nutricional cargada"
                        >
                            <option value="todos">Con o sin información nutricional</option>
                            <option value="con">Con información nutricional</option>
                            <option value="sin">Sin información nutricional</option>
                        </Select>
                    </div>

                    <div className="mb-4 flex flex-wrap gap-2">
                        {['todos', ...categorias].map((c) => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => setFiltro(c)}
                                className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                                    filtro === c
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-border text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {c === 'todos' ? 'Todos' : c}
                            </button>
                        ))}
                    </div>

                    {loading ? (
                        <Loading rows={4} />
                    ) : visibles.length === 0 ? (
                        <Empty>No hay alimentos que coincidan con estos filtros.</Empty>
                    ) : (
                        <>
                            {/* Reportado por Nalux (07/09/2026): en el celular la tabla
                                quedaba cortada y encima no dejaba correrla al costado
                                (el contenedor tenía overflow-hidden). Con 6 columnas no
                                hay forma de que entre en 375px sin achicar la letra
                                hasta lo ilegible, así que en pantalla chica se muestra
                                una tarjeta por alimento -- se ve TODO, sin scroll
                                horizontal -- y la tabla queda de sm para arriba. */}
                            <div className="space-y-3 sm:hidden">
                                {visibles.map((a) => {
                                    const esGlobal = !a.gimnasio_id;
                                    return (
                                    <div key={a.id} className="rounded-2xl border border-border bg-card p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="font-semibold">{a.nombre}</p>
                                                {esGlobal && (
                                                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                        <Lock className="h-3 w-3" /> Predefinido
                                                    </span>
                                                )}
                                            </div>
                                            <Badge className="border-border text-muted-foreground">
                                                {a.categoria || '—'}
                                            </Badge>
                                        </div>
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {a.unidad || '100 g'} · {a.calorias || 0} kcal
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            P {a.proteinas || 0} · C {a.carbohidratos || 0} · G {a.grasas || 0}
                                        </p>
                                        {esGlobal ? (
                                            <div className="mt-3">
                                                <Btn
                                                    variant="ghost"
                                                    className="w-full px-3 py-1.5 text-xs"
                                                    disabled={ocultando === a.id}
                                                    onClick={() => alternarOculto(a.id, false)}
                                                >
                                                    <EyeOff className="h-3.5 w-3.5" /> Ocultar
                                                </Btn>
                                            </div>
                                        ) : (
                                        <div className="mt-3 flex gap-2">
                                            <Btn
                                                variant="ghost"
                                                className="flex-1 px-3 py-1.5 text-xs"
                                                onClick={() => {
                                                    setForm({
                                                        nombre: a.nombre || '',
                                                        categoria: a.categoria || CATEGORIAS[0],
                                                        ...descomponerUnidad(a.unidad),
                                                        calorias: a.calorias ?? '',
                                                        proteinas: a.proteinas ?? '',
                                                        carbohidratos: a.carbohidratos ?? '',
                                                        grasas: a.grasas ?? '',
                                                    });
                                                    setEditId(a.id);
                                                    setOpen(true);
                                                }}
                                            >
                                                Editar
                                            </Btn>
                                            {confirmandoBorrarId === a.id ? (
                                                <ConfirmInlineActions
                                                    className="flex-1 px-3 py-1.5 text-xs"
                                                    ejecutando={borrando}
                                                    onConfirmar={() => borrar(a.id)}
                                                    onCancelar={() => setConfirmandoBorrarId(null)}
                                                />
                                            ) : (
                                                <Btn
                                                    variant="danger"
                                                    className="flex-1 px-3 py-1.5 text-xs"
                                                    onClick={() => setConfirmandoBorrarId(a.id)}
                                                >
                                                    Eliminar
                                                </Btn>
                                            )}
                                        </div>
                                        )}
                                    </div>
                                    );
                                })}
                            </div>

                            <div className="hidden overflow-x-auto rounded-2xl border border-border sm:block">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3">Alimento</th>
                                        <th className="px-4 py-3">Categoría</th>
                                        <th className="px-4 py-3">Porción</th>
                                        <th className="px-4 py-3">Kcal</th>
                                        <th className="hidden px-4 py-3 sm:table-cell">P / C / G</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border bg-card">
                                    {visibles.map((a) => {
                                        const esGlobal = !a.gimnasio_id;
                                        return (
                                        <tr key={a.id}>
                                            <td className="px-4 py-3 font-semibold">
                                                {a.nombre}
                                                {esGlobal && (
                                                    <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                        <Lock className="h-3 w-3" /> Predefinido
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge className="border-border text-muted-foreground">{a.categoria || '—'}</Badge>
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground">{a.unidad || '100 g'}</td>
                                            <td className="px-4 py-3">{a.calorias || 0}</td>
                                            <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                                                {a.proteinas || 0} / {a.carbohidratos || 0} / {a.grasas || 0}
                                            </td>
                                            <td className="px-4 py-3">
                                                {esGlobal ? (
                                                    <div className="flex justify-end">
                                                        <Btn
                                                            variant="ghost"
                                                            className="px-3 py-1.5 text-xs"
                                                            disabled={ocultando === a.id}
                                                            onClick={() => alternarOculto(a.id, false)}
                                                        >
                                                            <EyeOff className="h-3.5 w-3.5" /> Ocultar
                                                        </Btn>
                                                    </div>
                                                ) : (
                                                <div className="flex justify-end gap-2">
                                                    <Btn
                                                        variant="ghost"
                                                        className="px-3 py-1.5 text-xs"
                                                        onClick={() => {
                                                            setForm({
                                                                nombre: a.nombre || '',
                                                                categoria: a.categoria || CATEGORIAS[0],
                                                                ...descomponerUnidad(a.unidad),
                                                                calorias: a.calorias ?? '',
                                                                proteinas: a.proteinas ?? '',
                                                                carbohidratos: a.carbohidratos ?? '',
                                                                grasas: a.grasas ?? '',
                                                            });
                                                            setEditId(a.id);
                                                            setOpen(true);
                                                        }}
                                                    >
                                                        Editar
                                                    </Btn>
                                                    {confirmandoBorrarId === a.id ? (
                                                        <ConfirmInlineActions
                                                            className="px-3 py-1.5 text-xs"
                                                            ejecutando={borrando}
                                                            onConfirmar={() => borrar(a.id)}
                                                            onCancelar={() => setConfirmandoBorrarId(null)}
                                                        />
                                                    ) : (
                                                        <Btn
                                                            variant="danger"
                                                            className="px-3 py-1.5 text-xs"
                                                            onClick={() => setConfirmandoBorrarId(a.id)}
                                                        >
                                                            Eliminar
                                                        </Btn>
                                                    )}
                                                </div>
                                                )}
                                            </td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            </div>
                        </>
                    )}
                </>
            )}

            <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Editar alimento' : 'Nuevo alimento'}>
                <form onSubmit={guardar} className="space-y-4">
                    <Field label="Nombre">
                        <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Categoría">
                            <Select
                                value={form.categoria}
                                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                            >
                                {categorias.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        {/* Porción de referencia (14/09/2026): tres campos en vez de un
                            texto libre entero -- cantidad + unidad básica para elegir de
                            una lista + una aclaración opcional para casos como "1 unidad
                            (120 g)". Ocupa las dos columnas del grid para que entren los
                            tres cómodos. */}
                        <div className="sm:col-span-2">
                            <span className="mb-2 block text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                                Porción de referencia
                            </span>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr,1fr,1.6fr]">
                                <Field label="Cantidad">
                                    <Input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        value={form.unidadCantidad}
                                        onChange={(e) => setForm({ ...form, unidadCantidad: e.target.value })}
                                    />
                                </Field>
                                <Field label="Unidad">
                                    <Select
                                        value={form.unidadTipo}
                                        onChange={(e) => setForm({ ...form, unidadTipo: e.target.value })}
                                    >
                                        {UNIDADES_BASICAS.map((u) => (
                                            <option key={u} value={u}>
                                                {u}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <Field label="Aclaración (opcional)" className="col-span-2 sm:col-span-1">
                                    <Input
                                        value={form.unidadAclaracion}
                                        onChange={(e) => setForm({ ...form, unidadAclaracion: e.target.value })}
                                        placeholder="120 g, puñado..."
                                    />
                                </Field>
                            </div>
                        </div>
                        <Field label="Calorías">
                            <Input
                                type="number"
                                value={form.calorias}
                                onChange={(e) => setForm({ ...form, calorias: e.target.value })}
                            />
                        </Field>
                        <Field label="Proteínas (g)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.proteinas}
                                onChange={(e) => setForm({ ...form, proteinas: e.target.value })}
                            />
                        </Field>
                        <Field label="Carbohidratos (g)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.carbohidratos}
                                onChange={(e) => setForm({ ...form, carbohidratos: e.target.value })}
                            />
                        </Field>
                        <Field label="Grasas (g)">
                            <Input
                                type="number"
                                step="0.1"
                                value={form.grasas}
                                onChange={(e) => setForm({ ...form, grasas: e.target.value })}
                            />
                        </Field>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Btn variant="ghost" onClick={() => setOpen(false)}>
                            Cancelar
                        </Btn>
                        <Btn type="submit" disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Btn>
                    </div>
                </form>
            </Modal>
        </AppLayout>
    );
};

export default AlimentosPage;
