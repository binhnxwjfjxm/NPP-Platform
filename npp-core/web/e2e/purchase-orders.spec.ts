import { test, expect, type APIRequestContext } from '@playwright/test';

function uniqueReference() {
  return `E2E-PO-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function createPurchaseOrderFixture(request: APIRequestContext, suffix: string) {
  const create = async (path: string, key: string, data: Record<string, unknown>) => {
    const response = await request.post(path, { headers: { 'Idempotency-Key': key }, data });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  };

  const branch = await create('/api/organization/branches', `po-branch-${suffix}`, {
    code: `POB-${suffix}`,
    name: `Chi nhánh PO ${suffix}`,
  });
  const warehouse = await create('/api/organization/warehouses', `po-warehouse-${suffix}`, {
    branchId: branch.id,
    code: `POW-${suffix}`,
    name: `Kho PO ${suffix}`,
    warehouseType: 'main',
  });
  const supplier = await create('/api/suppliers', `po-supplier-${suffix}`, {
    code: `NCC-${suffix}`,
    name: `Nhà cung cấp PO ${suffix}`,
    taxId: `TAX-${suffix}`,
    avgDeliveryDays: 7,
  });
  const unit = await create('/api/units', `po-unit-${suffix}`, {
    code: `POU-${suffix}`,
    name: `Túi PO ${suffix}`,
    unitKind: 'PACKAGE',
    allowsFractional: false,
  });
  const product = await create('/api/products', `po-product-${suffix}`, {
    code: `POP-${suffix}`,
    name: `Sản phẩm PO ${suffix}`,
  });
  const variant = await create(`/api/products/${product.id}/variants`, `po-variant-${suffix}`, {
    sku: `POSKU-${suffix}`,
    name: `SKU PO ${suffix}`,
    variantKind: 'BASE',
    isInventoryBase: true,
    isSellable: true,
    isCatalogVisible: true,
  });

  let response = await request.patch(`/api/products/${product.id}/variants/${variant.id}/unit`, {
    data: { unitId: unit.id, conversionToBase: '1', expectedUpdatedAt: variant.updated_at },
  });
  expect(response.status()).toBe(200);

  response = await request.patch(`/api/products/${product.id}`, {
    data: { isOrderable: true, expectedUpdatedAt: product.updated_at },
  });
  expect(response.status()).toBe(200);

  return { warehouse, supplier, variant };
}

test.describe('Đơn đặt hàng nhà cung cấp', () => {
  test('tạo, sửa, gửi duyệt, duyệt, xem chi tiết và hủy đơn', async ({ page, request }) => {
    const supplierReference = uniqueReference();
    const suffix = supplierReference.replace(/[^A-Z0-9]/g, '').slice(-12);
    const fixture = await createPurchaseOrderFixture(request, suffix);

    await page.goto('/purchasing/purchase-orders');
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Đơn đặt hàng', exact: true })).toBeVisible();
    await expect(page.getByTestId('nav-purchase-orders')).toBeVisible();

    await page.getByTestId('purchase-order-create-button').click();
    const editor = page.getByRole('dialog', { name: 'Đơn đặt hàng mới' });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('tab', { name: 'Tìm nhanh' })).toBeVisible();
    await expect(editor.getByRole('tab', { name: 'Chọn từ danh mục' })).toBeVisible();
    await expect(editor.getByRole('tab', { name: 'Nhập nhiều dòng' })).toBeVisible();

    const supplierSelect = editor.getByRole('combobox', { name: 'Nhà cung cấp', exact: true });
    const warehouseSelect = editor.getByRole('combobox', { name: 'Kho nhận', exact: true });
    await supplierSelect.selectOption(fixture.supplier.id);
    await warehouseSelect.selectOption(fixture.warehouse.id);
    await editor.getByRole('textbox', { name: 'Tham chiếu nhà cung cấp', exact: true }).fill(supplierReference);

    const skuSearch = editor.getByRole('combobox', { name: /^Từ khóa sản phẩm hoặc SKU/ });
    await skuSearch.fill(fixture.variant.sku);
    const skuResult = editor.getByRole('option').filter({ hasText: fixture.variant.sku }).first();
    await expect(skuResult).toBeVisible();
    await expect(skuResult).toContainText('Có thể chọn để mua hàng');
    await skuResult.click();

    const line = editor.locator('article').filter({ hasText: fixture.variant.sku }).first();
    await expect(line).toBeVisible();
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
    const editLine = editDialog.locator('article').filter({ hasText: fixture.variant.sku }).first();
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

  test('không gửi yêu cầu live search khi từ khóa chưa đủ hai ký tự', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/purchase-orders/sku-search**', async (route) => {
      requestCount += 1;
      await route.fulfill({ status: 200, json: { data: [], requestId: 'e2e-min-search' } });
    });

    await page.goto('/purchasing/purchase-orders');
    await page.getByTestId('purchase-order-create-button').click();
    const editor = page.getByRole('dialog', { name: 'Đơn đặt hàng mới' });
    const skuSearch = editor.getByRole('combobox', { name: /^Từ khóa sản phẩm hoặc SKU/ });
    await skuSearch.fill('A');
    await page.waitForTimeout(500);
    expect(requestCount).toBe(0);
    await expect(editor.getByText('Nhập ít nhất 2 ký tự để tìm.')).toBeVisible();

    await skuSearch.fill('AB');
    await expect.poll(() => requestCount).toBe(1);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
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
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('giải thích SKU chưa đủ điều kiện và cho mở thiết lập sản phẩm', async ({ page }) => {
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
    await editor.getByRole('combobox', { name: 'Trạng thái SKU', exact: true }).selectOption('setup');
    await editor.getByRole('combobox', { name: /^Từ khóa sản phẩm hoặc SKU/ }).fill('SKU-THIEU-DV');
    const result = editor.getByRole('option').filter({ hasText: 'SKU-THIEU-DV' });
    await expect(result).toBeVisible();
    await result.click();
    await expect(editor.getByRole('alert')).toContainText('chưa được gắn đơn vị mua hàng');
    const productsLink = editor.getByRole('link', { name: 'Mở thiết lập sản phẩm', exact: true });
    await expect(productsLink).toBeVisible();
    await productsLink.click();
    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByTestId('products-page')).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('hiển thị lỗi kỹ thuật đúng nghĩa thay vì báo nhầm không tìm thấy đơn hàng', async ({ page }) => {
    await page.route('**/api/purchase-orders/sku-search**', async (route) => {
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'PURCHASE_ORDER_SKU_SEARCH_UNAVAILABLE',
            message: 'Chức năng tìm SKU chưa được cập nhật đồng bộ với máy chủ.',
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
    await editor.getByRole('combobox', { name: /^Từ khóa sản phẩm hoặc SKU/ }).fill('SKU-LOI-KY-THUAT');
    await expect(editor.getByRole('alert')).toContainText('chưa được cập nhật đồng bộ');
    await expect(editor.getByRole('alert')).not.toContainText('Purchase order was not found');
    await expect(editor.getByRole('link', { name: 'Mở thiết lập sản phẩm', exact: true })).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
