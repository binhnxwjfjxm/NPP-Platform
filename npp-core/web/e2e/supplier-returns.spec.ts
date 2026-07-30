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

  const branch = await create('/api/organization/branches', `sr-branch-${suffix}`, {
    code: `SRB-${suffix}`,
    name: `Chi nhánh trả NCC ${suffix}`,
    address: `Địa chỉ ${suffix}`,
    phone: '0901234567',
    email: `sr-branch-${suffix.toLowerCase()}@example.com`,
  });
  const warehouse = await create('/api/organization/warehouses', `sr-warehouse-${suffix}`, {
    branchId: branch.id,
    code: `SRW-${suffix}`,
    name: `Kho trả NCC ${suffix}`,
    warehouseType: 'main',
  });
  const location = await create('/api/organization/warehouse-locations', `sr-location-${suffix}`, {
    warehouseId: warehouse.id,
    code: `SRL-${suffix}`,
    name: `Vị trí trả NCC ${suffix}`,
    locationType: 'storage',
  });
  const supplier = await create('/api/suppliers', `sr-supplier-${suffix}`, {
    code: `SRS-${suffix}`,
    name: `Nhà cung cấp trả NCC ${suffix}`,
    taxId: `TAX-SR-${suffix}`,
    avgDeliveryDays: 3,
  });
  const unit = await create('/api/units', `sr-unit-${suffix}`, {
    code: `SRE-${suffix}`,
    name: `Đơn vị lẻ ${suffix}`,
    unitKind: 'COUNT',
    allowsFractional: true,
  });
  const cartonUnit = await create('/api/units', `sr-carton-unit-${suffix}`, {
    code: `SRT-${suffix}`,
    name: `Thùng ${suffix}`,
    unitKind: 'PACKAGE',
    allowsFractional: false,
  });
  const product = await create('/api/products', `sr-product-${suffix}`, {
    code: `SRP-${suffix}`,
    name: `Sản phẩm trả NCC ${suffix}`,
  });
  const baseVariant = await create(`/api/products/${product.id}/variants`, `sr-base-variant-${suffix}`, {
    sku: `SRB-${suffix}`,
    name: `SKU gốc ${suffix}`,
    variantKind: 'BASE',
    isInventoryBase: true,
    isSellable: true,
    isCatalogVisible: true,
  });
  const cartonVariant = await create(`/api/products/${product.id}/variants`, `sr-carton-variant-${suffix}`, {
    sku: `SRC-${suffix}`,
    name: `SKU thùng ${suffix}`,
    variantKind: 'CARTON',
    isInventoryBase: false,
    isSellable: true,
    isCatalogVisible: true,
  });

  let response = await request.patch(`/api/products/${product.id}/variants/${baseVariant.id}/unit`, {
    data: { unitId: unit.id, conversionToBase: '1', expectedUpdatedAt: baseVariant.updated_at },
  });
  expect(response.status()).toBe(200);

  response = await request.patch(`/api/products/${product.id}/variants/${cartonVariant.id}/unit`, {
    data: { unitId: cartonUnit.id, conversionToBase: '12', expectedUpdatedAt: cartonVariant.updated_at },
  });
  expect(response.status()).toBe(200);
  const cartonAssigned = (await response.json()).data;

  response = await request.patch(`/api/products/${product.id}`, {
    data: { isOrderable: true, expectedUpdatedAt: product.updated_at },
  });
  expect(response.status()).toBe(200);

  response = await request.put(`/api/inventory/tracking-policies/${baseVariant.id}`, {
    headers: { 'Idempotency-Key': `sr-policy-${suffix}` },
    data: {
      baseVariantId: baseVariant.id,
      lotTrackingMode: 'NONE',
      expiryTrackingMode: 'NONE',
      locationRequired: true,
    },
  });
  expect(response.status()).toBe(200);

  const poCreate = await request.post('/api/purchase-orders', {
    headers: { 'Idempotency-Key': `sr-po-create-${suffix}` },
    data: {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      orderDate: '2026-07-29',
      expectedDate: '2026-08-05',
      supplierReference: `SR-PO-${suffix}`,
      currencyCode: 'VND',
      note: 'PO phục vụ supplier return',
      lines: [{
        variantId: cartonVariant.id,
        quantity: '10',
        unitPrice: '10000',
        discountAmount: '0',
        taxAmount: '0',
      }],
    },
  });
  expect(poCreate.status()).toBe(201);
  const draftPurchaseOrder = (await poCreate.json()).data;

  response = await request.post(`/api/purchase-orders/${draftPurchaseOrder.id}/submit`, {
    headers: { 'Idempotency-Key': `sr-po-submit-${suffix}` },
    data: { expectedRevision: draftPurchaseOrder.revision },
  });
  expect(response.status()).toBe(200);
  const submittedPurchaseOrder = (await response.json()).data;

  response = await request.post(`/api/purchase-orders/${draftPurchaseOrder.id}/approve`, {
    headers: { 'Idempotency-Key': `sr-po-approve-${suffix}` },
    data: { expectedRevision: submittedPurchaseOrder.revision },
  });
  expect(response.status()).toBe(200);
  const purchaseOrder = (await response.json()).data;

  const grCreate = await request.post('/api/goods-receipts', {
    headers: { 'Idempotency-Key': `sr-gr-create-${suffix}` },
    data: {
      purchaseOrderId: purchaseOrder.id,
      receiptDate: '2026-07-29',
      supplierDeliveryReference: `SR-GR-${suffix}`,
      note: 'Phiếu nhận hàng phục vụ supplier return',
      lines: [{
        purchaseOrderLineId: purchaseOrder.lines[0].id,
        receivedQuantity: '2',
        acceptedQuantity: '2',
        rejectedQuantity: '0',
        finalizeLine: false,
        locationId: location.id,
        note: 'Dòng nhận',
      }],
    },
  });
  expect(grCreate.status()).toBe(201);
  const draftReceipt = (await grCreate.json()).data;

  response = await request.post(`/api/goods-receipts/${draftReceipt.id}/post`, {
    headers: { 'Idempotency-Key': `sr-gr-post-${suffix}` },
    data: { expectedRevision: draftReceipt.revision },
  });
  expect(response.status()).toBe(200);
  const postedReceipt = (await response.json()).data;

  return {
    branch,
    warehouse,
    location,
    supplier,
    unit,
    cartonUnit,
    product,
    baseVariant,
    cartonVariant: cartonAssigned,
    purchaseOrder,
    goodsReceipt: postedReceipt,
  };
}

