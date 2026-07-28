import { test, expect } from '@playwright/test';

test.describe('Kho vận không auth', () => {
  test('chặn route inventory và API inventory khi chưa đăng nhập', async ({ page, request }) => {
    const pageResponse = await page.goto('/inventory/balances');
    expect(pageResponse?.status()).toBe(401);
    expect(pageResponse?.headers()['www-authenticate']).toContain('Basic');

    const apiResponse = await request.get('/api/inventory/tracking-policies');
    expect(apiResponse.status()).toBe(401);
    expect(apiResponse.headers()['www-authenticate']).toContain('Basic');

    const postResponse = await request.post('/api/inventory/opening-balances/post', {
      data: {
        sourceKey: 'inventory-auth',
        contentChecksum: '0'.repeat(64),
        documentDate: '2026-07-28',
        rows: [],
      },
    });
    expect(postResponse.status()).toBe(401);
    expect(postResponse.headers()['www-authenticate']).toContain('Basic');
  });
});
