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
  childIdempotencyKey,
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

test('allocation child idempotency uses the shared safe contract and is deterministic', () => {
  const first = childIdempotencyKey('fulfillment.retry', 1);
  const retry = childIdempotencyKey('fulfillment.retry', 1);
  const next = childIdempotencyKey('fulfillment.retry', 2);
  assert.equal(first, retry);
  assert.notEqual(first, next);
  assert.match(first, /^[A-Za-z0-9._-]{1,128}$/);
  assert.doesNotMatch(first, /:/);
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

test('manual allocation aggregates duplicate exact scopes before checking availability', () => {
  const locationId = '11111111-1111-4111-8111-111111111111';
  const lotId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const candidates = [{
    rank: 1,
    locationId,
    lotId,
    availableBaseQuantity: '5.000000000000',
    allocationPolicy: 'FEFO',
  }];
  const context = { permissions: ['core.fulfillment.override-allocation-policy'] };

  const valid = buildManualPlan(
    {
      reason: 'Gom hai lần quét cùng vị trí và lô',
      allocations: [
        { locationId, lotId, quantity: '2' },
        { locationId, lotId, quantity: '3' },
      ],
    },
    candidates,
    context,
    parseQuantity('5'),
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.plan.length, 1);
  assert.equal(formatQuantity(valid.plan[0].quantityScaled), '5.000000000000');

  const invalid = buildManualPlan(
    {
      reason: 'Không được vượt tồn khả dụng của scope',
      allocations: [
        { locationId, lotId, quantity: '3' },
        { locationId, lotId, quantity: '3' },
      ],
    },
    candidates,
    context,
    parseQuantity('10'),
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'INVALID_ALLOCATION_QUANTITY');
});

test('Phase 6D.2 migration locks exact reservation, lifecycle and monotonic projection in one slice', () => {
  const allocationSql = readFileSync(
    new URL('../../../database/migrations/sales/043_sales_fulfillment_allocation_pick_pack.sql', import.meta.url),
    'utf8',
  );
  const repositorySource = readFileSync(
    new URL('../src/db/repositories/sales-fulfillment-operations.js', import.meta.url),
    'utf8',
  );
  const serviceSource = readFileSync(
    new URL('../src/services/sales-fulfillment-operations.js', import.meta.url),
    'utf8',
  );
  const registry = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');

  assert.match(allocationSql, /sales_order_fulfillment_allocations/);
  assert.match(allocationSql, /SALES_FULFILLMENT_ALLOCATION/);
  assert.match(allocationSql, /picked_base_quantity <= allocated_base_quantity/);
  assert.match(allocationSql, /packed_base_quantity <= picked_base_quantity/);
  assert.match(allocationSql, /sales_fulfillment_allocation_progress_cannot_decrease/);
  assert.match(allocationSql, /core\.fulfillment\.override-allocation-policy/);
  assert.match(allocationSql, /operation_idempotency_key/);
  assert.match(allocationSql, /sales_order_fulfillment_allocations_operation_scope_unique/);
  assert.match(allocationSql, /sales_fulfillment_transition_blocked_by_allocation/);
  assert.match(allocationSql, /WHEN count\(\*\) = 0 THEN NULL/);
  assert.match(allocationSql, /sum\(demand\.backordered_base_quantity\) = 0/);
  assert.match(allocationSql, /sales_fulfillment_allocation_requires_active_storage_location/);
  assert.match(allocationSql, /sales_fulfillment_allocation_expired_lot_forbidden/);
  assert.match(allocationSql, /sales_fulfillment_allocation_expiry_required/);
  assert.match(repositorySource, /location\.location_type = 'storage'/);
  assert.match(repositorySource, /location\.code AS location_code/);
  assert.match(repositorySource, /demand\.state = 'ACTIVE'/);
  assert.match(repositorySource, /orders\.status = 'confirmed'/);
  assert.match(repositorySource, /expiry_tracking_mode, 'NONE'\) <> 'REQUIRED'/);
  assert.match(repositorySource, /lot\.expiry_date IS NULL OR lot\.expiry_date >= CURRENT_DATE/);
  assert.match(repositorySource, /WHEN lot\.expiry_date IS NOT NULL THEN 'FEFO'/);
  assert.match(repositorySource, /ELSE 'FIFO'/);
  assert.match(serviceSource, /requestedByScope/);
  assert.match(serviceSource, /warehouseAllowed\(requestContext, replayDemand\.warehouse_id\)/);
  assert.match(serviceSource, /warehouseAllowed\(requestContext, replayAllocation\.warehouse_id\)/);
  assert.match(serviceSource, /mode === 'QUANTITY'/);
  assert.match(serviceSource, /reconcileDemandHold/);
  assert.match(registry, /043_sales_fulfillment_allocation_pick_pack/);
  assert.match(registry, /092_sales_shared_stock_hold/);
  assert.doesNotMatch(registry, /044_sales_fulfillment_allocation/);
  assert.doesNotMatch(registry, /045_sales_fulfillment_allocation/);
});

test('warehouse API and Công Ty UI keep allocation simple while preserving warehouse execution', () => {
  const inventoryRoutes = readFileSync(new URL('../src/routes/inventory.js', import.meta.url), 'utf8');
  const fulfillmentRoutes = readFileSync(new URL('../src/routes/fulfillment-operations.js', import.meta.url), 'utf8');
  const gateway = readFileSync(new URL('../../web/lib/inventory-gateway.ts', import.meta.url), 'utf8');
  const workProxy = readFileSync(new URL('../../web/app/api/inventory/fulfillment-work/route.ts', import.meta.url), 'utf8');
  const suggestionProxy = readFileSync(new URL('../../web/app/api/inventory/fulfillment-demands/[demandId]/suggestions/route.ts', import.meta.url), 'utf8');
  const allocateProxy = readFileSync(new URL('../../web/app/api/inventory/fulfillment-demands/[demandId]/allocate/route.ts', import.meta.url), 'utf8');
  const progressProxy = readFileSync(new URL('../../web/app/api/inventory/fulfillment-allocations/[allocationId]/[action]/route.ts', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../../web/app/components/app-shell-core.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../../web/app/inventory/fulfillment/fulfillment-workspace.tsx', import.meta.url), 'utf8');

  assert.match(inventoryRoutes, /handleFulfillmentOperationRoutes/);
  assert.match(fulfillmentRoutes, /\/api\/inventory\/fulfillment-work/);
  assert.match(fulfillmentRoutes, /FULFILLMENT_QUERY_FAILED/);
  assert.match(fulfillmentRoutes, /\/allocate/);
  assert.match(fulfillmentRoutes, /pick\|pack/);
  assert.match(gateway, /listFulfillmentWork/);
  assert.match(gateway, /getFulfillmentSuggestions/);
  assert.match(gateway, /allocateFulfillmentDemand/);
  assert.match(gateway, /updateFulfillmentProgress/);
  assert.match(workProxy, /listFulfillmentWork/);
  assert.match(suggestionProxy, /getFulfillmentSuggestions/);
  assert.match(allocateProxy, /allocateFulfillmentDemand/);
  assert.match(progressProxy, /updateFulfillmentProgress/);
  assert.match(shell, /href: '\/inventory\/fulfillment', label: 'Chuẩn bị hàng'/);
  assert.match(shell, /testId: 'nav-inventory-fulfillment'/);
  assert.match(workspace, /useRef/);
  assert.match(workspace, /detailRequestRef/);
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /role="status"/);
  assert.match(workspace, /aria-label="Tìm đơn, khách hàng hoặc SKU"/);
  assert.match(workspace, /Chưa phân bổ/);
  assert.match(workspace, /Khả dụng cho đơn này/);
  assert.match(workspace, /Số lượng phân bổ/);
  assert.match(workspace, /Phân bổ đủ/);
  assert.match(workspace, /mode: 'QUANTITY'/);
  assert.match(workspace, /Soạn/);
  assert.match(workspace, /Đóng gói/);
  assert.doesNotMatch(workspace, /tài xế|chuyến xe|\bPOD\b|\bCOD\b/i);
});
