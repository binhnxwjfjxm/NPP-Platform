import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import * as repository from '../src/db/repositories/document-numbering.js';
import * as service from '../src/services/document-numbering.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3033',
    INSTALLATION_ID: `numbering-h-${randomUUID()}`,
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

function standardPayload(overrides = {}) {
  return {
    code: 'CLIENT_CODE_MUST_NOT_WIN',
    documentType: 'SALES_ORDER',
    name: 'Đơn bán Lane H',
    prefix: 'SO-',
    numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
    resetPolicy: 'MONTHLY',
    sequenceWidth: 6,
    startCounter: '1',
    isActive: true,
    ...overrides,
  };
}

async function createStandard(pool, installationId, overrides = {}) {
  return service.createDocumentNumberSeries(pool, {
    installationId,
    payload: standardPayload(overrides),
    createdBy: 'test:lane-h',
  });
}

test('Lane H — standard identity is server-owned and one active series per type is concurrency-safe', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const concurrent = await Promise.all([
      createStandard(pool, config.installationId, { name: 'Đơn bán A' }),
      createStandard(pool, config.installationId, { name: 'Đơn bán B' }),
    ]);
    const successes = concurrent.filter((result) => result.ok);
    const failures = concurrent.filter((result) => !result.ok);
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, 'ACTIVE_SERIES_EXISTS');

    const active = successes[0].series;
    assert.notEqual(active.code, 'CLIENT_CODE_MUST_NOT_WIN');
    assert.match(active.code, /^SALES_ORDER_[0-9A-F]{8}$/);

    const legacyLookup = await repository.getDocumentNumberSeriesByCode(pool, {
      installationId: config.installationId,
      code: 'SALES_ORDER',
    });
    assert.equal(legacyLookup.id, active.id, 'legacy business consumers must resolve the active series by document type');

    await assert.rejects(
      pool.query(
        `INSERT INTO shared.document_number_series (
           id, installation_id, code, document_type, name, prefix, number_template,
           reset_policy, sequence_width, start_counter, is_active, created_by, updated_by
         ) VALUES ($1,$2,$3,'SALES_ORDER','Direct duplicate','SO-','{PREFIX}{YYYY}{MM}-{SEQ}',
                   'MONTHLY',6,1,true,'test:lane-h','test:lane-h')`,
        [randomUUID(), config.installationId, `DIRECT_${randomUUID().slice(0, 8).toUpperCase()}`],
      ),
      /document_number_series_one_active_type_unique/,
    );

    const allocation = await inTransaction(pool, (client) => service.allocateDocumentNumber(client, {
      installationId: config.installationId,
      seriesId: active.id,
      idempotencyKey: `lane-h-${randomUUID()}`,
      payload: { documentDate: '2026-08-13' },
      actorId: 'test:lane-h',
      requestId: `req-${randomUUID()}`,
      sourceApp: 'npp-core-api',
    }));
    assert.equal(allocation.ok, true, allocation.message);

    const current = await service.getDocumentNumberSeries(pool, {
      installationId: config.installationId,
      id: active.id,
    });
    const disabled = await inTransaction(pool, (client) => service.updateDocumentNumberSeries(client, {
      installationId: config.installationId,
      id: active.id,
      payload: { isActive: false, expectedUpdatedAt: current.series.updated_at },
      updatedBy: 'test:lane-h',
    }));
    assert.equal(disabled.ok, true, disabled.message);

    const replacement = await createStandard(pool, config.installationId, {
      name: 'Đơn bán thay thế',
      prefix: 'SON-',
    });
    assert.equal(replacement.ok, true, replacement.message);
    assert.notEqual(replacement.series.code, active.code);

    const history = await pool.query(
      `SELECT count(*)::int AS count
         FROM shared.document_number_allocations
        WHERE installation_id = $1 AND series_id = $2`,
      [config.installationId, active.id],
    );
    assert.equal(history.rows[0].count, 1, 'replacement must not delete prior allocation history');

    const activeRows = await pool.query(
      `SELECT id
         FROM shared.document_number_series
        WHERE installation_id = $1 AND document_type = 'SALES_ORDER' AND is_active = true`,
      [config.installationId],
    );
    assert.equal(activeRows.rowCount, 1);
    assert.equal(activeRows.rows[0].id, replacement.series.id);

    const resolvedReplacement = await repository.getDocumentNumberSeriesByCode(pool, {
      installationId: config.installationId,
      code: 'SALES_ORDER',
    });
    assert.equal(resolvedReplacement.id, replacement.series.id);

    const inactive = await createStandard(pool, config.installationId, {
      name: 'Đơn bán dự phòng',
      isActive: false,
    });
    assert.equal(inactive.ok, true, inactive.message);
    const activation = await inTransaction(pool, (client) => service.updateDocumentNumberSeries(client, {
      installationId: config.installationId,
      id: inactive.series.id,
      payload: { isActive: true, expectedUpdatedAt: inactive.series.updated_at },
      updatedBy: 'test:lane-h',
    }));
    assert.equal(activation.ok, false);
    assert.equal(activation.code, 'ACTIVE_SERIES_EXISTS');
  } finally {
    await closePool();
  }
});
