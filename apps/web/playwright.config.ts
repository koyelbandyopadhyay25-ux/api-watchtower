import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  maxFailures: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:5173', channel: 'msedge', headless: true, trace: 'retain-on-failure' },
  outputDir: 'test-results',
  reporter: 'list',
});
