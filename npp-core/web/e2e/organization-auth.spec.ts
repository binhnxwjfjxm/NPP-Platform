import { test, expect } from '@playwright/test';

test.describe('Organization gateway authentication', () => {
  test('rejects unauthenticated browser API access', async ({ request }) => {
    const response = await request.get('/api/organization/branches');
    expect(response.status()).toBe(401);
    expect(response.headers()['www-authenticate']).toContain('Basic');
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: {
        code: 'UNAUTHORIZED',
      },
    });
  });

  test('rejects unauthenticated role workspace and access API access', async ({ page, request }) => {
    const pageResponse = await page.goto('/access/roles');
    expect(pageResponse?.status()).toBe(401);
    expect(pageResponse?.headers()['www-authenticate']).toContain('Basic');

    const apiResponse = await request.get('/api/access/roles');
    expect(apiResponse.status()).toBe(401);
    expect(apiResponse.headers()['www-authenticate']).toContain('Basic');
    const payload = await apiResponse.json();
    expect(payload).toMatchObject({
      error: {
        code: 'UNAUTHORIZED',
      },
    });
  });
});
