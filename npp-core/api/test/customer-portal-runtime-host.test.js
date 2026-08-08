import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCustomerPortalRuntimeConfig } from '../src/customer-portal-server.js';

function config(overrides = {}) {
  return Object.freeze({
    nodeEnv: 'production',
    host: '127.0.0.1',
    port: 3004,
    installationId: 'npp-test',
    ...overrides,
  });
}

test('Customer Portal production runtime binds all interfaces when HOST is not explicitly configured', () => {
  const resolved = resolveCustomerPortalRuntimeConfig(config(), {});
  assert.equal(resolved.host, '0.0.0.0');
});

test('Customer Portal runtime preserves an explicit HOST and development loopback defaults', () => {
  assert.equal(resolveCustomerPortalRuntimeConfig(config({ host: '10.0.0.5' }), { HOST: '10.0.0.5' }).host, '10.0.0.5');
  assert.equal(resolveCustomerPortalRuntimeConfig(config({ nodeEnv: 'development' }), {}).host, '127.0.0.1');
});
