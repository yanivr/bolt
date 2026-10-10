import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.BOLT_E2E_PORT ?? 2567);

/**
 * End-to-end tests run the production build: the game server serves the built client on one
 * port, exactly as it does in deployment. Run `pnpm build` first.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    trace: 'retain-on-failure',
    launchOptions: {
      // Software GL keeps WebGL available on CI machines without a GPU.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'node apps/server/dist/main.js',
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'development',
      GUEST_TOKEN_SECRET: 'e2e-only-secret-000000000000000000000000',
      LOG_LEVEL: 'warn',
    },
  },
});
