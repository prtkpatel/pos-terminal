/**
 * Cross-platform launcher: runs scripts/bytecode.cjs inside Electron's Node runtime
 * (ELECTRON_RUN_AS_NODE=1) so the produced .jsc matches the Electron V8 version.
 * Invoked from the `dist` npm script after `vite build`, before electron-builder.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const electronPath = require('electron'); // resolves to the Electron executable path

const result = spawnSync(electronPath, [path.join(__dirname, 'bytecode.cjs')], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

process.exit(result.status ?? 0);
