import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';
import { createRequestContext, requirePermission, PERMISSIONS } from '../src/request-context.js';

const token = '0123456789abcdef0123456789abcdef';
let server;

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3005',
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

function authorizedHeaders() {
  return { Authorization: `Bearer ${token}` };
}

function unauthorizedHeaders() {
  return { Authorization: 'Bearer not-a-valid-token' };
}

test.before(async () => {
  server = await startServer({
    config: testConfig(),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
  });
});

test('GET /health/live remains public and returns 200', async () => {
  const response = await fetch('http://127.0.0.1:3005/health/live');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ok');
  assert.ok(body.requestId.startsWith('req_'));
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.ok(body.receivedAt);
});

test('GET /health/ready remains compatible', async () => {
  const response = await fetch('http://127.0.0.1:3005/health/ready');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ready');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});

test('protected route without bearer token returns 401', async () => {
  const response = await fetch('http://127.0.0.1:3005/api/config');
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});

test('protected route with invalid token returns 401', async () => {
  const response = await fetch('http://127.0.0.1:3005/api/config', {
    headers: unauthorizedHeaders(),
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('valid bootstrap token can access permitted endpoints', async () => {
  const configResponse = await fetch('http://127.0.0.1:3005/api/config', {
    headers: authorizedHeaders(),
  });
  const configBody = await configResponse.json();

  assert.equal(configResponse.status, 200);
  assert.equal(configBody.data.config.port, 3005);
  assert.equal(configBody.data.config.installationId, 'npp-hung-phat');
  assert.equal(configBody.data.authContext.installationId, 'npp-hung-phat');
  assert.equal(configBody.data.authContext.actorId, 'bootstrap:core-api');
  assert.ok(!('databaseUrl' in configBody.data.config));
  assert.ok(!('backendApiToken' in configBody.data.config));
  assert.equal(configResponse.headers.get('x-request-id'), configBody.requestId);

  const authResponse = await fetch('http://127.0.0.1:3005/health/authenticated', {
    headers: authorizedHeaders(),
  });
  const authBody = await authResponse.json();

  assert.equal(authResponse.status, 200);
  assert.equal(authBody.data.status, 'authenticated');
  assert.equal(authBody.data.actorId, 'bootstrap:core-api');
  assert.equal(authBody.data.installationId, 'npp-hung-phat');
  assert.equal(authResponse.headers.get('x-request-id'), authBody.requestId);
});

test('authenticated principal without the required permission returns 403', async () => {
  const unauthorizedServer = await startServer({
    config: testConfig({ PORT: '3006' }),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
    authenticateRequest: () => ({
      ok: true,
      principal: {
        actorId: 'bootstrap:test',
        roles: ['bootstrap'],
        permissions: [PERMISSIONS.coreConfigRead],
        sourceApp: 'test-runner',
      },
    }),
  });

  const response = await fetch('http://127.0.0.1:3006/health/authenticated', {
    headers: authorizedHeaders(),
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'FORBIDDEN');
  await new Promise((resolve, reject) => unauthorizedServer.close((error) => (error ? reject(error) : resolve())));
});

test('unknown permission is denied by default', async () => {
  const context = createRequestContext({
    config: testConfig(),
    principal: {
      actorId: 'bootstrap:core-api',
      roles: ['bootstrap'],
      permissions: [PERMISSIONS.coreConfigRead],
      sourceApp: 'test-runner',
    },
  });

  const authz = requirePermission(context, 'core.permission.unknown');
  assert.equal(authz.ok, false);
  assert.equal(authz.statusCode, 403);
});

test('spoofed headers do not override server-owned context', async () => {
  const response = await fetch('http://127.0.0.1:3005/api/config', {
    headers: {
      ...authorizedHeaders(),
      'x-installation-id': 'spoofed-install',
      'x-actor-id': 'spoofed-actor',
      'x-role': 'spoofed-role',
      'x-permission': 'spoofed-permission',
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.authContext.installationId, 'npp-hung-phat');
  assert.equal(body.data.authContext.actorId, 'bootstrap:core-api');
  assert.ok(!body.data.authContext.roles.includes('spoofed-role'));
  assert.ok(!body.data.requestContext.permissions.includes('spoofed-permission'));
});

test('separate requests receive separate request IDs', async () => {
  const responseOne = await fetch('http://127.0.0.1:3005/health/live');
  const responseTwo = await fetch('http://127.0.0.1:3005/health/live');
  const requestIdOne = responseOne.headers.get('x-request-id');
  const requestIdTwo = responseTwo.headers.get('x-request-id');

  assert.ok(requestIdOne);
  assert.ok(requestIdTwo);
  assert.notEqual(requestIdOne, requestIdTwo);
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
