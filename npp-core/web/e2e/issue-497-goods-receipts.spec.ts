import { createIdempotencyKey } from '@npp/contracts';
import { test, expect, type APIRequestContext } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function key(operation: string) {
  return createIdempotencyKey(`issue-497-gr-lot-${operation}`);
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

async function createLotRequiredFixture(request: APIRequestContext) {
  const suffix = uniqueSuffix();
  const branch = await createResource(request, '/api/organization/branches', 'branch', {
    code: `GRLOTB-${suffix}`,
    name: `Chi nhánh GR lot ${suffix}`,
  });
  const warehouse = await createResource(request, '/api/organization/warehouses', 'warehouse', {
    branchId: branch.id,
    code: `GRLOTW-${suffix}`,
    name: `Kho GR lot ${suffix}`,
    warehouseType: 'main',
  });
  const location = await createResource(request, '/api/organization/warehouse-locations', 'location', {
    warehouseId: warehouse.id,
    code: `GRLOTL-${suffix}`,
    name: `Vị trí GR lot ${suffix}`,
    locationType: 'storage',
  });
  const supplier = await createResource(request, '/api/suppliers', 'supplier', {
    code: `GRLOTS-${suffix}`,
    name: `Nhà cung cấp GR lot ${suffix}`,
    avgDeliveryDays: 3,
  });
  const unit = await createResource(request, '/api/units', 'unit', {
    code: `GRLOTU-${suffix}`,
    name: `Đơn vị GR lot ${suffix}`,
    unitKind: 'COUNT',
    allowsFractional: true,
  });
  const product = await createResource(request, '/api/products', 'product', {
    code: `GRLOTP-${suffix}`,
    name: `Sản phẩm GR lot ${suffix}`,
  });
  const variant = await createResource(request, `/api/products/${product.id}/variants`, 'variant', {
    sku: `GRLOTSKU-${suffix}`,
    name: `SKU GR lot ${suffix}`,
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

  response = await request.put(`/api/inventory/tracking-policies/${variant.id}`, {
    headers: { 'Idempotency-Key': key('tracking-policy') },
    data: {
      baseVariantId: variant.id,
      lotTrackingMode: 'REQUIRED',
      expiryTrackingMode: 'NONE',
      locationRequired: true,
    },
  });
  expect(response.status()).toBe(200);

  response = await request.post('/api/purchase-orders', {
    headers: { 'Idempotency-Key': key('po-create') },
    data: {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      orderDate: '2026-08-14',
      expectedDate: '2026-08-21',
      supplierReference: `GR-LOT-PO-${suffix}`,
      currencyCode: 'VND',
      note: 'Issue #497 LOT_REQUIRED UI regression fixture',
      lines: [{
        variantId: variant.id,
        quantity: '2',
        unitPrice: '10000',
        discountAmount: '0',
        taxAmount: '0',
        priceOverrideReason: 'Issue #497 LOT_REQUIRED browser regression fixture',
      }],
    },
  });
  expect(response.status()).toBe(201);
  const draftOrder = (await response.json()).data;

  response = await request.post(`/api/purchase-orders/${draftOrder.id}/submit`, {
    headers: { 'Idempotency-Key': key('po-submit') },
    data: { expectedRevision: draftOrder.revision },
  });
  expect(response.status()).toBe(200);
  const submittedOrder = (await response.json()).data;

  response = await request.post(`/api/purchase-orders/${draftOrder.id}/approve`, {
    headers: { 'Idempotency-Key': key('po-approve') },
    data: { expectedRevision: submittedOrder.revision },
  });
  expect(response.status()).toBe(200);
  const approvedOrder = (await response.json()).data;
  expect(approvedOrder.lines).toHaveLength(1);

  const supplierDeliveryReference = `GR-LOT-${suffix}`;
  response = await request.post('/api/goods-receipts', {
    headers: { 'Idempotency-Key': key('gr-create') },
    data: {
      purchaseOrderId: approvedOrder.id,
      receiptDate: '2026-08-14',
      supplierDeliveryReference,
      note: 'Draft cố ý thiếu số lô để kiểm tra preflight UI',
      lines: [{
        purchaseOrderLineId: approvedOrder.lines[0].id,
        receivedQuantity: '2',
        locationId: location.id,
      }],
    },
  });
  expect(response.status()).toBe(201);
  const goodsReceipt = (await response.json()).data;

  return {
    suffix,
    supplier,
    variant,
    location,
    approvedOrder,
    goodsReceipt,
    supplierDeliveryReference,
  };
}

test.describe('Issue #497 — Phiếu nhận hàng bắt buộc số lô', () => {
  test('chỉ chỗ nhập lô ngay khi chọn PO và không gửi POST 400 khi draft cũ còn thiếu lô', async ({ page, request }) => {
    const fixture = await createLotRequiredFixture(request);
    const detailResponse = await request.get(`/api/goods-receipts/${fixture.goodsReceipt.id}`);
    expect(detailResponse.status()).toBe(200);
    const detail = (await detailResponse.json()).data;
    expect(detail.lines[0].trackingPolicy).toMatchObject({
      baseVariantId: fixture.variant.id,
      lotTrackingMode: 'REQUIRED',
      expiryTrackingMode: 'NONE',
      locationRequired: true,
    });

    let postCalls = 0;
    await page.route(`**/api/goods-receipts/${fixture.goodsReceipt.id}/post`, async (route) => {
      postCalls += 1;
      await route.continue();
    });

    await page.goto('/purchasing/goods-receipts');

    await page.getByTestId('goods-receipt-create-button').click();
    let editor = page.getByRole('dialog', { name: 'Phiếu nhận hàng nháp' });
    await expect(editor).toBeVisible();
    await editor.getByTestId('goods-receipt-purchase-order-select').selectOption(fixture.approvedOrder.id);
    await expect(editor.getByTestId('goods-receipt-tracking-panel')).toContainText('Cần bổ sung trước khi ghi sổ');
    await expect(editor.getByTestId('goods-receipt-tracking-panel')).toContainText('bắt buộc có số lô trước khi ghi sổ');
    await expect(editor.getByTestId(`goods-receipt-lot-code-${fixture.approvedOrder.lines[0].id}`)).toBeVisible();
    await editor.getByRole('button', { name: 'Đóng' }).click();

    await page.getByTestId('goods-receipt-search').fill(fixture.supplierDeliveryReference);
    const table = page.getByTestId('goods-receipts-table');
    const row = table.locator('tbody tr').filter({ hasText: fixture.supplier.name });
    await expect(row).toHaveCount(1);

    await row.getByRole('button', { name: 'Ghi sổ' }).click();

    editor = page.getByRole('dialog', { name: 'Phiếu nhận hàng nháp' });
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('goods-receipt-editor-error')).toContainText('bắt buộc nhập Số lô');
    await expect(editor.getByTestId('goods-receipt-tracking-panel')).toContainText('Cần bổ sung trước khi ghi sổ');
    const lotInput = editor.getByTestId(`goods-receipt-lot-code-${fixture.approvedOrder.lines[0].id}`);
    await expect(lotInput).toBeVisible();
    await expect(lotInput).toHaveAttribute('placeholder', 'Nhập số lô trên bao bì');
    expect(postCalls).toBe(0);

    const lotCode = `LOT-${fixture.suffix}`;
    await lotInput.fill(lotCode);
    await editor.getByTestId('goods-receipt-save-button').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByText('Đã cập nhật phiếu nhận hàng nháp.')).toBeVisible();

    const filteredRow = table.locator('tbody tr').filter({ hasText: fixture.supplier.name });
    await filteredRow.getByRole('button', { name: 'Ghi sổ' }).click();
    const confirm = page.getByRole('dialog', { name: 'Ghi sổ' });
    await expect(confirm).toBeVisible();
    await confirm.getByTestId('goods-receipt-post-confirm').click();

    await expect(page.getByText('Phiếu nhận hàng đã được ghi sổ.')).toBeVisible();
    await expect(filteredRow).toContainText('Đã ghi sổ');
    expect(postCalls).toBe(1);
  });
});
