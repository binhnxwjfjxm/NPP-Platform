import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCoreApiServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { PERMISSIONS } from '../src/request-context.js';

function baseEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    INSTALLATION_ID: 'access-user-auth-test',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform_test',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-1234567890',
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    R2_ENABLED: 'false',
    R2_CONTRACT_ROUTE_ENABLED: 'false',
  };
}

function sendRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: response.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on('error', reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

async function withPrincipal(permissions, callback) {
  const server = createCoreApiServer({
    config: loadConfig(baseEnv()),
    authenticateRequest: () => ({
      ok: true,
      principal: {
        actorId: 'test:actor',
        employeeId: null,
        roles: ['test'],
        permissions,
        scopes: {},
        sourceApp: 'npp-core-api',
      },
    }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('core.user.write cannot replace user roles without core.user-role.write', async () => {
  await withPrincipal([PERMISSIONS.coreUserWrite], async (baseUrl) => {
    const response = await sendRequest(`${baseUrl}/api/access/users/00000000-0000-4000-8000-000000000001/roles`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer injected' },
      body: { roleIds: [], expectedUpdatedAt: new Date().toISOString() },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  });
});

test('core.user-role.write reaches the dedicated role endpoint', async () => {
  await withPrincipal([PERMISSIONS.coreUserRoleWrite], async (baseUrl) => {
    const response = await sendRequest(`${baseUrl}/api/access/users/00000000-0000-4000-8000-000000000001/roles`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer injected' },
      body: { roleIds: [], expectedUpdatedAt: new Date().toISOString() },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error.code, 'MISSING_IDEMPOTENCY_KEY');
  });
});

test('core.user-role.write alone cannot create or change user status', async () => {
  await withPrincipal([PERMISSIONS.coreUserRoleWrite], async (baseUrl) => {
    const createResponse = await sendRequest(`${baseUrl}/api/access/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer injected' },
      body: { loginName: 'test.user', employeeId: '00000000-0000-4000-8000-000000000001' },
    });
    assert.equal(createResponse.statusCode, 403);

    const statusResponse = await sendRequest(`${baseUrl}/api/access/users/00000000-0000-4000-8000-000000000001`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer injected' },
      body: { isActive: false, expectedUpdatedAt: new Date().toISOString() },
    });
    assert.equal(statusResponse.statusCode, 403);
  });
});
