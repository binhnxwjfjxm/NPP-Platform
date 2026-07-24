import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestId, resolveRequestId, sanitizeConfigRecord, toBoolean } from '../index.js';

test('creates a req id with a predictable prefix', () => {
  const requestId = createRequestId('req');
  assert.match(requestId, /^req_[a-z0-9]+$/);
});

test('preserves only safe incoming request ids', () => {
  assert.equal(resolveRequestId('trace-123:core'), 'trace-123:core');

  const generated = resolveRequestId('unsafe request id');
  assert.match(generated, /^req_[a-z0-9]+$/);
  assert.notEqual(generated, 'unsafe request id');
});

test('sanitizes config record values', () => {
  const sanitized = sanitizeConfigRecord({ HOST: ' 127.0.0.1 ', PORT: '3004' });
  assert.equal(sanitized.HOST, '127.0.0.1');
  assert.equal(sanitized.PORT, '3004');
});

test('coerces truthy booleans', () => {
  assert.equal(toBoolean('true'), true);
  assert.equal(toBoolean('0'), false);
  assert.equal(toBoolean(undefined, true), true);
});
