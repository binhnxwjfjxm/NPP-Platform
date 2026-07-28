import { createHash } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function createFixture(request: APIRequestContext, suffix: string) {
  const branchResponse = await request.post('/api/organization/branches', {
    headers: { 'Idempotency-Key': `inventory-branch-${suffix}` },
    data: {
      code: `BR-${suffix}`,
      name: `Chi nhánh ${suffix}`,
      address: `Địa chỉ ${suffix}`,
      phone: '0901234567',
      email: `branch-${suffix.toLowerCase()}@example.com`,
    },
  });
  expect(branchResponse.status()).toBe(201);
  const branch = (await branchResponse.json()).data;

  const warehouseResponse = await request.post('/api/organization/warehouses', {
    headers: { 'Idempotency-Key': `inventory-warehouse-${suffix}` },
    data: {
      branchId: branch.id,
      code: `WH-${suffix}`,
      name: `Kho ${suffix}`,
      warehouseType: 'main',
    },
  });
  expect(warehouseResponse.status()).toBe(201);
  const warehouse = (await warehouseResponse.json()).data;

  const locationResponse = await request.post('/api/organization/warehouse-locations', {
    headers: { 'Idempotency-Key': `inventory-location-${suffix}` },
    data: {
      warehouseId: warehouse.id,
      code: `LOC-${suffix}`,
      name: `Vị trí ${suffix}`,
      locationType: 'storage',
    },
  });
  expect(locationResponse.status()).toBe(201);
  const location = (await locationResponse.json()).data;

  const unitResponse = await request.post('/api/units', {
    headers: { 'Idempotency-Key': `inventory-unit-${suffix}` },
    data: {
      code: `EA-${suffix}`,
      name: `Đơn vị ${suffix}`,
      unitKind: 'COUNT',
      allowsFractional: false,
    },
  });
  expect(unitResponse.status()).toBe(201);
  const unit = (await unitResponse.json()).data;

  const cartonUnitResponse = await request.post('/api/units', {
    headers: { 'Idempotency-Key': `inventory-carton-unit-${suffix}` },
    data: {
      code: `CT-${suffix}`,
      name: `Thùng ${suffix}`,
      unitKind: 'PACKAGE',
      allowsFractional: false,
    },
  });
  expect(cartonUnitResponse.status()).toBe(201);
  const cartonUnit = (await cartonUnitResponse.json()).data;

  const productResponse = await request.post('/api/products', {
    headers: { 'Idempotency-Key': `inventory-product-${suffix}` },
    data: {
      code: `P-${suffix}`,
      name: `Sản phẩm ${suffix}`,
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = (await productResponse.json()).data;

  const product2Response = await request.post('/api/products', {
    headers: { 'Idempotency-Key': `inventory-product-2-${suffix}` },
    data: {
      code: `P2-${suffix}`,
      name: `Sản phẩm ${suffix} B`,
    },
  });
  expect(product2Response.status()).toBe(201);
  const product2 = (await product2Response.json()).data;

  const baseVariantResponse = await request.post(`/api/products/${product.id}/variants`, {
    headers: { 'Idempotency-Key': `inventory-base-variant-${suffix}` },
    data: {
      sku: `BASE-${suffix}`,
      name: `SKU cơ sở ${suffix}`,
      variantKind: 'BASE',
      isInventoryBase: true,
      isSellable: true,
      isCatalogVisible: true,
    },
  });
  expect(baseVariantResponse.status()).toBe(201);
  const baseVariant = (await baseVariantResponse.json()).data;

  const sourceVariantResponse = await request.post(`/api/products/${product.id}/variants`, {
    headers: { 'Idempotency-Key': `inventory-source-variant-${suffix}` },
    data: {
      sku: `SRC-${suffix}`,
      name: `SKU nguồn ${suffix}`,
      variantKind: 'CARTON',
      isInventoryBase: false,
      isSellable: true,
      isCatalogVisible: true,
    },
  });
  expect(sourceVariantResponse.status()).toBe(201);
  const sourceVariant = (await sourceVariantResponse.json()).data;

  const baseVariant2Response = await request.post(`/api/products/${product2.id}/variants`, {
    headers: { 'Idempotency-Key': `inventory-base-variant-2-${suffix}` },
    data: {
      sku: `BASE2-${suffix}`,
      name: `SKU cơ sở 2 ${suffix}`,
      variantKind: 'BASE',
      isInventoryBase: true,
      isSellable: true,
      isCatalogVisible: true,
    },
  });
  expect(baseVariant2Response.status()).toBe(201);
  const baseVariant2 = (await baseVariant2Response.json()).data;

  const sourceVariant2Response = await request.post(`/api/products/${product2.id}/variants`, {
    headers: { 'Idempotency-Key': `inventory-source-variant-2-${suffix}` },
    data: {
      sku: `SRC2-${suffix}`,
      name: `SKU nguồn 2 ${suffix}`,
      variantKind: 'CARTON',
      isInventoryBase: false,
      isSellable: true,
      isCatalogVisible: true,
    },
  });
  expect(sourceVariant2Response.status()).toBe(201);
  const sourceVariant2 = (await sourceVariant2Response.json()).data;

  const sourceUnitAssign = await request.patch(`/api/products/${product.id}/variants/${sourceVariant.id}/unit`, {
    data: {
      unitId: cartonUnit.id,
      conversionToBase: '12',
      expectedUpdatedAt: sourceVariant.updated_at,
    },
  });
  expect(sourceUnitAssign.status()).toBe(200);

  const baseUnitAssign = await request.patch(`/api/products/${product.id}/variants/${baseVariant.id}/unit`, {
    data: {
      unitId: unit.id,
      conversionToBase: '1',
      expectedUpdatedAt: baseVariant.updated_at,
    },
  });
  expect(baseUnitAssign.status()).toBe(200);

  const sourceUnitAssign2 = await request.patch(`/api/products/${product2.id}/variants/${sourceVariant2.id}/unit`, {
    data: {
      unitId: cartonUnit.id,
      conversionToBase: '12',
      expectedUpdatedAt: sourceVariant2.updated_at,
    },
  });
  expect(sourceUnitAssign2.status()).toBe(200);

  const baseUnitAssign2 = await request.patch(`/api/products/${product2.id}/variants/${baseVariant2.id}/unit`, {
    data: {
      unitId: unit.id,
      conversionToBase: '1',
      expectedUpdatedAt: baseVariant2.updated_at,
    },
  });
  expect(baseUnitAssign2.status()).toBe(200);

  const policyResponse = await request.put(`/api/inventory/tracking-policies/${baseVariant.id}`, {
    headers: { 'Idempotency-Key': `inventory-policy-${suffix}` },
    data: {
      baseVariantId: baseVariant.id,
      lotTrackingMode: 'REQUIRED',
      expiryTrackingMode: 'OPTIONAL',
      locationRequired: true,
    },
  });
  expect(policyResponse.status()).toBe(200);

  const policyResponse2 = await request.put(`/api/inventory/tracking-policies/${baseVariant2.id}`, {
    headers: { 'Idempotency-Key': `inventory-policy-2-${suffix}` },
    data: {
      baseVariantId: baseVariant2.id,
      lotTrackingMode: 'REQUIRED',
      expiryTrackingMode: 'OPTIONAL',
      locationRequired: true,
    },
  });
  expect(policyResponse2.status()).toBe(200);

  return {
    branch,
    warehouse,
    location,
    unit,
    cartonUnit,
    product,
    product2,
    baseVariant,
    sourceVariant,
    baseVariant2,
    sourceVariant2,
  };
}

function expectNoSensitiveData(value: string) {
  expect(value).not.toContain('CORE_API_SERVER_TOKEN');
  expect(value).not.toContain('CORE_API_INTERNAL_URL');
  expect(value).not.toContain('BACKEND_API_TOKEN');
  expect(value).not.toContain('DATABASE_URL');
  expect(value).not.toContain('postgresql://');
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

test.describe('Kho vận', () => {
  test('bảng tồn kho, chính sách lô, lô và nhập đầu kỳ chạy qua API thật', async ({ page, request }) => {
    const suffix = uniqueSuffix();
    const fixture = await createFixture(request, suffix);
    const sourceKey = `opening-${suffix}`;
    const rows = [{
      warehouseId: fixture.warehouse.id,
      locationId: fixture.location.id,
      sourceVariantId: fixture.sourceVariant.id,
      sourceQuantity: '12.000000',
      lotCode: 'LOT-001',
      manufacturedDate: '2026-01-01',
      expiryDate: '2027-01-01',
      supplierLotReference: 'SUP-001',
      sourceLineReference: 'Sheet1!2',
      metadata: { batch: 1 },
    }];

    await page.goto('/inventory/balances');
    await expect(page.getByTestId('inventory-page')).toBeVisible();
    await expect(page.getByTestId('inventory-balances-section').getByRole('heading', { name: 'Tồn kho', exact: true })).toBeVisible();
    await expect(page.getByTestId('inventory-balances-section')).toBeVisible();
    await expect(page.getByTestId('inventory-menu-toggle')).toHaveAttribute('aria-expanded', 'true');

    await page.goto('/inventory/tracking-policies');
    await expect(page.getByTestId(`inventory-policy-row-${fixture.baseVariant.sku}`)).toBeVisible();
    await page.getByTestId(`edit-policy-${fixture.baseVariant.sku}`).click();
    await expect(page.getByTestId('inventory-policy-editor')).toBeVisible();

    await page.goto('/inventory/opening-balances');
    await page.getByTestId('inventory-opening-source-key-input').fill(sourceKey);
    await page.getByTestId('inventory-opening-source-filename-input').fill('opening-balance.xlsx');
    await page.getByTestId('inventory-opening-document-date-input').fill('2026-07-28');
    await page.getByTestId('inventory-opening-metadata-input').fill(JSON.stringify({ source: 'e2e' }));
    await page.getByTestId('inventory-opening-rows-input').fill(JSON.stringify(rows, null, 2));

    const normalizedBody = {
      sourceKey,
      sourceFilename: 'opening-balance.xlsx',
      documentDate: '2026-07-28',
      metadata: { source: 'e2e' },
      rows,
    };
    const contentChecksum = sha256Hex(JSON.stringify(normalizedBody));
    const validateResponse = await request.post('/api/inventory/opening-balances/validate', {
      data: { ...normalizedBody, contentChecksum },
    });
    expect(validateResponse.status()).toBe(200);
    const validateBody = await validateResponse.json();
    expect(validateBody.data.rowErrors).toHaveLength(0);

    const sourceKeyRow = page.getByTestId(`inventory-opening-row-${sourceKey}`);
    await expect(sourceKeyRow).toHaveCount(0);

    const postResponse = await request.post('/api/inventory/opening-balances/post', {
      headers: { 'Idempotency-Key': `opening-${sourceKey}-${suffix}` },
      data: { ...normalizedBody, contentChecksum },
    });
    expect(postResponse.status()).toBe(201);
    const postBody = await postResponse.json();
    expect(postBody.data.ok).toBe(true);

    await page.goto('/inventory/opening-balances');
    await expect(page.getByTestId(`inventory-opening-row-${sourceKey}`)).toBeVisible();
    await expect(page.getByTestId(`inventory-opening-row-${sourceKey}`)).toHaveCount(1);

    await page.goto('/inventory/balances');
    await expect(page.getByTestId('inventory-balances-section')).toContainText('LOT-001');
    await expect(page.getByTestId('inventory-balances-section')).toContainText('144.000000000000');
    await page.getByTestId('inventory-search-input').fill('LOT-001');
    await expect(page.getByTestId('inventory-balances-section')).toContainText('LOT-001');

    expectNoSensitiveData(await page.content());
  });
});
