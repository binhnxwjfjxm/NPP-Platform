import { createIdempotencyKey } from '@npp/contracts';
import { test, expect, type APIRequestContext } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function key(operation: string) {
  return createIdempotencyKey(`issue-497-po-visibility-${operation}`);
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

async function createApprovedPurchaseOrder(
  request: APIRequestContext,
  suffix: string,
  discriminator: string,
  supplierId: string,
  warehouseId: string,
  variantId: string,
) {
  const supplierReference = `ISS497-${discriminator}-${suffix}`;
  const create = await request.post('/api/purchase-orders', {
    headers: { 'Idempotency-Key': key(`create-${discriminator}`) },
    data: {
      supplierId,
      warehouseId,
      orderDate: '2026-08-14',
      expectedDate: '2026-08-21',
      supplierReference,
      currencyCode: 'VND',
      note: 'Issue #497 regression: same warehouse purchase-order visibility',
      lines: [{
        variantId,
        quantity: '2',
        unitPrice: '10000',
        discountAmount: '0',
        taxAmount: '0',
        priceOverrideReason: 'Issue #497 browser regression fixture',
      }],
    },
  });
  expect(create.status()).toBe(201);
  const draft = (await create.json()).data;

  const submit = await request.post(`/api/purchase-orders/${draft.id}/submit`, {
    headers: { 'Idempotency-Key': key(`submit-${discriminator}`) },
    data: { expectedRevision: draft.revision },
  });
  expect(submit.status()).toBe(200);
  const submitted = (await submit.json()).data;

  const approve = await request.post(`/api/purchase-orders/${draft.id}/approve`, {
    headers: { 'Idempotency-Key': key(`approve-${discriminator}`) },
    data: { expectedRevision: submitted.revision },
  });
  expect(approve.status()).toBe(200);
  return { ...(await approve.json()).data, supplierReference };
}

async function createSameWarehouseFixture(request: APIRequestContext) {
  const suffix = uniqueSuffix();
  const branch = await createResource(request, '/api/organization/branches', 'branch', {
    code: `I497B-${suffix}`,
    name: `Chi nhánh Issue 497 ${suffix}`,
  });
  const warehouse = await createResource(request, '/api/organization/warehouses', 'warehouse', {
    branchId: branch.id,
    code: `I497W-${suffix}`,
    name: `Kho Issue 497 ${suffix}`,
    warehouseType: 'main',
  });
  const supplier = await createResource(request, '/api/suppliers', 'supplier', {
    code: `I497S-${suffix}`,
    name: `Nhà cung cấp Issue 497 ${suffix}`,
    avgDeliveryDays: 3,
  });
  const unit = await createResource(request, '/api/units', 'unit', {
    code: `I497U-${suffix}`,
    name: `Đơn vị Issue 497 ${suffix}`,
    unitKind: 'COUNT',
    allowsFractional: true,
  });
  const product = await createResource(request, '/api/products', 'product', {
    code: `I497P-${suffix}`,
    name: `Sản phẩm Issue 497 ${suffix}`,
  });
  const variant = await createResource(request, `/api/products/${product.id}/variants`, 'variant', {
    sku: `I497SKU-${suffix}`,
    name: `SKU Issue 497 ${suffix}`,
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

  const orders = [];
  for (const discriminator of ['A', 'B', 'C', 'D']) {
    orders.push(await createApprovedPurchaseOrder(
      request,
      suffix,
      discriminator,
      supplier.id,
      warehouse.id,
      variant.id,
    ));
  }
  return { orders, warehouse };
}

test.describe('Issue #497 — PO cùng kho không bị ẩn bởi search ngầm', () => {
  test('URL search hiện rõ trên UI, xóa search khôi phục đủ 4 PO cùng kho và Phiếu nhận thấy cả 4', async ({ page, request }) => {
    const fixture = await createSameWarehouseFixture(request);
    const [target] = fixture.orders;

    await page.goto(`/purchasing/purchase-orders?search=${encodeURIComponent(target.supplierReference)}`);
    await expect(page.getByTestId('purchase-orders-page')).toBeVisible();
    const search = page.getByTestId('purchase-order-search');
    const table = page.getByTestId('purchase-orders-table');
    await expect(search).toHaveValue(target.supplierReference);
    await expect(table.locator('tbody tr')).toHaveCount(1);

    await search.fill('');
    for (const order of fixture.orders) {
      const row = table.locator('tbody tr').filter({ hasText: order.supplierReference });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(fixture.warehouse.code);
    }

    await page.goto('/purchasing/goods-receipts');
    await page.getByTestId('goods-receipt-create-button').click();
    const select = page.getByTestId('goods-receipt-purchase-order-select');
    await expect(select).toBeVisible();
    for (const order of fixture.orders) {
      await expect(select.locator(`option[value="${order.id}"]`)).toHaveCount(1);
    }
  });
});
