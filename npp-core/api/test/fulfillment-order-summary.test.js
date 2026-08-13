import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listFulfillmentOrderTotals } from '../src/db/repositories/fulfillment-order-summary.js';
import { fulfillmentOrderSummaryInternals } from '../src/services/fulfillment-order-summary.js';

const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';

test('fulfillment order totals use one bulk canonical sales-order-version query', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ sales_order_version_id: VERSION_A, order_total: '80000' }] };
    },
  };

  const rows = await listFulfillmentOrderTotals(client, {
    installationId: 'installation-test',
    salesOrderVersionIds: [VERSION_A, VERSION_A, VERSION_B],
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /sales\.sales_order_versions/);
  assert.match(calls[0].sql, /version\.total::text AS order_total/);
  assert.deepEqual(calls[0].params, ['installation-test', [VERSION_A, VERSION_B]]);
  assert.deepEqual(rows, [{ sales_order_version_id: VERSION_A, order_total: '80000' }]);
});

test('fulfillment work projection attaches the canonical total without changing product work fields', () => {
  const work = [
    { fulfillmentDemandId: 'demand-a', salesOrderVersionId: VERSION_A, itemName: 'Sản phẩm A' },
    { fulfillmentDemandId: 'demand-b', salesOrderVersionId: VERSION_A, itemName: 'Sản phẩm B' },
    { fulfillmentDemandId: 'demand-c', salesOrderVersionId: VERSION_B, itemName: 'Sản phẩm C' },
  ];
  const merged = fulfillmentOrderSummaryInternals.mergeOrderTotals(work, [
    { sales_order_version_id: VERSION_A, order_total: '80000' },
  ]);

  assert.equal(merged[0].orderTotal, '80000');
  assert.equal(merged[1].orderTotal, '80000');
  assert.equal(merged[2].orderTotal, null);
  assert.equal(merged[0].itemName, 'Sản phẩm A');
});

test('fulfillment route enriches only the read queue; allocate, pick and pack stay on existing service paths', () => {
  const routeSource = readFileSync(new URL('../src/routes/fulfillment-operations.js', import.meta.url), 'utf8');
  assert.match(routeSource, /attachFulfillmentOrderTotals/);
  assert.match(routeSource, /work: result\.work/);
  assert.match(routeSource, /executeAllocateFulfillmentDemand/);
  assert.match(routeSource, /executePickFulfillmentAllocation/);
  assert.match(routeSource, /executePackFulfillmentAllocation/);
});
