import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fulfillmentReversalInternals } from '../src/services/sales-fulfillment-reversal.js';
import { executeReleaseDeliveryOrderForReversal } from '../src/services/sales-delivery-order-reversal.js';
import {
  executeRecoverDeliveryTrip,
  executeRecoveryUnassignDeliveryOrder,
} from '../src/services/logistics-trip-recovery.js';
import { handleFulfillmentOperationRoutes } from '../src/routes/fulfillment-operations.js';
import { handleDeliveryOrderRoutes } from '../src/routes/delivery-orders.js';
import { handleLogisticsDispatchRoutes } from '../src/routes/logistics-dispatch.js';

const salesMigration = readFileSync(
  new URL('../../../database/migrations/sales/082_sales_fulfillment_reversal.sql', import.meta.url),
  'utf8',
);
const logisticsMigration = readFileSync(
  new URL('../../../database/migrations/logistics/082_logistics_trip_recovery.sql', import.meta.url),
  'utf8',
);
const registrySource = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
const fulfillmentServiceSource = readFileSync(
  new URL('../src/services/sales-fulfillment-reversal.js', import.meta.url),
  'utf8',
);

test('Lane D modules load through canonical Core route boundaries', () => {
  assert.equal(typeof handleFulfillmentOperationRoutes, 'function');
  assert.equal(typeof handleDeliveryOrderRoutes, 'function');
  assert.equal(typeof handleLogisticsDispatchRoutes, 'function');
  assert.equal(typeof executeReleaseDeliveryOrderForReversal, 'function');
  assert.equal(typeof executeRecoverDeliveryTrip, 'function');
  assert.equal(typeof executeRecoveryUnassignDeliveryOrder, 'function');
});

test('Lane D quantity contract keeps exact twelve-decimal arithmetic', () => {
  const parsed = fulfillmentReversalInternals.parseQuantity('12.340000000001');
  assert.equal(parsed, 12340000000001n);
  assert.equal(fulfillmentReversalInternals.formatQuantity(parsed), '12.340000000001');
  assert.equal(fulfillmentReversalInternals.parseQuantity('-1'), null);
});

test('Lane D stores append-only reversal facts while projection changes are service-context only', () => {
  assert.match(salesMigration, /PICK_REVERSED/);
  assert.match(salesMigration, /PACK_REVERSED/);
  assert.match(salesMigration, /quantity_delta <= 0/);
  assert.match(salesMigration, /REVERSAL_REASON_REQUIRED|reversal_event_invalid/i);
  assert.match(salesMigration, /fulfillment_reversal_service/g);
  assert.match(salesMigration, /sales_fulfillment_reversal_batches_are_append_only/);
  assert.match(salesMigration, /delivery_order_events.*RELEASED_FOR_REVERSAL/s);
  assert.doesNotMatch(salesMigration, /UPDATE\s+inventory\.inventory_balances/i);
});

test('Lane D enforces downstream unwind order instead of lifecycle jumps', () => {
  assert.match(fulfillmentServiceSource, /PICK_REVERSAL_BLOCKED_BY_PACK/);
  assert.match(fulfillmentServiceSource, /PACK_REVERSAL_BLOCKED_BY_DELIVERY_ORDER/);
  assert.match(logisticsMigration, /status IN \('draft', 'planned', 'locked', 'dispatched', 'recovered', 'closed'\)/);
  assert.match(logisticsMigration, /logistics_trip_recovery_blocked_by_delivery_attempt/);
  assert.match(logisticsMigration, /logistics_recovery_unassign_requires_reversed_inventory_issue/);
});

test('Lane D is one logical repo migration after Lane C', () => {
  const laneCIndex = registrySource.indexOf("id: '081_sales_fulfillment_shortage_discrepancy'");
  const laneDIndex = registrySource.indexOf("id: '082_sales_fulfillment_reversal'");
  assert.ok(laneCIndex >= 0, 'Lane C migration must remain in the canonical registry');
  assert.ok(laneDIndex > laneCIndex, 'Lane D migration must append after Lane C');
  assert.match(registrySource, /082_sales_fulfillment_reversal\.sql/);
  assert.match(registrySource, /082_logistics_trip_recovery\.sql/);
});
