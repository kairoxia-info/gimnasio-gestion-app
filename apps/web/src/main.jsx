import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
	<App />
);

// Solo en producción: en desarrollo, un service worker registrado se
// interpone con el hot-reload de Vite (podría servir código viejo cacheado
// en vez del que se acaba de guardar). public/sw.js cachea el plan del
// alumno para que se siga viendo sin señal/wifi (pedido de Nalux,
// 04/09/2026) -- ver los comentarios ahí para el detalle de qué cachea y
// qué no.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/sw.js').catch(() => {
			// Sin service worker el sitio sigue andando normal, solo que no
			// va a funcionar sin conexión -- no hay nada que romper acá.
		});
	});
}
