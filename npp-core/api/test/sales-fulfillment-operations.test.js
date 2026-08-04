import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fulfillmentOperationInternals } from '../src/services/sales-fulfillment-operations.js';
import { handleFulfillmentOperationRoutes } from '../src/routes/fulfillment-operations.js';

const {
  parseQuantity,
  formatQuantity,
  buildAutoPlan,
  buildManualPlan,
} = fulfillmentOperationInternals;

test('fulfillment route module is loadable', () => {
  assert.equal(typeof handleFulfillmentOperationRoutes, 'function');
});

test('quantity helpers keep exact twelve-decimal arithmetic', () => {
  assert.equal(parseQuantity('12.345678901234'), 12345678901234n);
  assert.equal(formatQuantity(12345678901234n), '12.345678901234');
  assert.equal(parseQuantity('0.000000000001'), 1n);
  assert.equal(parseQuantity('1.0000000000001'), null);
});

test('auto allocation consumes candidates in deterministic policy order', () => {
  const candidates = [
    {
      rank: 1,
      locationId: '11111111-1111-4111-8111-111111111111',
      lotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      availableBaseQuantity: '3.000000000000',
      allocationPolicy: 'FEFO',
    },
    {
      rank: 2,
      locationId: '22222222-2222-4222-8222-222222222222',
      lotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      availableBaseQuantity: '10.000000000000',
      allocationPolicy: 'FEFO',
    },
  ];
  const plan = buildAutoPlan(candidates, parseQuantity('8.000000000000'));
  assert.equal(plan.length, 2);
  assert.equal(formatQuantity(plan[0].quantityScaled), '3.000000000000');
  assert.equal(formatQuantity(plan[1].quantityScaled), '5.000000000000');
  assert.equal(plan[0].policyRank, 1);
  assert.equal(plan[1].policyRank, 2);
});

test('manual allocation requires override permission and reason', () => {
  const candidates = [{
    rank: 1,
    locationId: null,
    lotId: null,
    availableBaseQuantity: '5.000000000000',
    allocationPolicy: 'FIFO',
  }];
  const denied = buildManualPlan(
    { reason: 'Bao bì lô ưu tiên bị hỏng', allocations: [{ locationId: null, lotId: null, quantity: '2' }] },
    candidates,
    { permissions: [] },
    parseQuantity('5'),
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'ALLOCATION_POLICY_OVERRIDE_FORBIDDEN');

  const allowed = buildManualPlan(
    { reason: 'Bao bì lô ưu tiên bị hỏng', allocations: [{ locationId: null, lotId: null, quantity: '2' }] },
    candidates,
    { permissions: ['core.fulfillment.override-allocation-policy'] },
    parseQuantity('5'),
  );
  assert.equal(allowed.ok, true);
  assert.equal(allowed.plan[0].allocationPolicy, 'MANUAL');
  assert.equal(formatQuantity(allowed.plan[0].quantityScaled), '2.000000000000');
});

test('Phase 6D.2 migrations lock exact reservation, monotonic progress and operation idempotency', () => {
  const allocationSql = readFileSync(
    new URL('../../../database/migrations/sales/043_sales_fulfillment_allocation_pick_pack.sql', import.meta.url),
    'utf8',
  );
  const operationSql = readFileSync(
    new URL('../../../database/migrations/sales/044_sales_fulfillment_allocation_operation_idempotency.sql', import.meta.url),
    'utf8',
  );
  const projectionSql = readFileSync(
    new URL('../../../database/migrations/sales/045_sales_fulfillment_allocation_projection_policy.sql', import.meta.url),
    'utf8',
  );
  const registry = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');

  assert.match(allocationSql, /sales_order_fulfillment_allocations/);
  assert.match(allocationSql, /SALES_FULFILLMENT_ALLOCATION/);
  assert.match(allocationSql, /picked_base_quantity <= allocated_base_quantity/);
  assert.match(allocationSql, /packed_base_quantity <= picked_base_quantity/);
  assert.match(allocationSql, /sales_fulfillment_allocation_progress_cannot_decrease/);
  assert.match(allocationSql, /core\.fulfillment\.override-allocation-policy/);
  assert.match(operationSql, /operation_idempotency_key/);
  assert.match(operationSql, /sales_fulfillment_allocation_operation_key_is_immutable/);
  assert.match(projectionSql, /TG_OP = 'INSERT'/);
  assert.match(projectionSql, /sum\(demand\.backordered_base_quantity\) = 0/);
  assert.match(projectionSql, /sales_order_fulfillment_allocations_scope_idx/);
  assert.match(registry, /043_sales_fulfillment_allocation_pick_pack/);
  assert.match(registry, /044_sales_fulfillment_allocation_operation_idempotency/);
  assert.match(registry, /045_sales_fulfillment_allocation_projection_policy/);
});

test('warehouse API routes and NPP navigation keep fulfillment inside Inventory', () => {
  const inventoryRoutes = readFileSync(new URL('../src/routes/inventory.js', import.meta.url), 'utf8');
  const fulfillmentRoutes = readFileSync(new URL('../src/routes/fulfillment-operations.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../../web/app/components/app-shell-core.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../../web/app/inventory/fulfillment/fulfillment-workspace.tsx', import.meta.url), 'utf8');

  assert.match(inventoryRoutes, /handleFulfillmentOperationRoutes/);
  assert.match(fulfillmentRoutes, /\/api\/inventory\/fulfillment-work/);
  assert.match(fulfillmentRoutes, /\/allocate/);
  assert.match(fulfillmentRoutes, /pick\|pack/);
  assert.match(shell, /href: '\/inventory\/fulfillment', label: 'Chuẩn bị hàng'/);
  assert.match(shell, /testId: 'nav-inventory-fulfillment'/);
  assert.match(workspace, /Phân bổ phần còn lại/);
  assert.match(workspace, /Soạn/);
  assert.match(workspace, /Đóng gói/);
  assert.doesNotMatch(workspace, /tài xế|chuyến xe|\bPOD\b|\bCOD\b/i);
});
