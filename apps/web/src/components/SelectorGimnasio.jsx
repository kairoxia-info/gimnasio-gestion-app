import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

// Selector del gimnasio abierto, en el menú lateral (migración 0076, varios gimnasios por
// profesor). Solo aparece con 2 o más gimnasios: con uno no hay nada que elegir y no tiene
// sentido sumar ruido a la pantalla. Elegir otro recarga la app entera (ver cambiarGimnasio en
// AuthContext): es lo único que garantiza que ninguna pantalla muestre datos del anterior.
const SelectorGimnasio = () => {
    const { profile, cambiarGimnasio } = useAuth();
    const [cambiandoA, setCambiandoA] = useState(null);
    const [error, setError] = useState('');

    const lista = profile?.misGimnasios ?? [];
    if (lista.length < 2) return null;

    const elegir = async (gimnasio) => {
        if (cambiandoA || gimnasio.id === profile?.gimnasio_id) return;
        setError('');
        setCambiandoA(gimnasio.id);
        const { error: errorCambio } = await cambiarGimnasio(gimnasio.id);
        if (errorCambio) {
            setError(errorCambio.message);
            setCambiandoA(null);
        }
        // Sin error la página se recarga sola.
    };

    return (
        <div className="mb-4 rounded-2xl border border-border p-2" id="selector-gimnasio">
            <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Mis gimnasios
            </p>
            <ul className="space-y-1">
                {lista.map((g) => {
                    const activo = g.id === profile?.gimnasio_id;
                    return (
                        <li key={g.id}>
                            <button
                                type="button"
                                onClick={() => elegir(g)}
                                disabled={!!cambiandoA}
                                aria-current={activo ? 'true' : undefined}
                                className={`flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition active:scale-[0.99] disabled:opacity-60 ${
                                    activo
                                        ? 'bg-primary/15 font-semibold text-foreground'
                                        : 'text-foreground hover:bg-secondary'
                                }`}
                            >
                                <span className="min-w-0 flex-1 truncate">{g.nombre}</span>
                                {cambiandoA === g.id ? (
                                    <span className="text-xs text-muted-foreground">Abriendo...</span>
                                ) : activo ? (
                                    <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Gimnasio abierto" />
                                ) : null}
                            </button>
                        </li>
                    );
                })}
            </ul>
            {error && <p className="px-2 pt-2 text-xs text-destructive">{error}</p>}
        </div>
    );
};

export default SelectorGimnasio;
