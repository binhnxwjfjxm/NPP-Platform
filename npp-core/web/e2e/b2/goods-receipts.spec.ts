import { createIdempotencyKey } from '@npp/contracts';
import { test, expect, type APIRequestContext } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function key(operation: string) {
  return createIdempotencyKey(`gr-b2-${operation}`);
}

async function createResource(request: APIRequestContext, path: string, operation: string, data: Record<string, unknown>) {
  const response = await request.post(path, { headers: { 'Idempotency-Key': key(operation) }, data });
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}

async function createOrderableVariant(
  request: APIRequestContext,
  suffix: string,
  discriminator: string,
  unitId: string,
) {
  const product = await createResource(request, '/api/products', `product-${discriminator}`, {
    code: `GRB2P-${discriminator}-${suffix}`,
    name: `Sản phẩm B2 ${discriminator} ${suffix}`,
  });
  const variant = await createResource(request, `/api/products/${product.id}/variants`, `variant-${discriminator}`, {
    sku: `GRB2SKU-${discriminator}-${suffix}`,
    name: `SKU B2 ${discriminator} ${suffix}`,
    variantKind: 'BASE',
    isInventoryBase: true,
    isSellable: true,
    isCatalogVisible: true,
  });

  let response = await request.patch(`/api/products/${product.id}/variants/${variant.id}/unit`, {
    data: { unitId, conversionToBase: '1', expectedUpdatedAt: variant.updated_at },
  });
  expect(response.status()).toBe(200);

  response = await request.patch(`/api/products/${product.id}`, {
    data: { isOrderable: true, expectedUpdatedAt: product.updated_at },
  });
  expect(response.status()).toBe(200);

  response = await request.put(`/api/inventory/tracking-policies/${variant.id}`, {
    headers: { 'Idempotency-Key': key(`policy-${discriminator}`) },
    data: {
      baseVariantId: variant.id,
      lotTrackingMode: 'NONE',
      expiryTrackingMode: 'NONE',
      locationRequired: true,
    },
  });
  expect(response.status()).toBe(200);
  return variant;
}

async function createApprovedPurchaseOrder(
  request: APIRequestContext,
  suffix: string,
  discriminator: string,
  supplierId: string,
  warehouseId: string,
  variantId: string,
  unitPrice: string,
  discountAmount = '0',
) {
  const create = await request.post('/api/purchase-orders', {
    headers: { 'Idempotency-Key': key(`po-create-${discriminator}`) },
    data: {
      supplierId,
      warehouseId,
      orderDate: '2026-08-14',
      expectedDate: '2026-08-21',
      supplierReference: `GR-B2-${discriminator}-${suffix}`,
      currencyCode: 'VND',
      note: 'PO fixture B2 chọn đơn khi tạo phiếu nhận hàng',
      lines: [{
        variantId,
        quantity: '5',
        unitPrice,
        discountAmount,
        taxAmount: '0',
        priceOverrideReason: 'Giá fixture Browser E2E B2',
      }],
    },
  });
  expect(create.status()).toBe(201);
  const draft = (await create.json()).data;

  const submit = await request.post(`/api/purchase-orders/${draft.id}/submit`, {
    headers: { 'Idempotency-Key': key(`po-submit-${discriminator}`) },
    data: { expectedRevision: draft.revision },
  });
  expect(submit.status()).toBe(200);
  const submitted = (await submit.json()).data;

  const approve = await request.post(`/api/purchase-orders/${draft.id}/approve`, {
    headers: { 'Idempotency-Key': key(`po-approve-${discriminator}`) },
    data: { expectedRevision: submitted.revision },
  });
  expect(approve.status()).toBe(200);
  return (await approve.json()).data;
}

