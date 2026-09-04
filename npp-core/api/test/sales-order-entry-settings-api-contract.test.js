import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('Sales Order transaction never persists user entry defaults', () => {
  const service = source('../src/services/sales-order-entry.js');
  const normalizeStart = service.indexOf('export async function normalizeSalesOrderEntryPayload');
  const internalsStart = service.indexOf('export const salesOrderEntryInternals', normalizeStart);
  const normalizeSource = service.slice(normalizeStart, internalsStart);

  assert.ok(normalizeStart >= 0);
  assert.match(normalizeSource, /filter\(\(\[key\]\) => key !== 'entryDefaults'\)/);
  assert.doesNotMatch(normalizeSource, /persistEntryDefaults\(/);
  assert.doesNotMatch(normalizeSource, /upsertUserPreference|deleteUserPreference|insertAuditRecord/);
});

test('entry settings have a dedicated idempotent PUT transaction with their own audit', () => {
  const route = source('../src/routes/sales-orders.js');
  const service = source('../src/services/sales-order-entry.js');

  assert.match(route, /pathname === '\/api\/sales-orders\/entry-settings' && method === 'PUT'/);
  assert.match(route, /executeEntrySettingsMutation\(req, res, options/);
  assert.match(route, /route: '\/api\/sales-orders\/entry-settings'/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /coreSalesOrderCreate/);
  assert.match(service, /export async function updateSalesOrderEntrySettings/);
  assert.match(service, /action: 'sales\.order_entry_defaults\.update'/);
  assert.match(service, /resourceType: 'user_preference'/);
});

test('entry settings update uses only warehouse and delivery choice', () => {
  const service = source('../src/services/sales-order-entry.js');
  assert.match(service, /!\['warehouseId', 'deliveryChoice'\]\.includes\(key\)/);
  assert.match(service, /WAREHOUSE_SCOPE_DENIED/);
  assert.match(service, /INVALID_SALES_ORDER_ENTRY_DEFAULTS/);
});
