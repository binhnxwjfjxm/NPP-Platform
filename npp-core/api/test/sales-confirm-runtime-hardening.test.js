import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('sales fulfillment locks active demands before allocation preflight and superseding demand', async () => {
  const source = await readFile(new URL('../src/services/sales-fulfillment.js', import.meta.url), 'utf8');
  const lock = source.indexOf('lockActiveSalesOrderDemands');
  const preflight = source.indexOf('hasActiveAllocationFacts');
  const supersede = source.indexOf('supersedeActiveDemands');
  assert.ok(lock >= 0, 'active demand row lock is required');
  assert.ok(preflight > lock, 'allocation preflight must run after active demand rows are locked');
  assert.ok(supersede > preflight, 'allocation preflight must run before superseding active demand');
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /sales_fulfillment_transition_blocked_by_allocation/);
  assert.match(source, /SALES_ORDER_HAS_EXECUTION_FACTS/);
});

test('sales fulfillment repository detects active demand allocations explicitly', async () => {
  const source = await readFile(new URL('../src/db/repositories/sales-fulfillment.js', import.meta.url), 'utf8');
  assert.match(source, /hasActiveAllocationFacts/);
  assert.match(source, /sales_order_fulfillment_allocations/);
  assert.match(source, /demand\.state = 'ACTIVE'/);
});
