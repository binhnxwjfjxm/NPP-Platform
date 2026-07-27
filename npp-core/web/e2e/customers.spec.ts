import { test, expect } from '@playwright/test';

test.describe('Danh mục khách hàng', () => {
  test('quản lý nhóm, khách hàng và địa chỉ trên route chuẩn', async ({ page }) => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const groupCode = `NH-${suffix}`;
    const customerCode = `KH-${suffix}`;
    const customerName = `Khách hàng ${suffix}`;

    await page.goto('/customers');
    await expect(page.getByTestId('customers-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Khách hàng', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Nhóm khách hàng', exact: true }).click();
    await page.getByTestId('customer-groups-topbar-create-button').click();
    await page.getByTestId('customer-group-code-input').fill(groupCode.toLowerCase());
    await page.getByTestId('customer-group-name-input').fill(`Nhóm ${suffix}`);
    await page.getByRole('button', { name: 'Lưu nhóm' }).click();
    await expect(page.getByTestId(`customer-group-row-${groupCode}`)).toBeVisible();

    await page.getByRole('button', { name: 'Khách hàng', exact: true }).click();
    await page.getByTestId('customers-topbar-create-button').click();
    await page.getByTestId('customer-code-input').fill(customerCode.toLowerCase());
    await page.getByTestId('customer-name-input').fill(customerName);
    await page.getByLabel('Nhóm khách hàng').selectOption({ label: `${groupCode} · Nhóm ${suffix}` });
    await page.getByTestId('customer-phone-input').fill('0901234567');
    await page.getByTestId('customer-email-input').fill(`customer-${suffix.toLowerCase()}@example.com`);
    await page.getByRole('button', { name: 'Lưu khách hàng' }).click();

    const customerRow = page.getByTestId(`customer-row-${customerCode}`);
    await expect(customerRow).toBeVisible();
    await expect(customerRow).toContainText(customerName);
    await expect(customerRow).toContainText(`Nhóm ${suffix}`);

    await page.getByTestId('customers-search-input').fill(customerCode);
    await expect(customerRow).toBeVisible();
    await page.getByTestId('customers-group-filter').selectOption({ label: `${groupCode} · Nhóm ${suffix}` });
    await expect(customerRow).toBeVisible();

    await page.getByTestId(`edit-customer-${customerCode}`).click();
    await page.getByTestId('customer-name-input').fill(`${customerName} đã sửa`);
    await page.getByRole('button', { name: 'Lưu khách hàng' }).click();
    await expect(customerRow).toContainText(`${customerName} đã sửa`);

    await page.getByTestId(`addresses-customer-${customerCode}`).click();
    await page.getByRole('button', { name: 'Thêm địa chỉ' }).click();
    await page.getByTestId('customer-address-label-input').fill('Kho chính');
    await page.getByTestId('customer-address-line1-input').fill(`1 Đường ${suffix}`);
    await page.getByLabel('Đặt làm địa chỉ mặc định').check();
    await page.getByRole('button', { name: 'Lưu địa chỉ' }).click();
    await expect(page.getByText('Kho chính · Mặc định')).toBeVisible();
    await page.getByRole('button', { name: 'Đóng' }).click();

    await customerRow.getByRole('button', { name: 'Ngừng' }).click();
    await expect(customerRow).toContainText('Không hoạt động');
    await page.getByTestId('customers-status-filter').selectOption('inactive');
    await expect(customerRow).toBeVisible();
  });
});
