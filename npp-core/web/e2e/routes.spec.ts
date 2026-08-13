import { test, expect, type Page } from '@playwright/test';

const TEST_TOKEN_MARKER = process.env.E2E_BACKEND_API_TOKEN ?? '';
const TEST_DATABASE_MARKER = process.env.E2E_DATABASE_URL ?? '';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

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
    await expect(page.getByRole('heading', { name: 'Tổng quan điều hành', exact: true })).toBeVisible();
  });

  test('login page loads cleanly in Vietnamese', async ({ page }) => {
    await expectHealthyRoute(page, '/login');
    await expect(page.getByRole('heading', { name: 'Đăng nhập hệ thống', exact: true })).toBeVisible();
    await expect(page.getByText('Hưng Phát Company')).toBeVisible();
    expectNoSensitiveData(await page.content());
  });

  test('dashboard page follows the office shell contract', async ({ page }) => {
    await expectHealthyRoute(page, '/dashboard');
    await expect(page.getByTestId('dashboard-launchpad-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tổng quan điều hành', exact: true })).toBeVisible();
    await expect(page.getByTestId('dashboard-shortcut-purchasing-goods-receipts')).toHaveAttribute('href', '/purchasing/goods-receipts');
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

  test('accounting menu opens on accounting routes and survives sidebar collapse', async ({ page }) => {
    await expectHealthyRoute(page, '/accounting/payables');
    await expect(page.getByRole('heading', { name: 'Công nợ phải trả', exact: true })).toBeVisible();
    await expect(page.getByTestId('accounting-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-payables')).toBeVisible();
    await expect(page.getByTestId('nav-supplier-payments')).toBeVisible();

    await page.getByTestId('sidebar-collapse-button').click();
    await expect(page.locator('[data-collapsed="true"]')).toBeVisible();

    await page.getByTestId('accounting-menu-toggle').click();
    await expect(page.locator('[data-collapsed="false"]')).toBeVisible();
    await expect(page.getByTestId('nav-payables')).toBeVisible();
  });

  test('accounting menu remains reachable from the mobile hamburger', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectHealthyRoute(page, '/accounting/payables');
    await page.getByRole('button', { name: 'Mở thanh điều hướng' }).click();
    await expect(page.getByTestId('accounting-menu-toggle')).toBeVisible();
    await expect(page.getByTestId('accounting-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-payables')).toBeVisible();
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

  test('role and permission workspace loads through the nested access menu without browser-side initial reload', async ({ page }) => {
    const browserAccessGets: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        request.method() === 'GET'
        && url.origin === 'http://127.0.0.1:3003'
        && url.pathname.startsWith('/api/access/')
      ) {
        browserAccessGets.push(`${url.pathname}${url.search}`);
      }
    });

    await expectHealthyRoute(page, '/access/roles');
    await expect(page.getByTestId('roles-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vai trò & phân quyền', exact: true })).toBeVisible();
    await expect(page.getByTestId('access-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-roles')).toBeVisible();
    expectNoSensitiveData(await page.content());
    expectNoEnglishMainFlow(await page.locator('body').innerText());
    expect(browserAccessGets).toEqual([]);
  });

  test('role and permission workspace supports create, edit, filter, toggle, and stale conflict handling', async ({ page }) => {
    const suffix = uniqueSuffix();
    const roleCode = `RL-${suffix}`;
    const initialName = `Vai trò ${suffix}`;
    const updatedName = `Vai trò ${suffix} đã sửa`;
    let conflictPage;

    await page.goto('/access/roles');
    await expect(page.getByTestId('roles-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vai trò & phân quyền', exact: true })).toBeVisible();

    await page.getByTestId('roles-topbar-create-button').click();
    const editorDialog = page.getByRole('dialog');
    await expect(editorDialog.getByRole('heading', { name: 'Thêm vai trò quản trị', exact: true })).toBeVisible();
    await expect(editorDialog.getByText('Phạm vi quyền', { exact: true })).toBeVisible();
    await expect(editorDialog.getByRole('heading', { name: 'Chọn quyền theo nhóm chức năng', exact: true })).toBeVisible();
    await expect(editorDialog.getByText('Mã vai trò', { exact: true })).toBeVisible();

    await page.getByTestId('role-code-input').fill(roleCode.toLowerCase());
    await page.getByTestId('role-name-input').fill(initialName);
    await page.getByTestId('role-description-input').fill(`Mô tả ${suffix}`);
    const roleReadPermission = page.getByTestId('permission-core.role.read');
    const permissionReadPermission = page.getByTestId('permission-core.permission.read');
    await roleReadPermission.evaluate((element) => {
      (element as HTMLInputElement).click();
    });
    await permissionReadPermission.evaluate((element) => {
      (element as HTMLInputElement).click();
    });
    await page.getByRole('button', { name: 'Tạo vai trò' }).click();

    const row = page.getByTestId(`role-row-${roleCode}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(initialName);
    await expect(row).toContainText('2 quyền');
    await expect(row).toContainText('Đang hoạt động');

    await page.getByTestId('roles-search-input').fill(roleCode);
    await expect(row).toBeVisible();
    await page.getByTestId('roles-status-filter').selectOption('active');
    await expect(row).toBeVisible();
    await page.getByTestId('roles-status-filter').selectOption('inactive');
    await expect(row).toHaveCount(0);
    await page.getByTestId('roles-status-filter').selectOption('all');
    await page.getByTestId('roles-search-input').fill('');

    await page.getByTestId(`edit-role-${roleCode}`).click();
    await expect(page.getByTestId('role-code-input')).toHaveValue(roleCode);
    await page.getByTestId('role-name-input').fill(updatedName);
    await page.getByTestId('role-description-input').fill(`Mô tả ${suffix} đã sửa`);
    await page.getByTestId('permission-core.permission.read').evaluate((element) => {
      (element as HTMLInputElement).click();
    });
    await page.getByTestId('permission-core.role.write').evaluate((element) => {
      (element as HTMLInputElement).click();
    });
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();

    await expect(row).toContainText(updatedName);
    await expect(row).toContainText('2 quyền');

    await page.getByTestId(`toggle-role-${roleCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(row).toContainText('Ngừng hoạt động');

    await page.getByTestId('roles-status-filter').selectOption('inactive');
    await expect(row).toBeVisible();

    await page.getByTestId(`toggle-role-${roleCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await page.getByTestId('roles-status-filter').selectOption('all');
    await expect(row).toContainText('Đang hoạt động');

    await page.getByTestId(`edit-role-${roleCode}`).click();
    await page.getByTestId('role-name-input').fill(`${updatedName} chờ xung đột`);

    conflictPage = await page.context().newPage();
    await conflictPage.goto('/access/roles');
    await conflictPage.getByTestId(`edit-role-${roleCode}`).click();
    await conflictPage.getByTestId('role-name-input').fill(`${updatedName} xung đột`);
    await conflictPage.getByRole('button', { name: 'Lưu thay đổi' }).click();

    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.getByRole('status')).toContainText('Vai trò đang có thay đổi, vui lòng tải lại dữ liệu');

    await conflictPage.close();
  });

  test('same-origin static assets are present and load', async ({ page }) => {
    await page.goto('/dashboard');
    const assets = page.locator('link[rel="stylesheet"], script[src], img[src="/logo-transparent.png"]');
    expect(await assets.count()).toBeGreaterThan(0);
  });
});
