import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as setup } from '@playwright/test';
import {
  E2E_WORKFORCE_AUTH_STATE,
  E2E_WORKFORCE_EMPLOYEE_ID,
  E2E_WORKFORCE_LOGIN,
  E2E_WORKFORCE_USER_ID,
  deriveWorkforceE2ECredentials,
} from './workforce-auth-fixture';

function required(name: 'E2E_DATABASE_URL' | 'E2E_BACKEND_API_TOKEN') {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required E2E environment variable: ${name}`);
  return value;
}

setup('create canonical workforce session', async ({ request }) => {
  const databaseUrl = required('E2E_DATABASE_URL');
  const seed = required('E2E_BACKEND_API_TOKEN');
  const { password, ownerCode } = deriveWorkforceE2ECredentials(seed);
  const prepareScript = fileURLToPath(
    new URL('../../api/scripts/prepare-workforce-e2e.js', import.meta.url),
  );

  execFileSync(process.execPath, [prepareScript], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      DATABASE_SSL_MODE: process.env.E2E_DATABASE_SSL_MODE?.trim() || 'disable',
      INSTALLATION_ID: 'e2e-installation',
      E2E_WORKFORCE_EMPLOYEE_ID,
      E2E_WORKFORCE_USER_ID,
      E2E_WORKFORCE_LOGIN,
      E2E_WORKFORCE_PASSWORD: password,
    },
    stdio: 'pipe',
  });

  const login = await request.post('/api/auth/login', {
    form: {
      username: E2E_WORKFORCE_LOGIN,
      password,
      ownerCode,
      returnTo: '/',
    },
    maxRedirects: 0,
  });
  expect(login.status()).toBe(303);
  expect(login.headers().location).toBe('/');

  const protectedResponse = await request.get('/api/organization/branches', { maxRedirects: 0 });
  expect(protectedResponse.status()).toBe(200);

  mkdirSync(dirname(E2E_WORKFORCE_AUTH_STATE), { recursive: true });
  await request.storageState({ path: E2E_WORKFORCE_AUTH_STATE });
});
