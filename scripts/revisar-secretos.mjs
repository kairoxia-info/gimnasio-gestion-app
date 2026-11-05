#!/usr/bin/env node
// Control previo a cada subida: el repositorio es PÚBLICO, así que no puede entrar ninguna
// clave ni dato personal. Nunca imprime el valor completo: solo archivo, línea, tipo y 6 letras.
//
//   node scripts/revisar-secretos.mjs --staged   líneas agregadas en lo preparado para commit
//                                                (claves + correos y teléfonos personales)
//   node scripts/revisar-secretos.mjs --claves   todos los archivos versionados (solo claves)
//
// Sale con código 1 si encuentra algo. No usa dependencias.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YO = 'scripts/revisar-secretos.mjs';

// Archivos que no se revisan: el lockfile (hashes largos) y binarios.
const IGNORAR = [/(^|\/)package-lock\.json$/, /\.(png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|eot|mp4|zip)$/i];

// ---- Claves ---------------------------------------------------------------------------------
const CLAVES = [
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/],
  ['Supabase sb_secret_', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['Supabase sbp_', /\bsbp_[A-Za-z0-9]{16,}/],
  ['Mercado Pago APP_USR', /APP_USR-[A-Za-z0-9-]{16,}/],
  ['Mercado Pago TEST', /\bTEST-[A-Za-z0-9-]{16,}/],
  ['Telegram bot', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ['GitHub', /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}/],
  ['GitHub fine-grained', /github_pat_[A-Za-z0-9_]{30,}/],
  ['Vercel', /\b(?:vercel|vcp)_[A-Za-z0-9]{20,}/],
  ['Google AIza', /AIza[A-Za-z0-9_-]{30,}/],
  ['Anthropic sk-ant-', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI sk-proj-', /sk-proj-[A-Za-z0-9_-]{20,}/],
  ['sk-', /\bsk-[A-Za-z0-9]{32,}/],
  ['Clave privada', /-----BEGIN [A-Z ]*PRIVATE KEY/],
  // Contraseña real = hay algo entre ":" y "@" que no es un marcador de ejemplo.
  ['Cadena postgres con contraseña', /postgres(?:ql)?:\/\/[^\s:@/]+:(?!\[|<|\$|\{|\*|TU_|PASSWORD|CONTRASE|xxx)[^\s@/]{3,}@/i],
];

// ---- Datos personales (solo --staged) -------------------------------------------------------
const CORREO = /[A-Za-z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|icloud|proton|protonmail)\.(?:com|com\.ar|net|me|ar|es)\b/gi;
// Teléfono argentino completo: +54 9 xx xxxx-xxxx, 549..., 54 11 ..., con separadores opcionales.
const TELEFONO = /(?<![\w.])\+?54[\s.-]?9?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{3,4}(?!\d)/g;

// Lista permitida: el correo de soporte y el WhatsApp públicos. Se leen de donde ya están
// definidos para no repetirlos acá.
const leer = (rel) => {
  try {
    return readFileSync(path.join(RAIZ, rel), 'utf8');
  } catch {
    return '';
  }
};
const permitidos = () => {
  const correos = new Set();
  const telefonos = new Set();
  const soporte = leer('apps/web/src/components/AppLayout.jsx').match(/EMAIL_SOPORTE\s*=\s*['"]([^'"]+)['"]/);
  if (soporte) correos.add(soporte[1].toLowerCase());
  const wa = leer('apps/web/src/lib/planesSuscripcion.js').match(/WHATSAPP_CONTACTO\s*=\s*['"](\d+)['"]/);
  if (wa) telefonos.add(wa[1]);
  return { correos, telefonos };
};

const soloDigitos = (s) => s.replace(/\D/g, '');

// ---- Git ------------------------------------------------------------------------------------
const git = (...args) =>
  execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd: RAIZ,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

const ignorado = (archivo) => archivo === YO || IGNORAR.some((r) => r.test(archivo));

// Líneas agregadas: [{ archivo, linea, texto }]
const lineasAgregadas = () => {
  const salida = git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff');
  const res = [];
  let archivo = null;
  let linea = 0;
  for (const l of salida.split('\n')) {
    if (l.startsWith('+++ ')) {
      archivo = l === '+++ /dev/null' ? null : l.slice(6).replace(/^"|"$/g, '');
    } else if (l.startsWith('@@')) {
      const m = l.match(/\+(\d+)/);
      linea = m ? Number(m[1]) : 0;
    } else if (l.startsWith('+') && archivo && !l.startsWith('+++')) {
      res.push({ archivo, linea, texto: l.slice(1) });
      linea++;
    }
  }
  return res;
};

const lineasDeTodo = () => {
  const archivos = git('ls-files', '-z').split('\0').filter(Boolean);
  const res = [];
  for (const archivo of archivos) {
    if (ignorado(archivo)) continue;
    let contenido;
    try {
      contenido = readFileSync(path.join(RAIZ, archivo), 'utf8');
    } catch {
      continue; // borrado en el árbol de trabajo o ilegible
    }
    if (contenido.includes('\0')) continue; // binario
    contenido.split(/\r?\n/).forEach((texto, i) => res.push({ archivo, linea: i + 1, texto }));
  }
  return res;
};

// ---- Revisión -------------------------------------------------------------------------------
const revisar = (lineas, conPersonales) => {
  const hallazgos = [];
  const ok = conPersonales ? permitidos() : null;
  for (const { archivo, linea, texto } of lineas) {
    if (ignorado(archivo) || texto.length > 20000) continue;
    for (const [tipo, re] of CLAVES) {
      const m = texto.match(re);
      if (m) hallazgos.push({ archivo, linea, tipo, inicio: m[0].slice(0, 6) });
    }
    if (!conPersonales) continue;
    for (const m of texto.matchAll(CORREO)) {
      if (!ok.correos.has(m[0].toLowerCase())) hallazgos.push({ archivo, linea, tipo: 'Correo personal', inicio: m[0].slice(0, 6) });
    }
    for (const m of texto.matchAll(TELEFONO)) {
      const d = soloDigitos(m[0]);
      if (d.length < 10) continue;
      // El WhatsApp público se escribe con o sin el 9 y con separadores: se compara por dígitos.
      const publico = [...ok.telefonos].some((t) => d === t || d === t.replace('549', '54'));
      if (!publico) hallazgos.push({ archivo, linea, tipo: 'Teléfono', inicio: m[0].slice(0, 6) });
    }
  }
  return hallazgos;
};

const modo = process.argv[2];
if (modo !== '--staged' && modo !== '--claves') {
  console.error('Uso: node scripts/revisar-secretos.mjs --staged | --claves');
  process.exit(2);
}

let hallazgos;
try {
  hallazgos = modo === '--staged' ? revisar(lineasAgregadas(), true) : revisar(lineasDeTodo(), false);
} catch {
  console.error('No se pudo ejecutar la revisión (¿git está disponible en esta carpeta?).');
  process.exit(2);
}

if (hallazgos.length === 0) {
  console.log('Revisión de seguridad: sin claves ni datos personales.');
  process.exit(0);
}
console.error('Posibles claves o datos personales (no se muestra el valor completo):');
for (const h of hallazgos) console.error(`  ${h.archivo}:${h.linea}  ${h.tipo}  empieza con "${h.inicio}"`);
process.exit(1);
