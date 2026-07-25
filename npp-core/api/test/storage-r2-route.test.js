import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCoreApiServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

function createFakeIdempotencyStore() {
  const records = new Map();
  return {
    async reserve(scope, requestFingerprint, requestId) {
      const key = `${scope.installationId}:${scope.actorId}:${scope.httpMethod}:${scope.route}:${scope.idempotencyKey}`;
      if (records.has(key)) {
        return { created: false, record: records.get(key) };
      }
      const record = { ...scope, request_fingerprint: requestFingerprint, request_id: requestId, status: 'processing' };
      records.set(key, record);
      return { created: true, record };
    },
    async markCompleted() {
      return null;
    },
    async markFailed() {
      return null;
    },
  };
}

function createFakeAuditOutboxAdapter() {
  return {
    calls: [],
    async connect() {
      return {
        query: async (sql, values = []) => {
          const normalized = String(sql).trim().toLowerCase();
          this.calls.push({ sql, values });
          if (normalized.startsWith('begin') || normalized.startsWith('commit') || normalized.startsWith('rollback')) {
            return { rows: [] };
          }
          if (normalized.startsWith('insert into shared.core_audit_records')) {
            return { rows: [] };
          }
          if (normalized.startsWith('insert into shared.core_outbox_events')) {
            return { rows: [] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release: async () => {},
      };
    },
  };
}

function sendJsonRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        resolve({ statusCode: response.statusCode, headers: response.headers, bodyText });
      });
    });
    request.on('error', reject);
    if (body !== undefined) {
      const text = JSON.stringify(body);
      request.write(text);
    }
    request.end();
  });
}

test('storage presign route returns a presigned URL and records audit/outbox entries', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    INSTALLATION_ID: 'test-installation',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform_test',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-1234567890',
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });

  const auditAdapter = createFakeAuditOutboxAdapter();
  const idempotencyStore = createFakeIdempotencyStore();
  const server = createCoreApiServer({
    config,
    auditOutboxAdapter: auditAdapter,
    idempotencyStore,
    storageAdapter: {
      async getPresignedPutUrl({ key, expiresIn }) {
        return { url: `https://example.com/${encodeURIComponent(key)}`, expiresIn: expiresIn ?? 900 };
      },
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address.port === 'number');
  const url = `http://127.0.0.1:${address.port}/api/storage/r2/presign-put`;

  const response = await sendJsonRequest(url, 'POST', {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token-1234567890',
  }, {
    keyComponents: {
      installationId: 'test-installation',
      namespace: 'uploads',
      objectName: 'report.pdf',
    },
  });

  server.close();

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.bodyText);
  assert.ok(body.data, `Unexpected response body: ${JSON.stringify(body)}`);
  assert.equal(body.data.objectKey, 'test-installation/uploads/report.pdf');
  assert.equal(body.data.presignedUrl, 'https://example.com/test-installation%2Fuploads%2Freport.pdf');
  assert.equal(typeof body.data.expiresIn, 'number');
  assert.ok(auditAdapter.calls.some((call) => /insert into shared.core_audit_records/.test(call.sql.toLowerCase())));
  assert.ok(auditAdapter.calls.some((call) => /insert into shared.core_outbox_events/.test(call.sql.toLowerCase())));
});
