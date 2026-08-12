import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createErrorEnvelope,
  createIdempotencyKey,
  createSuccessEnvelope,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_PATTERN,
  isValidIdempotencyKey,
  normalizeIdempotencyKey,
  normalizeIdempotencyOperation,
} from '../index.js';

const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';

test('creates a success envelope', () => {
  const envelope = createSuccessEnvelope({ ok: true }, 'req_123', '2026-07-24T00:00:00.000Z');
  assert.deepEqual(envelope, {
    data: { ok: true },
    requestId: 'req_123',
    receivedAt: '2026-07-24T00:00:00.000Z',
  });
});

test('creates an error envelope', () => {
  const envelope = createErrorEnvelope(
    {
      code: 'INVALID_TOKEN',
      message: 'Token rejected',
      details: { field: 'authorization' },
      retryable: false,
    },
    'req_456',
    '2026-07-24T00:00:00.000Z',
  );

  assert.deepEqual(envelope.error, {
    code: 'INVALID_TOKEN',
    message: 'Token rejected',
    details: { field: 'authorization' },
    retryable: false,
  });
});

test('idempotency contract accepts only the canonical 1..128 key language', () => {
  assert.equal(IDEMPOTENCY_KEY_MAX_LENGTH, 128);
  for (const value of ['a', 'abc-123', 'x.y_z-123', 'x'.repeat(128)]) {
    assert.equal(isValidIdempotencyKey(value), true, value);
    assert.match(value, IDEMPOTENCY_KEY_PATTERN);
  }
  for (const value of ['bad:key', 'bad+key', 'bad~key', 'bad/key', 'bad key', 'x'.repeat(129)]) {
    assert.equal(isValidIdempotencyKey(value), false, value);
  }
  assert.equal(normalizeIdempotencyKey('  abc-123  '), 'abc-123');
  assert.equal(normalizeIdempotencyKey('   '), null);
});

test('idempotency operation normalization cannot inject forbidden separators', () => {
  assert.equal(normalizeIdempotencyOperation(' Fulfillment:Pick '), 'fulfillment-pick');
  assert.equal(normalizeIdempotencyOperation(' customer + return '), 'customer-return');
  assert.throws(() => normalizeIdempotencyOperation(':::+~~'), /idempotency_operation_required/);
});

test('idempotency generator is deterministic under UUID injection and always canonical', () => {
  const key = createIdempotencyKey('Fulfillment:Pick', TEST_UUID);
  assert.equal(key, `fulfillment-pick-${TEST_UUID}`);
  assert.equal(key.length <= IDEMPOTENCY_KEY_MAX_LENGTH, true);
  assert.equal(isValidIdempotencyKey(key), true);
  assert.equal(key.includes(':'), false);
  assert.throws(() => createIdempotencyKey('pick', 'not-a-uuid'), /idempotency_uuid_invalid/);

  const longOperation = `fulfillment-${'x'.repeat(200)}`;
  const longKey = createIdempotencyKey(longOperation, TEST_UUID);
  assert.equal(longKey.length, IDEMPOTENCY_KEY_MAX_LENGTH);
  assert.equal(isValidIdempotencyKey(longKey), true);
});
