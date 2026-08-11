import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRequestWithIdempotency } from '../src/idempotency.js';

function baseArgs(store, requestId, onProcess) {
  return {
    idempotencyStore: store,
    req: { method: 'POST', headers: { 'idempotency-key': 'sales-confirm-test' } },
    requestContext: { installationId: 'installation-test', actorId: 'actor-test' },
    requestId,
    receivedAt: '2026-08-09T12:00:00.000Z',
    route: '/api/sales-orders/order-test/confirm',
    payload: {},
    onProcess,
  };
}

test('unknown idempotent processing failures are retryable 503 responses instead of opaque 500s', async () => {
  let failedResponse = null;
  const store = {
    async reserve() { return { created: true, record: {} }; },
    async markCompleted() { assert.fail('markCompleted must not run after a thrown processing error'); },
    async markFailed(_scope, _requestId, response) { failedResponse = response; },
  };
  const result = await executeRequestWithIdempotency(baseArgs(store, 'request-test', async () => {
    throw new Error('database transaction failed');
  }));
  assert.equal(result.replayed, false);
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.error.code, 'INTERNAL_ERROR');
  assert.equal(result.response.body.error.retryable, true);
  assert.equal(failedResponse.statusCode, 503);
});

test('null thrown values still persist the retryable fallback response', async () => {
  let failedResponse = null;
  const store = {
    async reserve() { return { created: true, record: {} }; },
    async markCompleted() { assert.fail('markCompleted must not run'); },
    async markFailed(_scope, _requestId, response) { failedResponse = response; },
  };
  const result = await executeRequestWithIdempotency(baseArgs(store, 'request-null', async () => {
    throw null;
  }));
  assert.equal(result.response.statusCode, 503);
  assert.equal(result.response.body.error.code, 'INTERNAL_ERROR');
  assert.equal(result.response.body.error.retryable, true);
  assert.equal(failedResponse.body.error.code, 'INTERNAL_ERROR');
});

test('same idempotency key reclaims a retryable failed record and processes again', async () => {
  let processCount = 0;
  let reclaimed = false;
  const failedRecord = {
    request_fingerprint: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    request_id: 'request-first',
    status: 'failed',
    response_status: 503,
    response_content_type: 'application/json',
    response_body: { error: { code: 'INTERNAL_ERROR', retryable: true } },
  };
  const store = {
    async reserve() { return { created: false, record: failedRecord }; },
    async reclaimFailed(_scope, fingerprint, requestId) {
      assert.equal(fingerprint, failedRecord.request_fingerprint);
      reclaimed = true;
      return { claimed: true, record: { ...failedRecord, status: 'processing', request_id: requestId } };
    },
    async markCompleted() {},
    async markFailed() { assert.fail('second attempt should succeed'); },
  };
  const result = await executeRequestWithIdempotency(baseArgs(store, 'request-retry', async () => {
    processCount += 1;
    return { statusCode: 200, contentType: 'application/json', requestId: 'request-retry', body: { data: { ok: true } } };
  }));
  assert.equal(reclaimed, true);
  assert.equal(processCount, 1);
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.replayed, false);
});

test('returned retryable 503 is stored as failed and the same key can process again', async () => {
  let record = null;
  let processCount = 0;
  const store = {
    async reserve(_scope, fingerprint, requestId) {
      if (!record) {
        record = {
          request_fingerprint: fingerprint,
          request_id: requestId,
          status: 'processing',
          response_status: null,
          response_content_type: null,
          response_body: null,
        };
        return { created: true, record };
      }
      return { created: false, record };
    },
    async reclaimFailed(_scope, fingerprint, requestId) {
      assert.equal(record.status, 'failed');
      assert.equal(fingerprint, record.request_fingerprint);
      record = {
        ...record,
        request_id: requestId,
        status: 'processing',
        response_status: null,
        response_content_type: null,
        response_body: null,
      };
      return { claimed: true, record };
    },
    async markCompleted(_scope, requestId, response) {
      record = {
        ...record,
        request_id: requestId,
        status: 'completed',
        response_status: response.statusCode,
        response_content_type: response.contentType,
        response_body: response.body,
      };
    },
    async markFailed(_scope, requestId, response) {
      record = {
        ...record,
        request_id: requestId,
        status: 'failed',
        response_status: response.statusCode,
        response_content_type: response.contentType,
        response_body: response.body,
      };
    },
  };

  const first = await executeRequestWithIdempotency(baseArgs(store, 'request-returned-503', async () => {
    processCount += 1;
    return {
      statusCode: 503,
      contentType: 'application/json',
      requestId: 'request-returned-503',
      body: {
        error: {
          code: 'DOCUMENT_NUMBER_SERIES_UNAVAILABLE',
          message: 'Document number series is unavailable',
          retryable: true,
          details: {},
        },
      },
    };
  }));
  assert.equal(first.response.statusCode, 503);
  assert.equal(first.replayed, false);
  assert.equal(record.status, 'failed');

  const second = await executeRequestWithIdempotency(baseArgs(store, 'request-returned-503-retry', async () => {
    processCount += 1;
    return {
      statusCode: 200,
      contentType: 'application/json',
      requestId: 'request-returned-503-retry',
      body: { data: { status: 'confirmed', number: 'SO-260811-000001' } },
    };
  }));
  assert.equal(second.response.statusCode, 200);
  assert.equal(second.replayed, false);
  assert.equal(record.status, 'completed');
  assert.equal(processCount, 2);
});