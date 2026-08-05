import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const migration = readFileSync(
  new URL('../../../database/migrations/accounting/053_customer_receivable_ledger.sql', import.meta.url),
  'utf8',
);
const migrationRegistry = source('src/migrations/index.js');
const deliveryAttempt = source('src/services/logistics-driver-delivery.js');
const pickup = source('src/services/sales-delivery-inventory.js');
const server = source('src/server.js');
const permissions = source('src/access/permissions.js');

test('migration 053 owns append-only customer receivable facts and rebuildable balance', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS accounting\.receivable_documents/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS accounting\.receivable_document_lines/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS accounting\.receivable_ledger_entries/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS accounting\.customer_receivable_balances/);
  assert.match(migration, /receivable_history_is_append_only/);
  assert.match(migration, /rebuild_customer_receivable_balances/);
  assert.match(migration, /core\.receivable\.read/);
  assert.doesNotMatch(migration, /payment|allocation|refund|write.?off|cash_handover/i);
});

test('migration 053 is registered after logistics migration 052', () => {
  const position052 = migrationRegistry.indexOf('052_logistics_optional_proof_of_delivery');
  const position053 = migrationRegistry.indexOf('053_customer_receivable_ledger');
  assert.ok(position052 >= 0);
  assert.ok(position053 > position052);
});

test('accepted delivery and pickup post receivable inside their existing transaction', () => {
  assert.match(deliveryAttempt, /postReceivableFromDeliveryAttempt\(client/);
  assert.match(deliveryAttempt, /delivered_full.*delivered_partial/s);
  assert.match(pickup, /postReceivableFromPickupHandover\(client/);
  assert.match(pickup, /expectedAuditCount: receivablePosted \? 2 : 1/);
  assert.doesNotMatch(deliveryAttempt, /failed.*postReceivableFromDeliveryAttempt/s);
});

test('Core read route and deny-by-default permission are registered', () => {
  assert.match(server, /handleCustomerReceivableRoutes/);
  assert.match(permissions, /coreReceivableRead: 'core\.receivable\.read'/);
});
