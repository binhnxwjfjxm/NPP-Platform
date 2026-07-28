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

test('opening balance file selection invalidates every previously validated draft', async () => {
  const page = await text('../app/inventory/opening-balances/page.tsx');
  const workspace = await text('../app/inventory/opening-balances/opening-balance-csv-workspace.tsx');
  assert.match(page, /OpeningBalanceCsvWorkspace/);
  assert.match(workspace, /async function chooseFile\(file: File\)/);
  assert.match(workspace, /function invalidateDraft\(\)/);
  assert.match(workspace, /draftRevision\.current \+= 1/);
  assert.match(workspace, /setValidation\(null\)/);
  assert.match(workspace, /setValidationChecksum\(null\)/);
  assert.match(workspace, /invalidateDraft\(\);\s*setRows\(\[\]\)/);
  assert.match(workspace, /if \(!file\.name\.toLowerCase\(\)\.endsWith\('\.csv'\)\)/);
  assert.doesNotMatch(page, /OpeningFileResetBoundary/);
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
