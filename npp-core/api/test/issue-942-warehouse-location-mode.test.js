import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { warehouseLocationModeInternals } from '../src/services/warehouse-location-mode.js';

const serviceSource = await readFile(new URL('../src/services/warehouse-location-mode.js', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../src/routes/warehouse-location-mode.js', import.meta.url), 'utf8');
const repositorySource = await readFile(new URL('../src/db/repositories/warehouse-location-mode.js', import.meta.url), 'utf8');

function row({ locationId = null, onHand = '0.000000000000', reserved = '0.000000000000' } = {}) {
  return {
    location_id: locationId,
    on_hand_quantity: onHand,
    reserved_quantity: reserved,
  };
}

test('Issue #942 migration adds warehouse-owned mode without mutating inventory balances', () => {
  const migration = CORE_API_MIGRATIONS.find(({ id }) => id === '131_warehouse_location_management_mode');
  assert.ok(migration);
  assert.match(migration.sql, /ALTER TABLE shared\.warehouses[\s\S]*location_management_mode/);
  assert.match(migration.sql, /warehouse_location_mode_runs/);
  assert.match(migration.sql, /warehouse_location_mode_run_lines/);
  assert.match(migration.sql, /base_sku_snapshot/);
  assert.match(migration.sql, /source_location_id/);
  assert.match(migration.sql, /destination_location_id/);
  assert.match(migration.sql, /base_quantity/);
  assert.doesNotMatch(migration.sql, /UPDATE\s+inventory\.inventory_balances/i);
});

test('Issue #942 only infers legacy warehouse mode when current stock shape is unambiguous', () => {
  const { inferMode } = warehouseLocationModeInternals;
  assert.equal(inferMode([
    row({ locationId: '11111111-1111-4111-8111-111111111111', onHand: '3' }),
    row({ locationId: '22222222-2222-4222-8222-222222222222', onHand: '2' }),
  ]), 'MANAGED');
  assert.equal(inferMode([row({ onHand: '5' })]), 'UNMANAGED');
  assert.equal(inferMode([
    row({ locationId: '11111111-1111-4111-8111-111111111111', onHand: '3' }),
    row({ onHand: '2' }),
  ]), null);
  assert.equal(inferMode([]), null);
});

test('Issue #942 preserves exact scale-12 quantity when creating transfer movement representation', () => {
  const { movementRepresentation, parse12 } = warehouseLocationModeInternals;
  assert.deepEqual(
    movementRepresentation(parse12('12.000000000000')),
    { sourceQuantity: '12.000000', conversionToBase: '1.000000' },
  );
  assert.deepEqual(
    movementRepresentation(parse12('1.234567890123')),
    { sourceQuantity: '1234567.890123', conversionToBase: '0.000001' },
  );
});

test('Issue #942 conversion uses carrying-cost transfers and never fakes economic adjustments', () => {
  assert.match(serviceSource, /movementType:\s*'TRANSFER_ISSUE'/);
  assert.match(serviceSource, /movementType:\s*'TRANSFER_RECEIPT'/);
  assert.match(serviceSource, /inventoryTransferLineId:\s*lineId/);
  assert.match(serviceSource, /createIdempotencyKey\('warehouse-location-mode-issue'/);
  assert.match(serviceSource, /createIdempotencyKey\('warehouse-location-mode-receipt'/);
  assert.doesNotMatch(serviceSource, /MANUAL_ADJUSTMENT_IN|MANUAL_ADJUSTMENT_OUT/);
});

test('Issue #942 preview blocks open reservations but does not block merely because stock exists', () => {
  assert.match(serviceSource, /ACTIVE_RESERVATIONS_PRESENT/);
  assert.match(serviceSource, /reservedQuantity\s*>\s*0n/);
  assert.doesNotMatch(serviceSource, /WAREHOUSE_HAS_STOCK|STOCK_MUST_BE_ZERO/);
});

test('Issue #942 conversion endpoint is warehouse-scoped and commits audit plus outbox atomically', () => {
  assert.match(routeSource, /PERMISSIONS\.coreWarehouseWrite/);
  assert.match(routeSource, /hasWarehouseScope\(requestContext, warehouseId\)/);
  assert.match(routeSource, /withAuditOutboxTransaction/);
  assert.match(routeSource, /warehouse\.location_mode\.convert/);
  assert.match(routeSource, /inventory\.warehouse_location_mode\.completed/);
  assert.match(routeSource, /isValidIdempotencyKey/);
});

test('Issue #942 scope-version lock avoids FOR UPDATE on the nullable side of a LEFT JOIN', () => {
  assert.match(repositorySource, /JOIN inventory\.inventory_scope_versions version/);
  assert.match(repositorySource, /FOR UPDATE OF version/);
  assert.doesNotMatch(
    repositorySource,
    /LEFT JOIN inventory\.inventory_scope_versions version[\s\S]{0,800}FOR UPDATE OF version/,
  );
});
