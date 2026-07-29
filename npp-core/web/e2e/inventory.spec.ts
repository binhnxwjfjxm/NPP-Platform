import { test, expect, type APIRequestContext } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function createFixture(request: APIRequestContext, suffix: string) {
  const create = async (path: string, key: string, data: Record<string, unknown>) => {
    const response = await request.post(path, { headers: { 'Idempotency-Key': key }, data });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  };

  const branch = await create('/api/organization/branches', `inventory-branch-${suffix}`, {
    code: `BR-${suffix}`, name: `Chi nhánh ${suffix}`, address: `Địa chỉ ${suffix}`,
    phone: '0901234567', email: `branch-${suffix.toLowerCase()}@example.com`,
  });
  const warehouse = await create('/api/organization/warehouses', `inventory-warehouse-${suffix}`, {
    branchId: branch.id, code: `WH-${suffix}`, name: `Kho ${suffix}`, warehouseType: 'main',
  });
  const location = await create('/api/organization/warehouse-locations', `inventory-location-${suffix}`, {
    warehouseId: warehouse.id, code: `LOC-${suffix}`, name: `Vị trí ${suffix}`, locationType: 'storage',
  });
  const unit = await create('/api/units', `inventory-unit-${suffix}`, {
    code: `EA-${suffix}`, name: `Đơn vị ${suffix}`, unitKind: 'COUNT', allowsFractional: false,
  });
  const cartonUnit = await create('/api/units', `inventory-carton-unit-${suffix}`, {
    code: `CT-${suffix}`, name: `Thùng ${suffix}`, unitKind: 'PACKAGE', allowsFractional: false,
  });
  const product = await create('/api/products', `inventory-product-${suffix}`, {
    code: `P-${suffix}`, name: `Sản phẩm ${suffix}`,
  });
  const baseVariant = await create(`/api/products/${product.id}/variants`, `inventory-base-variant-${suffix}`, {
    sku: `BASE-${suffix}`, name: `SKU cơ sở ${suffix}`, variantKind: 'BASE',
    isInventoryBase: true, isSellable: true, isCatalogVisible: true,
  });
  const sourceVariant = await create(`/api/products/${product.id}/variants`, `inventory-source-variant-${suffix}`, {
    sku: `SRC-${suffix}`, name: `SKU nguồn ${suffix}`, variantKind: 'CARTON',
    isInventoryBase: false, isSellable: true, isCatalogVisible: true,
  });

  let response = await request.patch(`/api/products/${product.id}/variants/${sourceVariant.id}/unit`, {
    data: { unitId: cartonUnit.id, conversionToBase: '12', expectedUpdatedAt: sourceVariant.updated_at },
  });
  expect(response.status()).toBe(200);
  response = await request.patch(`/api/products/${product.id}/variants/${baseVariant.id}/unit`, {
    data: { unitId: unit.id, conversionToBase: '1', expectedUpdatedAt: baseVariant.updated_at },
  });
  expect(response.status()).toBe(200);
  response = await request.put(`/api/inventory/tracking-policies/${baseVariant.id}`, {
    headers: { 'Idempotency-Key': `inventory-policy-${suffix}` },
    data: { baseVariantId: baseVariant.id, lotTrackingMode: 'REQUIRED', expiryTrackingMode: 'OPTIONAL', locationRequired: true },
  });
  expect(response.status()).toBe(200);

  return { warehouse, location, baseVariant, sourceVariant };
}

function expectNoSensitiveData(value: string) {
  for (const secret of ['CORE_API_SERVER_TOKEN', 'CORE_API_INTERNAL_URL', 'BACKEND_API_TOKEN', 'DATABASE_URL', 'postgresql://']) {
    expect(value).not.toContain(secret);
  }
}

test.describe('Kho vận', () => {
  test('tra cứu tồn kho, chính sách lô và thiết lập đầu kỳ chạy qua API thật', async ({ page, request }) => {
    const suffix = uniqueSuffix();
    const fixture = await createFixture(request, suffix);
    const sourceKey = `opening-${suffix}`;

    await page.goto('/inventory/balances');
    await expect(page.getByTestId('inventory-page')).toBeVisible();
    await expect(page.getByTestId('inventory-balances-section').getByRole('heading', { name: 'Tồn kho', exact: true })).toBeVisible();
    await expect(page.getByTestId('inventory-menu-toggle')).toHaveAttribute('aria-expanded', 'true');

    await page.goto('/inventory/tracking-policies');
    await expect(page.getByTestId(`inventory-policy-row-${fixture.baseVariant.sku}`)).toBeVisible();
    await page.getByTestId(`edit-policy-${fixture.baseVariant.sku}`).click();
    await expect(page.getByTestId('inventory-policy-editor')).toBeVisible();

    await page.goto('/inventory/opening-balances');
    await page.getByTestId('inventory-opening-source-key-input').fill(sourceKey);
    await page.getByTestId('inventory-opening-document-date-input').fill('2026-07-28');
    const csv = [
      'warehouseId,locationId,sourceVariantId,sourceQuantity,lotCode,manufacturedDate,expiryDate,supplierLotReference,sourceLineReference',
      `${fixture.warehouse.id},${fixture.location.id},${fixture.sourceVariant.id},12.000000,LOT-001,2026-01-01,2027-01-01,SUP-001,Sheet1!2`,
    ].join('\n');
    await page.getByTestId('inventory-opening-file-input').setInputFiles({
      name: 'opening-balance.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
    });
    await expect(page.getByText('Sẵn sàng kiểm tra')).toBeVisible();
    await expect(page.getByText('LOT-001', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Kiểm tra tệp' }).click();
    await expect(page.getByText('Dữ liệu hợp lệ. Có thể xác nhận nhập tồn.')).toBeVisible();
    const postButton = page.getByRole('button', { name: 'Xác nhận nhập tồn' });
    await expect(postButton).toBeEnabled();
    await postButton.click();
    await expect(page.getByText('Đã ghi nhận tồn đầu kỳ thành công.')).toBeVisible();
    await expect(page.getByText(sourceKey.toUpperCase(), { exact: true })).toBeVisible();

    await page.goto('/inventory/balances');
    await expect(page.getByTestId('inventory-balances-section')).toContainText('LOT-001');
    await expect(page.getByTestId('inventory-balances-section')).toContainText('144.000000000000');
    await page.getByTestId('inventory-search-input').fill('LOT-001');
    await expect(page.getByTestId('inventory-balances-section')).toContainText('LOT-001');
    expectNoSensitiveData(await page.content());
  });
});