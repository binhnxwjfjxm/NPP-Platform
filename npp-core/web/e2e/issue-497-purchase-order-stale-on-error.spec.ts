import { createIdempotencyKey } from '@npp/contracts';
import { test, expect, type APIRequestContext } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function key(operation: string) {
  return createIdempotencyKey(`issue-497-c1-po-stale-${operation}`);
}

async function createResource(
  request: APIRequestContext,
  path: string,
  operation: string,
  data: Record<string, unknown>,
) {
  const response = await request.post(path, {
    headers: { 'Idempotency-Key': key(operation) },
    data,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}

async function createPurchaseOrderFixture(request: APIRequestContext) {
  const suffix = uniqueSuffix();
  const branch = await createResource(request, '/api/organization/branches', 'branch', {
    code: `C1B-${suffix}`,
    name: `Chi nhánh C1 ${suffix}`,
  });
  const warehouse = await createResource(request, '/api/organization/warehouses', 'warehouse', {
    branchId: branch.id,
    code: `C1W-${suffix}`,
    name: `Kho C1 ${suffix}`,
    warehouseType: 'main',
  });
  const supplier = await createResource(request, '/api/suppliers', 'supplier', {
    code: `C1S-${suffix}`,
    name: `Nhà cung cấp C1 ${suffix}`,
    avgDeliveryDays: 3,
  });
  const unit = await createResource(request, '/api/units', 'unit', {
    code: `C1U-${suffix}`,
    name: `Đơn vị C1 ${suffix}`,
    unitKind: 'COUNT',
    allowsFractional: true,
  });
  const product = await createResource(request, '/api/products', 'product', {
    code: `C1P-${suffix}`,
    name: `Sản phẩm C1 ${suffix}`,
  });
  const variant = await createResource(request, `/api/products/${product.id}/variants`, 'variant', {
    sku: `C1SKU-${suffix}`,
    name: `SKU C1 ${suffix}`,
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

  const supplierReference = `ISS497-C1-${suffix}`;
  const create = await request.post('/api/purchase-orders', {
    headers: { 'Idempotency-Key': key('create-purchase-order') },
    data: {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      orderDate: '2026-08-14',
      expectedDate: '2026-08-21',
      supplierReference,
      currencyCode: 'VND',
      note: 'Issue #497 C1 stale-on-error regression fixture',
      lines: [{
        variantId: variant.id,
        quantity: '2',
        unitPrice: '10000',
        discountAmount: '0',
        taxAmount: '0',
        priceOverrideReason: 'Issue #497 C1 browser regression fixture',
      }],
    },
  });
  expect(create.status()).toBe(201);
  return { purchaseOrder: (await create.json()).data, supplierReference };
}

test.describe('Issue #497 C1 — PO stale-on-error semantics', () => {
  test('giữ dữ liệu tốt gần nhất khi refresh lỗi, hồi phục bình thường và chỉ hiện 0 sau lần tải thành công rỗng', async ({ page, request }) => {
    const fixture = await createPurchaseOrderFixture(request);

    await page.goto(`/purchasing/purchase-orders?search=${encodeURIComponent(fixture.supplierReference)}`);
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
    const table = page.getByTestId('purchase-orders-table');
    const row = table.locator('tbody tr').filter({ hasText: fixture.supplierReference });
    await expect(row).toHaveCount(1);

    let mode: 'failure' | 'success' | 'empty' = 'failure';
    await page.route('**/api/purchase-orders/bootstrap', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      if (mode === 'failure') {
        payload.data.purchaseOrders = [];
        payload.data.errors.orders = 'Gateway mua hàng tạm thời không phản hồi.';
      } else if (mode === 'empty') {
        payload.data.purchaseOrders = [];
        payload.data.errors.orders = null;
      }
      await route.fulfill({ response, json: payload });
    });

    await page.getByTestId('purchase-order-refresh-button').click();
    await expect(row).toHaveCount(1);
    await expect(page.getByTestId('purchase-order-data-state-banner')).toContainText('Đang giữ dữ liệu từ lần tải thành công gần nhất');
    await expect(page.getByTestId('purchase-order-list-count')).toContainText('dữ liệu cũ');
    await expect(page.getByTestId('purchase-order-total-count')).not.toHaveText('—');

    mode = 'success';
    await page.getByTestId('purchase-order-refresh-button').click();
    await expect(page.getByTestId('purchase-order-data-state-banner')).toHaveCount(0);
    await expect(row).toHaveCount(1);
    await expect(page.getByTestId('purchase-order-list-count')).not.toContainText('dữ liệu cũ');

    mode = 'empty';
    await page.getByTestId('purchase-order-refresh-button').click();
    await expect(page.getByTestId('purchase-order-data-state-banner')).toHaveCount(0);
    await expect(page.getByTestId('purchase-order-total-count')).toHaveText('0');
    await expect(page.getByTestId('purchase-order-list-count')).toHaveText('0 đơn');
    await expect(page.getByTestId('purchase-orders-empty-state')).toBeVisible();

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
