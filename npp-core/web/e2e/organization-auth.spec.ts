import { test, expect, type APIRequestContext } from '@playwright/test';

async function expectBasicAuthRequired(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  expect(response.status()).toBe(401);
  expect(response.headers()['www-authenticate']).toContain('Basic');
  const payload = await response.json();
  expect(payload).toMatchObject({
    error: {
      code: 'UNAUTHORIZED',
    },
  });
}

test.describe('Organization gateway authentication', () => {
  test('rejects unauthenticated browser API access', async ({ request }) => {
    await expectBasicAuthRequired(request, '/api/organization/branches');
  });

  test('rejects unauthenticated access through the nested Vercel build path', async ({ request }) => {
    await expectBasicAuthRequired(request, '/npp-core/web/api/organization/branches');
  });
});
