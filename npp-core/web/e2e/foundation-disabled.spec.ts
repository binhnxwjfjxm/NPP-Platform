import { test, expect } from '@playwright/test';

test.describe('Foundation UI disabled by default', () => {
  test('foundation page is hidden', async ({ page }) => {
    const response = await page.goto('/foundation');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /NPP Platform readiness/i })).toHaveCount(0);
  });

  test('foundation status gateway is hidden', async ({ request }) => {
    const response = await request.get('/api/foundation/status');
    expect(response.status()).toBe(404);
  });

  test('foundation R2 gateway is hidden', async ({ request }) => {
    const response = await request.post('/api/foundation/r2-test');
    expect(response.status()).toBe(404);
  });
});
