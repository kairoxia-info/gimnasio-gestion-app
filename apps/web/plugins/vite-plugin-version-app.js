import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Aviso de versión nueva (pedido de Nalux, 03/11/2026). En cada compilación:
// - fija un identificador de la versión y lo deja en el código como __VERSION_APP__;
// - escribe /version.json con ese mismo identificador.
// La app abierta en cada celular consulta /version.json cada tanto (components/AvisoVersionNueva.jsx):
// si el identificador cambió, se subió una versión nueva y muestra el cartel con "Actualizar".
//
// El identificador es una huella del contenido de la app, no la hora de compilar (04/11/2026): una subida
// que solo toca CONTEXT.md o supabase/ compila igual en Vercel, y con la hora les mostraba el cartel a
// todos sin nada nuevo. Con la huella, mismos archivos = misma versión = sin cartel.
//
// aviso-version.json (al lado de package.json, opcional) permite agregar a ESA subida un texto
// ("mensaje") y marcarla como obligatoria ("obligatoria": true -> el cartel no se puede cerrar). Queda
// afuera de la huella a propósito: por sí solo no genera cartel, y volver a dejarlo en false después de
// una subida urgente no molesta a nadie. O sea que un mensaje siempre tiene que ir con un cambio en la app.

// Lo que define lo que llega al navegador. Rutas relativas a apps/web.
const ENTRADAS = [
    'src',
    'public',
    'index.html',
    'package.json',
    'vite.config.js',
    'tailwind.config.js',
    'postcss.config.js',
    '../../package-lock.json',
];

const archivosDe = (ruta) => {
    if (!existsSync(ruta)) return [];
    if (!statSync(ruta).isDirectory()) return [ruta];
    return readdirSync(ruta).flatMap((nombre) => archivosDe(path.join(ruta, nombre)));
};

const huellaDeLaApp = (raiz) => {
    const hash = createHash('sha256');
    ENTRADAS.flatMap((entrada) => archivosDe(path.resolve(raiz, entrada)))
        .map((archivo) => ({ archivo, clave: path.relative(raiz, archivo).replaceAll('\\', '/') }))
        .sort((a, b) => (a.clave < b.clave ? -1 : 1))
        .forEach(({ archivo, clave }) => {
            hash.update(clave);
            hash.update(readFileSync(archivo));
        });
    // Las variables VITE_ también terminan dentro de la app.
    Object.keys(process.env)
        .filter((nombre) => nombre.startsWith('VITE_'))
        .sort()
        .forEach((nombre) => hash.update(`${nombre}=${process.env[nombre]}`));
    return hash.digest('hex').slice(0, 12);
};

export default function versionAppPlugin({ command }) {
    const raiz = process.cwd();
    const version = command === 'build' ? huellaDeLaApp(raiz) : 'desarrollo';

    return {
        name: 'version-app',
        config: () => ({
            define: { __VERSION_APP__: JSON.stringify(version) },
        }),
        generateBundle() {
            if (command !== 'build') return;
            let aviso = {};
            const archivo = path.resolve(raiz, 'aviso-version.json');
            if (existsSync(archivo)) {
                try {
                    aviso = JSON.parse(readFileSync(archivo, 'utf-8'));
                } catch (_) {
                    // un aviso mal escrito no puede frenar la compilación: se sube sin texto
                }
            }
            this.emitFile({
                type: 'asset',
                fileName: 'version.json',
                source: JSON.stringify({
                    version,
                    creada_en: new Date().toISOString(),
                    obligatoria: aviso.obligatoria === true,
                    mensaje: typeof aviso.mensaje === 'string' ? aviso.mensaje.slice(0, 300) : '',
                }),
            });
        },
    };
}
