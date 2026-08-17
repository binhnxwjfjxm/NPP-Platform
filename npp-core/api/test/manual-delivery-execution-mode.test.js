import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import {
  salesOrderDeliveryExecutionInternals,
} from '../src/services/sales-order.js';
import {
  getDeliveryOrderForAssignment,
  listEligibleDeliveryOrders,
} from '../src/db/repositories/logistics-trip-planning.js';

const {
  normalizeDeliveryExecution,
  mergeDetailedOrder,
} = salesOrderDeliveryExecutionInternals;

test('delivery execution defaults DELIVERY to TRIP and accepts explicit MANUAL', () => {
  assert.deepEqual(normalizeDeliveryExecution({ deliveryMode: 'DELIVERY' }), {
    ok: true,
    deliveryExecutionMode: 'TRIP',
  });
  assert.deepEqual(normalizeDeliveryExecution({
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode: 'manual',
  }), {
    ok: true,
    deliveryExecutionMode: 'MANUAL',
  });
});

test('pickup rejects trip/manual execution intent', () => {
  const result = normalizeDeliveryExecution({
    deliveryMode: 'PICKUP',
    deliveryExecutionMode: 'MANUAL',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DELIVERY_EXECUTION_MODE_NOT_APPLICABLE');
});

test('detailed Sales Order exposes version and current delivery execution mode', () => {
  const order = {
    id: 'order-1',
    currentVersionNumber: '2',
    deliveryMode: 'DELIVERY',
    versions: [
      { versionNumber: '1', deliveryMode: 'DELIVERY' },
      { versionNumber: '2', deliveryMode: 'DELIVERY' },
    ],
  };
  const merged = mergeDetailedOrder(order, [
    { version_number: 1, delivery_mode: 'DELIVERY', delivery_execution_mode: 'TRIP' },
    { version_number: 2, delivery_mode: 'DELIVERY', delivery_execution_mode: 'MANUAL' },
  ]);
  assert.equal(merged.deliveryExecutionMode, 'MANUAL');
  assert.deepEqual(merged.versions.map((version) => version.deliveryExecutionMode), ['TRIP', 'MANUAL']);
});

test('migration 089 backfills legacy delivery orders and guards trip assignment', () => {
  const migration = CORE_API_MIGRATIONS.find((entry) => entry.id === '089_sales_delivery_execution_mode');
  assert.ok(migration);
  assert.match(migration.sql, /delivery_execution_mode IN \('TRIP', 'MANUAL'\)/);
  assert.match(migration.sql, /WHEN delivery_mode = 'DELIVERY' THEN 'TRIP'/);
  assert.match(migration.sql, /DISABLE TRIGGER sales_order_versions_immutable/);
  assert.match(migration.sql, /ENABLE TRIGGER sales_order_versions_immutable/);
  assert.match(migration.sql, /guard_sales_order_delivery_execution_mutation/);
  assert.match(migration.sql, /OLD\.version_status <> 'draft'/);
  assert.match(migration.sql, /NEW\.delivery_execution_mode IS DISTINCT FROM OLD\.delivery_execution_mode/);
  assert.match(migration.sql, /logistics_assignment_delivery_execution_denied/);
  assert.match(migration.sql, /delivery_order\.sales_order_version_id/);
});

test('trip planning only returns exact-version TRIP delivery orders', async () => {
  const trip = { id: '11111111-1111-4111-8111-111111111111', sales_order_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const manual = { id: '22222222-2222-4222-8222-222222222222', sales_order_version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  let calls = 0;
  const client = {
    async query(sql) {
      calls += 1;
      if (sql.includes('FROM sales.delivery_orders delivery_order')) return { rows: [trip, manual] };
      if (sql.includes('FROM sales.sales_order_versions')) {
        return { rows: [
          { id: trip.sales_order_version_id, delivery_mode: 'DELIVERY', delivery_execution_mode: 'TRIP' },
          { id: manual.sales_order_version_id, delivery_mode: 'DELIVERY', delivery_execution_mode: 'MANUAL' },
        ] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const rows = await listEligibleDeliveryOrders(client, {
    installationId: 'installation-1',
    warehouseIds: ['33333333-3333-4333-8333-333333333333'],
  });
  assert.deepEqual(rows, [trip]);
  assert.equal(calls, 2);
});

test('direct trip assignment lookup hides MANUAL delivery order', async () => {
  const manual = {
    id: '22222222-2222-4222-8222-222222222222',
    sales_order_version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  };
  const client = {
    async query(sql) {
      if (sql.includes('SELECT * FROM sales.delivery_orders')) return { rows: [manual] };
      if (sql.includes('FROM sales.sales_order_versions')) {
        return { rows: [{ delivery_mode: 'DELIVERY', delivery_execution_mode: 'MANUAL' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const row = await getDeliveryOrderForAssignment(client, {
    installationId: 'installation-1',
    deliveryOrderId: manual.id,
  });
  assert.equal(row, null);
});
