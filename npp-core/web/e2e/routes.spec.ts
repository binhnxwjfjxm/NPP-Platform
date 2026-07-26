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
    await expect(page.getByText('Hưng Phát Company')).toBeVisible();
    expectNoSensitiveData(await page.content());
  });

  test('dashboard page follows the office shell contract', async ({ page }) => {
    await expectHealthyRoute(page, '/dashboard');
    await expect(page.getByTestId('organization-overview-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tổng quan', exact: true })).toBeVisible();
    await expect(page.getByText('Hưng Phát Company')).toBeVisible();
    await expect(page.getByTestId('app-sidebar')).toHaveCSS('position', 'fixed');
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

  test('sidebar collapses and organization children remain nested', async ({ page }) => {
    await expectHealthyRoute(page, '/dashboard');

    await page.getByTestId('organization-menu-toggle').click();
    await expect(page.getByTestId('nav-branches')).toBeVisible();
    await expect(page.getByTestId('nav-warehouses')).toBeVisible();
    await expect(page.getByTestId('nav-locations')).toBeVisible();

    await page.getByTestId('sidebar-collapse-button').click();
    await expect(page.locator('[data-collapsed="true"]')).toBeVisible();

    await page.getByTestId('organization-menu-toggle').click();
    await expect(page.locator('[data-collapsed="false"]')).toBeVisible();
  });

  test('organization route navigation does not repeat browser-side list loading', async ({ page }) => {
    const browserGatewayGets: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        request.method() === 'GET'
        && url.origin === 'http://127.0.0.1:3003'
        && url.pathname.startsWith('/api/organization/')
      ) {
        browserGatewayGets.push(url.pathname);
      }
    });

    await expectHealthyRoute(page, '/dashboard');
    await page.getByTestId('organization-menu-toggle').click();
    await page.getByTestId('nav-branches').click();
    await expect(page).toHaveURL(/\/organization\/branches$/);
    await expect(page.getByTestId('branches-page')).toBeVisible();
    await page.waitForTimeout(250);
    expect(browserGatewayGets).toEqual([]);
  });

  test('employee directory loads through the nested access menu without browser-side initial reload', async ({ page }) => {
    const browserEmployeeGets: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.origin === 'http://127.0.0.1:3003' && url.pathname === '/api/access/employees') {
        browserEmployeeGets.push(url.pathname);
      }
    });

    await expectHealthyRoute(page, '/access/employees');
    await expect(page.getByTestId('employees-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Danh mục nhân sự', exact: true })).toBeVisible();
    await expect(page.getByTestId('access-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-employees')).toBeVisible();
    expectNoSensitiveData(await page.content());
    expectNoEnglishMainFlow(await page.locator('body').innerText());
    expect(browserEmployeeGets).toEqual([]);
  });

  test('same-origin static assets are present and load', async ({ page }) => {
    await page.goto('/dashboard');
    const assets = page.locator('link[rel="stylesheet"], script[src], img[src="/logo-transparent.png"]');
    expect(await assets.count()).toBeGreaterThan(0);
  });
});
