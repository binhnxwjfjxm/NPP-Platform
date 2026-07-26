import { test, expect, type Page } from '@playwright/test';

const TEST_TOKEN_MARKER = process.env.E2E_BACKEND_API_TOKEN ?? '';
const TEST_DATABASE_MARKER = process.env.E2E_DATABASE_URL ?? '';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function expectNoSensitiveData(value: string) {
  expect(value).not.toContain('Authorization');
  expect(value).not.toContain('CORE_API_SERVER_TOKEN');
  expect(value).not.toContain('CORE_API_INTERNAL_URL');
  expect(value).not.toContain('DATABASE_URL');
  expect(value).not.toContain('postgresql://');
  if (TEST_TOKEN_MARKER) expect(value).not.toContain(TEST_TOKEN_MARKER);
  if (TEST_DATABASE_MARKER) expect(value).not.toContain(TEST_DATABASE_MARKER);
}

async function postFixture<T>(page: Page, path: string, body: unknown, key: string): Promise<T> {
  return page.evaluate(async ({ path: requestPath, body: requestBody, key: requestKey }) => {
    const response = await fetch(requestPath, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': requestKey,
      },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${response.status} ${payload?.error?.code ?? ''} ${payload?.error?.message ?? ''}`);
    return payload.data as T;
  }, { path, body, key });
}

test.describe('User identity and role assignment workspace', () => {
  test('creates a zero-role user, assigns a role and keeps the modal inside the viewport', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    const unique = suffix();
    const employeeCode = `USR-${unique}`;
    const employeeName = `Nhân sự người dùng ${unique}`;
    const roleCode = `UR-${unique}`;
    const roleName = `Vai trò người dùng ${unique}`;
    const loginName = `user.${unique.toLowerCase()}`;

    await page.goto('/dashboard');
    await postFixture(page, '/api/access/employees', {
      code: employeeCode,
      fullName: employeeName,
      isActive: true,
    }, `e2e-user-employee-${unique}`);
    await postFixture(page, '/api/access/roles', {
      code: roleCode,
      name: roleName,
      description: `Vai trò kiểm thử ${unique}`,
      isActive: true,
      permissionKeys: [],
    }, `e2e-user-role-${unique}`);

    const response = await page.goto('/access/users');
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Người dùng', exact: true })).toBeVisible();
    await expect(page.getByTestId('access-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-users')).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole('button', { name: 'Thêm người dùng' }).click();

    const dialog = page.getByRole('dialog', { name: 'Thêm người dùng' });
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual((await page.viewportSize())?.height ?? 900);
    await expect(dialog.getByRole('heading', { name: 'Thêm người dùng', exact: true })).toBeVisible();

    await dialog.getByLabel('Tên đăng nhập').fill(loginName);
    await dialog.getByLabel('Nhân sự đang hoạt động chưa có tài khoản').selectOption({ label: `${employeeName} — ${employeeCode}` });
    await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();

    const row = page.getByRole('row').filter({ hasText: loginName });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Chưa gán vai trò');

    await row.getByRole('button', { name: 'Sửa', exact: true }).click();
    const editDialog = page.getByRole('dialog', { name: 'Cập nhật người dùng' });
    await expect(editDialog).toBeVisible();
    await editDialog.getByText(roleName, { exact: true }).click();
    await editDialog.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(row).toContainText(roleName);
    await expect(row).not.toContainText(roleCode);

    expectNoSensitiveData(await page.content());
    expect(browserErrors).toEqual([]);
  });

  test('user modal remains usable on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto('/access/users');
    await page.waitForLoadState('networkidle');

    const createButton = page.getByRole('button', { name: 'Thêm người dùng' });
    if (await createButton.isEnabled()) {
      await createButton.click();
      const dialog = page.getByRole('dialog', { name: 'Thêm người dùng' });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect(box?.width ?? 1000).toBeLessThanOrEqual(390);
      await expect(dialog.getByRole('heading', { name: 'Thêm người dùng', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Đóng' }).click();
    }

    expectNoSensitiveData(await page.content());
  });
});
