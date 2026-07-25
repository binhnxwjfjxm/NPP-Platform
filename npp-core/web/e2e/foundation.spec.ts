import { test, expect } from '@playwright/test';

/**
 * Foundation UI browser verification tests
 * 
 * Disabled mode uses baseURL http://127.0.0.1:3003.
 * Enabled mode uses baseURL http://127.0.0.1:3005.
 */

test.describe('Foundation UI disabled', () => {
  test('foundation UI returns 404 when disabled', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'disabled', 'Disabled project only');

    const response = await page.goto('/foundation');
    expect(response?.status()).toBe(200);

    await expect(page.locator('text=Foundation UI is not enabled in this environment')).toBeVisible();
    await expect(page.locator('text=Core API Status')).not.toBeVisible();
  });

  test('foundation API status endpoint returns 404 when disabled', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'disabled', 'Disabled project only');

    const response = await context.request.get('/api/foundation/status');
    expect(response.status()).toBe(404);
  });

  test('foundation R2 test endpoint returns 404 when disabled', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'disabled', 'Disabled project only');

    const response = await context.request.post('/api/foundation/r2-test', {
      data: { test: true },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe('Foundation UI enabled', () => {
  test('foundation status page loads and displays safe data', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    const response = await page.goto('/foundation');
    expect(response?.status()).toBe(200);

    await expect(page.locator('text=NPP Core — Foundation Status')).toBeVisible();
    await expect(page.locator('text=Core API Status')).toBeVisible();
    await expect(page.locator('text=Authenticated Context')).toBeVisible();
    await expect(page.locator('text=Sanitized Configuration')).toBeVisible();
  });

  test('foundation status displays API status safely', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    await page.goto('/foundation');
    await expect(page.locator('text=Live:')).toBeVisible();
    await expect(page.locator('text=Ready:')).toBeVisible();
  });

  test('foundation status displays context without backend token', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    await page.goto('/foundation');
    const content = await page.content();

    expect(content).not.toContain('Bearer');
    expect(content).not.toContain('CORE_API_INTERNAL_URL');
    expect(content).not.toContain('CORE_API_SERVER_TOKEN');
  });

  test('foundation does not leak R2 credentials', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    await page.goto('/foundation');
    const content = await page.content();

    expect(content).not.toContain('r2.cloudflarestorage.com');
  });

  test('foundation does not leak database URLs', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    await page.goto('/foundation');
    const content = await page.content();

    expect(content).not.toContain('postgresql://');
  });

  test('foundation does not show signed URLs', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    await page.goto('/foundation');
    const content = await page.content();

    expect(content).not.toContain('X-Amz-Signature');
    expect(content).not.toContain('X-Amz-Credential');
  });

  test('client-side spoofing headers are ignored', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    await context.setExtraHTTPHeaders({
      'x-actor-id': 'spoofed-actor',
      'x-installation-id': 'spoofed-installation',
    });

    const response = await context.request.get('/api/foundation/status', {
      headers: {
        'x-actor-id': 'spoofed-actor',
        'x-installation-id': 'spoofed-installation',
      },
    });

    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test('foundation handles gateway failures gracefully', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    await page.goto('/foundation');
    await expect(page.locator('text=NPP Core — Foundation Status')).toBeVisible();
    await expect(page.locator('text=Core API Status')).toBeVisible();
  });

  test('foundation API status endpoint returns safe response', async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    const response = await context.request.get('/api/foundation/status');
    expect(response.ok()).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty('apiLive');
    expect(data).toHaveProperty('apiReady');
    expect(data).toHaveProperty('authenticatedContext');
    expect(data).toHaveProperty('sanitizedConfig');
    expect(data).toHaveProperty('r2State');
    expect(data).toHaveProperty('serverTimestamp');

    const json = JSON.stringify(data);
    expect(json).not.toContain('CORE_API_SERVER_TOKEN');
  });

  test('no uncaught console errors on foundation page', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'enabled', 'Enabled project only');

    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/foundation');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});

