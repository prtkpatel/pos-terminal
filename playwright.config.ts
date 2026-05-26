import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright config for Electron E2E tests (Cashier Simulator)
 * @see https://playwright.dev/docs/api/class-electron
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,          // Electron app tests should run sequentially
  workers: 1,                    // One worker — one app instance at a time
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
