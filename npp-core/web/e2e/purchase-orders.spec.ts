import { test, expect } from '@playwright/test';

function uniqueReference() {
  return `E2E-PO-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

test.describe('Đơn đặt hàng nhà cung cấp', () => {
  test('tạo, sửa, gửi duyệt, duyệt, xem chi tiết và hủy đơn', async ({ page }) => {
    const supplierReference = uniqueReference();
    const supplierSuffix = supplierReference.replace(/[^A-Z0-9]/g, '').slice(-12);
    const supplierResponse = await page.request.post('/api/suppliers', {
      headers: { 'Idempotency-Key': `po-supplier-${supplierSuffix}` },
      data: {
        code: `NCC-${supplierSuffix}`,
        name: `Nhà cung cấp PO ${supplierSuffix}`,
        taxId: `TAX-${supplierSuffix}`,
        avgDeliveryDays: 7,
      },
    });
    expect(supplierResponse.status()).toBe(201);

    await page.goto('/purchasing/purchase-orders');
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Đơn đặt hàng', exact: true })).toBeVisible();
    await expect(page.getByTestId('nav-purchase-orders')).toBeVisible();

    await page.getByTestId('purchase-order-create-button').click();
    const editor = page.getByRole('dialog', { name: 'Đơn đặt hàng mới' });
    await expect(editor).toBeVisible();

    const supplierSelect = editor.getByLabel('Nhà cung cấp');
    const warehouseSelect = editor.getByLabel('Kho nhận');
    const productSelect = editor.getByLabel('Sản phẩm');
    await expect(supplierSelect.locator('option')).not.toHaveCount(1);
    await expect(warehouseSelect.locator('option')).not.toHaveCount(1);
    await expect(productSelect.locator('option')).not.toHaveCount(1);
    await supplierSelect.selectOption({ label: `NCC-${supplierSuffix} — Nhà cung cấp PO ${supplierSuffix}` });
    await warehouseSelect.selectOption({ index: 1 });
    await editor.getByLabel('Tham chiếu nhà cung cấp').fill(supplierReference);

    const variantsResponse = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && /\/api\/products\/[^/]+\/variants(?:\?|$)/.test(response.url())
      && response.ok()
    ));
    await productSelect.selectOption({ index: 1 });
    await variantsResponse;
    const variantSelect = editor.getByLabel('SKU mua hàng');
    await expect(variantSelect.locator('option')).not.toHaveCount(1);
    await variantSelect.selectOption({ index: 1 });
    await editor.getByRole('button', { name: 'Thêm dòng' }).click();

    const line = page.getByTestId('purchase-order-lines').locator('tbody tr').first();
    const inputs = line.locator('input');
    await inputs.nth(0).fill('2.5');
    await inputs.nth(1).fill('10000.25');
    await inputs.nth(2).fill('500');
    await inputs.nth(3).fill('250');
    await expect(line).toContainText('24.750,625 VND');
    await page.getByTestId('purchase-order-save').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByText('Đã tạo đơn đặt hàng nháp.')).toBeVisible();

    await page.getByTestId('purchase-order-search').fill(supplierReference);
    const row = page.getByTestId('purchase-orders-table').locator('tbody tr').filter({ hasText: supplierReference });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Nháp');

    await row.getByRole('button', { name: 'Sửa' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Đơn chưa cấp số' });
    await expect(editDialog).toBeVisible();
    const editLine = page.getByTestId('purchase-order-lines').locator('tbody tr').first();
    await editLine.locator('input').nth(0).fill('3');
    await page.getByTestId('purchase-order-save').click();
    await expect(editDialog).toHaveCount(0);
    await expect(page.getByText('Đã cập nhật đơn đặt hàng nháp.')).toBeVisible();

    await row.getByRole('button', { name: 'Gửi duyệt' }).click();
    await page.getByTestId('purchase-order-submit-confirm').click();
    await expect(page.getByText('Đơn đặt hàng đã được gửi duyệt.')).toBeVisible();
    await expect(row).toContainText('Chờ duyệt');

    await row.getByRole('button', { name: 'Duyệt' }).click();
    await page.getByTestId('purchase-order-approve-confirm').click();
    await expect(page.getByText(/Đơn đặt hàng đã được duyệt với số PO-/)).toBeVisible();
    await expect(row).toContainText('Đã duyệt');
    await expect(row).toContainText(/PO-\d{6}-\d{6}/);

    await row.getByRole('button', { name: 'Xem' }).click();
    const detail = page.getByRole('dialog', { name: /PO-\d{6}-\d{6}/ });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('30.000,75 VND');
    await detail.getByRole('button', { name: 'Đóng chi tiết' }).click();

    await row.getByRole('button', { name: 'Hủy' }).click();
    const cancelDialog = page.getByRole('dialog', { name: 'Hủy đơn' });
    await cancelDialog.getByLabel('Lý do hủy').fill('Hủy để kiểm thử lifecycle P5.1');
    await page.getByTestId('purchase-order-cancel-confirm').click();
    await expect(page.getByText('Đơn đặt hàng đã được hủy.')).toBeVisible();
    await expect(row).toContainText('Đã hủy');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
  });
});
