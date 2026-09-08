import React from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Mismo criterio que components/GraficoIngresos.jsx: recharts en su propio
// archivo para poder cargarse con React.lazy (AlumnoPage.jsx). Antes esto
// era el motivo de que recharts (~100 KB) siguiera empaquetado en el bundle
// principal aunque el gráfico del panel (GraficoIngresos) ya estuviera
// diferido -- Rollup no puede separar una librería que otro punto de
// entrada sigue importando de forma estática. Con los dos gráficos diferidos,
// recharts recién se descarga cuando el profesor entra a ver el progreso de
// un alumno.
const GraficoPeso = ({ serie }) => (
    <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie}>
            <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="fecha" stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={['auto', 'auto']} />
            <Tooltip
                contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                    color: 'hsl(var(--foreground))',
                }}
            />
            <Line type="monotone" dataKey="peso" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 3 }} />
        </LineChart>
    </ResponsiveContainer>
);

export default GraficoPeso;
