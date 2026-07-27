import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import * as service from '../src/services/document-numbering.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3033',
    INSTALLATION_ID: `numbering-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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

async function createSeries(pool, installationId, suffix, overrides = {}) {
  const result = await service.createDocumentNumberSeries(pool, {
    installationId,
    payload: {
      code: `SO-${suffix}`,
      documentType: 'SALES_ORDER',
      name: `Đơn bán ${suffix}`,
      prefix: 'SO-',
      numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
      resetPolicy: 'MONTHLY',
      sequenceWidth: 4,
      startCounter: '1',
      ...overrides,
    },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.series;
}

async function allocate(pool, input) {
  return inTransaction(pool, (client) => service.allocateDocumentNumber(client, input));
}

test('Document numbering service — period reset, backdate, replay, lock and isolation', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const invalid = await service.createDocumentNumberSeries(pool, {
      installationId: config.installationId,
      payload: { code: `BAD-${suffix}`, documentType: 'TEST', name: 'Sai', numberTemplate: '{PREFIX}{UNKNOWN}-{SEQ}' },
      createdBy: 'test:user',
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'INVALID_TEMPLATE');

    const series = await createSeries(pool, config.installationId, suffix);
    const baseInput = {
      installationId: config.installationId,
      seriesId: series.id,
      actorId: 'test:user',
      requestId: `req-${suffix}`,
      sourceApp: 'npp-core-api',
    };

    const july1 = await allocate(pool, { ...baseInput, idempotencyKey: `july-1-${suffix}`, payload: { documentDate: '2026-07-27' } });
    const july2 = await allocate(pool, { ...baseInput, idempotencyKey: `july-2-${suffix}`, payload: { documentDate: '2026-07-28' } });
    const august1 = await allocate(pool, { ...baseInput, idempotencyKey: `aug-1-${suffix}`, payload: { documentDate: '2026-08-01' } });
    const june1 = await allocate(pool, { ...baseInput, idempotencyKey: `june-1-${suffix}`, payload: { documentDate: '2026-06-30' } });
    assert.ok(july1.ok && july2.ok && august1.ok && june1.ok);
    assert.equal(july1.allocation.document_number, 'SO-202607-0001');
    assert.equal(july2.allocation.document_number, 'SO-202607-0002');
    assert.equal(august1.allocation.document_number, 'SO-202608-0001');
    assert.equal(june1.allocation.document_number, 'SO-202606-0001');

    const replay = await allocate(pool, { ...baseInput, idempotencyKey: `july-1-${suffix}`, payload: { documentDate: '2026-07-27' } });
    assert.ok(replay.ok);
    assert.equal(replay.replayed, true);
    assert.equal(replay.allocation.id, july1.allocation.id);

    const locked = await inTransaction(pool, (client) => service.updateDocumentNumberSeries(client, {
      installationId: config.installationId,
      id: series.id,
      payload: { prefix: 'NEW-', expectedUpdatedAt: series.updated_at },
      updatedBy: 'test:user',
    }));
    assert.equal(locked.ok, false);
    assert.equal(locked.code, 'FORMAT_LOCKED');

    const current = await service.getDocumentNumberSeries(pool, { installationId: config.installationId, id: series.id });
    assert.ok(current.ok);
    const renamed = await inTransaction(pool, (client) => service.updateDocumentNumberSeries(client, {
      installationId: config.installationId,
      id: series.id,
      payload: { name: 'Đơn bán đã đổi tên', expectedUpdatedAt: current.series.updated_at },
      updatedBy: 'test:user',
    }));
    assert.ok(renamed.ok, renamed.message);

    const isolated = await service.getDocumentNumberSeries(pool, { installationId: `${config.installationId}-other`, id: series.id });
    assert.equal(isolated.ok, false);
    assert.equal(isolated.code, 'NOT_FOUND');
  } finally {
    await closePool();
  }
});

test('Document numbering service — concurrent allocation is unique and gap-free for successful requests', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const series = await createSeries(pool, config.installationId, suffix, {
      code: `INV-${suffix}`,
      documentType: 'INVENTORY_ADJUSTMENT',
      prefix: 'IA-',
      numberTemplate: '{PREFIX}{YYYY}-{SEQ}',
      resetPolicy: 'YEARLY',
      sequenceWidth: 6,
    });
    const results = await Promise.all(Array.from({ length: 24 }, (_, index) => allocate(pool, {
      installationId: config.installationId,
      seriesId: series.id,
      idempotencyKey: `parallel-${suffix}-${index}`,
      payload: { documentDate: '2026-07-27', metadata: { index } },
      actorId: 'test:parallel',
      requestId: `req-${suffix}-${index}`,
      sourceApp: 'npp-core-api',
    })));
    assert.ok(results.every((result) => result.ok), results.find((result) => !result.ok)?.message);
    const numbers = results.map((result) => result.allocation.document_number);
    assert.equal(new Set(numbers).size, 24);
    const counters = results.map((result) => Number(result.allocation.counter_value)).sort((a, b) => a - b);
    assert.deepEqual(counters, Array.from({ length: 24 }, (_, index) => index + 1));
  } finally {
    await closePool();
  }
});

test('Document numbering service — overflow and inactive series do not advance counters', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const series = await createSeries(pool, config.installationId, suffix, {
      code: `OV-${suffix}`,
      documentType: 'OVERFLOW_TEST',
      prefix: 'O-',
      numberTemplate: '{PREFIX}{SEQ}',
      resetPolicy: 'NONE',
      sequenceWidth: 1,
      startCounter: '9',
    });
    const first = await allocate(pool, {
      installationId: config.installationId, seriesId: series.id, idempotencyKey: `ov-1-${suffix}`,
      payload: { documentDate: '2026-07-27' }, actorId: 'test:user', requestId: `req-ov-1-${suffix}`, sourceApp: 'npp-core-api',
    });
    assert.ok(first.ok);
    assert.equal(first.allocation.document_number, 'O-9');
    const overflow = await allocate(pool, {
      installationId: config.installationId, seriesId: series.id, idempotencyKey: `ov-2-${suffix}`,
      payload: { documentDate: '2026-07-27' }, actorId: 'test:user', requestId: `req-ov-2-${suffix}`, sourceApp: 'npp-core-api',
    });
    assert.equal(overflow.ok, false);
    assert.equal(overflow.code, 'SEQUENCE_OVERFLOW');
    const counters = await pool.query(
      `SELECT next_counter FROM shared.document_number_counters WHERE installation_id = $1 AND series_id = $2 AND period_key = 'ALL'`,
      [config.installationId, series.id],
    );
    assert.equal(String(counters.rows[0].next_counter), '10');

    const current = await service.getDocumentNumberSeries(pool, { installationId: config.installationId, id: series.id });
    const disabled = await inTransaction(pool, (client) => service.updateDocumentNumberSeries(client, {
      installationId: config.installationId,
      id: series.id,
      payload: { isActive: false, expectedUpdatedAt: current.series.updated_at },
      updatedBy: 'test:user',
    }));
    assert.ok(disabled.ok);
    const inactive = await allocate(pool, {
      installationId: config.installationId, seriesId: series.id, idempotencyKey: `inactive-${suffix}`,
      payload: { documentDate: '2026-07-27' }, actorId: 'test:user', requestId: `req-inactive-${suffix}`, sourceApp: 'npp-core-api',
    });
    assert.equal(inactive.ok, false);
    assert.equal(inactive.code, 'SERIES_INACTIVE');
  } finally {
    await closePool();
  }
});

test('Document numbering API — auth, HTTP/domain idempotency, history and audit', async () => {
  const config = loadConfig(testEnv({ PORT: '3034' }));
  const pool = getPool(config);
  let server;
  try {
    server = await startServer({ config });
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const baseUrl = 'http://127.0.0.1:3034';
    const headers = (key) => ({
      Authorization: `Bearer ${config.backendApiToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    });

    const unauthorized = await fetch(`${baseUrl}/api/document-number-series`);
    assert.equal(unauthorized.status, 401);

    const createKey = `series-${suffix}`;
    const createRequest = () => fetch(`${baseUrl}/api/document-number-series`, {
      method: 'POST',
      headers: headers(createKey),
      body: JSON.stringify({
        code: `SO-${suffix}`, documentType: 'SALES_ORDER', name: 'Đơn bán', prefix: 'SO-',
        numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY', sequenceWidth: 6,
      }),
    });
    const createdResponse = await createRequest();
    assert.equal(createdResponse.status, 201);
    const series = (await createdResponse.json()).data;
    const createdReplay = await createRequest();
    assert.equal(createdReplay.status, 201);
    assert.equal((await createdReplay.json()).data.id, series.id);

    const allocationKey = `allocation-${suffix}`;
    const allocationRequest = () => fetch(`${baseUrl}/api/document-number-series/${series.id}/allocate`, {
      method: 'POST',
      headers: headers(allocationKey),
      body: JSON.stringify({ documentDate: '2026-07-27', metadata: { purpose: 'e2e-api' } }),
    });
    const allocatedResponse = await allocationRequest();
    assert.equal(allocatedResponse.status, 201);
    const allocated = (await allocatedResponse.json()).data;
    assert.equal(allocated.document_number, 'SO-202607-000001');
    assert.equal(allocated.replayed, false);

    const httpReplay = await allocationRequest();
    assert.equal(httpReplay.status, 201);
    assert.equal((await httpReplay.json()).data.id, allocated.id);

    await pool.query(
      `DELETE FROM shared.core_idempotency_records
       WHERE installation_id = $1 AND actor_id = $2 AND http_method = 'POST'
         AND route = $3 AND idempotency_key = $4`,
      [config.installationId, config.coreBootstrapActorId, `/api/document-number-series/${series.id}/allocate`, allocationKey],
    );
    const domainReplay = await allocationRequest();
    assert.equal(domainReplay.status, 200);
    const replayed = (await domainReplay.json()).data;
    assert.equal(replayed.id, allocated.id);
    assert.equal(replayed.replayed, true);

    const historyResponse = await fetch(`${baseUrl}/api/document-number-series/${series.id}/allocations`, {
      headers: { Authorization: `Bearer ${config.backendApiToken}` },
    });
    assert.equal(historyResponse.status, 200);
    const history = (await historyResponse.json()).data;
    assert.equal(history.allocations.length, 1);
    assert.equal(history.counters[0].next_counter, '2');

    const audit = await pool.query(
      `SELECT action, resource_type FROM shared.core_audit_records
       WHERE installation_id = $1 AND resource_type IN ('document_number_series', 'document_number_allocation')
       ORDER BY occurred_at`,
      [config.installationId],
    );
    assert.deepEqual(audit.rows.map((row) => row.resource_type), ['document_number_series', 'document_number_allocation']);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
