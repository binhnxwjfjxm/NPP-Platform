import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import * as service from '../src/services/document-numbering.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3039',
    INSTALLATION_ID: `numbering-global-conflict-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

async function inTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createSeries(pool, installationId, code, documentType) {
  const result = await service.createDocumentNumberSeries(pool, {
    installationId,
    payload: {
      code,
      documentType,
      name: code,
      prefix: 'SO-',
      numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
      resetPolicy: 'MONTHLY',
      sequenceWidth: 6,
      startCounter: '1',
    },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.series;
}

async function allocate(pool, input) {
  return inTransaction(pool, (client) => service.allocateDocumentNumber(client, input));
}

test('Document numbering service — skips a rendered number occupied by another series', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const blocker = await createSeries(pool, config.installationId, `BLOCK-${suffix}`, 'BLOCKER_DOC');
    const target = await createSeries(pool, config.installationId, `TARGET-${suffix}`, 'TARGET_DOC');
    const common = {
      installationId: config.installationId,
      payload: { documentDate: '2026-08-12' },
      actorId: 'test:user',
      sourceApp: 'npp-core-api',
    };

    const occupied = await allocate(pool, {
      ...common,
      seriesId: blocker.id,
      idempotencyKey: `block-${suffix}`,
      requestId: `req-block-${suffix}`,
    });
    assert.ok(occupied.ok, occupied.message);
    assert.equal(occupied.allocation.document_number, 'SO-202608-000001');

    const allocated = await allocate(pool, {
      ...common,
      seriesId: target.id,
      idempotencyKey: `target-${suffix}`,
      requestId: `req-target-${suffix}`,
    });
    assert.ok(allocated.ok, allocated.message);
    assert.equal(allocated.allocation.document_number, 'SO-202608-000002');
    assert.equal(String(allocated.allocation.counter_value), '2');

    const replay = await allocate(pool, {
      ...common,
      seriesId: target.id,
      idempotencyKey: `target-${suffix}`,
      requestId: `req-target-replay-${suffix}`,
    });
    assert.ok(replay.ok, replay.message);
    assert.equal(replay.replayed, true);
    assert.equal(replay.allocation.id, allocated.allocation.id);

    const counter = await pool.query(
      `SELECT next_counter
       FROM shared.document_number_counters
       WHERE installation_id = $1 AND series_id = $2 AND period_key = '2026-08'`,
      [config.installationId, target.id],
    );
    assert.equal(String(counter.rows[0].next_counter), '3');
  } finally {
    await closePool();
  }
});
