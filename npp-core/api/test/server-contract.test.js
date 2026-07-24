import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';

const token = '0123456789abcdef0123456789abcdef';
let server;

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3005',
    INSTALLATION_ID: 'npp-hung-phat',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: token,
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
}

test.before(async () => {
  server = await startServer({
    config: testConfig(),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
  });
});

test('GET /health/live responds without a database query', async () => {
  const response = await fetch('http://127.0.0.1:3005/health/live');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ok');
  assert.ok(body.requestId.startsWith('req_'));
  assert.ok(body.receivedAt);
});

test('GET /health/ready checks the injected database executor', async () => {
  const response = await fetch('http://127.0.0.1:3005/health/ready');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ready');
});

test('GET /api/config requires the full bearer token and returns sanitized config', async () => {
  const response = await fetch('http://127.0.0.1:3005/api/config', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.config.port, 3005);
  assert.equal(body.data.config.installationId, 'npp-hung-phat');
  assert.equal(body.data.authContext.installationId, 'npp-hung-phat');
  assert.ok(!('databaseUrl' in body.data.config));
  assert.ok(!('backendApiToken' in body.data.config));
});

test('truncated or missing bearer tokens are rejected', async () => {
  for (const authorization of [undefined, `Bearer ${token.slice(0, 24)}`]) {
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await fetch('http://127.0.0.1:3005/api/config', { headers });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  }
});

test('CORS uses exact origin matching', async () => {
  const response = await fetch('http://127.0.0.1:3005/health/live', {
    headers: { Origin: 'http://malicious.example.com' },
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'CORS_ORIGIN_NOT_ALLOWED');
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
