import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const chromium = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  globalSetup: './global-setup.mjs',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  outputDir: './test-results',
  webServer: { command: 'node ui/static-server.mjs ../web/out 4173', url: 'http://127.0.0.1:4173/login/', reuseExistingServer: true, cwd: '..' },
});
