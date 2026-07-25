import { test, expect, type Page } from '@playwright/test';

async function expectHealthyRoute(page: Page, path: string) {
  const browserErrors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === 'http://127.0.0.1:3003' && /\.(?:css|js|woff2?|png|jpe?g|webp|svg)(?:\?|$)/i.test(url.pathname) && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${url.pathname}`);
    }
  });

  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');
  expect(browserErrors).toEqual([]);
  expect(failedAssets).toEqual([]);
}

test.describe('Core web route smoke', () => {
  test('landing page loads cleanly', async ({ page }) => {
    await expectHealthyRoute(page, '/');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('login page loads cleanly', async ({ page }) => {
    await expectHealthyRoute(page, '/login');
  });

  test('dashboard page follows its current render contract', async ({ page }) => {
    await expectHealthyRoute(page, '/dashboard');
  });

  test('organization page loads cleanly', async ({ page }) => {
    await expectHealthyRoute(page, '/organization');
    await expect(page.getByTestId('organization-page')).toBeVisible();
  });

  test('same-origin static assets are present and load', async ({ page }) => {
    await page.goto('/');
    const assets = page.locator('link[rel="stylesheet"], script[src]');
    expect(await assets.count()).toBeGreaterThan(0);
  });

  test('landing HTML excludes credential-shaped data', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).not.toContain('postgresql://');
    expect(html).not.toContain('CORE_API_SERVER_TOKEN');
    expect(html).not.toContain('R2_SECRET_ACCESS_KEY');
    expect(html).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]+/i);
  });
});
