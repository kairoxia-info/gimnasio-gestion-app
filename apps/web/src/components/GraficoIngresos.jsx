import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '@/lib/format';

// El gráfico vive en su propio archivo para poder cargarse aparte del resto
// del panel (React.lazy en DashboardPage.jsx). Recharts pesa ~100 KB y este
// gráfico queda más abajo de lo que se ve al entrar, así que no tiene por
// qué frenar la primera pantalla que ve el profesor -- mismo criterio que ya
// se usa con jsPDF/html2canvas para el PDF (lib/descargarPdf.js).
//
// Los colores salen de las variables del tema (hsl(var(--...))) y no de
// valores fijos: así el gráfico sigue el color que cada gimnasio configuró y
// también el modo claro/oscuro, sin tener que tocar nada acá.
const GraficoIngresos = ({ serie }) => (
    <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie}>
            <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                width={70}
                tickFormatter={(v) => money(v)}
            />
            <Tooltip
                cursor={{ fill: 'hsl(var(--secondary))' }}
                contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                    color: 'hsl(var(--foreground))',
                }}
                formatter={(v) => [money(v), 'Cobrado']}
            />
            <Bar dataKey="total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
        </BarChart>
    </ResponsiveContainer>
);

export default GraficoIngresos;
