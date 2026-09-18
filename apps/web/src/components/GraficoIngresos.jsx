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
                // Bug encontrado probando un gimnasio recién creado, sin pagos
                // todavía (18/09/2026): sin domain explícito, con los 12 meses
                // en $0 recharts arma un eje degenerado ($0, $1, $2, $3, $4)
                // -- ticks que no significan nada en pesos reales. Con este
                // domain, mientras no haya ingresos el eje llega a $100 (un
                // techo prolijo), y en cuanto hay plata de verdad
                // (normalmente mucho más que 100) el máximo real vuelve a
                // mandar, sin cambiar nada del comportamiento de hoy.
                domain={[0, (dataMax) => Math.max(dataMax, 100)]}
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
