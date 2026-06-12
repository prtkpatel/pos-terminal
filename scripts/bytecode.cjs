/**
 * Compile the built main-process bundle to V8 bytecode (.jsc) and replace the .js
 * with a tiny loader stub. This must run under Electron's V8 (same version that will
 * execute the .jsc) — launch it via scripts/run-bytecode.cjs, not plain `node`.
 *
 * Only the MAIN process is bytecoded. The preload runs in a restricted context where
 * .jsc loading is fragile, so it stays minified+obfuscated JS (it exposes no secrets).
 */
const bytenode = require('bytenode');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'dist-electron');
const targets = ['main.js']; // add 'preload.js' only if verified working on your build

for (const file of targets) {
  const jsPath = path.join(dir, file);
  if (!fs.existsSync(jsPath)) {
    console.warn('[bytecode] skip (not found):', file);
    continue;
  }
  const jscPath = jsPath.replace(/\.js$/, '.jsc');
  bytenode.compileFile({ filename: jsPath, output: jscPath, electron: true });
  const stub = `"use strict";\nrequire('bytenode');\nrequire(${JSON.stringify('./' + path.basename(jscPath))});\n`;
  fs.writeFileSync(jsPath, stub);
  console.log('[bytecode] compiled', file, '->', path.basename(jscPath));
}
