import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSslConfig, createPgPool, queryReady, resolvePgPoolMax, snapshotPgPool, setPoolForTest, closePool } from '../src/db/pool.js';

const config = {
  databaseUrl: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
  databaseSslMode: 'disable',
  databasePoolMax: 10,
};

test('createPgPool constructs a pool with the configured connection limit without issuing a query', () => {
  let options;
  let queryCount = 0;
  class FakePool {
    constructor(input) {
      options = input;
    }
    query() {
      queryCount += 1;
    }
    async end() {}
  }

  const pool = createPgPool(config, FakePool);
  assert.ok(pool);
  assert.equal(options.connectionString, config.databaseUrl);
  assert.equal(options.ssl, false);
  assert.equal(options.max, 10);
  assert.equal(queryCount, 0);
});

test('database pool size has a bounded default and rejects unsafe values', () => {
  assert.equal(resolvePgPoolMax({}), 10);
  assert.equal(resolvePgPoolMax({ databasePoolMax: '12' }), 12);
  assert.throws(() => resolvePgPoolMax({ databasePoolMax: '1' }), /invalid_database_pool_max/);
  assert.throws(() => resolvePgPoolMax({ databasePoolMax: '31' }), /invalid_database_pool_max/);
  assert.throws(() => resolvePgPoolMax({ databasePoolMax: 'many' }), /invalid_database_pool_max/);
});

test('pool snapshot exposes only capacity counters', () => {
  assert.deepEqual(snapshotPgPool({ totalCount: 8, idleCount: 2, waitingCount: 3 }, 10), {
    max: 10,
    total: 8,
    idle: 2,
    waiting: 3,
  });
});

test('SSL modes are explicit', () => {
  assert.equal(buildSslConfig('disable'), false);
  assert.deepEqual(buildSslConfig('require'), { rejectUnauthorized: false });
  assert.deepEqual(buildSslConfig('verify-full'), { rejectUnauthorized: true });
  assert.throws(() => buildSslConfig('unknown'), /invalid_database_ssl_mode/);
});

test('readiness query uses an injected executor', async () => {
  const statements = [];
  const result = await queryReady(config, {
    async query(sql) {
      statements.push(sql);
      return { rows: [{ ok: 1 }] };
    },
  });
  assert.deepEqual(statements, ['SELECT 1 AS ok']);
  assert.equal(result.rows[0].ok, 1);
});

test('closePool disposes the shared pool safely', async () => {
  let ended = 0;
  setPoolForTest({ async end() { ended += 1; } });
  await closePool();
  await closePool();
  assert.equal(ended, 1);
});