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

test('whole-order allocation classifies ready, shortage and attention without frontend fan-out', async () => {
  const demands = [
    demand(DEMAND_ONE, 1),
    demand(DEMAND_TWO, 2, {
      reserved: '2.000000000000',
      allocated: '2.000000000000',
      backordered: '1.000000000000',
    }),
    demand(DEMAND_THREE, 3, { reserved: '4.000000000000' }),
  ];
  const calls = [];
  const result = await executeAllocateFulfillmentOrder({
    adapter: {},
    requestContext: requestContext(),
    salesOrderId: SALES_ORDER_ID,
    idempotencyKey: 'fulfillment-allocate-order.test',
    payload: { mode: 'AUTO' },
    dependencies: {
      listDemands: async () => demands,
      getDemand: async () => null,
      allocateDemand: async (args) => {
        calls.push(args);
        if (args.demandId === DEMAND_THREE) {
          return { ok: false, code: 'NO_ALLOCATABLE_STOCK', message: 'none', retryable: false };
        }
        return {
          ok: true,
          replayed: false,
          allocation: { allocatedBaseQuantity: '3.000000000000' },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    totalLines: 3,
    readyLines: 1,
    shortageLines: 1,
    needsAttentionLines: 1,
  });
  assert.deepEqual(result.lines.map((line) => line.outcome), ['READY', 'SHORTAGE', 'NEEDS_ATTENTION']);
  assert.equal(result.lines[2].reasonCode, 'NO_ALLOCATABLE_STOCK');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload.mode, 'AUTO');
  assert.equal(calls[1].payload.mode, 'AUTO');
  assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.match(calls[0].idempotencyKey, /^[A-Za-z0-9._-]{1,128}$/);
  assert.match(calls[1].idempotencyKey, /^[A-Za-z0-9._-]{1,128}$/);
});

test('whole-order child idempotency key is deterministic per demand and safe', () => {
  const { orderDemandIdempotencyKey } = fulfillmentOrderAllocationInternals;
  const first = orderDemandIdempotencyKey('fulfillment-order.retry-key', DEMAND_ONE);
  const retry = orderDemandIdempotencyKey('fulfillment-order.retry-key', DEMAND_ONE);
  const anotherLine = orderDemandIdempotencyKey('fulfillment-order.retry-key', DEMAND_TWO);
  assert.equal(first, retry);
  assert.notEqual(first, anotherLine);
  assert.match(first, /^[A-Za-z0-9._-]{1,128}$/);
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

test('Lô 2 exposes one whole-order command and keeps line allocation as the canonical backend primitive', () => {
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
