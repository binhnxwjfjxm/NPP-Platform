import { test, expect } from '@playwright/test';

test.describe('Organization gateway authentication', () => {
  test('rejects unauthenticated browser API access', async ({ request }) => {
    const response = await request.get('/api/organization/branches');
    expect(response.status()).toBe(401);
    expect(response.headers()['www-authenticate']).toContain('Basic');
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'UNAUTHORIZED',
      },
    });
  });
});
