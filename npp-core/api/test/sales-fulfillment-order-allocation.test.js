import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  executeAllocateFulfillmentOrder,
  fulfillmentOrderAllocationInternals,
} from '../src/services/sales-fulfillment-order-allocation.js';

const SALES_ORDER_ID = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE_ID = '44444444-4444-4444-8444-444444444444';
const DEMAND_ONE = '11111111-1111-4111-8111-111111111111';
const DEMAND_TWO = '11111111-1111-4111-8111-222222222222';
const DEMAND_THREE = '11111111-1111-4111-8111-333333333333';

function demand(id, lineNumber, {
  ordered = '3.000000000000',
  reserved = '3.000000000000',
  allocated = '0.000000000000',
  backordered = '0.000000000000',
} = {}) {
  return {
    id,
    sales_order_id: SALES_ORDER_ID,
    sales_order_line_id: `66666666-6666-4666-8666-${String(lineNumber).padStart(12, '6')}`,
    line_number: lineNumber,
    warehouse_id: WAREHOUSE_ID,
    sku_snapshot: `SKU-${lineNumber}`,
    item_name_snapshot: `Sản phẩm ${lineNumber}`,
    unit_code_snapshot: 'THUNG',
    ordered_base_quantity: ordered,
    reserved_base_quantity: reserved,
    allocated_base_quantity: allocated,
    backordered_base_quantity: backordered,
  };
}

function requestContext(warehouseIds = [WAREHOUSE_ID]) {
  return {
    installationId: 'installation-test',
    actorId: 'employee-test',
    requestId: 'request-test',
    sourceApp: 'npp-core-web',
    permissions: ['core.fulfillment.allocate'],
    scopes: { warehouseIds },
  };
}

test('whole-order allocation retries every unallocated line so replenished stock is not left stale', async () => {
  const demands = [
    demand(DEMAND_ONE, 1),
    demand(DEMAND_TWO, 2, {
      ordered: '3.000000000000',
      reserved: '2.000000000000',
      allocated: '2.000000000000',
      backordered: '1.000000000000',
    }),
    demand(DEMAND_THREE, 3, { ordered: '4.000000000000', reserved: '4.000000000000' }),
  ];
  const calls = [];
  const refreshed = new Map(demands.map((item) => [item.id, item]));
  const result = await executeAllocateFulfillmentOrder({
    adapter: {},
    requestContext: requestContext(),
    salesOrderId: SALES_ORDER_ID,
    idempotencyKey: 'fulfillment-allocate-order.test',
    payload: { mode: 'AUTO' },
    dependencies: {
      listDemands: async () => demands,
      getDemand: async (_adapter, { demandId }) => refreshed.get(demandId) ?? null,
      allocateDemand: async (args) => {
        calls.push(args);
        if (args.demandId === DEMAND_TWO) {
          refreshed.set(DEMAND_TWO, demand(DEMAND_TWO, 2, {
            ordered: '3.000000000000',
            reserved: '3.000000000000',
            allocated: '3.000000000000',
            backordered: '0.000000000000',
          }));
          return { ok: true, replayed: false, allocation: { allocatedBaseQuantity: '3.000000000000' } };
        }
        if (args.demandId === DEMAND_THREE) {
          return { ok: false, code: 'NO_ALLOCATABLE_STOCK', message: 'none', retryable: false };
        }
        refreshed.set(DEMAND_ONE, demand(DEMAND_ONE, 1, { allocated: '3.000000000000' }));
        return { ok: true, replayed: false, allocation: { allocatedBaseQuantity: '3.000000000000' } };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    totalLines: 3,
    readyLines: 2,
    shortageLines: 0,
    needsAttentionLines: 1,
  });
  assert.deepEqual(result.lines.map((line) => line.outcome), ['READY', 'READY', 'NEEDS_ATTENTION']);
  assert.equal(result.lines[2].reasonCode, 'NO_ALLOCATABLE_STOCK');
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.payload.mode === 'AUTO'));
  assert.equal(new Set(calls.map((call) => call.idempotencyKey)).size, 3);
  for (const call of calls) assert.match(call.idempotencyKey, /^[A-Za-z0-9._-]{1,128}$/);
});

test('whole-order child idempotency key is deterministic per demand and safe', () => {
  const { orderDemandIdempotencyKey } = fulfillmentOrderAllocationInternals;
  const first = orderDemandIdempotencyKey('fulfillment-order.retry-key', DEMAND_ONE);
  const retry = orderDemandIdempotencyKey('fulfillment-order.retry-key', DEMAND_ONE);
  const anotherLine = orderDemandIdempotencyKey('fulfillment-order.retry-key', DEMAND_TWO);
  assert.equal(first, retry);
  assert.notEqual(first, anotherLine);
  assert.match(first, /^[A-Za-z0-9._-]{1,128}$/);
  assert.doesNotMatch(first, /:/);
});

test('whole-order allocation fails closed before writes when any line is outside warehouse scope', async () => {
  let writes = 0;
  const result = await executeAllocateFulfillmentOrder({
    adapter: {},
    requestContext: requestContext([]),
    salesOrderId: SALES_ORDER_ID,
    idempotencyKey: 'fulfillment-order.scope-test',
    payload: { mode: 'AUTO' },
    dependencies: {
      listDemands: async () => [demand(DEMAND_ONE, 1)],
      allocateDemand: async () => { writes += 1; return { ok: true, replayed: false }; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'WAREHOUSE_SCOPE_DENIED');
  assert.equal(writes, 0);
});

test('whole-order command keeps line allocation as the canonical backend primitive', () => {
  const route = readFileSync(new URL('../src/routes/fulfillment-operations.js', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/sales-fulfillment-order-allocation.js', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../src/db/repositories/sales-fulfillment-order-allocation.js', import.meta.url), 'utf8');
  const gateway = readFileSync(new URL('../../web/lib/inventory-gateway.ts', import.meta.url), 'utf8');
  const proxy = readFileSync(new URL('../../web/app/api/inventory/fulfillment-orders/[salesOrderId]/allocate/route.ts', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../../web/app/inventory/fulfillment/fulfillment-workspace.tsx', import.meta.url), 'utf8');

  assert.match(route, /allocateOrderMatch/);
  assert.match(route, /fulfillment-orders/);
  assert.match(route, /executeAllocateFulfillmentOrder/);
  assert.match(service, /executeAllocateFulfillmentDemand/);
  assert.match(service, /for \(const demand of demands\)/);
  assert.match(service, /ordered_base_quantity/);
  assert.match(repository, /demand\.ordered_base_quantity/);
  assert.match(repository, /demand\.sales_order_id = \$2/);
  assert.match(gateway, /allocateFulfillmentOrder/);
  assert.match(gateway, /\/fulfillment-orders\/\$\{id\}\/allocate/);
  assert.match(proxy, /allocateFulfillmentOrder/);
  assert.match(workspace, /Phân bổ toàn đơn/);
  assert.match(workspace, /fulfillment-auto-allocate-order/);
  assert.match(workspace, /\/api\/inventory\/fulfillment-orders\/\$\{selectedOrder\.salesOrderId\}\/allocate/);
  assert.match(workspace, /keyFor\('allocate-order'/);
  assert.match(workspace, /createIdempotencyKey/);
  assert.doesNotMatch(workspace, /Promise\.all\([^\n]*fulfillment-demands/);
});
