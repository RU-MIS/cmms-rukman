import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const chromium = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: '.',
  testMatch: /browser\.spec\.mjs$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], launchOptions: chromium ? { executablePath: chromium } : {}, trace: 'retain-on-failure' },
  outputDir: './test-results'
});
