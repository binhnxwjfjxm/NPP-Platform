import { defineConfig, devices } from '@playwright/test';
import {
  E2E_WORKFORCE_AUTH_STATE,
  deriveWorkforceE2ECredentials,
} from './e2e/workforce-auth-fixture';

function requiredTestEnv(name: 'E2E_DATABASE_URL' | 'E2E_BACKEND_API_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required E2E environment variable: ${name}`);
  return value;
}

const databaseUrl = requiredTestEnv('E2E_DATABASE_URL');
const backendToken = requiredTestEnv('E2E_BACKEND_API_TOKEN');
const { ownerCode } = deriveWorkforceE2ECredentials(backendToken);
const apiEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3004',
  INSTALLATION_ID: 'e2e-installation',
  DATABASE_URL: databaseUrl,
  DATABASE_SSL_MODE: process.env.E2E_DATABASE_SSL_MODE?.trim() || 'disable',
  BACKEND_API_TOKEN: backendToken,
  CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:e2e',
  CORS_ORIGINS: 'http://127.0.0.1:3003,http://127.0.0.1:3005',
  R2_ENABLED: 'false',
  R2_CONTRACT_ROUTE_ENABLED: 'false',
  INTERNAL_AUTH_ENABLED: 'true',
  INTERNAL_SESSION_TTL_SECONDS: '3600',
  INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED: 'true',
  ALLOW_FIXED_OWNER_CODE: 'true',
  SECURITY_OWNER_TEST_CODE: ownerCode,
};
const commonWebEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  NEXT_PUBLIC_CORE_API_URL: 'http://127.0.0.1:3004',
  NEXT_PUBLIC_APP_NAME: 'NPP Core',
  CORE_API_INTERNAL_URL: 'http://127.0.0.1:3004',
  FOUNDATION_R2_TEST_ENABLED: 'false',
};
const authenticatedUse = (baseURL: string) => ({
  ...devices['Desktop Chrome'],
  baseURL,
  storageState: E2E_WORKFORCE_AUTH_STATE,
});
const authenticatedDependency = ['workforce-auth-setup'];

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
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'workforce-auth-setup',
      testMatch: /workforce-auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3003' },
    },
    {
      name: 'routes',
      testMatch: /(routes|cod-reconciliation|sales-settlement-reconciliation)\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'management',
      testMatch: /management\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'organization',
      testMatch: /organization\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'customers',
      testMatch: /customers\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'suppliers',
      testMatch: /suppliers\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'catalog',
      testMatch: /products\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'document-numbering',
      testMatch: /document-numbering\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'pricing-financial',
      testMatch: /pricing\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'inventory',
      testMatch: /inventory\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'purchasing',
      testMatch: /(purchase-orders|goods-receipts|supplier-returns)\.spec\.ts/,
      dependencies: ['workforce-auth-setup', 'organization', 'suppliers', 'catalog'],
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'sales-order-commercial',
      testMatch: /sales-orders-(commercial|price-recovery)\.spec\.ts/,
      dependencies: ['workforce-auth-setup', 'organization'],
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'organization-auth',
      testMatch: /organization-auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3003' },
    },
    {
      name: 'inventory-auth',
      testMatch: /inventory-auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3003' },
    },
    {
      name: 'foundation-disabled',
      testMatch: /foundation-disabled\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3003'),
    },
    {
      name: 'foundation-enabled',
      testMatch: /foundation\.spec\.ts/,
      dependencies: authenticatedDependency,
      use: authenticatedUse('http://127.0.0.1:3005'),
    },
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
