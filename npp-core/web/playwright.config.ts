import { defineConfig, devices } from '@playwright/test';

function requiredTestEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required E2E environment variable: ${name}`);
  }

  return value;
}

const E2E_DATABASE_URL = requiredTestEnv('E2E_DATABASE_URL');
const E2E_BACKEND_API_TOKEN = requiredTestEnv('E2E_BACKEND_API_TOKEN');

/**
 * Playwright configuration for Core UI and browser verification tests
 * 
 * Tests run against:
 * - Core Web: http://localhost:3003
 * - Core API: http://localhost:3004 (started before tests)
 * - PostgreSQL: ephemeral service (in CI) or local test instance
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
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3004',
        INSTALLATION_ID: 'e2e-installation',
        DATABASE_URL: E2E_DATABASE_URL,
        DATABASE_SSL_MODE: 'disable',
        BACKEND_API_TOKEN: E2E_BACKEND_API_TOKEN,
        CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:e2e',
        CORS_ORIGINS: 'http://127.0.0.1:3003',
        R2_ENABLED: 'false',
        R2_CONTRACT_ROUTE_ENABLED: 'false',
      },
      timeout: 120 * 1000,
    },
    // Core Web starts second
    {
      command: 'npm --workspace npp-core-web run dev',
      url: 'http://127.0.0.1:3003',
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3003',
        NEXT_PUBLIC_CORE_API_URL: 'http://127.0.0.1:3004',
        NEXT_PUBLIC_INSTALLATION_ID: 'e2e-installation',
        CORE_API_INTERNAL_URL: 'http://127.0.0.1:3004',
        CORE_API_SERVER_TOKEN: E2E_BACKEND_API_TOKEN,
        FOUNDATION_TEST_UI_ENABLED: 'true',
        FOUNDATION_R2_TEST_ENABLED: 'false',
      },
      timeout: 120 * 1000,
    },
  ],
});
