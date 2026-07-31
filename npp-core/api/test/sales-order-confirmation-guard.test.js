import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../../database/migrations/sales/038_sales_order_confirmation_guard.sql', import.meta.url),
  'utf8',
);
const routes = readFileSync(new URL('../src/routes/sales-orders.js', import.meta.url), 'utf8');

test('Sales Order confirmation revalidates active customer, address, warehouse, SKU, product and unit', () => {
  assert.match(migration, /OLD\.version_status = 'draft' AND NEW\.version_status = 'confirmed'/);
  assert.match(migration, /customer_active IS DISTINCT FROM true/);
  assert.match(migration, /warehouse_active IS DISTINCT FROM true/);
  assert.match(migration, /ca\.customer_id = NEW\.customer_id/);
  assert.match(migration, /ca\.is_active = true/);
  assert.match(migration, /variant\.is_sellable IS DISTINCT FROM true/);
  assert.match(migration, /product\.is_orderable IS DISTINCT FROM true/);
  assert.match(migration, /unit\.is_active IS DISTINCT FROM true/);
  assert.match(migration, /variant\.conversion_to_base IS DISTINCT FROM line\.conversion_to_base/);
});

test('Every Sales Order mutation is idempotent and returns its outbox event to the transaction guard', () => {
  assert.match(routes, /return \{ salesOrder: result\.salesOrder, eventId \}/);
  assert.match(routes, /action: 'update_draft'[\s\S]*executeIdempotentMutation/);
  assert.match(routes, /action: 'update_amendment'[\s\S]*executeIdempotentMutation/);
  assert.match(routes, /MISSING_IDEMPOTENCY_KEY/);
});
