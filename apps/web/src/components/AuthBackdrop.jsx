import React from 'react';

// Fondo compartido de las 3 pantallas de ANTES del login (Login, Onboarding
// y ResetPassword): acá todavía no hay gimnasio identificado, así que no
// corresponde ni el theming por-gimnasio (colorTema.js, que solo se aplica
// una vez logueado) ni el modo claro/oscuro del sistema -- es la identidad
// fija de Kairox. Pedido de Nalux (03/09/2026): "gris ocuro con ondas de
// grises claron... dorados... profesional y premium... no tan cargado ni
// tan pelado".
//
// Las "ondas" son 3 capas radial-gradient + blur (2 grises cálidos, 1
// dorado muy tenue) con un drift sutil vía CSS puro -- nada de imágenes ni
// librerías nuevas, todo liviano y corriendo en el compositor.
//
// className="dark" en la raíz es a propósito: Btn/Input/Field/ErrorBox (de
// ui-kit.jsx, que NO se toca) siguen leyendo --background/--card/--border/
// --muted-foreground, tokens que cambian según el theme claro/oscuro. Si no
// forzáramos esto acá, un profesor que cerró sesión habiendo dejado la app
// en modo claro vería esta pantalla "premium oscura" con inputs blancos
// rotos -- por eso además ya no se muestra <ThemeToggle /> en estas 3
// pantallas (no tiene sentido un modo claro sobre una identidad a propósito
// oscura). El fondo/capas de acá no usan esos tokens en absoluto: son
// colores fijos, ajenos a index.css.
const AuthBackdrop = ({ children }) => (
    <div className="dark relative min-h-[100dvh] w-full overflow-hidden bg-[#110f0d]">
        <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,#17140f_0%,#0e0c0a_45%,#120f0c_100%)]"
        />

        {/* "Ondas": grises cálidos superpuestos + un halo dorado muy tenue, todo
            recortado por overflow-hidden para no generar scroll horizontal en mobile */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <span className="kx-wave kx-wave-a absolute -right-1/4 -top-1/3 h-[65vw] max-h-[42rem] w-[65vw] max-w-[42rem] rounded-full bg-[radial-gradient(closest-side,#433c30_0%,transparent_72%)] opacity-50 blur-3xl" />
            <span className="kx-wave kx-wave-b absolute -left-1/4 bottom-[-18%] h-[55vw] max-h-[36rem] w-[55vw] max-w-[36rem] rounded-full bg-[radial-gradient(closest-side,#242019_0%,transparent_72%)] opacity-70 blur-3xl" />
            <span className="kx-wave kx-wave-c absolute left-1/2 top-1/2 h-[48vw] max-h-[30rem] w-[48vw] max-w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,#c9a86a_0%,transparent_70%)] opacity-[0.08] blur-3xl" />
        </div>

        {/* Línea + resplandor dorado superior, reemplaza la barra sólida bg-primary de antes */}
        <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(201,168,106,0.18),transparent_75%)]"
        />
        <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d8b876]/80 to-transparent"
        />

        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-12">
            {children}
        </div>

        <style>{`
            .kx-wave-a { animation: kx-drift-a 26s ease-in-out infinite alternate; }
            .kx-wave-b { animation: kx-drift-b 32s ease-in-out infinite alternate; }
            .kx-wave-c { animation: kx-drift-c 22s ease-in-out infinite alternate; }
            @keyframes kx-drift-a {
                from { transform: translate3d(0, 0, 0) scale(1); }
                to { transform: translate3d(-3%, 3%, 0) scale(1.08); }
            }
            @keyframes kx-drift-b {
                from { transform: translate3d(0, 0, 0) scale(1); }
                to { transform: translate3d(4%, -4%, 0) scale(1.05); }
            }
            @keyframes kx-drift-c {
                from { transform: translate3d(-50%, -50%, 0) scale(1); }
                to { transform: translate3d(-50%, -50%, 0) scale(1.15); }
            }
            @media (prefers-reduced-motion: reduce) {
                .kx-wave-a, .kx-wave-b, .kx-wave-c { animation: none; }
            }
        `}</style>
    </div>
);

export default AuthBackdrop;
