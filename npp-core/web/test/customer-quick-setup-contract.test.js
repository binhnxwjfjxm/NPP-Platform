import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('Khách hàng exposes Thiết lập nhanh beside the existing import/update tabs', () => {
  const tabs = read('../app/customers/customer-bulk-tabs-launcher.tsx');
  assert.match(tabs, /'quick' \| 'import' \| 'update'/);
  assert.match(tabs, /customers-quick-setup-tab/);
  assert.match(tabs, /<CustomerQuickSetupWorkspace \/>/);
  assert.match(tabs, /customers-import-tab/);
  assert.match(tabs, /customers-update-tab/);
});

test('Thiết lập nhanh uses existing customer, address, employee and media APIs only', () => {
  const quick = read('../app/customers/customer-quick-setup-workspace.tsx');
  assert.match(quick, /\/api\/customers\?limit=1000/);
  assert.match(quick, /\/api\/customer-groups\?limit=1000/);
  assert.match(quick, /\/api\/access\/employees\?limit=1000/);
  assert.match(quick, /\/addresses/);
  assert.match(quick, /\/media/);
  assert.match(quick, /createIdempotencyKey\('customer\.quick\.create'\)/);
  assert.match(quick, /createIdempotencyKey\('customer\.quick\.address\.create'\)/);
  assert.doesNotMatch(quick, /database|migration|migrations/);
});

test('Thiết lập nhanh prioritizes customer name over customer code in the picker', () => {
  const quick = read('../app/customers/customer-quick-setup-workspace.tsx');
  const strongName = quick.indexOf('<strong>{customer.name}</strong>');
  const code = quick.indexOf('{customer.code}{customer.phone');
  assert.ok(strongName >= 0 && code > strongName);
});