async function createMultiPurchaseOrderFixture(request: APIRequestContext, suffix: string) {
  const branch = await createResource(request, '/api/organization/branches', 'branch', {
    code: `GRB2B-${suffix}`,
    name: `Chi nhánh B2 ${suffix}`,
  });
  const paidWarehouse = await createResource(request, '/api/organization/warehouses', 'warehouse-paid', {
    branchId: branch.id,
    code: `GRB2W-P-${suffix}`,
    name: `Kho B2 có tiền ${suffix}`,
    warehouseType: 'main',
  });
  const zeroWarehouse = await createResource(request, '/api/organization/warehouses', 'warehouse-zero', {
    branchId: branch.id,
    code: `GRB2W-Z-${suffix}`,
    name: `Kho B2 zero ${suffix}`,
    warehouseType: 'main',
  });
  const paidLocation = await createResource(request, '/api/organization/warehouse-locations', 'location-paid', {
    warehouseId: paidWarehouse.id,
    code: `GRB2L-P-${suffix}`,
    name: `Vị trí B2 có tiền ${suffix}`,
    locationType: 'storage',
  });
  const zeroLocation = await createResource(request, '/api/organization/warehouse-locations', 'location-zero', {
    warehouseId: zeroWarehouse.id,
    code: `GRB2L-Z-${suffix}`,
    name: `Vị trí B2 zero ${suffix}`,
    locationType: 'storage',
  });
  const supplier = await createResource(request, '/api/suppliers', 'supplier', {
    code: `GRB2S-${suffix}`,
    name: `Nhà cung cấp B2 ${suffix}`,
    avgDeliveryDays: 3,
  });
  const unit = await createResource(request, '/api/units', 'unit', {
    code: `GRB2U-${suffix}`,
    name: `Đơn vị B2 ${suffix}`,
    unitKind: 'COUNT',
    allowsFractional: true,
  });

  const paidVariant = await createOrderableVariant(request, suffix, 'P', unit.id);
  const zeroVariant = await createOrderableVariant(request, suffix, 'Z', unit.id);
  const paidPurchaseOrder = await createApprovedPurchaseOrder(
    request, suffix, 'P', supplier.id, paidWarehouse.id, paidVariant.id, '10000',
  );
  const zeroPurchaseOrder = await createApprovedPurchaseOrder(
    request, suffix, 'Z', supplier.id, zeroWarehouse.id, zeroVariant.id, '10000', '50000',
  );

  return {
    paidLocation,
    zeroLocation,
    paidVariant,
    zeroVariant,
    paidPurchaseOrder,
    zeroPurchaseOrder,
  };
}

test.describe('Phiếu nhận hàng — B2 chọn đơn đặt hàng', () => {
  test('create cho chọn mọi PO eligible, kể cả PO tổng tiền 0, và nạp đúng dòng/vị trí theo PO vừa chọn', async ({ page, request }) => {
    const fixture = await createMultiPurchaseOrderFixture(request, uniqueSuffix());
    expect(fixture.paidPurchaseOrder.total).not.toBe('0.000000');
    expect(fixture.zeroPurchaseOrder.total).toBe('0.000000');

    await page.goto('/purchasing/goods-receipts');
    await page.getByTestId('goods-receipt-create-button').click();

    const editor = page.getByRole('dialog', { name: 'Phiếu nhận hàng nháp' });
    const purchaseOrderSelect = editor.getByTestId('goods-receipt-purchase-order-select');
    await expect(editor).toBeVisible();
    await expect(purchaseOrderSelect).toHaveValue('');
    await expect(page.getByTestId('goods-receipt-save-button')).toBeDisabled();
    await expect(purchaseOrderSelect.locator(`option[value="${fixture.paidPurchaseOrder.id}"]`)).toHaveCount(1);
    await expect(purchaseOrderSelect.locator(`option[value="${fixture.zeroPurchaseOrder.id}"]`)).toHaveCount(1);

    await purchaseOrderSelect.selectOption(fixture.zeroPurchaseOrder.id);
    const zeroLine = editor.getByRole('row').filter({ hasText: fixture.zeroVariant.sku }).first();
    await expect(zeroLine).toBeVisible();
    await expect(zeroLine.locator('select')).toHaveValue(fixture.zeroLocation.id);
    await expect(editor).toContainText(fixture.zeroPurchaseOrder.number);

    await purchaseOrderSelect.selectOption(fixture.paidPurchaseOrder.id);
    const paidLine = editor.getByRole('row').filter({ hasText: fixture.paidVariant.sku }).first();
    await expect(paidLine).toBeVisible();
    await expect(paidLine.locator('select')).toHaveValue(fixture.paidLocation.id);
    await expect(editor).toContainText(fixture.paidPurchaseOrder.number);
    await expect(editor.getByText(fixture.zeroVariant.sku, { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('goods-receipt-save-button')).toBeEnabled();
  });
});
