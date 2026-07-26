import { test, expect, type Page } from '@playwright/test';

const TEST_TOKEN_MARKER = process.env.E2E_BACKEND_API_TOKEN ?? '';
const TEST_DATABASE_MARKER = process.env.E2E_DATABASE_URL ?? '';

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

function expectNoSensitiveData(value: string) {
  expect(value).not.toContain('Authorization');
  expect(value).not.toContain('CORE_API_SERVER_TOKEN');
  expect(value).not.toContain('CORE_API_INTERNAL_URL');
  expect(value).not.toContain('postgresql://');
  expect(value).not.toContain('r2.cloudflarestorage.com');
  expect(value).not.toContain('X-Amz-Signature');
  if (TEST_TOKEN_MARKER) expect(value).not.toContain(TEST_TOKEN_MARKER);
  if (TEST_DATABASE_MARKER) expect(value).not.toContain(TEST_DATABASE_MARKER);
}

function expectNoEnglishMainFlow(value: string) {
  expect(value).not.toMatch(/\bDashboard\b/);
  expect(value).not.toMatch(/\bOrganization\b/);
  expect(value).not.toMatch(/\bPlaceholder\b/);
  expect(value).not.toMatch(/\bRefresh\b/);
  expect(value).not.toMatch(/\bCreate\b/);
  expect(value).not.toMatch(/\bLoading\b/);
  expect(value).not.toMatch(/\bActive\b/);
  expect(value).not.toMatch(/\bInactive\b/);
}

test.describe('Core web route smoke', () => {
  test('root route redirects into the dashboard shell', async ({ page }) => {
    await expectHealthyRoute(page, '/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
  });

  test('login page loads cleanly in Vietnamese', async ({ page }) => {
    await expectHealthyRoute(page, '/login');
    await expect(page.getByRole('heading', { name: 'Đăng nhập để vào không gian quản trị' })).toBeVisible();
    expectNoSensitiveData(await page.content());
  });

  test('dashboard page follows the new organization shell contract', async ({ page }) => {
    await expectHealthyRoute(page, '/dashboard');
    await expect(page.getByTestId('organization-overview-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tổng quan', exact: true })).toBeVisible();
    expectNoSensitiveData(await page.content());
    expectNoEnglishMainFlow(await page.locator('body').innerText());
  });

  test('organization overview page loads cleanly', async ({ page }) => {
    await expectHealthyRoute(page, '/organization');
    await expect(page.getByTestId('organization-overview-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tổ chức', exact: true })).toBeVisible();
    expectNoSensitiveData(await page.content());
    expectNoEnglishMainFlow(await page.locator('body').innerText());
  });

  test('same-origin static assets are present and load', async ({ page }) => {
    await page.goto('/dashboard');
    const assets = page.locator('link[rel="stylesheet"], script[src]');
    expect(await assets.count()).toBeGreaterThan(0);
  });
});
