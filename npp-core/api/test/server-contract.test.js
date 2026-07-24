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

function closeServer(target) {
  return new Promise((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));
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

test('safe incoming request ids are preserved and unsafe values are replaced', async () => {
  const safeResponse = await fetch('http://127.0.0.1:3005/health/live', {
    headers: { 'x-request-id': 'trace-123:core' },
  });
  const safeBody = await safeResponse.json();
  assert.equal(safeBody.requestId, 'trace-123:core');
  assert.equal(safeResponse.headers.get('x-request-id'), 'trace-123:core');

  const unsafeResponse = await fetch('http://127.0.0.1:3005/health/live', {
    headers: { 'x-request-id': 'unsafe request id' },
  });
  const unsafeBody = await unsafeResponse.json();
  assert.ok(unsafeBody.requestId.startsWith('req_'));
  assert.notEqual(unsafeBody.requestId, 'unsafe request id');
});

test('GET /health/ready remains compatible', async () => {
  const response = await fetch('http://127.0.0.1:3005/health/ready');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'ready');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});

test('allowed browser preflight supports authenticated GET requests', async () => {
  const response = await fetch('http://127.0.0.1:3005/api/config', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:3003',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,x-request-id',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3003');
  assert.match(response.headers.get('access-control-allow-methods'), /GET/);
  assert.match(response.headers.get('access-control-allow-headers'), /authorization/);
  assert.ok(response.headers.get('x-request-id'));
});

test('protected route without bearer token returns 401', async () => {
  const response = await fetch('http://127.0.0.1:3005/api/config');
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});

test('invalid and truncated bearer tokens return 401', async () => {
  for (const headers of [unauthorizedHeaders(), { Authorization: `Bearer ${token.slice(0, 24)}` }]) {
    const response = await fetch('http://127.0.0.1:3005/api/config', { headers });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  }
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
  assert.equal(configBody.data.authContext.employeeId, null);
  assert.deepEqual(configBody.data.authContext.roles, ['bootstrap']);
  assert.deepEqual(configBody.data.authContext.scopes.warehouseIds, []);
  assert.ok(!('databaseUrl' in configBody.data.config));
  assert.ok(!('backendApiToken' in configBody.data.config));
  assert.equal(configResponse.headers.get('cache-control'), 'no-store');
  assert.equal(configResponse.headers.get('x-request-id'), configBody.requestId);

  const authResponse = await fetch('http://127.0.0.1:3005/health/authenticated', {
    headers: authorizedHeaders(),
  });
  const authBody = await authResponse.json();

  assert.equal(authResponse.status, 200);
  assert.equal(authBody.data.status, 'authenticated');
  assert.equal(authBody.data.actorId, 'bootstrap:core-api');
  assert.equal(authBody.data.installationId, 'npp-hung-phat');
  assert.equal(authResponse.headers.get('cache-control'), 'no-store');
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

  try {
    const response = await fetch('http://127.0.0.1:3006/health/authenticated', {
      headers: authorizedHeaders(),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'FORBIDDEN');
  } finally {
    await closeServer(unauthorizedServer);
  }
});

test('unknown or missing permissions are denied by default', () => {
  const context = createRequestContext({
    config: testConfig(),
    principal: {
      actorId: 'bootstrap:core-api',
      roles: ['bootstrap'],
      permissions: [PERMISSIONS.coreConfigRead],
      sourceApp: 'test-runner',
    },
  });

  assert.equal(requirePermission(context, 'core.permission.unknown').ok, false);
  assert.equal(requirePermission(undefined, PERMISSIONS.coreConfigRead).ok, false);
});

test('spoofed identity headers do not override server-owned context', async () => {
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

test('CORS uses exact origin matching', async () => {
  const response = await fetch('http://127.0.0.1:3005/health/live', {
    headers: { Origin: 'http://malicious.example.com' },
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'CORS_ORIGIN_NOT_ALLOWED');
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
  if (server) await closeServer(server);
});
