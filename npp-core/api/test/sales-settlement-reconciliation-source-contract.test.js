import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { salesSettlementReconciliationInternals } from '../src/services/sales-settlement-reconciliation.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('6F.5 registers read-only reconciliation views exactly once', () => {
  const matches = CORE_API_MIGRATIONS.filter((entry) => entry.id === '057_phase6f_reconciliation_views');
  assert.equal(matches.length, 1);
  assert.match(matches[0].sql, /reporting\.phase6f_document_reconciliation/);
  assert.match(matches[0].sql, /reporting\.phase6f_customer_balance_reconciliation/);
  assert.match(matches[0].sql, /reporting\.phase6f_order_status_projection/);
  assert.match(matches[0].sql, /reporting\.phase6f_cod_collection_reconciliation/);
  assert.match(matches[0].sql, /reporting\.phase6f_cod_handover_reconciliation/);
  assert.match(matches[0].sql, /reporting\.phase6f_closeout_anomalies/);
  assert.doesNotMatch(matches[0].sql, /CREATE TABLE|INSERT INTO|UPDATE\s+accounting|DELETE FROM/);
});

test('reconciliation route is GET-only, deny-by-default and warehouse scoped', () => {
  const route = source('../src/routes/sales-settlement-reconciliation.js');
  const repository = source('../src/db/repositories/sales-settlement-reconciliation.js');
  const wrapper = source('../src/routes/customer-receivables.js');
  assert.match(route, /coreReceivableRead/);
  assert.match(route, /METHOD_NOT_ALLOWED/);
  assert.doesNotMatch(route, /readJsonBody|executeRequestWithIdempotency|withAuditOutboxTransaction/);
  assert.match(repository, /warehouseColumn \?\? 'warehouse_id'/);
  assert.match(repository, /ANY\(\$2::uuid\[\]\)/);
  assert.match(repository, /reporting\.phase6f_closeout_anomalies/);
  assert.match(wrapper, /handleSalesSettlementReconciliationRoutes/);
});

test('reconciliation query validation keeps dates, search and status stable', () => {
  assert.equal(salesSettlementReconciliationInternals.normalize({ from: '2026-08-01', to: '2026-08-31', search: 'KH01', status: 'mismatch', limit: 100 }).ok, true);
  assert.equal(salesSettlementReconciliationInternals.normalize({ from: '2026-09-01', to: '2026-08-31' }).code, 'INVALID_RECONCILIATION_PERIOD');
  assert.equal(salesSettlementReconciliationInternals.normalize({ status: 'unknown' }).code, 'INVALID_RECONCILIATION_STATUS');
});

test('production reconciliation script reports anomalies without exposing database credentials', () => {
  const script = source('../scripts/phase-6f-reconciliation.js');
  assert.match(script, /phase6f_closeout_anomalies/);
  assert.match(script, /anomalyCount/);
  assert.match(script, /process\.exitCode = 1/);
  assert.doesNotMatch(script, /databaseUrl|DATABASE_URL|password/);
});
