import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Core UI and browser verification tests
 * 
 * Tests run against:
 * - Core Web: http://localhost:3003
 * - Core API: http://localhost:3004 (started before tests)
 * - PostgreSQL: ephemeral service (in CI)
 * 
 * Secrets are never exposed to browser:
 * - CORE_API_SERVER_TOKEN is server-only (never in NEXT_PUBLIC_*)
 * - R2 credentials and endpoints not in browser
 * - Database URLs not accessible from browser
 */
export default defineConfig({
  testDir: './e2e',
  // Run all tests serially to avoid port conflicts
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 3 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
  ],

  use: {
    baseURL: 'http://127.0.0.1:3003',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start Core API and Core Web servers before tests
  webServer: [
    // Core API must start first (needed for health checks)
    {
      command: 'npm --workspace npp-core-api run dev',
      url: 'http://127.0.0.1:3004/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    // Core Web starts second
    {
      command: 'npm --workspace npp-core-web run dev',
      url: 'http://127.0.0.1:3003',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
});
