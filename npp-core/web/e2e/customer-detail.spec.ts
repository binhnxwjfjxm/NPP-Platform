import { test, expect } from '@playwright/test';

test.describe('Chi tiết khách hàng', () => {
  test('mở hồ sơ theo đúng khách và hiển thị tổng quan, thông tin, địa chỉ', async ({ page }) => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const customerCode = `CT-${suffix}`;
    const customerName = `Khách hồ sơ ${suffix}`;

    await page.goto('/customers');
    await page.getByTestId('customers-topbar-create-button').click();
    const dialog = page.getByRole('dialog', { name: 'Biểu mẫu khách hàng' });
    await page.getByTestId('customer-code-input').fill(customerCode);
    await page.getByTestId('customer-name-input').fill(customerName);
    await page.getByTestId('customer-phone-input').fill('0901234567');
    await page.getByTestId('customer-create-address-label-input').fill('Địa chỉ chính');
    await page.getByTestId('customer-province-select').selectOption({ label: 'Hà Nội' });
    await page.getByTestId('customer-ward-select').selectOption({ index: 1 });
    await page.getByTestId('customer-create-address-line1-input').fill(`10 Đường ${suffix}`);
    await dialog.getByRole('button', { name: 'Lưu khách hàng và địa chỉ' }).click();

    await page.reload();
    await page.getByTestId('customers-search-input').fill(customerCode);
    const row = page.getByTestId(`customer-row-${customerCode}`);
    await expect(row).toBeVisible();
    const detailLink = page.getByTestId(`customer-detail-${customerCode}`);
    await expect(detailLink).toBeAttached();
    await detailLink.click();

    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+/i);
    const detail = page.getByTestId('customer-detail-page');
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('heading', { name: customerName })).toBeVisible();
    await expect(page.getByTestId('customer-summary-revenue')).toContainText('Doanh số');
    await expect(page.getByTestId('customer-summary-orders')).toContainText('Số đơn');
    await expect(page.getByTestId('customer-summary-receivable')).toContainText('Công nợ hiện tại');
    await expect(page.getByTestId('customer-summary-credit-limit')).toContainText('Hạn mức tín dụng');

    await detail.getByRole('link', { name: 'Thông tin & địa chỉ' }).click();
    await expect(detail.getByText('Địa chỉ chính')).toBeVisible();
    await expect(detail.getByText(new RegExp(`10 Đường ${suffix}`))).toBeVisible();

    await detail.getByRole('link', { name: 'Sửa thông tin', exact: true }).first().click();
    await expect(page).toHaveURL(/\/customers/);
    await expect(page.getByRole('dialog', { name: 'Biểu mẫu khách hàng' })).toBeVisible();
  });
});
