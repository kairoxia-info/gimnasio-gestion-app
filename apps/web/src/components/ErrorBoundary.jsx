import React from 'react';
import { reportarErrorCliente } from '@/lib/errores';

// Reportado por Nalux (07/09/2026): en el celular, al entrar o al cambiar de
// módulo, a veces la pantalla se pone en negro y hay que recargar a mano.
// Causa real: no había NINGÚN error boundary en toda la app -- si cualquier
// componente tira una excepción al renderizar (por ejemplo, un archivo JS
// que quedó desincronizado en el celular contra el service worker justo
// después de subir una versión nueva -- ver public/sw.js y el listener de
// controllerchange en main.jsx, que atacan esa causa de raíz), React
// desmonta TODO el árbol y no queda nada dentro de <div id="root">: la
// pantalla se ve negra porque el fondo de la página está en modo oscuro por
// default (App.jsx, ThemeProvider defaultTheme="dark"), sin ningún mensaje.
//
// Esto no evita que el error ocurra -- es la red de contención: en vez de
// una pantalla negra muda, siempre hay un mensaje con un botón para
// recargar, incluso si el error viene de un lugar que no anticipamos.
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('Error atrapado por ErrorBoundary:', error, info?.componentStack);

        // Deja rastro en la base (migración 0066, pedido de Nalux 21/09/2026,
        // antes de la semana de prueba con el primer cliente real): sin esto,
        // si al cliente le queda la pantalla de error, ella se entera solo si
        // él avisa -- Vercel no ve los errores de JavaScript del navegador.
        //
        // La RPC resuelve el gimnasio del lado del servidor desde auth.uid(),
        // así que acá no hace falta el perfil: este componente está MÁS AFUERA
        // que AuthProvider (ver App.jsx) y no tiene acceso al contexto.
        //
        // Sin await a propósito: reportar el error nunca puede romper ni
        // demorar la pantalla de error. Las reglas (solo producción, solo con
        // sesión, tope por pestaña) viven en lib/errores.js, compartidas con
        // los listeners globales que instala main.jsx.
        reportarErrorCliente({
            mensaje: `Crash de pantalla: ${error?.message || error || 'sin mensaje'}`,
            detalle: [error?.stack, info?.componentStack].filter(Boolean).join('\n---\n'),
        });
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
                    <p className="font-display text-xl font-extrabold uppercase text-foreground">
                        Algo no cargó bien
                    </p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                        Puede haber quedado una versión vieja guardada en el dispositivo. Recarga la
                        página para volver a intentar.
                    </p>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition active:scale-[0.98]"
                    >
                        Recargar
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
