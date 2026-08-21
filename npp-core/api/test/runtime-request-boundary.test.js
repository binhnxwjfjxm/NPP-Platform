import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { createCustomerPortalAwareServer } from '../src/customer-portal-server.js';

function baseEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    INSTALLATION_ID: 'runtime-request-boundary-test',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform_test',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-1234567890',
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    R2_ENABLED: 'false',
    R2_CONTRACT_ROUTE_ENABLED: 'false',
  };
}

function sendRequest(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
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
  });
}

test('one rejected production request is contained and the same server remains live', async () => {
  const config = loadConfig(baseEnv());
  const pool = { query: async () => ({ rows: [{ ok: 1 }] }) };
  let shouldFail = true;
  const server = createCustomerPortalAwareServer({
    config,
    env: {},
    pool,
    auditOutboxAdapter: pool,
    idempotencyStore: {},
    customerPortalAuth: {},
    internalAuthConfig: { enabled: false },
    internalAuth: { resolveRequest: async () => null },
    createRequestContext: () => {
      if (shouldFail) {
        shouldFail = false;
        throw Object.assign(new Error('synthetic connection reset'), { code: 'ECONNRESET' });
      }
      return {};
    },
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const failedRequest = await sendRequest(`${baseUrl}/health/live`);
    assert.equal(failedRequest.statusCode, 503);
    assert.equal(failedRequest.body.error.code, 'RUNTIME_REQUEST_FAILED');
    assert.equal(failedRequest.body.error.retryable, true);

    const nextRequest = await sendRequest(`${baseUrl}/health/live`);
    assert.equal(nextRequest.statusCode, 200);
    assert.equal(nextRequest.body.data.status, 'ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
