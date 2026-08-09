import { test, expect } from '@playwright/test';

test.describe('Organization gateway authentication', () => {
  test('rejects unauthenticated browser API access', async ({ request }) => {
    const response = await request.get('/api/organization/branches');
    expect(response.status()).toBe(401);
    expect(response.headers()['www-authenticate']).toBeUndefined();
    const payload = await response.json();
    expect(payload).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  test('redirects unauthenticated workspaces to login and rejects access APIs', async ({ page, request }) => {
    const pageResponse = await page.goto('/access/roles');
    expect(pageResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login\?returnTo=%2Faccess%2Froles$/);
    await expect(page.getByRole('heading', { name: 'Đăng nhập hệ thống' })).toBeVisible();

    const apiResponse = await request.get('/api/access/roles');
    expect(apiResponse.status()).toBe(401);
    expect(apiResponse.headers()['www-authenticate']).toBeUndefined();
    const payload = await apiResponse.json();
    expect(payload).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });
});
