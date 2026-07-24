import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuccessEnvelope } from '@npp/contracts';
import { loadConfig } from '../src/config.js';
import {
  IDEMPOTENCY_ERROR_CODES,
  createPostgresIdempotencyStore,
  createRequestFingerprint,
  executeRequestWithIdempotency,
  normalizeIdempotencyKey,
} from '../src/idempotency.js';
import { startServer } from '../src/server.js';

const token = '0123456789abcdef0123456789abcdef';
const receivedAt = '2026-07-24T00:00:00.000Z';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3007',
    INSTALLATION_ID: 'npp-hung-phat',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: token,
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

function testConfig(overrides = {}) {
  return loadConfig(testEnv(overrides));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createAtomicTestStore() {
  const rows = new Map();
  const scopeKey = (scope) => [
    scope.installationId,
    scope.actorId,
    scope.httpMethod,
    scope.route,
    scope.idempotencyKey,
  ].join('::');

  return {
    rows,
    async reserve(scope, requestFingerprint, requestId) {
      const key = scopeKey(scope);
      const existing = rows.get(key);
      if (existing) return { created: false, record: existing };

      const record = {
        installation_id: scope.installationId,
        actor_id: scope.actorId,
        http_method: scope.httpMethod,
        route: scope.route,
        idempotency_key: scope.idempotencyKey,
        request_fingerprint: requestFingerprint,
        request_id: requestId,
        status: 'processing',
        response_status: null,
        response_content_type: null,
        response_body: null,
      };
      rows.set(key, record);
      return { created: true, record };
    },
    async markCompleted(scope, requestId, response) {
      const record = rows.get(scopeKey(scope));
      assert.equal(record?.request_id, requestId);
      assert.equal(record?.status, 'processing');
      Object.assign(record, {
        status: 'completed',
        response_status: response.statusCode,
        response_content_type: response.contentType,
        response_body: response.body,
      });
    },
    async markFailed(scope, requestId, response) {
      const record = rows.get(scopeKey(scope));
      assert.equal(record?.request_id, requestId);
      assert.equal(record?.status, 'processing');
      Object.assign(record, {
        status: 'failed',
        response_status: response.statusCode,
        response_content_type: response.contentType,
        response_body: response.body,
      });
    },
  };
}

function requestFor(key, extraHeaders = {}) {
  return {
    method: 'POST',
    headers: {
      ...(key === undefined ? {} : { 'idempotency-key': key }),
      ...extraHeaders,
    },
  };
}

function contextFor(overrides = {}) {
  return {
    installationId: 'installation-one',
    actorId: 'actor-one',
    ...overrides,
  };
}

function successResponse(requestId, body = { status: 'processed' }) {
  return {
    statusCode: 201,
    contentType: 'application/json',
    requestId,
    body,
  };
}

function execute({
  store,
  key = 'request-001',
  payload = { order: 'create', amount: 12 },
  requestContext = contextFor(),
  requestId = 'req_current',
  extraHeaders,
  onProcess = async () => successResponse(requestId),
}) {
  return executeRequestWithIdempotency({
    idempotencyStore: store,
    req: requestFor(key, extraHeaders),
    requestContext,
    requestId,
    receivedAt,
    route: '/api/idempotency-test',
    payload,
    onProcess,
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('fingerprints are stable across object key order', () => {
  const left = createRequestFingerprint({ z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }] });
  const right = createRequestFingerprint({ list: [{ x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 });
  assert.equal(left, right);
  assert.match(left, /^[0-9a-f]{64}$/);
});

test('Idempotency-Key validation rejects blank, malformed, duplicate and oversized values', () => {
  assert.equal(normalizeIdempotencyKey(undefined), null);
  assert.equal(normalizeIdempotencyKey(' valid.key-_1 '), 'valid.key-_1');
  for (const value of ['', 'bad key!', ['one', 'two'], 'a'.repeat(129)]) {
    assert.throws(() => normalizeIdempotencyKey(value), /invalid_idempotency_key/);
  }
});

test('PostgreSQL reservation performs atomic insert before reading a conflict', async () => {
  const queries = [];
  const existing = {
    request_fingerprint: createRequestFingerprint({ order: 1 }),
    request_id: 'req_existing',
    status: 'processing',
  };
  const client = {
    async query(sql, values = []) {
      const text = String(sql).trim();
      queries.push({ text, values });
      if (text.startsWith('INSERT INTO shared.core_idempotency_records')) return { rows: [], rowCount: 0 };
      if (text.startsWith('SELECT *')) return { rows: [existing], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const store = createPostgresIdempotencyStore({ connect: async () => client });
  const result = await store.reserve({
    installationId: 'installation-one',
    actorId: 'actor-one',
    httpMethod: 'POST',
    route: '/orders',
    idempotencyKey: 'key-one',
  }, existing.request_fingerprint, 'req_new');

  assert.equal(result.created, false);
  assert.equal(result.record, existing);
  const insertIndex = queries.findIndex(({ text }) => text.startsWith('INSERT INTO'));
  const selectIndex = queries.findIndex(({ text }) => text.startsWith('SELECT *'));
  assert.ok(insertIndex >= 0);
  assert.ok(selectIndex > insertIndex);
  assert.match(queries[insertIndex].text, /ON CONFLICT[\s\S]+DO NOTHING/);
});

test('first request completes and duplicate same payload replays the original response', async () => {
  const store = createAtomicTestStore();
  let processCount = 0;
  const first = await execute({
    store,
    requestId: 'req_original',
    onProcess: async () => {
      processCount += 1;
      return successResponse('req_original', { result: 'created' });
    },
  });
  const replay = await execute({
    store,
    requestId: 'req_retry',
    onProcess: async () => {
      processCount += 1;
      return successResponse('req_retry');
    },
  });

  assert.equal(first.response.statusCode, 201);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.response.requestId, 'req_original');
  assert.deepEqual(replay.response.body, { result: 'created' });
  assert.equal(processCount, 1);
});

test('same scope and key with a different payload returns a stable 409', async () => {
  const store = createAtomicTestStore();
  await execute({ store });
  const conflict = await execute({ store, payload: { order: 'different' }, requestId: 'req_conflict' });

  assert.equal(conflict.response.statusCode, 409);
  assert.equal(conflict.response.body.error.code, IDEMPOTENCY_ERROR_CODES.payloadMismatch);
  assert.equal(conflict.replayed, false);
});

test('concurrent duplicate is rejected while only the winner executes', async () => {
  const store = createAtomicTestStore();
  const started = createDeferred();
  const release = createDeferred();
  let processCount = 0;

  const firstPromise = execute({
    store,
    key: 'request-concurrent',
    requestId: 'req_winner',
    onProcess: async () => {
      processCount += 1;
      started.resolve();
      await release.promise;
      return successResponse('req_winner');
    },
  });
  await started.promise;

  const duplicate = await execute({
    store,
    key: 'request-concurrent',
    requestId: 'req_duplicate',
    onProcess: async () => {
      processCount += 1;
      return successResponse('req_duplicate');
    },
  });

  assert.equal(duplicate.response.statusCode, 409);
  assert.equal(duplicate.response.body.error.code, IDEMPOTENCY_ERROR_CODES.inProgress);
  assert.equal(processCount, 1);

  release.resolve();
  const winner = await firstPromise;
  assert.equal(winner.response.statusCode, 201);
  assert.equal(processCount, 1);
});

test('failed request is stored and replayed without executing again', async () => {
  const store = createAtomicTestStore();
  let processCount = 0;
  const fail = async () => {
    processCount += 1;
    throw Object.assign(new Error('internal detail'), {
      code: 'REQUEST_FAILED',
      publicMessage: 'Requested failure',
      statusCode: 422,
    });
  };

  const first = await execute({ store, key: 'request-failed', onProcess: fail });
  const replay = await execute({ store, key: 'request-failed', requestId: 'req_retry', onProcess: fail });

  assert.equal(first.response.statusCode, 422);
  assert.equal(first.response.body.error.code, 'REQUEST_FAILED');
  assert.equal(replay.response.statusCode, 422);
  assert.equal(replay.response.body.error.code, 'REQUEST_FAILED');
  assert.equal(replay.replayed, true);
  assert.equal(processCount, 1);
});

test('actor and installation are part of the idempotency scope', async () => {
  const store = createAtomicTestStore();
  let processCount = 0;
  const process = async () => {
    processCount += 1;
    return successResponse(`req_${processCount}`);
  };

  await execute({ store, key: 'scope-key', requestContext: contextFor(), onProcess: process });
  await execute({ store, key: 'scope-key', requestContext: contextFor({ actorId: 'actor-two' }), onProcess: process });
  await execute({ store, key: 'scope-key', requestContext: contextFor({ installationId: 'installation-two' }), onProcess: process });

  assert.equal(processCount, 3);
  assert.equal(store.rows.size, 3);
});

test('request without Idempotency-Key bypasses storage', async () => {
  const store = createAtomicTestStore();
  let processCount = 0;
  const result = await execute({
    store,
    key: undefined,
    onProcess: async () => {
      processCount += 1;
      return successResponse('req_plain');
    },
  });

  assert.equal(result.response.statusCode, 201);
  assert.equal(processCount, 1);
  assert.equal(store.rows.size, 0);
});

test('spoofed identity headers do not affect server-owned idempotency scope', async () => {
  const store = createAtomicTestStore();
  let processCount = 0;
  const first = await execute({
    store,
    key: 'spoof-key',
    extraHeaders: { 'x-actor-id': 'spoofed', 'x-installation-id': 'spoofed' },
    onProcess: async () => {
      processCount += 1;
      return successResponse('req_original');
    },
  });
  const replay = await execute({ store, key: 'spoof-key', requestId: 'req_retry' });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(processCount, 1);
});

test('protected HTTP route exposes the idempotency contract without runtime test delays', async () => {
  const store = createAtomicTestStore();
  let processCount = 0;
  const server = await startServer({
    config: testConfig(),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
    idempotencyStore: store,
    idempotencyTestHandler: async ({ payload, requestContext, requestId, receivedAt: requestReceivedAt }) => {
      processCount += 1;
      return {
        statusCode: 200,
        contentType: 'application/json',
        requestId,
        body: createSuccessEnvelope({
          status: 'processed',
          payload,
          actorId: requestContext.actorId,
          installationId: requestContext.installationId,
        }, requestId, requestReceivedAt),
      };
    },
  });

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': 'http-request-001',
      'x-actor-id': 'spoofed-actor',
      'x-installation-id': 'spoofed-installation',
    };
    const first = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ order: 'create' }),
    });
    const firstBody = await first.json();
    const replay = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ order: 'create' }),
    });
    const replayBody = await replay.json();

    assert.equal(first.status, 200);
    assert.equal(replay.status, 200);
    assert.equal(processCount, 1);
    assert.equal(firstBody.data.actorId, 'bootstrap:core-api');
    assert.equal(firstBody.data.installationId, 'npp-hung-phat');
    assert.equal(replayBody.requestId, firstBody.requestId);
    assert.equal(replay.headers.get('x-request-id'), firstBody.requestId);
    assert.equal(first.headers.get('cache-control'), 'no-store');
  } finally {
    await closeServer(server);
  }
});

test('idempotency route CORS preflight allows POST and Idempotency-Key', async () => {
  const server = await startServer({
    config: testConfig({ PORT: '3008' }),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
    idempotencyStore: createAtomicTestStore(),
  });

  try {
    const response = await fetch('http://127.0.0.1:3008/api/idempotency-test', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:3003',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
      },
    });

    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
    assert.match(response.headers.get('access-control-allow-headers'), /idempotency-key/);
  } finally {
    await closeServer(server);
  }
});
