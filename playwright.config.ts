import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3931);

/** Browser E2E against the built app (`npm run build` first); each run starts on an empty data directory. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(port) },
  },
});
