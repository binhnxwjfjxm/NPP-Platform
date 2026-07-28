import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyGatewayFailure } from '../lib/gateway-diagnostics.ts';

test('gateway diagnostics distinguish upstream 404', () => {
  assert.equal(classifyGatewayFailure(404, 'CUSTOMER_NOT_FOUND'), 'upstream_not_found');
});

test('gateway diagnostics distinguish missing configuration 503', () => {
  assert.equal(classifyGatewayFailure(503, 'CUSTOMER_GATEWAY_NOT_CONFIGURED'), 'not_configured');
});

test('gateway diagnostics distinguish upstream authentication 401', () => {
  assert.equal(classifyGatewayFailure(401, 'AUTHENTICATION_REQUIRED'), 'authentication_failed');
});
