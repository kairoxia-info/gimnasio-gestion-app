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
	// Reportado por Nalux (07/09/2026): pantalla en negro en el celular al
	// entrar o cambiar de módulo, hay que recargar a mano. Pasa cuando el
	// celular tiene la pestaña abierta desde ANTES de que se suba una
	// versión nueva del sitio: el JS de la app ya está corriendo en memoria
	// (versión vieja) mientras en segundo plano se instala y activa un
	// service worker nuevo -- de ahí en más, ese JS viejo sigue pidiendo
	// archivos de ESA versión vieja, que Vercel ya no tiene. "controllerchange"
	// es el aviso del propio navegador de que un service worker nuevo
	// tomó control de esta pestaña: recargar una sola vez ahí sincroniza
	// todo de nuevo (JS + service worker de la misma versión), antes de que
	// el usuario llegue a notar nada roto. La bandera evita un loop si el
	// evento llegara a dispararse más de una vez.
	let yaRecargando = false;
	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (yaRecargando) return;
		yaRecargando = true;
		window.location.reload();
	});

	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/sw.js').catch(() => {
			// Sin service worker el sitio sigue andando normal, solo que no
			// va a funcionar sin conexión -- no hay nada que romper acá.
		});
	});
}
