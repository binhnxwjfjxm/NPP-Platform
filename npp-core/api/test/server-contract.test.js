import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';

let server;

async function bootServer() {
  server = await startServer({
    config: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 3005,
      DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
      DATABASE_SSL_MODE: 'disable',
      BACKEND_API_TOKEN: 'replace-with-local-token',
      CORS_ORIGINS: ['http://127.0.0.1:3003'],
    },
    queryFn: async () => ({ rows: [{ ok: true }] }),
    corsOrigins: ['http://127.0.0.1:3003'],
  });
}

test.before(async () => {
  await bootServer();
});

test('GET /health/live responds with ok envelope', async () => {
  const response = await fetch('http://127.0.0.1:3005/health/live');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ok');
});

test('GET /api/config requires bearer token and returns sanitized config', async () => {
  const response = await fetch('http://127.0.0.1:3005/api/config', {
    headers: { Authorization: 'Bearer replace-with-local-token' },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.config.port, 3005);
  assert.ok(!('databaseUrl' in body.data.config));
});

test('GET /api/config without token rejects', async () => {
  const response = await fetch('http://127.0.0.1:3005/api/config');
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
