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
    PORT: '3038',
    INSTALLATION_ID: `numbering-invariants-${randomUUID()}`,
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
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

test('Document numbering invariants — timestamp normalization, payload-bound replay and append-only history', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const created = await service.createDocumentNumberSeries(pool, {
      installationId: config.installationId,
      payload: {
        code: `INV-${suffix}`,
        documentType: 'SALES_ORDER',
        name: 'Series kiểm tra bất biến',
        prefix: 'SO-',
        numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
        resetPolicy: 'MONTHLY',
        sequenceWidth: 6,
      },
      createdBy: 'test:user',
    });
    assert.ok(created.ok, created.message);

    const renamed = await inTransaction(pool, (client) => service.updateDocumentNumberSeries(client, {
      installationId: config.installationId,
      id: created.series.id,
      payload: { name: 'Series đã chuẩn hóa timestamp', expectedUpdatedAt: created.series.updated_at },
      updatedBy: 'test:user',
    }));
    assert.ok(renamed.ok, renamed.message);

    const baseInput = {
      installationId: config.installationId,
      seriesId: created.series.id,
      idempotencyKey: `allocation-${suffix}`,
      actorId: 'test:user',
      requestId: `req-${suffix}`,
      sourceApp: 'npp-core-api',
    };
    const first = await inTransaction(pool, (client) => service.allocateDocumentNumber(client, {
      ...baseInput,
      payload: { documentDate: '2026-07-27', metadata: { source: 'test', nested: { b: 2, a: 1 } } },
    }));
    assert.ok(first.ok, first.message);
    assert.equal(first.replayed, false);

    const equivalentReplay = await inTransaction(pool, (client) => service.allocateDocumentNumber(client, {
      ...baseInput,
      payload: { documentDate: '2026-07-27', metadata: { nested: { a: 1, b: 2 }, source: 'test' } },
    }));
    assert.ok(equivalentReplay.ok, equivalentReplay.message);
    assert.equal(equivalentReplay.replayed, true);
    assert.equal(equivalentReplay.allocation.id, first.allocation.id);

    const changedDate = await inTransaction(pool, (client) => service.allocateDocumentNumber(client, {
      ...baseInput,
      payload: { documentDate: '2026-07-28', metadata: { source: 'test', nested: { a: 1, b: 2 } } },
    }));
    assert.equal(changedDate.ok, false);
    assert.equal(changedDate.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    const changedMetadata = await inTransaction(pool, (client) => service.allocateDocumentNumber(client, {
      ...baseInput,
      payload: { documentDate: '2026-07-27', metadata: { source: 'changed' } },
    }));
    assert.equal(changedMetadata.ok, false);
    assert.equal(changedMetadata.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    await assert.rejects(
      pool.query('UPDATE shared.document_number_allocations SET metadata = metadata WHERE installation_id = $1 AND id = $2', [config.installationId, first.allocation.id]),
      /document_number_allocations_are_append_only/,
    );
    await assert.rejects(
      pool.query('DELETE FROM shared.document_number_allocations WHERE installation_id = $1 AND id = $2', [config.installationId, first.allocation.id]),
      /document_number_allocations_are_append_only/,
    );
  } finally {
    await closePool();
  }
});
