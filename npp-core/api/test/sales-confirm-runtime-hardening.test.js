import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('sales fulfillment classifies allocated execution facts before superseding demand', async () => {
  const source = await readFile(new URL('../src/services/sales-fulfillment.js', import.meta.url), 'utf8');
  const preflight = source.indexOf('hasActiveAllocationFacts');
  const supersede = source.indexOf('supersedeActiveDemands');
  assert.ok(preflight >= 0, 'allocation preflight is required');
  assert.ok(supersede > preflight, 'allocation preflight must run before superseding active demand');
  assert.match(source, /SALES_ORDER_HAS_EXECUTION_FACTS/);
});

test('sales fulfillment repository detects active demand allocations explicitly', async () => {
  const source = await readFile(new URL('../src/db/repositories/sales-fulfillment.js', import.meta.url), 'utf8');
  assert.match(source, /hasActiveAllocationFacts/);
  assert.match(source, /sales_order_fulfillment_allocations/);
  assert.match(source, /demand\.state = 'ACTIVE'/);
});
