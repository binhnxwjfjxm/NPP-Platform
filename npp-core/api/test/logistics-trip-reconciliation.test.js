import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { PERMISSIONS } from '../src/access/permissions.js';
import { salesInventoryLedgerInternals } from '../src/services/sales-inventory-ledger.js';
import { logisticsTripReconciliationInternals } from '../src/services/logistics-trip-reconciliation.js';

const migrationSource = readFileSync(
  new URL('../../../database/migrations/logistics/051_logistics_trip_reconciliation.sql', import.meta.url),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../src/services/logistics-trip-reconciliation.js', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(
  new URL('../src/routes/logistics-reconciliation.js', import.meta.url),
  'utf8',
);

test('migration 051 is registered once and locks append-only reconciliation', () => {
  const migrations = CORE_API_MIGRATIONS.filter((entry) => entry.id === '051_logistics_trip_reconciliation');
  assert.equal(migrations.length, 1);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS logistics\.trip_return_receipts/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS logistics\.trip_return_receipt_lines/);
  assert.match(migrationSource, /logistics_trip_return_quantity_exceeds_outstanding/);
  assert.match(migrationSource, /logistics_trip_close_missing_attempts/);
  assert.match(migrationSource, /logistics_trip_close_unreconciled_stock/);
  assert.match(migrationSource, /OLD\.status = 'dispatched' AND NEW\.status = 'closed'/);
  assert.doesNotMatch(migrationSource, /UPDATE inventory\.inventory_movements/);
  assert.doesNotMatch(migrationSource, /DELETE FROM inventory\.inventory_movements/);
});

test('reconciliation permissions are deny-by-default capability keys', () => {
  assert.equal(PERMISSIONS.coreDeliveryTripReconciliationRead, 'core.delivery-trip.reconciliation-read');
  assert.equal(PERMISSIONS.coreDeliveryTripReturnReceive, 'core.delivery-trip.return-receive');
  assert.equal(PERMISSIONS.coreDeliveryTripClose, 'core.delivery-trip.close');
});

test('trusted inventory contract accepts only logistics IN for trip return', () => {
  const base = {
    movementType: 'LOGISTICS_TRIP_RETURN',
    direction: 'IN',
    sourceDomain: 'LOGISTICS',
    sourceDocumentType: 'TRIP_RETURN_RECEIPT',
    sourceDocumentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sourceDocumentNumber: 'TRIP-001-RETURN',
    documentDate: '2026-08-05',
    reasonCode: 'FAILED_DELIVERY_RETURN',
    reasonNote: 'Kho thực nhận',
    lines: [{
      sourceLineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      warehouseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      locationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      baseVariantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      baseSku: 'SKU-01',
      baseUnitId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      baseUnitCode: 'KG',
      quantity: '2.000000000000',
    }],
  };
  assert.equal(salesInventoryLedgerInternals.normalizePayload(base).ok, true);
  assert.equal(salesInventoryLedgerInternals.normalizePayload({ ...base, direction: 'OUT' }).code, 'INVALID_DIRECTION');
  assert.equal(salesInventoryLedgerInternals.normalizePayload({ ...base, sourceDomain: 'SALES' }).code, 'INVALID_DIRECTION');
});

test('receipt normalization is exact, positive, unique and canonical', () => {
  const normalized = logisticsTripReconciliationInternals.normalizeReceiptPayload(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    {
      receivedAt: '2026-08-05T01:00:00.000Z',
      note: 'Kho nhận đủ',
      lines: [
        { inventoryIssueLineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', returnedBaseQuantity: '2' },
        { inventoryIssueLineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', returnedBaseQuantity: '1.5' },
      ],
    },
  );
  assert.equal(normalized.ok, true);
  assert.deepEqual(
    normalized.value.lines.map((line) => line.inventoryIssueLineId),
    ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
  );
  assert.equal(normalized.value.lines[0].returnedBaseQuantity, '1.500000000000');
  const duplicated = logisticsTripReconciliationInternals.normalizeReceiptPayload(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    {
      receivedAt: '2026-08-05T01:00:00.000Z',
      lines: [
        { inventoryIssueLineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', returnedBaseQuantity: '1' },
        { inventoryIssueLineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', returnedBaseQuantity: '1' },
      ],
    },
  );
  assert.equal(duplicated.code, 'INVALID_INVENTORY_ISSUE_LINE');
});

test('service and routes keep return, close, audit and outbox in the server boundary', () => {
  assert.match(routeSource, /reconciliation\|return-receipts\|close/);
  assert.match(serviceSource, /postServerOwnedDomainMovement/);
  assert.match(serviceSource, /LOGISTICS_TRIP_RETURN/);
  assert.match(serviceSource, /insertAuditRecord/);
  assert.match(serviceSource, /insertOutboxEvent/);
  assert.match(serviceSource, /core\.delivery_trip\.return_received/);
  assert.match(serviceSource, /core\.delivery_trip\.closed/);
  assert.doesNotMatch(serviceSource, /reverseMovement|reverseIssue|SALES_CUSTOMER_RETURN/);
});
