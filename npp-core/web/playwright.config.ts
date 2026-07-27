import { defineConfig, devices } from '@playwright/test';

function requiredTestEnv(name: 'E2E_DATABASE_URL' | 'E2E_BACKEND_API_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required E2E environment variable: ${name}`);
  return value;
}

const databaseUrl = requiredTestEnv('E2E_DATABASE_URL');
const backendToken = requiredTestEnv('E2E_BACKEND_API_TOKEN');
const webAdminUsername = 'e2e-admin';
const webAdminPassword = 'e2e-password';
const apiEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3004',
  INSTALLATION_ID: 'e2e-installation',
  DATABASE_URL: databaseUrl,
  DATABASE_SSL_MODE: 'disable',
  BACKEND_API_TOKEN: backendToken,
  CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:e2e',
  CORS_ORIGINS: 'http://127.0.0.1:3003,http://127.0.0.1:3005',
  R2_ENABLED: 'false',
  R2_CONTRACT_ROUTE_ENABLED: 'false',
};
const commonWebEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  NEXT_PUBLIC_CORE_API_URL: 'http://127.0.0.1:3004',
  NEXT_PUBLIC_APP_NAME: 'NPP Core',
  CORE_API_INTERNAL_URL: 'http://127.0.0.1:3004',
  CORE_API_SERVER_TOKEN: backendToken,
  CORE_WEB_ADMIN_USERNAME: webAdminUsername,
  CORE_WEB_ADMIN_PASSWORD: webAdminPassword,
  FOUNDATION_R2_TEST_ENABLED: 'false',
};
const authenticatedBrowser = {
  ...devices['Desktop Chrome'],
  baseURL: 'http://127.0.0.1:3003',
  httpCredentials: { username: webAdminUsername, password: webAdminPassword },
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'routes', testMatch: /routes\.spec\.ts/, use: authenticatedBrowser },
    { name: 'organization', testMatch: /organization\.spec\.ts/, use: authenticatedBrowser },
    { name: 'catalog', testMatch: /(products|pricing|document-numbering)\.spec\.ts/, use: authenticatedBrowser },
    { name: 'organization-auth', testMatch: /organization-auth\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3003' } },
    { name: 'foundation-disabled', testMatch: /foundation-disabled\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3003' } },
    { name: 'foundation-enabled', testMatch: /foundation\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3005' } },
  ],
  webServer: [
    {
      command: 'npm --prefix ../api run dev',
      url: 'http://127.0.0.1:3004/health/live',
      reuseExistingServer: false,
      env: apiEnvironment,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:3003',
      reuseExistingServer: false,
      env: { ...commonWebEnvironment, PORT: '3003', FOUNDATION_TEST_UI_ENABLED: 'false' },
      timeout: 120_000,
    },
    {
      command: 'npx next dev -p 3005 -H 127.0.0.1',
      url: 'http://127.0.0.1:3005',
      reuseExistingServer: false,
      env: { ...commonWebEnvironment, PORT: '3005', FOUNDATION_TEST_UI_ENABLED: 'true' },
      timeout: 120_000,
    },
  ],
});
