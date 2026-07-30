import { test, expect, type APIRequestContext } from '@playwright/test';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function createFixture(request: APIRequestContext, code: string) {
  const create = async (path: string, key: string, data: Record<string, unknown>) => {
    const response = await request.post(path, { headers: { 'Idempotency-Key': key }, data });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  };

  const branch = await create('/api/organization/branches', `sp-branch-${code}`, {
    code: `SPB-${code}`,
    name: `Chi nhánh thanh toán ${code}`,
  });
  const warehouse = await create('/api/organization/warehouses', `sp-warehouse-${code}`, {
    branchId: branch.id,
    code: `SPW-${code}`,
    name: `Kho thanh toán ${code}`,
    warehouseType: 'main',
  });
  const location = await create('/api/organization/warehouse-locations', `sp-location-${code}`, {
    warehouseId: warehouse.id,
    code: `SPL-${code}`,
    name: `Vị trí thanh toán ${code}`,
    locationType: 'storage',
  });
  const supplier = await create('/api/suppliers', `sp-supplier-${code}`, {
    code: `SPS-${code}`,
    name: `Nhà cung cấp thanh toán ${code}`,
    taxId: `TAX-SP-${code}`,
  });
  const unit = await create('/api/units', `sp-unit-${code}`, {
    code: `SPE-${code}`,
    name: `Đơn vị thanh toán ${code}`,
    unitKind: 'COUNT',
    allowsFractional: true,
  });
  const product = await create('/api/products', `sp-product-${code}`, {
    code: `SPP-${code}`,
    name: `Sản phẩm thanh toán ${code}`,
  });
  const variant = await create(`/api/products/${product.id}/variants`, `sp-variant-${code}`, {
    sku: `SPSKU-${code}`,
    name: `SKU thanh toán ${code}`,
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
    headers: { 'Idempotency-Key': `sp-policy-${code}` },
    data: {
      baseVariantId: variant.id,
      lotTrackingMode: 'NONE',
      expiryTrackingMode: 'NONE',
      locationRequired: true,
    },
  });
  expect(response.status()).toBe(200);

  response = await request.post('/api/purchase-orders', {
    headers: { 'Idempotency-Key': `sp-po-create-${code}` },
    data: {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      orderDate: '2026-07-30',
      currencyCode: 'VND',
      lines: [{
        variantId: variant.id,
        quantity: '10',
        unitPrice: '10000',
        discountAmount: '0',
        taxAmount: '0',
      }],
    },
  });
  expect(response.status()).toBe(201);
  const draftOrder = (await response.json()).data;

  response = await request.post(`/api/purchase-orders/${draftOrder.id}/submit`, {
    headers: { 'Idempotency-Key': `sp-po-submit-${code}` },
    data: { expectedRevision: draftOrder.revision },
  });
  expect(response.status()).toBe(200);
  const submittedOrder = (await response.json()).data;

  response = await request.post(`/api/purchase-orders/${draftOrder.id}/approve`, {
    headers: { 'Idempotency-Key': `sp-po-approve-${code}` },
    data: { expectedRevision: submittedOrder.revision },
  });
  expect(response.status()).toBe(200);
  const purchaseOrder = (await response.json()).data;

  response = await request.post('/api/goods-receipts', {
    headers: { 'Idempotency-Key': `sp-gr-create-${code}` },
    data: {
      purchaseOrderId: purchaseOrder.id,
      receiptDate: '2026-07-30',
      supplierDeliveryReference: `SP-GR-${code}`,
      lines: [{
        purchaseOrderLineId: purchaseOrder.lines[0].id,
        receivedQuantity: '10',
        acceptedQuantity: '10',
        rejectedQuantity: '0',
        finalizeLine: false,
        locationId: location.id,
      }],
    },
  });
  expect(response.status()).toBe(201);
  const draftReceipt = (await response.json()).data;

  response = await request.post(`/api/goods-receipts/${draftReceipt.id}/post`, {
    headers: { 'Idempotency-Key': `sp-gr-post-${code}` },
    data: { expectedRevision: draftReceipt.revision },
  });
  expect(response.status()).toBe(200);
  const goodsReceipt = (await response.json()).data;

  return { warehouse, supplier, goodsReceipt };
}

test('supplier payment workspace allocates, guards reversal and restores history', async ({ page, request }) => {
  const code = suffix();
  const fixture = await createFixture(request, code);

  await page.goto('/accounting/supplier-payments');
  await expect(page.getByTestId('supplier-payments-page')).toBeVisible();
  await expect(page.getByTestId('nav-supplier-payments')).toBeVisible();

  const form = page.getByTestId('supplier-payment-form');
  await form.getByLabel('Nhà cung cấp').selectOption(fixture.supplier.id);
  await form.getByLabel('Kho').selectOption(fixture.warehouse.id);
  await form.getByLabel('Số tiền').fill('60000');
  await form.getByLabel('Tham chiếu ngân hàng').fill(`BANK-${code}`);
  await form.getByLabel('Ghi chú').fill('Thanh toán kiểm thử giao diện Phase 5.6');
  await form.getByRole('button', { name: 'Ghi nhận thanh toán' }).click();

  await expect(page.getByRole('status')).toContainText('Đã ghi nhận phiếu SP-');
  const paymentTable = page.getByTestId('supplier-payments-table');
  const paymentRow = paymentTable.locator('tbody tr').filter({ hasText: fixture.supplier.code });
  await expect(paymentRow).toHaveCount(1);
  await expect(paymentRow).toContainText('60.000');
  await paymentRow.getByRole('button', { name: /^SP-/ }).click();

  const detail = page.getByTestId('supplier-payment-detail');
  await expect(detail).toContainText(fixture.supplier.code);
  const allocationForm = page.getByTestId('supplier-payment-allocation-form');
  const targetSelect = allocationForm.getByLabel('Chứng từ phải trả');
  const targetValue = await targetSelect.locator('option')
    .filter({ hasText: fixture.goodsReceipt.documentNumber })
    .first()
    .getAttribute('value');
  expect(targetValue).toBeTruthy();
  await targetSelect.selectOption(targetValue!);
  await allocationForm.getByLabel('Số tiền phân bổ').fill('50000');
  await allocationForm.getByRole('button', { name: 'Phân bổ' }).click();

  await expect(page.getByRole('status')).toContainText('Đã phân bổ thanh toán');
  await expect(detail).toContainText('Đã phân bổ một phần');
  const allocationTable = page.getByTestId('supplier-payment-allocations-table');
  const allocationRow = allocationTable.locator('tbody tr').filter({ hasText: fixture.goodsReceipt.documentNumber });
  await expect(allocationRow).toContainText('50.000');
  await expect(allocationRow).toContainText('Hiệu lực');

  const reversePayment = detail.getByRole('button', { name: 'Đảo phiếu thanh toán' });
  await expect(reversePayment).toBeDisabled();
  await detail.getByLabel('Lý do đảo').fill('Đảo phân bổ và thanh toán trong Browser E2E');
  await allocationRow.getByRole('button', { name: 'Đảo' }).click();

  await expect(page.getByRole('status')).toContainText('Đã đảo phân bổ');
  await expect(allocationTable).toContainText('Đã đảo');
  await expect(reversePayment).toBeEnabled();
  await reversePayment.click();

  await expect(page.getByRole('status')).toContainText('Đã đảo phiếu SP-');
  await expect(detail).toContainText('Đã đảo');
});
