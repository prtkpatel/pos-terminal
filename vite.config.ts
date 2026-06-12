import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

// Renderer obfuscation runs as a POST-BUILD step (scripts/obfuscate-renderer.cjs) on the
// final bundle — doing it here as a per-module transform gets undone by esbuild's minify.
// Main + preload get stronger V8 bytecode protection via scripts/bytecode.cjs.
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['better-sqlite3-multiple-ciphers'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onclean: (options) => options.reload(),
      },
    ]),
    renderer(),
  ],
  build: {
    // No sourcemaps in production — don't ship a map that de-obfuscates the bundle.
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
