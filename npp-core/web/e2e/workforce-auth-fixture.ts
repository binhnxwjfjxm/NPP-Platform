import { createHash } from 'node:crypto';

export const E2E_WORKFORCE_EMPLOYEE_ID = '91111111-1111-4111-8111-111111111111';
export const E2E_WORKFORCE_USER_ID = '92222222-2222-4222-8222-222222222222';
export const E2E_WORKFORCE_LOGIN = 'e2e.workforce';
export const E2E_WORKFORCE_AUTH_STATE = 'test-results/.auth/workforce.json';

export function deriveWorkforceE2ECredentials(seed: string) {
  const normalized = seed.trim();
  if (!normalized) throw new Error('Missing E2E workforce credential seed');
  const digest = (purpose: string) => createHash('sha256')
    .update(`${purpose}:${normalized}`)
    .digest('hex');
  return Object.freeze({
    password: `E2E-${digest('password').slice(0, 24)}-Aa9!`,
    ownerCode: digest('owner-code').slice(0, 16),
  });
}
