import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createPgPool } from '../src/db/pool.js';
import * as service from '../src/services/document-numbering.js';

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3033',
    INSTALLATION_ID: `numbering-production-regression-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
}

async function inTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function createSeries(pool, installationId, {
  code,
  documentType,
  prefix,
}) {
  const created = await service.createDocumentNumberSeries(pool, {
    installationId,
    payload: {
      code,
      documentType,
      name: code,
      prefix,
      numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
      resetPolicy: 'MONTHLY',
      sequenceWidth: 6,
      startCounter: '1',
    },
    createdBy: 'test:numbering-regression',
  });
  assert.equal(created.ok, true, created.message);
  return created.series;
}

async function allocate(pool, config, series, idempotencyKey) {
  return inTransaction(pool, (client) => service.allocateDocumentNumber(client, {
    installationId: config.installationId,
    seriesId: series.id,
    idempotencyKey,
    payload: { documentDate: '2026-08-12' },
    actorId: 'test:numbering-regression',
    requestId: `req-${idempotencyKey}`,
    sourceApp: 'npp-core-api',
  }));
}

test('document numbering repairs a stale counter from immutable allocation history', async () => {
  const config = testConfig();
  const pool = createPgPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const series = await createSeries(pool, config.installationId, {
      code: `DRIFT-${suffix}`,
      documentType: `DRIFT_${suffix}`,
      prefix: `D${suffix}-`,
    });

    const first = await allocate(pool, config, series, `first-${suffix}`);
    assert.equal(first.ok, true, first.message);
    assert.equal(String(first.allocation.counter_value), '1');

    await pool.query(
      `UPDATE shared.document_number_counters
       SET next_counter = 1
       WHERE installation_id = $1 AND series_id = $2 AND period_key = '2026-08'`,
      [config.installationId, series.id],
    );

    const second = await allocate(pool, config, series, `second-${suffix}`);
    assert.equal(second.ok, true, second.message);
    assert.equal(String(second.allocation.counter_value), '2');
    assert.equal(second.allocation.document_number, `D${suffix}-202608-000002`);

    const counter = await pool.query(
      `SELECT next_counter
       FROM shared.document_number_counters
       WHERE installation_id = $1 AND series_id = $2 AND period_key = '2026-08'`,
      [config.installationId, series.id],
    );
    assert.equal(String(counter.rows[0].next_counter), '3');
  } finally {
    await pool.end();
  }
});

test('document number uniqueness conflict skips the occupied number without aborting the transaction', async () => {
  const config = testConfig();
  const pool = createPgPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const prefix = `C${suffix}-`;
    const firstSeries = await createSeries(pool, config.installationId, {
      code: `CONFLICT-A-${suffix}`,
      documentType: `CONFLICT_A_${suffix}`,
      prefix,
    });
    const secondSeries = await createSeries(pool, config.installationId, {
      code: `CONFLICT-B-${suffix}`,
      documentType: `CONFLICT_B_${suffix}`,
      prefix,
    });

    const first = await allocate(pool, config, firstSeries, `conflict-first-${suffix}`);
    assert.equal(first.ok, true, first.message);
    assert.equal(first.allocation.document_number, `${prefix}202608-000001`);

    const second = await inTransaction(pool, async (client) => {
      const result = await service.allocateDocumentNumber(client, {
        installationId: config.installationId,
        seriesId: secondSeries.id,
        idempotencyKey: `conflict-second-${suffix}`,
        payload: { documentDate: '2026-08-12' },
        actorId: 'test:numbering-regression',
        requestId: `req-conflict-second-${suffix}`,
        sourceApp: 'npp-core-api',
      });
      const health = await client.query('SELECT 1 AS ok');
      assert.equal(health.rows[0].ok, 1);
      return result;
    });

    assert.equal(second.ok, true, second.message);
    assert.equal(String(second.allocation.counter_value), '2');
    assert.equal(second.allocation.document_number, `${prefix}202608-000002`);

    const counter = await pool.query(
      `SELECT next_counter
       FROM shared.document_number_counters
       WHERE installation_id = $1 AND series_id = $2 AND period_key = '2026-08'`,
      [config.installationId, secondSeries.id],
    );
    assert.equal(String(counter.rows[0].next_counter), '3');
  } finally {
    await pool.end();
  }
});
