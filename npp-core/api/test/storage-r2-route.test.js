import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCoreApiServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { PERMISSIONS } from '../src/request-context.js';

function baseEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    INSTALLATION_ID: 'server-installation',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform_test',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-1234567890',
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    R2_ENABLED: 'false',
    R2_CONTRACT_ROUTE_ENABLED: 'true',
    ...overrides,
  };
}

function scopeKey(scope) {
  return `${scope.installationId}:${scope.actorId}:${scope.httpMethod}:${scope.route}:${scope.idempotencyKey}`;
}

function createFakeIdempotencyStore() {
  const records = new Map();
  return {
    async reserve(scope, requestFingerprint, requestId) {
      const key = scopeKey(scope);
      if (records.has(key)) return { created: false, record: records.get(key) };
      const record = {
        request_fingerprint: requestFingerprint,
        request_id: requestId,
        status: 'processing',
      };
      records.set(key, record);
      return { created: true, record };
    },
    async markCompleted(scope, requestId, response) {
      const record = records.get(scopeKey(scope));
      Object.assign(record, {
        request_id: requestId,
        status: 'completed',
        response_status: response.statusCode,
        response_content_type: response.contentType,
        response_body: response.body,
      });
    },
    async markFailed(scope, requestId, response) {
      const record = records.get(scopeKey(scope));
      Object.assign(record, {
        request_id: requestId,
        status: 'failed',
        response_status: response.statusCode,
        response_content_type: response.contentType,
        response_body: response.body,
      });
    },
  };
}

function sendJsonRequest(url, { headers = {}, body = {}, method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.write(JSON.stringify(body));
    request.end();
  });
}

async function withServer(options, callback) {
  const server = createCoreApiServer({
    idempotencyStore: createFakeIdempotencyStore(),
    storageAdapter: null,
    auditOutboxAdapter: { connect: async () => { throw new Error('not-used'); } },
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('contract route is hidden when disabled and the old presign route is not exposed', async () => {
  await withServer({ config: loadConfig(baseEnv({ R2_CONTRACT_ROUTE_ENABLED: 'false' })) }, async (baseUrl) => {
    const disabled = await sendJsonRequest(`${baseUrl}/api/storage/r2-test`);
    const retired = await sendJsonRequest(`${baseUrl}/api/storage/r2/presign-put`);
    assert.equal(disabled.statusCode, 404);
    assert.equal(retired.statusCode, 404);
  });
});

test('contract route requires authentication and deny-by-default permission', async () => {
  const config = loadConfig(baseEnv());
  await withServer({ config }, async (baseUrl) => {
    const unauthorized = await sendJsonRequest(`${baseUrl}/api/storage/r2-test`);
    assert.equal(unauthorized.statusCode, 401);
  });

  await withServer({
    config,
    authenticateRequest: () => ({
      ok: true,
      principal: { actorId: 'actor', permissions: [], sourceApp: 'npp-core-api' },
    }),
  }, async (baseUrl) => {
    const forbidden = await sendJsonRequest(`${baseUrl}/api/storage/r2-test`, {
      headers: { Authorization: 'Bearer ignored-by-injected-auth' },
    });
    assert.equal(forbidden.statusCode, 403);
  });
});

test('route uses server-owned context and an injected contract operation', async () => {
  const calls = [];
  await withServer({
    config: loadConfig(baseEnv()),
    storageContractOperation: async (input) => {
      calls.push(input);
      return {
        key: 'server-installation/contracts/2026/07/object.txt',
        size: 4,
        contentType: 'text/plain',
        etag: 'etag',
        checksumSha256: null,
        auditId: 'audit-id',
        deleted: true,
      };
    },
  }, async (baseUrl) => {
    const response = await sendJsonRequest(`${baseUrl}/api/storage/r2-test`, {
      headers: {
        Authorization: 'Bearer test-token-1234567890',
        'x-installation-id': 'spoofed-installation',
        'x-actor-id': 'spoofed-actor',
        'x-source-app': 'spoofed-app',
      },
      body: { namespace: 'contracts', filename: 'contract.txt', installationId: 'client-installation' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].requestContext.installationId, 'server-installation');
    assert.equal(calls[0].requestContext.actorId, 'bootstrap:core-api');
    assert.equal(calls[0].requestContext.sourceApp, 'npp-core-api');
    assert.equal(calls[0].payload.installationId, 'client-installation');
  });
});

test('idempotency replay does not execute the storage operation twice', async () => {
  let operationCalls = 0;
  await withServer({
    config: loadConfig(baseEnv()),
    storageContractOperation: async () => {
      operationCalls += 1;
      return { key: 'key', size: 4, contentType: 'text/plain', auditId: 'audit', deleted: true };
    },
  }, async (baseUrl) => {
    const request = {
      headers: {
        Authorization: 'Bearer test-token-1234567890',
        'Idempotency-Key': 'storage-contract-1',
      },
      body: { namespace: 'contracts', filename: 'contract.txt', content: 'same' },
    };
    const first = await sendJsonRequest(`${baseUrl}/api/storage/r2-test`, request);
    const replay = await sendJsonRequest(`${baseUrl}/api/storage/r2-test`, request);
    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.body, first.body);
    assert.equal(operationCalls, 1);
  });
});

test('same idempotency key with a different payload returns conflict', async () => {
  await withServer({
    config: loadConfig(baseEnv()),
    storageContractOperation: async () => ({ key: 'key', size: 1, contentType: 'text/plain', auditId: 'audit', deleted: true }),
  }, async (baseUrl) => {
    const headers = {
      Authorization: 'Bearer test-token-1234567890',
      'Idempotency-Key': 'storage-contract-2',
    };
    const first = await sendJsonRequest(`${baseUrl}/api/storage/r2-test`, {
      headers,
      body: { content: 'one' },
    });
    const mismatch = await sendJsonRequest(`${baseUrl}/api/storage/r2-test`, {
      headers,
      body: { content: 'two' },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(mismatch.statusCode, 409);
    assert.equal(mismatch.body.error.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');
  });
});

test('storage disabled is returned as a sanitized service error', async () => {
  await withServer({ config: loadConfig(baseEnv()) }, async (baseUrl) => {
    const response = await sendJsonRequest(`${baseUrl}/api/storage/r2-test`, {
      headers: { Authorization: 'Bearer test-token-1234567890' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error.code, 'STORAGE_DISABLED');
  });
});

test('registered storage permission remains available to the bootstrap principal', () => {
  assert.equal(PERMISSIONS.coreStorageR2TestWrite, 'core.storage.r2.test.write');
});
