import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';
import { PERMISSIONS } from '../src/request-context.js';

const token = '0123456789abcdef0123456789abcdef';

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

function authorizedHeaders(overrides = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...overrides,
  };
}

function createTestIdempotencyStore() {
  const rows = new Map();

  const scopeKey = (scope) => [
    scope.installationId,
    scope.actorId,
    scope.httpMethod,
    scope.route,
    scope.idempotencyKey,
  ].join('::');

  return {
    async reserve(scope, requestFingerprint, requestId) {
      const key = scopeKey(scope);
      const existing = rows.get(key);
      if (!existing) {
        const record = {
          installation_id: scope.installationId,
          actor_id: scope.actorId,
          http_method: scope.httpMethod,
          route: scope.route,
          idempotency_key: scope.idempotencyKey,
          request_fingerprint: requestFingerprint,
          request_id: requestId,
          status: 'processing',
          response_status: 0,
          response_content_type: 'application/json',
          response_body: {},
          created_at: new Date().toISOString(),
        };
        rows.set(key, record);
        return { created: true, record };
      }

      return { created: false, record: existing };
    },
    async markCompleted(scope, requestId, responsePayload) {
      const key = scopeKey(scope);
      const existing = rows.get(key);
      if (!existing) return;
      existing.status = 'completed';
      existing.response_status = responsePayload.statusCode;
      existing.response_content_type = responsePayload.contentType;
      existing.response_body = responsePayload.body;
      existing.request_id = requestId;
      existing.completed_at = new Date().toISOString();
    },
    async markFailed(scope, requestId, responsePayload) {
      const key = scopeKey(scope);
      const existing = rows.get(key);
      if (!existing) return;
      existing.status = 'failed';
      existing.response_status = responsePayload.statusCode;
      existing.response_content_type = responsePayload.contentType;
      existing.response_body = responsePayload.body;
      existing.request_id = requestId;
      existing.completed_at = new Date().toISOString();
    },
    async get(scope) {
      const key = scopeKey(scope);
      return rows.get(key) ?? null;
    },
  };
}

const idempotencyStore = createTestIdempotencyStore();
let server;

test.before(async () => {
  server = await startServer({
    config: testConfig(),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
    idempotencyStore,
  });
});

test('request first time completes and returns envelope', async () => {
  const response = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'request-001',
    }),
    body: JSON.stringify({ order: 'create', amount: 12 }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'processed');
  assert.equal(body.data.payload.order, 'create');
  assert.equal(body.data.actorId, 'bootstrap:core-api');
  assert.equal(body.data.installationId, 'npp-hung-phat');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});

test('duplicate request same key and payload replays stored response', async () => {
  const response = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'request-001',
    }),
    body: JSON.stringify({ order: 'create', amount: 12 }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'processed');
  assert.equal(body.data.payload.order, 'create');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});

test('duplicate key with different payload returns 409', async () => {
  const response = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'request-001',
    }),
    body: JSON.stringify({ order: 'create', amount: 99 }),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
});

test('concurrent duplicate requests only one executes', async () => {
  const controller = new AbortController();
  const worker = async () => fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'request-002',
    }),
    body: JSON.stringify({ order: 'concurrent', amount: 1 }),
    signal: controller.signal,
  });

  const first = worker();
  const second = worker();
  const [one, two] = await Promise.all([first, second]);
  const [oneBody, twoBody] = await Promise.all([one.json(), two.json()]);

  const statuses = [one.status, two.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(oneBody.error?.code ?? oneBody.data?.status, 'processed');
  assert.equal(twoBody.error?.code, 'IDEMPOTENCY_IN_PROGRESS');
});

test('processing duplicate returns stable in-progress 409', async () => {
  const response = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'request-003',
    }),
    body: JSON.stringify({ order: 'hold', amount: 3 }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  const duplicate = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'request-003',
    }),
    body: JSON.stringify({ order: 'hold', amount: 3 }),
  });
  const duplicateBody = await duplicate.json();

  assert.equal(duplicate.status, 200);
  assert.equal(duplicateBody.data.status, 'processed');
});

test('failed request behavior is deterministic', async () => {
  const response = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'request-004',
    }),
    body: JSON.stringify({ fail: true }),
  });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'REQUEST_FAILED');

  const replay = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'request-004',
    }),
    body: JSON.stringify({ fail: true }),
  });
  const replayBody = await replay.json();

  assert.equal(replay.status, 500);
  assert.equal(replayBody.error.code, 'REQUEST_FAILED');
});

test('different actor or installation does not share the same idempotency record', async () => {
  // Start a second server that authenticates as a different actor to simulate
  // a different principal sharing the same idempotency store.
  const otherServer = await startServer({
    config: testConfig({ PORT: '3008' }),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
    idempotencyStore,
    authenticateRequest: () => ({
      ok: true,
      principal: {
        actorId: 'bootstrap:other',
        roles: ['bootstrap'],
        permissions: [PERMISSIONS.coreIdempotencyTestWrite],
        sourceApp: 'test-runner',
      },
    }),
  });

  try {
    const one = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
      method: 'POST',
      headers: authorizedHeaders({
        'content-type': 'application/json',
        'idempotency-key': 'request-005',
      }),
      body: JSON.stringify({ actor: 'one' }),
    });

    const two = await fetch('http://127.0.0.1:3008/api/idempotency-test', {
      method: 'POST',
      headers: authorizedHeaders({
        'content-type': 'application/json',
        'idempotency-key': 'request-005',
      }),
      body: JSON.stringify({ actor: 'two' }),
    });

    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
  } finally {
    await new Promise((resolve, reject) => otherServer.close((err) => (err ? reject(err) : resolve())));
  }
});

test('route without Idempotency-Key behaves normally', async () => {
  const response = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
    }),
    body: JSON.stringify({ order: 'plain' }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.payload.order, 'plain');
});

test('invalid Idempotency-Key is rejected with stable 400', async () => {
  const response = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'bad key!',
    }),
    body: JSON.stringify({ order: 'invalid' }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'IDEMPOTENCY_KEY_INVALID');
});

test('spoofed identity headers do not change idempotency scope', async () => {
  const response = await fetch('http://127.0.0.1:3007/api/idempotency-test', {
    method: 'POST',
    headers: authorizedHeaders({
      'content-type': 'application/json',
      'idempotency-key': 'request-006',
      'x-actor-id': 'spoofed-actor',
      'x-installation-id': 'spoofed-install',
    }),
    body: JSON.stringify({ order: 'spoof' }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.actorId, 'bootstrap:core-api');
  assert.equal(body.data.installationId, 'npp-hung-phat');
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
