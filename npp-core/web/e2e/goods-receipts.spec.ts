import { createIdempotencyKey } from '@npp/contracts';
import { test, expect, type APIRequestContext } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function key(operation: string) {
  return createIdempotencyKey(`gr-e2e-${operation}`);
}

async function createResource(request: APIRequestContext, path: string, operation: string, data: Record<string, unknown>) {
  const response = await request.post(path, { headers: { 'Idempotency-Key': key(operation) }, data });
  expect(response.status()).toBe(201);
  return (await response.json()).data;
}

async function createFixture(request: APIRequestContext) {
  const suffix = uniqueSuffix();
  const branch = await createResource(request, '/api/organization/branches', 'branch', {
    code: `GRB-${suffix}`,
    name: `Chi nhánh nhận hàng ${suffix}`,
  });
  const warehouse = await createResource(request, '/api/organization/warehouses', 'warehouse', {
    branchId: branch.id,
    code: `GRW-${suffix}`,
    name: `Kho nhận hàng ${suffix}`,
    warehouseType: 'main',
  });
  const location = await createResource(request, '/api/organization/warehouse-locations', 'location', {
    warehouseId: warehouse.id,
    code: `GRL-${suffix}`,
    name: `Vị trí nhận hàng ${suffix}`,
    locationType: 'storage',
  });
  const supplier = await createResource(request, '/api/suppliers', 'supplier', {
    code: `GRS-${suffix}`,
    name: `Nhà cung cấp nhận hàng ${suffix}`,
    avgDeliveryDays: 5,
  });
  const unit = await createResource(request, '/api/units', 'unit', {
    code: `GRU-${suffix}`,
    name: `Đơn vị nhận hàng ${suffix}`,
    unitKind: 'COUNT',
    allowsFractional: true,
  });
  const product = await createResource(request, '/api/products', 'product', {
    code: `GRP-${suffix}`,
    name: `Sản phẩm nhận hàng ${suffix}`,
  });
  const variant = await createResource(request, `/api/products/${product.id}/variants`, 'variant', {
    sku: `GRSKU-${suffix}`,
    name: `SKU nhận hàng ${suffix}`,
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
      lotTrackingMode: 'NONE',
      expiryTrackingMode: 'NONE',
      locationRequired: true,
    },
  });
  expect(response.status()).toBe(200);

  response = await request.post('/api/purchase-orders', {
    headers: { 'Idempotency-Key': key('purchase-order-create') },
    data: {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      orderDate: '2026-07-01',
      expectedDate: '2026-07-05',
      supplierReference: `GR-PO-${suffix}`,
      currencyCode: 'VND',
      note: 'PO phục vụ Browser E2E nhận hàng',
      lines: [{
        variantId: variant.id,
        quantity: '10',
        unitPrice: '12000',
        discountAmount: '0',
        taxAmount: '0',
        priceOverrideReason: 'Giá fixture Browser E2E',
      }],
    },
  });
  expect(response.status()).toBe(201);
  const draftOrder = (await response.json()).data;

  response = await request.post(`/api/purchase-orders/${draftOrder.id}/submit`, {
    headers: { 'Idempotency-Key': key('purchase-order-submit') },
    data: { expectedRevision: draftOrder.revision },
  });
  expect(response.status()).toBe(200);
  const submittedOrder = (await response.json()).data;

  response = await request.post(`/api/purchase-orders/${draftOrder.id}/approve`, {
    headers: { 'Idempotency-Key': key('purchase-order-approve') },
    data: { expectedRevision: submittedOrder.revision },
  });
  expect(response.status()).toBe(200);
  const purchaseOrder = (await response.json()).data;
  expect(purchaseOrder.lines).toHaveLength(1);

  return { suffix, branch, warehouse, location, supplier, unit, product, variant, purchaseOrder };
}

