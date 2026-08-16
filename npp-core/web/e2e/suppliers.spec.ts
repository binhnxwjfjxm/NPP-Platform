import { test, expect } from '@playwright/test';

test.describe('Danh mục nhà cung cấp', () => {
  test('quản lý nhà cung cấp và cập nhật trạng thái', async ({ page }) => {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const supplierCode = `NCC-${suffix}`;
    const supplierName = `Nhà cung cấp ${suffix}`;
    const taxId = `TAXID-${suffix}`;
    const bankAccount = `ACC-${suffix}`;

    await page.goto('/suppliers');
    const workspace = page.getByTestId('suppliers-page');
    await expect(workspace).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nhà cung cấp', exact: true, level: 1 })).toBeVisible();

    await workspace.getByRole('button', { name: 'Thêm nhà cung cấp' }).click();
    await page.getByTestId('supplier-code-input').fill(supplierCode.toLowerCase());
    await page.getByTestId('supplier-name-input').fill(supplierName);
    await page.getByTestId('supplier-tax-id-input').fill(taxId);
    await page.getByTestId('supplier-bank-account-input').fill(bankAccount);
    await page.getByTestId('supplier-bank-name-input').fill(`Ngân hàng ${suffix}`);
    await page.getByTestId('supplier-avg-delivery-days-input').fill('7');
    await page.getByTestId('supplier-street-input').fill(`Địa chỉ ${suffix}`);
    const provinceSelect = page.getByTestId('supplier-province-select');
    await expect(provinceSelect).toBeEnabled();
    await provinceSelect.selectOption({ index: 1 });
    const wardSelect = page.getByTestId('supplier-ward-select');
    await expect(wardSelect).toBeEnabled();
    await wardSelect.selectOption({ index: 1 });
    await workspace.getByRole('button', { name: 'Lưu', exact: true }).click();

    const supplierRow = page.getByTestId(`supplier-row-${supplierCode}`);
    await expect(supplierRow).toBeVisible();
    await expect(supplierRow).toContainText(supplierName);
    await expect(supplierRow).toContainText(taxId);

    await page.getByTestId('suppliers-search-input').fill(supplierCode);
    await expect(supplierRow).toBeVisible();

    await page.getByTestId('suppliers-status-filter').selectOption('active');
    await expect(supplierRow).toBeVisible();

    await page.getByTestId(`edit-supplier-${supplierCode}`).click();
    await page.getByTestId('supplier-name-input').fill(`${supplierName} đã sửa`);
    await page.getByTestId('supplier-avg-delivery-days-input').fill('10');
    await workspace.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(supplierRow).toContainText(`${supplierName} đã sửa`);

    await supplierRow.getByRole('button', { name: 'Ngừng sử dụng', exact: true }).click();
    await page.getByTestId('suppliers-status-filter').selectOption('inactive');
    await expect(supplierRow).toContainText('Ngừng sử dụng');
  });
});