async function openReturnEditor(page: Page, goodsReceiptNumber: string) {
  await page.goto('/purchasing/goods-receipts');
  await expect(page.getByTestId('goods-receipts-page')).toBeVisible();
  await page.getByTestId('goods-receipt-search').fill(goodsReceiptNumber);
  const row = page.getByTestId('goods-receipts-table').locator('tbody tr').filter({ hasText: goodsReceiptNumber });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Xem', exact: true }).click();
  const detail = page.getByRole('dialog', { name: goodsReceiptNumber });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('link', { name: 'Tạo phiếu trả NCC', exact: true })).toBeVisible();
  await detail.getByRole('link', { name: 'Tạo phiếu trả NCC', exact: true }).click();
  await expect(page).toHaveURL(/\/purchasing\/supplier-returns\?goodsReceiptId=/);
  const editor = page.getByRole('dialog', { name: 'Phiếu trả nháp' });
  await expect(editor).toBeVisible();
  return editor;
}

test.describe('Phiếu trả nhà cung cấp', () => {
  test('mở từ phiếu nhận hàng, tạo, duyệt, ghi sổ và đảo phiếu', async ({ page, request }) => {
    const suffix = uniqueSuffix();
    const fixture = await createFixture(request, suffix);
    const editor = await openReturnEditor(page, fixture.goodsReceipt.documentNumber);

    const line = editor.getByRole('row').filter({ hasText: fixture.goodsReceipt.documentNumber }).first();
    await line.locator('input').nth(0).fill('1');
    await line.locator('input').nth(1).fill('DAMAGED');
    await line.locator('input').nth(2).fill('Thùng bị móp');
    await editor.getByTestId('supplier-return-save').click();
    await expect(editor).toHaveCount(0);

    const table = page.getByTestId('supplier-returns-table');
    await expect(table).toBeVisible();
    const row = table.locator('tbody tr').first();
    await expect(row).toContainText('Nháp');

    await row.getByRole('button', { name: 'Gửi duyệt', exact: true }).click();
    await page.getByTestId('supplier-return-submit-confirm').click();
    await expect(row).toContainText('Chờ duyệt');

    await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await page.getByTestId('supplier-return-approve-confirm').click();
    await expect(row).toContainText('Đã duyệt');

    await row.getByRole('button', { name: 'Ghi sổ', exact: true }).click();
    await page.getByTestId('supplier-return-post-confirm').click();
    await expect(row).toContainText('Đã ghi sổ');

    await row.getByRole('button', { name: 'Đảo phiếu', exact: true }).click();
    await page.getByTestId('supplier-return-reverse-reason').fill('Đảo phiếu trả do kiểm thử');
    await page.getByTestId('supplier-return-reverse-confirm').click();
    await expect(row).toContainText('Đã đảo');
  });

  test('hủy phiếu nháp với lý do bắt buộc', async ({ page, request }) => {
    const suffix = uniqueSuffix();
    const fixture = await createFixture(request, suffix);
    const editor = await openReturnEditor(page, fixture.goodsReceipt.documentNumber);
    const line = editor.getByRole('row').filter({ hasText: fixture.goodsReceipt.documentNumber }).first();
    await line.locator('input').nth(0).fill('1');
    await line.locator('input').nth(1).fill('OTHER');
    await line.locator('input').nth(2).fill('Hủy để kiểm thử');
    await editor.getByTestId('supplier-return-save').click();

    const row = page.getByTestId('supplier-returns-table').locator('tbody tr').first();
    await row.getByRole('button', { name: 'Hủy', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Phiếu chưa cấp số' });
    await dialog.locator('input').fill('Không tiếp tục trả hàng');
    await page.getByTestId('supplier-return-cancel-confirm').click();
    await expect(row).toContainText('Đã hủy');
  });

  test('mobile smoke mở được trình tạo phiếu trả', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const suffix = uniqueSuffix();
    const fixture = await createFixture(request, suffix);
    const editor = await openReturnEditor(page, fixture.goodsReceipt.documentNumber);
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('supplier-return-save')).toBeVisible();
  });
});
