import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Aviso de versión nueva (pedido de Nalux, 03/11/2026). En cada compilación:
// - fija un identificador único de la versión y lo deja en el código como __VERSION_APP__;
// - escribe /version.json con ese mismo identificador.
// La app abierta en cada celular consulta /version.json cada tanto (components/AvisoVersionNueva.jsx):
// si el identificador cambió, se subió una versión nueva y muestra el cartel con "Actualizar".
//
// aviso-version.json (al lado de package.json, opcional) permite agregar a ESA subida un texto
// ("mensaje") y marcarla como obligatoria ("obligatoria": true -> el cartel no se puede cerrar).
// Después de una subida urgente conviene volver a dejarlo en false.
export default function versionAppPlugin({ command }) {
    const version =
        command === 'build'
            ? `${(process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7)}-${Date.now().toString(36)}`
            : 'desarrollo';

    return {
        name: 'version-app',
        config: () => ({
            define: { __VERSION_APP__: JSON.stringify(version) },
        }),
        generateBundle() {
            if (command !== 'build') return;
            let aviso = {};
            const archivo = path.resolve(process.cwd(), 'aviso-version.json');
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
