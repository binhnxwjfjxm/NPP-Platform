import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  executeDeliveryDispatchInventoryIssue,
  salesDeliveryInventoryInternals,
} from '../src/services/sales-delivery-inventory.js';
import { salesInventoryLedgerInternals } from '../src/services/sales-inventory-ledger.js';

const UUID = '11111111-1111-4111-8111-111111111111';

test('Phase 6D.4 exact quantity and hashing helpers are stable', () => {
  assert.equal(salesDeliveryInventoryInternals.parseQuantity('9.123456789012'), 9123456789012n);
  assert.equal(salesDeliveryInventoryInternals.formatQuantity(9123456789012n), '9.123456789012');
  assert.equal(salesDeliveryInventoryInternals.parseQuantity('0.000000000001'), 1n);
  assert.equal(salesDeliveryInventoryInternals.parseQuantity('1.0000000000001'), null);
  assert.equal(
    salesDeliveryInventoryInternals.payloadHash({ b: 2, a: { y: 2, x: 1 } }),
    salesDeliveryInventoryInternals.payloadHash({ a: { x: 1, y: 2 }, b: 2 }),
  );
  assert.equal(salesInventoryLedgerInternals.parseQuantity('3.250000000001'), 3250000000001n);
});

test('Delivery dispatch inventory issue requires a trusted Logistics source', async () => {
  const result = await executeDeliveryDispatchInventoryIssue({
    adapter: null,
    requestContext: {},
    deliveryOrderId: UUID,
    idempotencyKey: 'dispatch-test',
    dispatchSource: { sourceType: 'MANUAL', dispatchId: 'manual-bypass' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRUSTED_LOGISTICS_SOURCE_REQUIRED');
});

test('Customer Return input rejects duplicate origins and over-precision', () => {
  const invalidCreate = salesDeliveryInventoryInternals.validateCreateReturnPayload({
    lines: [
      { issueLineId: UUID, quantity: '1.000000000000', reasonCode: 'OTHER', reasonNote: 'Lý do' },
      { issueLineId: UUID, quantity: '1.000000000000', reasonCode: 'OTHER', reasonNote: 'Lý do' },
    ],
  });
  assert.equal(invalidCreate.ok, false);
  assert.equal(invalidCreate.code, 'INVALID_ISSUE_LINE_ID');

  const invalidReceive = salesDeliveryInventoryInternals.validateReceivePayload({
    documentDate: '2026-08-04',
    expectedRevision: '1',
    lines: [{ customerReturnLineId: UUID, acceptedQuantity: '1.0000000000001' }],
  });
  assert.equal(invalidReceive.ok, false);
  assert.equal(invalidReceive.code, 'INVALID_RECEIPT_LINE');
});

test('Phase 6D.4 migration locks issue, reversal, reservation and return lineage', () => {
  const foundation = readFileSync(
    new URL('../../../database/migrations/sales/045_sales_inventory_issue_customer_return.sql', import.meta.url),
    'utf8',
  );
  const guards = readFileSync(
    new URL('../../../database/migrations/sales/045_sales_inventory_issue_customer_return_guards.sql', import.meta.url),
    'utf8',
  );
  const registry = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/services/sales-delivery-inventory.js', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/routes/delivery-orders.js', import.meta.url), 'utf8');

  assert.match(foundation, /CREATE TABLE IF NOT EXISTS sales\.delivery_order_inventory_issues/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS inventory\.inventory_reservation_issue_adjustments/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS sales\.customer_returns/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS sales\.customer_return_lines/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS sales\.customer_return_receipt_lines/);
  assert.match(foundation, /core\.delivery-order\.pickup-handover/);
  assert.match(foundation, /core\.delivery-order\.reverse-inventory-issue/);
  assert.match(foundation, /core\.customer-return\.receive/);
  assert.match(foundation, /customer_return_quantity_exceeds_issued/);
  assert.match(guards, /header\.status IN \('draft', 'ready_to_dispatch', 'dispatched', 'handed_over'\)/);
  assert.match(guards, /delivery_issue_movement_line_mismatch/);
  assert.match(registry, /045_sales_inventory_issue_customer_return/);
  assert.match(service, /executePickupHandover/);
  assert.match(service, /executeDeliveryDispatchInventoryIssue/);
  assert.match(service, /TRUSTED_LOGISTICS_SOURCE_REQUIRED/);
  assert.match(service, /core\.sales\.customer_return\.received/);
  assert.match(route, /pickup-handover\|reverse-inventory-issue/);
  assert.doesNotMatch(route, /\/dispatch(?:'|\"|\/)/);
});

test('Phase 6D.4 stays free of trip, POD, COD and accounting schema while 6F.1 hooks pickup receivable posting', () => {
  const service = readFileSync(new URL('../src/services/sales-delivery-inventory.js', import.meta.url), 'utf8');
  const migration = readFileSync(
    new URL('../../../database/migrations/sales/045_sales_inventory_issue_customer_return.sql', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS .*delivery_trips|delivery_attempts|proof_of_delivery|receivable|accounting/i);
  assert.doesNotMatch(service, /assignDriver|optimizeRoute|recordPod|collectCod|postAccounting/i);
  assert.match(service, /postReceivableFromPickupHandover/);
});