async function openReceiptEditor(page: import('@playwright/test').Page, purchaseOrderId: string, sku: string) {
  await page.getByTestId('goods-receipt-create-button').click();
  const editor = page.getByRole('dialog', { name: 'Phiếu nhận hàng nháp' });
  await expect(editor).toBeVisible();
  await editor.getByTestId('goods-receipt-purchase-order-select').selectOption(purchaseOrderId);
  await expect(editor).toContainText(sku);
  return editor;
}

test.describe('Phiếu nhận hàng mua vào', () => {
  test('nhận một phần, nhận đủ, ghi sổ tồn kho và đảo phiếu', async ({ page, request }) => {
    const fixture = await createFixture(request);
    const firstReference = `DELIVERY-1-${fixture.suffix}`;
    const secondReference = `DELIVERY-2-${fixture.suffix}`;
    const shortageReference = `DELIVERY-SHORT-${fixture.suffix}`;

    await page.goto('/purchasing/goods-receipts');
    await expect(page.getByTestId('goods-receipts-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Phiếu nhận hàng', exact: true })).toBeVisible();
    await expect(page.getByTestId('nav-goods-receipts')).toBeVisible();

    let editor = await openReceiptEditor(page, fixture.purchaseOrder.id, fixture.variant.sku);
    await editor.locator('input').nth(1).fill(firstReference);
    await editor.locator('input[inputmode="decimal"]').nth(0).fill('3');
    await editor.locator('input[inputmode="decimal"]').nth(1).fill('1');
    const firstLine = editor.getByRole('row').filter({ hasText: fixture.variant.sku }).first();
    await firstLine.getByRole('textbox').nth(2).fill('DAMAGED');
    await firstLine.getByRole('textbox').nth(3).fill('Thùng bị móp');
    await page.getByTestId('goods-receipt-save-button').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('status')).toBeVisible();

    await page.getByTestId('goods-receipt-search').fill(firstReference);
    let receiptRow = page.getByTestId('goods-receipts-table').locator('tbody tr');
    await expect(receiptRow).toHaveCount(1);
    await expect(receiptRow.getByRole('button')).toHaveCount(3);
    await receiptRow.getByRole('button').last().click();
    await page.getByTestId('goods-receipt-post-confirm').click();
    await expect(page.getByRole('status')).toBeVisible();
    await expect(receiptRow.getByRole('button')).toHaveCount(2);

    await receiptRow.getByRole('button').first().click();
    let receiptDetail = page.getByRole('dialog').filter({ hasText: firstReference });
    await expect(receiptDetail).toContainText('DAMAGED');
    await expect(receiptDetail).toContainText('Thùng bị móp');
    await expect(receiptDetail).toContainText('3');
    await expect(receiptDetail).toContainText('1');
    await receiptDetail.getByRole('button', { name: 'Đóng', exact: true }).click();

    await page.getByTestId('goods-receipt-search').fill('');
    editor = await openReceiptEditor(page, fixture.purchaseOrder.id, fixture.variant.sku);
    await expect(editor).toContainText('7');
    await editor.locator('input').nth(1).fill(secondReference);
    await editor.locator('input[inputmode="decimal"]').nth(0).fill('7');
    await editor.locator('input[inputmode="decimal"]').nth(1).fill('0');
    await page.getByTestId('goods-receipt-save-button').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Đã tạo phiếu nhận hàng nháp');

    await page.getByTestId('goods-receipt-search').fill(secondReference);
    receiptRow = page.getByTestId('goods-receipts-table').locator('tbody tr');
    await expect(receiptRow).toHaveCount(1);
    await expect(receiptRow.getByRole('button')).toHaveCount(3);
    await receiptRow.getByRole('button').last().click();
    await page.getByTestId('goods-receipt-post-confirm').click();
    await expect(page.getByRole('status')).toBeVisible();
    await expect(receiptRow.getByRole('button')).toHaveCount(2);

    await page.goto('/purchasing/purchase-orders');
    await page.getByTestId('purchase-order-search').fill(fixture.purchaseOrder.number);
    let purchaseOrderRow = page.getByTestId('purchase-orders-table').locator('tbody tr');
    await expect(purchaseOrderRow).toHaveCount(1);
    await purchaseOrderRow.getByRole('button').first().click();
    let detail = page.getByRole('dialog', { name: fixture.purchaseOrder.number });
    await expect(detail).toContainText('10');
    await expect(detail).toContainText('1');
    await expect(detail).toContainText('0');
    await expect(detail).toContainText('11');
    const receiptSummaryTable = detail.getByTestId('purchase-order-receipts-table');
    await expect(receiptSummaryTable).toContainText(firstReference);
    await expect(receiptSummaryTable).toContainText(secondReference);
    await detail.getByRole('button').first().click();

    await page.goto('/purchasing/goods-receipts');
    await page.getByTestId('goods-receipt-search').fill(secondReference);
    receiptRow = page.getByTestId('goods-receipts-table').locator('tbody tr');
    await expect(receiptRow).toHaveCount(1);
    await expect(receiptRow.getByRole('button')).toHaveCount(2);
    await receiptRow.getByRole('button').last().click();
    const reverseDialog = page.getByRole('dialog');
    await reverseDialog.getByRole('textbox').first().fill('Đảo lần nhận thứ hai trong Browser E2E');
    await page.getByTestId('goods-receipt-reverse-confirm').click();
    await expect(page.getByRole('status')).toBeVisible();
    await expect(receiptRow.getByRole('button')).toHaveCount(1);

    await page.goto('/purchasing/purchase-orders');
    await page.getByTestId('purchase-order-search').fill(fixture.purchaseOrder.number);
    purchaseOrderRow = page.getByTestId('purchase-orders-table').locator('tbody tr');
    await expect(purchaseOrderRow).toHaveCount(1);
    await purchaseOrderRow.getByRole('button').first().click();
    detail = page.getByRole('dialog', { name: fixture.purchaseOrder.number });
    await expect(detail).toContainText('3');
    await expect(detail).toContainText('1');
    await expect(detail).toContainText('0');
    await expect(detail).toContainText('7');
    await expect(detail.getByTestId('purchase-order-receipts-table')).toContainText(secondReference);
    await detail.getByRole('button').last().click();

    await page.goto('/purchasing/goods-receipts');
    editor = await openReceiptEditor(page, fixture.purchaseOrder.id, fixture.variant.sku);
    await editor.locator('input[inputmode="decimal"]').first().fill('8');
    await page.getByTestId('goods-receipt-save-button').click();
    await expect(editor.getByTestId('goods-receipt-editor-error')).toContainText(/remaining/i);

    await editor.locator('input[inputmode="decimal"]').nth(0).fill('2');
    await editor.getByRole('checkbox').check();
    await editor.locator('input').nth(1).fill(shortageReference);
    const shortageLine = editor.getByRole('row').filter({ hasText: fixture.variant.sku }).first();
    await shortageLine.getByRole('textbox').nth(2).fill('SHORTAGE');
    await shortageLine.getByRole('textbox').nth(3).fill('Nhà cung cấp xác nhận giao thiếu');
    await page.getByTestId('goods-receipt-save-button').click();
    await expect(editor).toHaveCount(0);
    await page.getByTestId('goods-receipt-search').fill(shortageReference);
    receiptRow = page.getByTestId('goods-receipts-table').locator('tbody tr');
    await expect(receiptRow).toHaveCount(1);
    await receiptRow.getByRole('button', { name: 'Ghi sổ', exact: true }).click();
    await page.getByTestId('goods-receipt-post-confirm').click();
    await expect(receiptRow.getByRole('button')).toHaveCount(2);
    await expect(page.getByRole('status')).toContainText('đã được ghi sổ');

    await page.goto('/purchasing/purchase-orders');
    await page.getByTestId('purchase-order-search').fill(fixture.purchaseOrder.number);
    purchaseOrderRow = page.getByTestId('purchase-orders-table').locator('tbody tr');
    await expect(purchaseOrderRow).toContainText('Đã đóng');

    await page.goto('/purchasing/goods-receipts');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('goods-receipts-page')).toBeVisible();
  });
});