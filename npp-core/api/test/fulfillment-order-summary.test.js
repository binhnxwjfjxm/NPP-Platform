import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listFulfillmentOrderTotals } from '../src/db/repositories/fulfillment-order-summary.js';
import { fulfillmentOrderSummaryInternals } from '../src/services/fulfillment-order-summary.js';

const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';

test('fulfillment order summary uses one bulk canonical sales-order-version query', async () => {
  const calls = [];
  const row = {
    sales_order_version_id: VERSION_A,
    order_subtotal: '75000',
    order_discount_total: '5000',
    order_tax_total: '10000',
    order_total: '80000',
    sales_channel_code_snapshot: 'OFFICE',
    sales_channel_name_snapshot: 'NPP Operations',
  };
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [row] };
    },
  };

  const rows = await listFulfillmentOrderTotals(client, {
    installationId: 'installation-test',
    salesOrderVersionIds: [VERSION_A, VERSION_A, VERSION_B],
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /sales\.sales_order_versions/);
  assert.match(calls[0].sql, /version\.subtotal::text AS order_subtotal/);
  assert.match(calls[0].sql, /version\.discount_total::text AS order_discount_total/);
  assert.match(calls[0].sql, /version\.tax_total::text AS order_tax_total/);
  assert.match(calls[0].sql, /version\.total::text AS order_total/);
  assert.match(calls[0].sql, /version\.sales_channel_code_snapshot/);
  assert.match(calls[0].sql, /version\.sales_channel_name_snapshot/);
  assert.deepEqual(calls[0].params, ['installation-test', [VERSION_A, VERSION_B]]);
  assert.deepEqual(rows, [row]);
});

test('fulfillment work projection attaches financial reconciliation and sales channel without changing product fields', () => {
  const work = [
    { fulfillmentDemandId: 'demand-a', salesOrderVersionId: VERSION_A, itemName: 'Sản phẩm A' },
    { fulfillmentDemandId: 'demand-b', salesOrderVersionId: VERSION_A, itemName: 'Sản phẩm B' },
    { fulfillmentDemandId: 'demand-c', salesOrderVersionId: VERSION_B, itemName: 'Sản phẩm C' },
  ];
  const merged = fulfillmentOrderSummaryInternals.mergeOrderTotals(work, [{
    sales_order_version_id: VERSION_A,
    order_subtotal: '75000',
    order_discount_total: '5000',
    order_tax_total: '10000',
    order_total: '80000',
    sales_channel_code_snapshot: 'OFFICE',
    sales_channel_name_snapshot: 'NPP Operations',
  }]);

  assert.equal(merged[0].orderSubtotal, '75000');
  assert.equal(merged[0].orderDiscountTotal, '5000');
  assert.equal(merged[0].orderTaxTotal, '10000');
  assert.equal(merged[0].orderTotal, '80000');
  assert.equal(merged[0].salesChannelCode, 'OFFICE');
  assert.equal(merged[0].salesChannelName, 'NPP Operations');
  assert.equal(merged[1].orderTotal, '80000');
  assert.equal(merged[2].orderTotal, null);
  assert.equal(merged[2].salesChannelCode, null);
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
