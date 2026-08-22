import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const servicePath = fileURLToPath(new URL('../src/services/pricing.js', import.meta.url));
const routePath = fileURLToPath(new URL('../src/routes/pricing.js', import.meta.url));
const salesOrderPath = fileURLToPath(new URL('../src/services/sales-order.js', import.meta.url));

test('Issue #736 scopes missing-base-price preview state to the explicit sales-order preview flag', async () => {
  const [service, route] = await Promise.all([
    readFile(servicePath, 'utf8'),
    readFile(routePath, 'utf8'),
  ]);

  assert.match(service, /delete automaticPayload\.allowMissingBasePrice/);
  assert.match(service, /automatic\.code === 'BASE_PRICE_NOT_FOUND' && payload\?\.allowMissingBasePrice === true/);
  assert.match(service, /resolutionStatus: 'MANUAL_PRICE_REQUIRED'/);
  assert.match(service, /message: 'Chưa có giá Công Ty\. Nhập giá bán theo quyền được cấp để tiếp tục\.'/);
  assert.match(service, /return automatic;/);
  assert.match(route, /'BASE_PRICE_NOT_FOUND'.*'IMPORT_CONFLICT'/s);
  assert.match(route, /\]\.includes\(result\.code\)\) return 409/);
});

test('Issue #736 keeps save-time manual price permission, reason and system-price concurrency guards', async () => {
  const salesOrder = await readFile(salesOrderPath, 'utf8');

  assert.match(salesOrder, /core\.sales-order\.price\.override/);
  assert.match(salesOrder, /PRICE_OVERRIDE_REASON_REQUIRED/);
  assert.match(salesOrder, /resolutionResult\.code !== 'BASE_PRICE_NOT_FOUND' \|\| manual\.value === null/);
  assert.match(salesOrder, /expectedSystemUnitPriceMinor/);
  assert.match(salesOrder, /expectedPricingFingerprint/);
  assert.match(salesOrder, /'SALES_PRICE_CHANGED'/);
});
