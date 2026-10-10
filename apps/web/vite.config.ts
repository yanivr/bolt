import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const SERVER = process.env.BOLT_SERVER_URL ?? 'http://localhost:2567';

// Relative base so the same build runs from a domain root, a sub-path, or a static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@bolt/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@bolt/content': fileURLToPath(
        new URL('../../packages/content/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: SERVER },
      '/matchmake': { target: SERVER },
      // Colyseus room sockets live at /<processId>/<roomId>; proxy every upgrade that is not
      // Vite's own HMR socket.
      '^/[A-Za-z0-9_-]{6,}/[A-Za-z0-9_-]{6,}': { target: SERVER, ws: true },
    },
  },
  build: {
    target: 'es2022',
    assetsDir: 'app',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'], react: ['react', 'react-dom', 'zustand'] },
      },
    },
  },
});
