import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { closePool, getPool } from '../src/db/pool.js';
import { loadConfig } from '../src/config.js';
import { codReport } from '../src/routes/reporting-cod.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Phase 8.6 registers dedicated COD reporting permission and metadata-only migration', () => {
  const permissions = source('../src/access/permissions.js');
  const requestContext = source('../src/request-context.js');
  assert.match(permissions, /coreReportingCodRead:\s*'core\.reporting\.cod\.read'/);
  assert.match(requestContext, /PERMISSIONS\.coreReportingCodRead/);
  const migration068 = CORE_API_MIGRATIONS.findIndex((entry) => entry.id === '068_reporting_logistics_permission_catalog');
  const migration069 = CORE_API_MIGRATIONS.findIndex((entry) => entry.id === '069_reporting_cod_permission_catalog');
  assert.ok(migration068 >= 0 && migration069 === migration068 + 1);
  const sql = CORE_API_MIGRATIONS[migration069].sql;
  assert.match(sql, /core\.reporting\.cod\.read/);
  assert.doesNotMatch(sql, /role_permission|INSERT\s+INTO\s+(accounting|sales|logistics)\./i);
});

test('Phase 8.6 reuses canonical Phase 6F COD read models and separates snapshot from period activity', () => {
  const report = source('../src/routes/reporting-cod.js');
  assert.match(report, /reporting\.phase6f_cod_collection_reconciliation/);
  assert.match(report, /reporting\.phase6f_cod_handover_reconciliation/);
  assert.match(report, /reporting\.phase6f_closeout_anomalies/);
  assert.match(report, /collection_method = 'CASH'/);
  assert.match(report, /custody_remaining_amount > 0/);
  assert.match(report, /const scopeParams =/);
  assert.match(report, /const periodParams =/);
  assert.match(report, /const snapshotAtParams =/);
  assert.match(report, /collected_at >= \$3::timestamptz/);
  assert.match(report, /handed_over_at >= \$3::timestamptz/);
  assert.match(report, /accepted_at >= \$3::timestamptz/);
  assert.match(report, /collection_method = 'NONE'/);
  assert.match(report, /collection\.due_at < \$4::timestamptz/);
  assert.match(report, /count\(DISTINCT collection\.currency_code\)/);
  assert.match(report, /currency_count <> 1/);
  assert.doesNotMatch(report, /sum\([^)]*\)\s+AS\s+global/i);
});

test('Phase 8.6 report SQL executes against empty scoped PostgreSQL data', async () => {
  const config = loadConfig({ NODE_ENV: 'test', INSTALLATION_ID: `phase86-${randomUUID()}`, DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform', DATABASE_SSL_MODE: 'disable', BACKEND_API_TOKEN: 'test-token-0123456789abcdef', CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap', CORS_ORIGINS: 'http://127.0.0.1:3005' });
  const pool = getPool(config);
  try {
    const report = await codReport(pool, Object.freeze({ installationId: config.installationId, receivedAt: '2026-08-07T15:00:00.000Z' }), Object.freeze({ from: '2026-08-01', to: '2026-08-07', fromInstant: '2026-07-31T17:00:00.000Z', toExclusiveInstant: '2026-08-07T17:00:00.000Z', warehouseId: null }), [randomUUID()]);
    assert.equal(report.businessTimezone, 'Asia/Ho_Chi_Minh');
    assert.deepEqual(report.currentSnapshot.custodyByCurrency, []);
    assert.deepEqual(report.activity.collections, []);
  } finally { await closePool(); }
});
