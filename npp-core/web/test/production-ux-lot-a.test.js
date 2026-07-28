import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function text(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('pricing create requests always receive an idempotency key', async () => {
  const source = await text('../app/pricing/pricing-idempotency-boundary.tsx');
  assert.match(source, /price-lists/);
  assert.match(source, /input\.clone\(\)\.text/);
  assert.match(source, /headers\.set\('Idempotency-Key', key\)/);
});

test('favicon returns real logo bytes instead of nested svg image', async () => {
  const source = await text('../app/favicon.ico/route.ts');
  assert.match(source, /logo-transparent\.png/);
  assert.match(source, /arrayBuffer\(\)/);
  assert.doesNotMatch(source, /<svg/);
});

test('opening balance file selection clears stale hidden payload first', async () => {
  const page = await text('../app/inventory/opening-balances/page.tsx');
  const boundary = await text('../app/inventory/opening-balances/opening-file-reset-boundary.tsx');
  assert.match(page, /OpeningFileResetBoundary/);
  assert.match(boundary, /inventory-opening-rows-input/);
  assert.match(boundary, /inventory-opening-metadata-input/);
  assert.match(boundary, /inventory-opening-source-filename-input/);
});

test('supplier address idempotency is keyed by endpoint and payload', async () => {
  const page = await text('../app/suppliers/page.tsx');
  const boundary = await text('../app/suppliers/supplier-address-idempotency-boundary.tsx');
  assert.match(page, /SupplierAddressIdempotencyBoundary/);
  assert.match(boundary, /fingerprint = `\$\{url\.pathname\}\\n\$\{body\}`/);
  assert.match(boundary, /web-supplier-address-/);
});

test('warehouse type labels are rendered directly by the React workspace', async () => {
  const page = await text('../app/organization/warehouses/page.tsx');
  const workspace = await text('../app/organization/organization-workspace.tsx');
  assert.doesNotMatch(page, /OrganizationLot3Boundary/);
  assert.match(workspace, /warehouseTypeLabels/);
  assert.match(workspace, /data-testid="warehouse-type-select"/);
  assert.match(workspace, /warehouseTypeLabels\[type\]/);
  assert.doesNotMatch(workspace, /MutationObserver/);
});
