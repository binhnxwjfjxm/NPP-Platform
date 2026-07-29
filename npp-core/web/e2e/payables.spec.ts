import { test, expect, type APIRequestContext } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function createFixture(request: APIRequestContext, suffix: string) {
  const create = async (path: string, key: string, payload: Record<string, unknown>) => {
    const response = await request.post(path, { headers: { 'Idempotency-Key': key }, data: payload });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  };

  const branch = await create('/api/organization/branches', `pay-branch-${suffix}`, { code: `PYB-${suffix}`, name: `Chi nhánh công nợ ${suffix}` });
  const warehouse = await create('/api/organization/warehouses', `pay-warehouse-${suffix}`, { branchId: branch.id, code: `PYW-${suffix}`, name: `Kho công nợ ${suffix}`, warehouseType: 'main' });
  const location = await create('/api/organization/warehouse-locations', `pay-location-${suffix}`, { warehouseId: warehouse.id, code: `PYL-${suffix}`, name: `Vị trí công nợ ${suffix}`, locationType: 'storage' });
  const supplier = await create('/api/suppliers', `pay-supplier-${suffix}`, { code: `PYS-${suffix}`, name: `Nhà cung cấp công nợ ${suffix}` });
  const unit = await create('/api/units', `pay-unit-${suffix}`, { code: `PYE-${suffix}`, name: `Đơn vị lẻ ${suffix}`, unitKind: 'COUNT', allowsFractional: true });
  const cartonUnit = await create('/api/units', `pay-carton-${suffix}`, { code: `PYT-${suffix}`, name: `Thùng ${suffix}`, unitKind: 'PACKAGE', allowsFractional: false });
  const product = await create('/api/products', `pay-product-${suffix}`, { code: `PYP-${suffix}`, name: `Sản phẩm công nợ ${suffix}` });
  const baseVariant = await create(`/api/products/${product.id}/variants`, `pay-base-${suffix}`, { sku: `PYB-${suffix}`, name: `SKU gốc ${suffix}`, variantKind: 'BASE', isInventoryBase: true, isSellable: true, isCatalogVisible: true });
  const cartonVariant = await create(`/api/products/${product.id}/variants`, `pay-carton-variant-${suffix}`, { sku: `PYC-${suffix}`, name: `SKU thùng ${suffix}`, variantKind: 'CARTON', isInventoryBase: false, isSellable: true, isCatalogVisible: true });

  let response = await request.patch(`/api/products/${product.id}/variants/${baseVariant.id}/unit`, { data: { unitId: unit.id, conversionToBase: '1', expectedUpdatedAt: baseVariant.updated_at } });
  expect(response.status()).toBe(200);
  response = await request.patch(`/api/products/${product.id}/variants/${cartonVariant.id}/unit`, { data: { unitId: cartonUnit.id, conversionToBase: '12', expectedUpdatedAt: cartonVariant.updated_at } });
  expect(response.status()).toBe(200);
  response = await request.put(`/api/inventory/tracking-policies/${baseVariant.id}`, { headers: { 'Idempotency-Key': `pay-policy-${suffix}` }, data: { baseVariantId: baseVariant.id, lotTrackingMode: 'NONE', expiryTrackingMode: 'NONE', locationRequired: true } });
  expect(response.status()).toBe(200);

  response = await request.post('/api/purchase-orders', {
    headers: { 'Idempotency-Key': `pay-po-create-${suffix}` },
    data: {
      supplierId: supplier.id, warehouseId: warehouse.id, orderDate: '2026-07-30', currencyCode: 'VND',
      lines: [{ variantId: cartonVariant.id, quantity: '10', unitPrice: '10000', discountAmount: '10000', taxAmount: '20000' }],
    },
  });
  expect(response.status()).toBe(201);
  const draftOrder = (await response.json()).data;
  response = await request.post(`/api/purchase-orders/${draftOrder.id}/submit`, { headers: { 'Idempotency-Key': `pay-po-submit-${suffix}` }, data: { expectedRevision: draftOrder.revision } });
  expect(response.status()).toBe(200);
  const submittedOrder = (await response.json()).data;
  response = await request.post(`/api/purchase-orders/${draftOrder.id}/approve`, { headers: { 'Idempotency-Key': `pay-po-approve-${suffix}` }, data: { expectedRevision: submittedOrder.revision } });
  expect(response.status()).toBe(200);
  const purchaseOrder = (await response.json()).data;

  response = await request.post('/api/goods-receipts', {
    headers: { 'Idempotency-Key': `pay-gr-create-${suffix}` },
    data: {
      purchaseOrderId: purchaseOrder.id, receiptDate: '2026-07-30', supplierDeliveryReference: `PAY-GR-${suffix}`,
      lines: [{ purchaseOrderLineId: purchaseOrder.lines[0].id, receivedQuantity: '2', acceptedQuantity: '2', rejectedQuantity: '0', finalizeLine: false, locationId: location.id }],
    },
  });
  expect(response.status()).toBe(201);
  const draftReceipt = (await response.json()).data;
  response = await request.post(`/api/goods-receipts/${draftReceipt.id}/post`, { headers: { 'Idempotency-Key': `pay-gr-post-${suffix}` }, data: { expectedRevision: draftReceipt.revision } });
  expect(response.status()).toBe(200);
  const goodsReceipt = (await response.json()).data;
  return { supplier, goodsReceipt };
}

test('payable list and drill-down expose server-owned purchasing ledger facts', async ({ page, request }) => {
  const suffix = uniqueSuffix();
  const fixture = await createFixture(request, suffix);

  await page.goto('/accounting/payables');
  await expect(page.getByTestId('payables-page')).toBeVisible();
  await expect(page.getByTestId('nav-payables')).toBeVisible();
  const row = page.getByTestId('payables-table').locator('tbody tr').filter({ hasText: fixture.goodsReceipt.documentNumber });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(fixture.supplier.code);
  await expect(row).toContainText('22.000');
  await row.getByRole('link', { name: fixture.goodsReceipt.documentNumber }).click();
  await expect(page.getByTestId('payable-detail')).toBeVisible();
  await expect(page.getByTestId('payable-lines-table')).toContainText('22.000');
  await expect(page.getByTestId('payable-ledger-table')).toContainText('GOODS_RECEIPT_POST');
});
