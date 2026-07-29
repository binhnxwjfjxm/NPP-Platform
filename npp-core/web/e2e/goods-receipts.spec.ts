import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function createFixture(request: APIRequestContext, suffix: string) {
  const create = async (path: string, key: string, data: Record<string, unknown>) => {
    const response = await request.post(path, { headers: { 'Idempotency-Key': key }, data });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  };

  const branch = await create('/api/organization/branches', `gr-branch-${suffix}`, {
    code: `GRB-${suffix}`,
    name: `Chi nhánh nhận hàng ${suffix}`,
    address: `Địa chỉ ${suffix}`,
    phone: '0901234567',
    email: `gr-branch-${suffix.toLowerCase()}@example.com`,
  });
  const warehouse = await create('/api/organization/warehouses', `gr-warehouse-${suffix}`, {
    branchId: branch.id,
    code: `GRW-${suffix}`,
    name: `Kho nhận hàng ${suffix}`,
    warehouseType: 'main',
  });
  const location = await create('/api/organization/warehouse-locations', `gr-location-${suffix}`, {
    warehouseId: warehouse.id,
    code: `GRL-${suffix}`,
    name: `Vị trí nhận hàng ${suffix}`,
    locationType: 'storage',
  });
  const supplier = await create('/api/suppliers', `gr-supplier-${suffix}`, {
    code: `GRS-${suffix}`,
    name: `Nhà cung cấp nhận hàng ${suffix}`,
    taxId: `TAX-GR-${suffix}`,
    avgDeliveryDays: 3,
  });
  const unit = await create('/api/units', `gr-unit-${suffix}`, {
    code: `GRE-${suffix}`,
    name: `Đơn vị nhận ${suffix}`,
    unitKind: 'COUNT',
    allowsFractional: true,
  });
  const product = await create('/api/products', `gr-product-${suffix}`, {
    code: `GRP-${suffix}`,
    name: `Sản phẩm nhận hàng ${suffix}`,
  });
  const variant = await create(`/api/products/${product.id}/variants`, `gr-variant-${suffix}`, {
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

  response = await request.put(`/api/inventory/tracking-policies/${variant.id}`, {
    headers: { 'Idempotency-Key': `gr-policy-${suffix}` },
    data: {
      baseVariantId: variant.id,
      lotTrackingMode: 'NONE',
      expiryTrackingMode: 'NONE',
      locationRequired: true,
    },
  });
  expect(response.status()).toBe(200);

  const poCreate = await request.post('/api/purchase-orders', {
    headers: { 'Idempotency-Key': `gr-po-create-${suffix}` },
    data: {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      orderDate: '2026-07-29',
      expectedDate: '2026-08-05',
      supplierReference: `GR-PO-${suffix}`,
      currencyCode: 'VND',
      note: 'PO phục vụ Browser E2E P5.2',
      lines: [{
        variantId: variant.id,
        quantity: '10',
        unitPrice: '10000',
        discountAmount: '0',
        taxAmount: '0',
      }],
    },
  });
  expect(poCreate.status()).toBe(201);
  const draftPurchaseOrder = (await poCreate.json()).data;

  const submit = await request.post(`/api/purchase-orders/${draftPurchaseOrder.id}/submit`, {
    headers: { 'Idempotency-Key': `gr-po-submit-${suffix}` },
    data: { expectedRevision: draftPurchaseOrder.revision },
  });
  expect(submit.status()).toBe(200);
  const submittedPurchaseOrder = (await submit.json()).data;

  const approve = await request.post(`/api/purchase-orders/${draftPurchaseOrder.id}/approve`, {
    headers: { 'Idempotency-Key': `gr-po-approve-${suffix}` },
    data: { expectedRevision: submittedPurchaseOrder.revision },
  });
  expect(approve.status()).toBe(200);
  const purchaseOrder = (await approve.json()).data;

  return { warehouse, location, supplier, variant, purchaseOrder };
}

async function openReceiptEditor(page: Page, purchaseOrderId: string, sku: string) {
  await page.getByTestId('goods-receipt-create-button').click();
  const editor = page.getByRole('dialog', { name: 'Phiếu nhận hàng nháp' });
  await expect(editor).toBeVisible();
  await editor.locator('select').first().selectOption(purchaseOrderId);
  await expect(editor.getByText(sku, { exact: true })).toBeVisible();
  return editor;
}

test.describe('Phiếu nhận hàng mua vào', () => {
  test('nhận một phần, nhận đủ, ghi sổ tồn kho và đảo phiếu', async ({ page, request }) => {
    const suffix = uniqueSuffix();
    const fixture = await createFixture(request, suffix);
    const firstReference = `DELIVERY-1-${suffix}`;
    const secondReference = `DELIVERY-2-${suffix}`;

    await page.goto('/purchasing/goods-receipts');
    await expect(page.getByTestId('goods-receipts-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Phiếu nhận hàng', exact: true })).toBeVisible();
    await expect(page.getByTestId('nav-goods-receipts')).toBeVisible();

    let editor = await openReceiptEditor(page, fixture.purchaseOrder.id, fixture.variant.sku);
    await editor.locator('input').nth(1).fill(firstReference);
    await editor.locator('input[inputmode="decimal"]').first().fill('4');
    await page.getByTestId('goods-receipt-save-button').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByText('Đã tạo phiếu nhận hàng nháp.')).toBeVisible();

    await page.getByTestId('goods-receipt-search').fill(firstReference);
    let receiptRow = page.getByTestId('goods-receipts-table').locator('tbody tr');
    await expect(receiptRow).toHaveCount(1);
    await receiptRow.getByRole('button', { name: 'Ghi sổ', exact: true }).click();
    await page.getByTestId('goods-receipt-post-confirm').click();
    await expect(page.getByText('Phiếu nhận hàng đã được ghi sổ.')).toBeVisible();
    await expect(receiptRow).toContainText('Đã ghi sổ');

    await page.getByTestId('goods-receipt-search').fill('');
    editor = await openReceiptEditor(page, fixture.purchaseOrder.id, fixture.variant.sku);
    await expect(editor).toContainText('6');
    await editor.locator('input').nth(1).fill(secondReference);
    await editor.locator('input[inputmode="decimal"]').first().fill('6');
    await page.getByTestId('goods-receipt-save-button').click();
    await expect(page.getByText('Đã tạo phiếu nhận hàng nháp.')).toBeVisible();

    await page.getByTestId('goods-receipt-search').fill(secondReference);
    receiptRow = page.getByTestId('goods-receipts-table').locator('tbody tr');
    await expect(receiptRow).toHaveCount(1);
    await receiptRow.getByRole('button', { name: 'Ghi sổ', exact: true }).click();
    await page.getByTestId('goods-receipt-post-confirm').click();
    await expect(page.getByText('Phiếu nhận hàng đã được ghi sổ.')).toBeVisible();

    await page.goto('/purchasing/purchase-orders');
    await page.getByTestId('purchase-order-search').fill(fixture.purchaseOrder.number);
    let purchaseOrderRow = page.getByTestId('purchase-orders-table').locator('tbody tr');
    await expect(purchaseOrderRow).toHaveCount(1);
    await expect(purchaseOrderRow).toContainText('Đã nhận đủ');
    await purchaseOrderRow.getByRole('button', { name: 'Xem', exact: true }).click();
    let detail = page.getByRole('dialog', { name: fixture.purchaseOrder.number });
    await expect(detail).toContainText('Đã nhận');
    await expect(detail).toContainText('10');
    await expect(detail).toContainText('Còn lại');
    const receiptSummaryTable = detail.getByTestId('purchase-order-receipts-table');
    await expect(receiptSummaryTable).toContainText(firstReference);
    await expect(receiptSummaryTable).toContainText(secondReference);
    await detail.getByRole('button', { name: 'Đóng chi tiết', exact: true }).click();

    await page.goto('/purchasing/goods-receipts');
    await page.getByTestId('goods-receipt-search').fill(secondReference);
    receiptRow = page.getByTestId('goods-receipts-table').locator('tbody tr');
    await expect(receiptRow).toHaveCount(1);
    await receiptRow.getByRole('button', { name: 'Đảo phiếu', exact: true }).click();
    const reverseDialog = page.getByRole('dialog', { name: 'Đảo phiếu' });
    await reverseDialog.getByRole('textbox', { name: 'Lý do đảo phiếu' }).fill('Đảo lần nhận thứ hai trong Browser E2E');
    await page.getByTestId('goods-receipt-reverse-confirm').click();
    await expect(page.getByText('Phiếu nhận hàng đã được đảo.')).toBeVisible();
    await expect(receiptRow).toContainText('Đã đảo');

    await page.goto('/purchasing/purchase-orders');
    await page.getByTestId('purchase-order-search').fill(fixture.purchaseOrder.number);
    purchaseOrderRow = page.getByTestId('purchase-orders-table').locator('tbody tr');
    await expect(purchaseOrderRow).toHaveCount(1);
    await expect(purchaseOrderRow).toContainText('Đã nhận một phần');
    await purchaseOrderRow.getByRole('button', { name: 'Xem', exact: true }).click();
    detail = page.getByRole('dialog', { name: fixture.purchaseOrder.number });
    await expect(detail).toContainText('Đã nhận');
    await expect(detail).toContainText('4');
    await expect(detail).toContainText('Còn lại');
    await expect(detail).toContainText('6');
    await expect(detail.getByTestId('purchase-order-receipts-table')).toContainText('Đã đảo');
    await detail.getByRole('button', { name: 'Đóng chi tiết', exact: true }).click();

    await page.goto('/purchasing/goods-receipts');
    editor = await openReceiptEditor(page, fixture.purchaseOrder.id, fixture.variant.sku);
    await editor.locator('input[inputmode="decimal"]').first().fill('7');
    await page.getByTestId('goods-receipt-save-button').click();
    await expect(page.locator('[role="alert"]').filter({ hasText: /remaining/i })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('goods-receipts-page')).toBeVisible();
  });
});
