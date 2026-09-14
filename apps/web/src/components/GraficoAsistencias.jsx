import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Mismo criterio que GraficoIngresos.jsx: vive en su propio archivo para
// cargarse aparte del resto del panel (React.lazy en DashboardPage.jsx),
// recharts pesa ~100 KB y este gráfico queda más abajo de lo que se ve al
// entrar.
//
// Fase 2.1 (13/09/2026), pedido de Nalux: antes el Dashboard sumaba TODAS
// las asistencias de los últimos 7 días en un solo número -- si vinieron 6
// el lunes y 4 el martes, mostraba "10" sin decir nada de cómo se repartió.
// Este gráfico desglosa día por día, con el día de hoy resaltado en el
// color de marca (el resto en un gris neutro) para que salte a la vista sin
// tener que leer las etiquetas del eje.
const GraficoAsistencias = ({ serie }) => (
    <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie}>
            <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="dia" stroke="hsl(var(--muted-foreground))" fontSize={12} />
            <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                width={30}
                allowDecimals={false}
            />
            <Tooltip
                cursor={{ fill: 'hsl(var(--secondary))' }}
                contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                    color: 'hsl(var(--foreground))',
                }}
                formatter={(v) => [v, v === 1 ? 'asistencia' : 'asistencias']}
            />
            <Bar dataKey="presentes" radius={[6, 6, 0, 0]}>
                {serie.map((punto) => (
                    <Cell
                        key={punto.dia}
                        fill={punto.esHoy ? 'hsl(var(--primary))' : 'hsl(var(--secondary))'}
                    />
                ))}
            </Bar>
        </BarChart>
    </ResponsiveContainer>
);

export default GraficoAsistencias;
