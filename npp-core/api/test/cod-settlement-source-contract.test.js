import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('6F.4 migration keeps customer settlement separate from driver cash custody', () => {
  const sql = [
    source('../../../database/migrations/accounting/056_cod_collection_handover_schema.sql'),
    source('../../../database/migrations/accounting/056_cod_collection_handover_projections.sql'),
  ].join('\n');
  assert.match(sql, /accounting\.cod_collections/);
  assert.match(sql, /accounting\.cod_cash_handovers/);
  assert.match(sql, /accounting\.cod_cash_acceptances/);
  assert.match(sql, /source_receivable_document_id/);
  assert.match(sql, /payment_document_id/);
  assert.match(sql, /cod_collection_custody/);
  assert.match(sql, /cod_history_is_append_only/);
  assert.match(sql, /cod_collection_reversals/);
  assert.match(sql, /cod_cash_handover_reversals/);
  assert.match(sql, /cod_cash_acceptance_reversals/);
});

test('driver and accounting COD permissions are deny-by-default and separate', () => {
  const permissions = source('../src/access/permissions.js');
  const context = source('../src/request-context.js');
  assert.match(permissions, /core\.cod-collection\.record/);
  assert.match(permissions, /core\.cod-handover\.create/);
  assert.match(permissions, /core\.cod-reconciliation\.accept/);
  assert.match(context, /withDeliveryAttemptPermissions[\s\S]*coreCodCollectionRecord/);
  assert.match(context, /withDeliveryAttemptPermissions[\s\S]*coreCodHandoverCreate/);
  assert.doesNotMatch(context, /createMcpSalesPrincipal[\s\S]{0,500}coreCod/);
});

test('COD mutations use idempotency, audit/outbox and exact route scope', () => {
  const driverRoute = source('../src/routes/cod-driver.js');
  const accountingRoute = source('../src/routes/cod-reconciliation.js');
  const service = [
    source('../src/services/cod-settlement-shared.js'),
    source('../src/services/cod-settlement-driver.js'),
    source('../src/services/cod-settlement-reconciliation.js'),
  ].join('\n');
  assert.match(driverRoute, /executeRequestWithIdempotency/);
  assert.match(driverRoute, /withAuditOutboxTransaction/);
  assert.match(driverRoute, /core\.cod\.collection_recorded/);
  assert.match(driverRoute, /core\.cod\.handover_recorded/);
  assert.match(accountingRoute, /core\.cod\.reconciled/);
  assert.match(service, /pg_advisory_xact_lock|lockCodKey/);
  assert.match(service, /COLLECT_ON_DELIVERY/);
  assert.match(service, /createCustomerPayment/);
  assert.match(service, /reverseCustomerPayment/);
  assert.match(service, /COD_HANDOVER_EXCEEDS_CUSTODY/);
});

test('closed trips remain available for COD custody handover but cannot record new collection', () => {
  const driverRepository = source('../src/db/repositories/cod-settlement-driver.js');
  const driverRoute = source('../src/routes/cod-driver.js');
  assert.match(driverRepository, /getDriverTrip[\s\S]*trip\.status IN \('dispatched', 'closed'\)/);
  assert.match(driverRepository, /listDriverCustodyTripIds[\s\S]*custody\.custody_remaining_amount > 0/);
  assert.match(driverRepository, /listDriverCodAssignments[\s\S]*trip\.status IN \('dispatched', 'closed'\)/);
  assert.match(driverRepository, /getCollectionLineageForDriver[\s\S]*trip\.status = 'dispatched'/);
  assert.match(driverRoute, /\/api\/logistics\/driver\/cod-custody/);
});
