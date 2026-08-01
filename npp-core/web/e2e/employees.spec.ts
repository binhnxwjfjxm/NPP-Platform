import { test, expect } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

test.describe('Danh mục nhân sự', () => {
  test('tạo, sửa, lọc và cập nhật trạng thái nhân sự', async ({ page }) => {
    const suffix = uniqueSuffix();
    const branchCode = `BR-${suffix}`;
    const branchName = `Chi nhánh nhân sự ${suffix}`;
    const employeeCode = `NV-${suffix}`;
    const employeeName = `Nguyễn Văn ${suffix}`;

    await page.goto('/organization/branches');
    await page.getByTestId('branches-topbar-create-button').click();
    await page.getByTestId('branch-code-input').fill(branchCode.toLowerCase());
    await page.getByTestId('branch-name-input').fill(branchName);
    await page.getByRole('button', { name: 'Tạo chi nhánh' }).click();
    await expect(page.getByTestId(`branch-row-${branchCode}`)).toBeVisible();

    await page.goto('/access/employees');
    await expect(page.getByTestId('employees-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Danh mục nhân sự', exact: true })).toBeVisible();
    await expect(page.getByTestId('access-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-employees')).toBeVisible();

    await page.getByTestId('employees-search-input').fill(`KHONG-KHOP-${suffix}`);
    await page.getByTestId('employees-status-filter').selectOption('inactive');
    await page.getByTestId('employees-branch-filter').selectOption('unassigned');

    await page.getByTestId('employees-topbar-create-button').click();
    await page.getByTestId('employee-code-input').fill(employeeCode.toLowerCase());
    await page.getByTestId('employee-name-input').fill(employeeName);
    await page.getByTestId('employee-title-input').fill('Kế toán kho');
    await page.getByTestId('employee-branch-select').selectOption({ label: `${branchCode} · ${branchName}` });
    await page.getByTestId('employee-phone-input').fill('0901234567');
    await page.getByTestId('employee-email-input').fill(`employee-${suffix.toLowerCase()}@example.com`);
    await page.getByRole('button', { name: 'Tạo hồ sơ' }).click();

    const row = page.getByTestId(`employee-row-${employeeCode}`);
    await expect(page.getByTestId('employees-search-input')).toHaveValue('');
    await expect(page.getByTestId('employees-status-filter')).toHaveValue('all');
    await expect(page.getByTestId('employees-branch-filter')).toHaveValue('all');
    await expect(row).toBeVisible();
    await expect(row).toContainText(employeeName);
    await expect(row).toContainText('Kế toán kho');
    await expect(row).toContainText(branchName);
    await expect(row).toContainText('Đang làm việc');

    await page.getByTestId('nav-users').click();
    await expect(page).toHaveURL(/\/access\/users$/);
    await page.getByTestId('nav-employees').click();
    await expect(page).toHaveURL(/\/access\/employees$/);
    await expect(row).toBeVisible();
    await expect(row).toContainText(employeeName);

    await page.getByTestId('employees-search-input').fill(employeeCode);
    await expect(row).toBeVisible();
    await page.getByTestId('employees-status-filter').selectOption('active');
    await expect(row).toBeVisible();
    await page.getByTestId('employees-branch-filter').selectOption({ label: `${branchCode} · ${branchName}` });
    await expect(row).toBeVisible();

    await page.getByTestId(`edit-employee-${employeeCode}`).click();
    await page.getByTestId('employee-title-input').fill('Kế toán kho cấp cao');
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(row).toContainText('Kế toán kho cấp cao');

    await page.getByTestId('nav-users').click();
    await expect(page).toHaveURL(/\/access\/users$/);
    await page.getByTestId('nav-employees').click();
    await expect(page).toHaveURL(/\/access\/employees$/);
    await expect(row).toContainText('Kế toán kho cấp cao');

    await page.getByTestId(`toggle-employee-${employeeCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await page.getByTestId('employees-status-filter').selectOption('inactive');
    await expect(row).toContainText('Ngừng hoạt động');

    await page.getByTestId('nav-users').click();
    await expect(page).toHaveURL(/\/access\/users$/);
    await page.getByTestId('nav-employees').click();
    await expect(page).toHaveURL(/\/access\/employees$/);
    await expect(row).toContainText('Ngừng hoạt động');

    await page.getByTestId(`toggle-employee-${employeeCode}`).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await page.getByTestId('employees-status-filter').selectOption('all');
    await expect(row).toContainText('Đang làm việc');
  });
});