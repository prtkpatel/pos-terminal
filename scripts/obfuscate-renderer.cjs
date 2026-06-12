/**
 * Post-build obfuscation of the FINAL renderer bundle (dist/assets/*.js).
 * Runs after `vite build` so esbuild's minify can't undo it. Conservative settings:
 * string-array + identifier mangling only — control-flow flattening, dead-code
 * injection and self-defending are OFF to avoid runtime breakage in a large React app.
 */
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'dist', 'assets');

const options = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 0.6,
  stringArrayEncoding: ['base64'],
  splitStrings: true,
  splitStringsChunkLength: 12,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  disableConsoleOutput: false,
  sourceMap: false,
};

if (!fs.existsSync(assetsDir)) {
  console.warn('[obfuscate] dist/assets not found — run `vite build` first');
  process.exit(0);
}

const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
if (!files.length) {
  console.warn('[obfuscate] no .js files in dist/assets');
  process.exit(0);
}

for (const file of files) {
  const full = path.join(assetsDir, file);
  const code = fs.readFileSync(full, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, options);
  fs.writeFileSync(full, result.getObfuscatedCode());
  console.log('[obfuscate]', file, '→ obfuscated');
}
