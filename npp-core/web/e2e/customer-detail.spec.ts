import { test, expect } from '@playwright/test';

test.describe('Chi tiết khách hàng', () => {
  test('mở hồ sơ theo đúng khách và hiển thị các tab lịch sử theo lazy-load', async ({ page }) => {
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

    await detail.getByRole('link', { name: 'Hàng đã mua' }).click();
    await expect(page).toHaveURL(/tab=purchased-items/);
    await expect(page.getByTestId('customer-purchased-items')).toBeVisible();
    await expect(page.getByPlaceholder('Tên sản phẩm hoặc SKU')).toBeVisible();
    await expect(page.getByText('Chưa có hàng đã mua trong khoảng thời gian này.')).toBeVisible();

    await detail.getByRole('link', { name: 'Đơn hàng', exact: true }).click();
    await expect(page).toHaveURL(/tab=orders/);
    await expect(page.getByTestId('customer-orders')).toBeVisible();
    await expect(page.getByPlaceholder('Số đơn')).toBeVisible();
    await expect(page.getByText('Khách hàng chưa có đơn hàng phù hợp.')).toBeVisible();

    await detail.getByRole('link', { name: 'Công nợ & thanh toán', exact: true }).click();
    await expect(page).toHaveURL(/tab=finance/);
    await expect(page.getByTestId('customer-finance')).toBeVisible();
    await expect(page.getByTestId('customer-receivable-documents')).toBeVisible();
    await expect(page.getByTestId('customer-payments')).toBeVisible();

    await detail.getByRole('link', { name: 'Giao hàng / Trả hàng', exact: true }).click();
    await expect(page).toHaveURL(/tab=delivery-returns/);
    await expect(page.getByTestId('customer-delivery-returns')).toBeVisible();
    await expect(page.getByTestId('customer-delivery-history')).toBeVisible();
    await expect(page.getByTestId('customer-return-history')).toBeVisible();
    await expect(page.getByText('Khách hàng chưa có lịch sử giao hàng.')).toBeVisible();
    await expect(page.getByText('Khách hàng chưa có hàng trả.')).toBeVisible();

    await detail.getByRole('link', { name: 'Thông tin & địa chỉ' }).click();
    await expect(detail.getByText('Địa chỉ chính')).toBeVisible();
    await expect(detail.getByText(new RegExp(`10 Đường ${suffix}`))).toBeVisible();

    await detail.getByRole('link', { name: 'Sửa thông tin', exact: true }).first().click();
    await expect(page).toHaveURL(/\/customers/);
    await expect(page.getByRole('dialog', { name: 'Biểu mẫu khách hàng' })).toBeVisible();
  });
});
