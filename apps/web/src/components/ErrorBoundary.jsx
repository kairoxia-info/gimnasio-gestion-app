import React from 'react';

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
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
                    <p className="font-display text-xl font-extrabold uppercase text-foreground">
                        Algo no cargó bien
                    </p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                        Puede haber quedado una versión vieja guardada en el celular. Recargá la
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
