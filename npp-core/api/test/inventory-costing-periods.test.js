import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  allocateLargestRemainder,
  monthBounds,
  parse12,
} from '../src/services/inventory-costing-period-utils.js';
import { compareEvents } from '../src/services/inventory-costing-period-support.js';

const migration = readFileSync(
  new URL('../../../database/migrations/inventory/063_inventory_costing_periods_backdate.sql', import.meta.url),
  'utf8',
);
const projector = readFileSync(
  new URL('../src/services/inventory-costing-period-projector.js', import.meta.url),
  'utf8',
);
const resolution = readFileSync(
  new URL('../src/services/inventory-costing-period-resolution.js', import.meta.url),
  'utf8',
);
const periodService = readFileSync(
  new URL('../src/services/inventory-costing-periods.js', import.meta.url),
  'utf8',
);
const adjustmentService = readFileSync(
  new URL('../src/services/inventory-costing-adjustments.js', import.meta.url),
  'utf8',
);
const routes = readFileSync(
  new URL('../src/routes/inventory-costing-periods.js', import.meta.url),
  'utf8',
);

test('month bounds are exact and reject non-month starts', () => {
  assert.deepEqual(monthBounds('2028-02-01'), {
    start: '2028-02-01',
    end: '2028-02-29',
  });
  assert.equal(monthBounds('2028-02-02'), null);
  assert.equal(monthBounds('2028-13-01'), null);
});

test('largest remainder allocation is exact and deterministic by receipt line id', () => {
  const result = allocateLargestRemainder(
    '1.000000000001',
    'BASE_QUANTITY',
    [
      { receiptLineId: '00000000-0000-4000-8000-000000000003', baseQuantity: '1', warehouseId: 'w3', baseVariantId: 'v3' },
      { receiptLineId: '00000000-0000-4000-8000-000000000001', baseQuantity: '1', warehouseId: 'w1', baseVariantId: 'v1' },
      { receiptLineId: '00000000-0000-4000-8000-000000000002', baseQuantity: '1', warehouseId: 'w2', baseVariantId: 'v2' },
    ],
  );
  assert.equal(result.ok, true);
  const values = result.allocations.map((item) => item.valueDelta);
  assert.deepEqual(values, ['0.333333333334', '0.333333333334', '0.333333333333']);
  const sum = values.reduce((total, value) => total + parse12(value), 0n);
  assert.equal(sum, parse12('1.000000000001'));
});

test('event ordering follows effective date, movement posting lineage, then cost event id', () => {
  const events = [
    { kind: 'adjustment', row: { posting_date: '2026-08-05', created_at: '2026-08-05T10:00:00Z', id: 'b' } },
    { kind: 'movement', row: { document_date: '2026-08-05', posted_at: '2026-08-05T09:00:00Z', movement_id: 'm2', line_number: 1, movement_line_id: 'l2' } },
    { kind: 'movement', row: { document_date: '2026-08-04', posted_at: '2026-08-06T09:00:00Z', movement_id: 'm1', line_number: 1, movement_line_id: 'l1' } },
  ].sort(compareEvents);
  assert.deepEqual(events.map((event) => event.kind === 'movement' ? event.row.movement_line_id : event.row.id), ['l1', 'l2', 'b']);
});

test('phase 7.6 source locks closed periods and keeps corrections append-only', () => {
  for (const marker of [
    'inventory.inventory_costing_periods',
    'inventory.inventory_cost_period_balances',
    'inventory.inventory_cost_adjustment_events',
    'inventory.inventory_cost_discrepancies',
    'closed_inventory_costing_period_is_immutable',
    'inventory_cost_adjustment_events_append_only',
    'FORWARD_CORRECTION',
    'PURCHASE_VALUE',
    'BASE_QUANTITY',
  ]) assert.ok(migration.includes(marker), `missing ${marker}`);
  for (const marker of [
    'CLOSED_PERIOD_LATE_MOVEMENT',
    'FULL_MUTABLE_TAIL_FROM_CLOSED_SNAPSHOT',
    'earliestAffected',
    'replaceBalances',
  ]) assert.ok(projector.includes(marker), `missing ${marker}`);
  for (const marker of [
    'HISTORICAL_REVERSAL',
    'canonicalFactByMovementLine',
    'canonicalTransferFact',
  ]) assert.ok(resolution.includes(marker), `missing ${marker}`);
  assert.match(periodService, /inventory-costing-adjustments/);
  assert.match(adjustmentService, /resolveReceiptTargets/);
  assert.match(adjustmentService, /goodsReceiptLineId/);
  assert.match(adjustmentService, /purchaseValue/);
  assert.match(routes, /withAuditOutboxTransaction/);
  assert.match(routes, /executeRequestWithIdempotency/);
  assert.match(routes, /core\.inventory-cost\.rebuild/);
  assert.match(routes, /core\.inventory-cost\.reconcile/);
});
