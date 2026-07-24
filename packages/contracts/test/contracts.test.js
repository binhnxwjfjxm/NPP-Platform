import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuccessEnvelope, createErrorEnvelope } from '../index.js';

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
