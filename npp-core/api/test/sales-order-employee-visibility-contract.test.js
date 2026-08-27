import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const directIssue = readFileSync(new URL('../src/services/sales-direct-stock-issue.js', import.meta.url), 'utf8');
const migrationIndex = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');

test('direct stock issue checks employee-scoped Sales Order visibility before locking stock', () => {
  const visibilityIndex = directIssue.indexOf('const visible = await getSalesOrder(client, { requestContext, id });');
  const lockIndex = directIssue.indexOf('const source = await lockSource(client');
  assert.ok(visibilityIndex >= 0, 'missing Sales Order visibility guard');
  assert.ok(lockIndex > visibilityIndex, 'stock lock must happen after Sales Order visibility guard');
});

test('employee visibility permission migration is registered after migration 117', () => {
  assert.match(migrationIndex, /118_sales_order_employee_visibility\.sql/);
  const migration117 = migrationIndex.indexOf("id: '117_sku_weight_sales_order_snapshot'");
  const migration118 = migrationIndex.indexOf("id: '118_sales_order_employee_visibility'");
  assert.ok(migration117 >= 0 && migration118 > migration117);
});
