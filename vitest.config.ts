import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The Colyseus client is a devDependency of the server package only, so tests at the
      // repository root cannot resolve it by name. tests/tsconfig.json mirrors this for types.
      'colyseus.js': fileURLToPath(
        new URL('./apps/server/node_modules/colyseus.js/build/esm/index.mjs', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // Colyseus loads @pm2/io, which writes its own messages to the parent IPC channel
    // whenever one exists. In the default forked pool that channel is Vitest's, and the
    // run aborts. Worker threads have no IPC channel, so the server can start inside tests.
    pool: 'threads',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
