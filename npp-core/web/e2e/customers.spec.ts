import { test, expect } from '@playwright/test';

test.describe('Danh mục khách hàng', () => {
  test('thêm, sửa, lọc và bật/tắt khách hàng', async ({ page }) => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const customerCode = `CU-${suffix}`;
    let customerName = `Khách hàng ${suffix}`;

    await page.goto('/organization/customers');
    await expect(page.getByTestId('customers-page').getByRole('heading', { name: 'Khách hàng', exact: true })).toBeVisible();
    await expect(page.getByTestId('customers-page')).toBeVisible();

    await page.getByTestId('customers-topbar-create-button').click();
    await page.getByTestId('customer-code-input').fill(customerCode.toLowerCase());
    await page.getByTestId('customer-name-input').fill(customerName);
    await page.getByTestId('customer-address-input').fill(`Địa chỉ ${suffix}`);
    await page.getByTestId('customer-phone-input').fill('0901234567');
    await page.getByTestId('customer-email-input').fill(`customer-${suffix.toLowerCase()}@example.com`);
    await page.getByRole('button', { name: 'Tạo khách hàng' }).click();

    const customerRow = page.getByTestId(`customer-row-${customerCode}`);
    await expect(customerRow).toBeVisible();
    await expect(customerRow).toContainText(customerName);
    await expect(customerRow).toContainText('Đang hoạt động');

    await page.getByTestId('customers-search-input').fill(customerCode);
    await expect(customerRow).toBeVisible();
    await page.getByTestId('customers-status-filter').selectOption('active');
    await expect(customerRow).toBeVisible();
    await page.getByTestId('customers-status-filter').selectOption('all');
    await page.getByTestId('customers-search-input').fill('');

    const editedName = `${customerName} (đã sửa)`;
    await page.getByTestId(`edit-customer-${customerCode}`).click();
    await page.getByTestId('customer-name-input').fill(editedName);
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    customerName = editedName;
    await expect(customerRow).toContainText(customerName);

    await page.getByTestId(`toggle-customer-${customerCode}`).click();
    await expect(customerRow).toContainText('Ngừng hoạt động');

    await page.getByTestId('customers-status-filter').selectOption('inactive');
    await expect(customerRow).toBeVisible();

    await page.getByTestId(`toggle-customer-${customerCode}`).click();
    await page.getByTestId('customers-status-filter').selectOption('all');
    await expect(customerRow).toContainText('Đang hoạt động');
  });
});
