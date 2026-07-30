import { test, expect } from '@playwright/test';

function uniqueReference() {
  return `E2E-PO-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

type SkuSearchOption = {
  id: string;
  sku: string;
  variantName: string;
  unitCode: string | null;
  eligibility: { selectable: boolean; code: string; message: string };
};

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
    const supplier = (await supplierResponse.json()).data;

    const skuResponse = await page.request.get('/api/purchase-orders/sku-search?limit=50&offset=0');
    expect(skuResponse.status()).toBe(200);
    const skuOptions = (await skuResponse.json()).data as SkuSearchOption[];
    const eligibleSku = skuOptions.find((option) => option.eligibility.selectable);
    expect(eligibleSku).toBeTruthy();

    await page.goto('/purchasing/purchase-orders');
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Đơn đặt hàng', exact: true })).toBeVisible();
    await expect(page.getByTestId('nav-purchase-orders')).toBeVisible();

    await page.getByTestId('purchase-order-create-button').click();
    const editor = page.getByRole('dialog', { name: 'Đơn đặt hàng mới' });
    await expect(editor).toBeVisible();

    const supplierSelect = editor.getByRole('combobox', { name: 'Nhà cung cấp', exact: true });
    const warehouseSelect = editor.getByRole('combobox', { name: 'Kho nhận', exact: true });
    await expect(supplierSelect.locator('option')).not.toHaveCount(1);
    await expect(warehouseSelect.locator('option')).not.toHaveCount(1);
    await supplierSelect.selectOption(supplier.id);
    await warehouseSelect.selectOption({ index: 1 });
    await editor.getByRole('textbox', { name: 'Tham chiếu nhà cung cấp', exact: true }).fill(supplierReference);

    const skuSearch = editor.getByRole('combobox', { name: 'Tìm SKU mua hàng', exact: true });
    await skuSearch.fill(eligibleSku!.sku);
    const skuResult = editor.getByRole('option').filter({ hasText: eligibleSku!.sku }).first();
    await expect(skuResult).toBeVisible();
    await skuResult.getByRole('button').click();
    await editor.getByRole('button', { name: 'Thêm dòng', exact: true }).click();

    const line = page.getByTestId('purchase-order-lines').locator('tbody tr').first();
    const decimalInputs = line.locator('input[inputmode="decimal"]');
    await decimalInputs.nth(0).fill('2');
    await decimalInputs.nth(1).fill('10000');
    await line.locator('select').selectOption('PERCENT');
    await decimalInputs.nth(2).fill('10');
    await decimalInputs.nth(3).fill('8');
    await expect(line).toContainText('19.440 VND');
    await page.getByTestId('purchase-order-save').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByText('Đã tạo đơn đặt hàng nháp.')).toBeVisible();

    await page.getByTestId('purchase-order-search').fill(supplierReference);
    const row = page.getByTestId('purchase-orders-table').locator('tbody tr').filter({ hasText: supplierReference });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Nháp');

    await row.getByRole('button', { name: 'Sửa', exact: true }).click();
    const editDialog = page.getByRole('dialog', { name: 'Đơn chưa cấp số' });
    await expect(editDialog).toBeVisible();
    const editLine = page.getByTestId('purchase-order-lines').locator('tbody tr').first();
    await editLine.locator('input[inputmode="decimal"]').nth(0).fill('3');
    await page.getByTestId('purchase-order-save').click();
    await expect(editDialog).toHaveCount(0);
    await expect(page.getByText('Đã cập nhật đơn đặt hàng nháp.')).toBeVisible();

    await row.getByRole('button', { name: 'Gửi duyệt', exact: true }).click();
    await page.getByTestId('purchase-order-submit-confirm').click();
    await expect(page.getByText('Đơn đặt hàng đã được gửi duyệt.')).toBeVisible();
    await expect(row).toContainText('Chờ duyệt');

    await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await page.getByTestId('purchase-order-approve-confirm').click();
    await expect(page.getByText(/Đơn đặt hàng đã được duyệt với số PO-/)).toBeVisible();
    await expect(row).toContainText('Đã duyệt');
    await expect(row).toContainText(/PO-\d{6}-\d{6}/);

    await row.getByRole('button', { name: 'Xem', exact: true }).click();
    const detail = page.getByRole('dialog', { name: /PO-\d{6}-\d{6}/ });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('29.160 VND');
    await detail.getByRole('button', { name: 'Đóng chi tiết', exact: true }).click();

    await row.getByRole('button', { name: 'Hủy', exact: true }).click();
    const cancelDialog = page.getByRole('dialog', { name: 'Hủy đơn' });
    await cancelDialog.getByRole('textbox', { name: 'Lý do hủy', exact: true }).fill('Hủy để kiểm thử lifecycle P5.1');
    await page.getByTestId('purchase-order-cancel-confirm').click();
    await expect(page.getByText('Đơn đặt hàng đã được hủy.')).toBeVisible();
    await expect(row).toContainText('Đã hủy');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
  });

  test('cập nhật dữ liệu không hiểu products rỗng là danh mục rỗng khi dùng live SKU search', async ({ page }) => {
    await page.goto('/purchasing/purchase-orders');
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Đơn đặt hàng', exact: true })).toBeVisible();

    await page.route('**/api/purchase-orders/bootstrap', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.data.products = [];
      payload.data.errors.products = null;
      await route.fulfill({ response, json: payload });
    });

    await page.getByTestId('purchase-order-refresh-button').click();
    await expect(page.getByText('Chưa có sản phẩm mua hàng khả dụng để tạo đơn đặt hàng.')).toHaveCount(0);
    await expect(page.getByTestId('purchase-order-create-button')).toBeEnabled();
    await expect(page.getByTestId('purchase-order-products-link')).toHaveCount(0);
  });

  test('hiển thị link Danh mục sản phẩm khi live search trả SKU chưa đủ điều kiện mua', async ({ page }) => {
    await page.route('**/api/purchase-orders/sku-search**', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          data: [{
            id: '11111111-1111-4111-8111-111111111111',
            productId: '22222222-2222-4222-8222-222222222222',
            productCode: 'SP-THIEU-DV',
            productName: 'Sản phẩm thiếu đơn vị',
            sku: 'SKU-THIEU-DV',
            variantName: 'SKU thiếu đơn vị',
            barcode: null,
            unitId: null,
            unitCode: null,
            unitName: null,
            conversionToBase: null,
            allowsFractional: null,
            eligibility: {
              selectable: false,
              code: 'SKU_UNIT_MISSING',
              message: 'SKU chưa được gắn đơn vị mua hàng và hệ số quy đổi.',
            },
          }],
          requestId: 'e2e-sku-missing-unit',
        },
      });
    });

    await page.goto('/purchasing/purchase-orders');
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
    await page.getByTestId('purchase-order-create-button').click();

    const editor = page.getByRole('dialog', { name: 'Đơn đặt hàng mới' });
    await expect(editor).toBeVisible();
    await editor.getByRole('combobox', { name: 'Tìm SKU mua hàng', exact: true }).fill('SKU-THIEU-DV');
    const result = editor.getByRole('option').filter({ hasText: 'SKU-THIEU-DV' });
    await expect(result).toBeVisible();
    await result.getByRole('button').click();
    await expect(editor.getByRole('alert')).toContainText('chưa được gắn đơn vị mua hàng');
    const productsLink = page.getByTestId('purchase-order-products-link');
    await expect(productsLink).toBeVisible();
    await productsLink.click();
    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByTestId('products-page')).toBeVisible();
  });

  test('không hiện link Danh mục sản phẩm khi live SKU search báo lỗi kỹ thuật', async ({ page }) => {
    await page.route('**/api/purchase-orders/sku-search**', async (route) => {
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'PURCHASE_ORDER_SKU_SEARCH_UNAVAILABLE',
            message: 'Không tải được danh sách SKU',
            retryable: true,
          },
          requestId: 'e2e-sku-search-failure',
        },
      });
    });

    await page.goto('/purchasing/purchase-orders');
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
    await page.getByTestId('purchase-order-create-button').click();

    const editor = page.getByRole('dialog', { name: 'Đơn đặt hàng mới' });
    await expect(editor).toBeVisible();
    await editor.getByRole('combobox', { name: 'Tìm SKU mua hàng', exact: true }).fill('SKU-LOI-KY-THUAT');
    await expect(editor.getByRole('alert')).toContainText('Không tải được danh sách SKU');
    await expect(page.getByTestId('purchase-order-products-link')).toHaveCount(0);
  });
});
