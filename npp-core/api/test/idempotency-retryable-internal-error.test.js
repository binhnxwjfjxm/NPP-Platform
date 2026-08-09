import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRequestWithIdempotency } from '../src/idempotency.js';

test('unknown idempotent processing failures are retryable 503 responses instead of sticky 500s', async () => {
  let failedResponse = null;
  const store = {
    async reserve() {
      return { created: true, record: {} };
    },
    async markCompleted() {
      assert.fail('markCompleted must not run after a thrown processing error');
    },
    async markFailed(_scope, _requestId, response) {
      failedResponse = response;
    },
  };

  const result = await executeRequestWithIdempotency({
    idempotencyStore: store,
    req: { method: 'POST', headers: { 'idempotency-key': 'sales-confirm-test' } },
    requestContext: { installationId: 'installation-test', actorId: 'actor-test' },
    requestId: 'request-test',
    receivedAt: '2026-08-09T12:00:00.000Z',
    route: '/api/sales-orders/order-test/confirm',
    payload: {},
    onProcess: async () => {
      throw new Error('database transaction failed');
    },
  });

  assert.equal(result.replayed, false);
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.error.code, 'INTERNAL_ERROR');
  assert.equal(result.response.body.error.retryable, true);
  assert.equal(failedResponse.statusCode, 503);
  assert.equal(failedResponse.body.error.retryable, true);
});
