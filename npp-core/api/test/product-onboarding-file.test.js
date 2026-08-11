import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PRODUCT_ONBOARDING_FILE_COLUMNS,
  normalizeProductOnboardingRows,
} from '../src/services/product-onboarding-file.js';

const routeSource = await readFile(new URL('../src/routes/file-operations.js', import.meta.url), 'utf8');
const serviceSource = await readFile(new URL('../src/services/product-onboarding-file.js', import.meta.url), 'utf8');

test('product onboarding file carries unit conversion and inventory policy in the same row contract', () => {
  for (const column of ['unitCode', 'conversionToBase', 'lotTrackingMode', 'expiryTrackingMode', 'locationRequired']) {
    assert.ok(PRODUCT_ONBOARDING_FILE_COLUMNS.includes(column));
  }
  const result = normalizeProductOnboardingRows({ rows: [{
    productCode: 'SP01', sku: 'SKU01', isInventoryBase: 'TRUE', unitCode: 'KG', conversionToBase: '1.000',
    lotTrackingMode: 'Có', expiryTrackingMode: 'Bắt buộc', locationRequired: 'Có',
  }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows[0], {
    productCode: 'SP01', sku: 'SKU01', unitCode: 'KG', conversionToBase: '1', isInventoryBase: true,
    lotTrackingMode: 'REQUIRED', expiryTrackingMode: 'REQUIRED', locationRequired: true,
  });
});

test('tracking policy is defined only on the inventory-base SKU and keeps backend invariants', () => {
  const nonBase = normalizeProductOnboardingRows({ rows: [{
    productCode: 'SP01', sku: 'SKU-THUNG', isInventoryBase: false, unitCode: 'THUNG', conversionToBase: '12',
    lotTrackingMode: 'REQUIRED', expiryTrackingMode: '', locationRequired: '',
  }] });
  assert.equal(nonBase.ok, false);
  assert.equal(nonBase.code, 'TRACKING_POLICY_BASE_ONLY');

  const conflict = normalizeProductOnboardingRows({ rows: [{
    productCode: 'SP01', sku: 'SKU01', isInventoryBase: true, unitCode: 'KG', conversionToBase: '1',
    lotTrackingMode: 'Không', expiryTrackingMode: 'Tùy chọn', locationRequired: false,
  }] });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'TRACKING_POLICY_CONFLICT');
});

test('official product file operation stays transactional and permission-scoped across product, unit and inventory policy', () => {
  assert.match(routeSource, /productOnboardingService\.importProductOnboardingRows/);
  assert.match(routeSource, /coreInventoryTrackingPolicyManage/);
  assert.match(routeSource, /coreInventoryTrackingPolicyRead/);
  assert.match(serviceSource, /fileOperationService\.importProductRows/);
  assert.match(serviceSource, /productUnitService\.assignVariantUnit/);
  assert.match(serviceSource, /inventoryLotService\.upsertInventoryTrackingPolicy/);
});
