import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3005',
    httpCredentials: {
      username: 'driver-a',
      password: 'delivery-test-password',
    },
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
  },
  webServer: [
    {
      command: 'node test/mock-core.mjs',
      url: 'http://127.0.0.1:4010/api/logistics/driver/trips',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:3005',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
