import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5174', headless: true },
  webServer: {
    command: 'node scripts/dev.mjs --test',
    cwd: '..',
    url: 'http://127.0.0.1:5174',
    timeout: 120_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
