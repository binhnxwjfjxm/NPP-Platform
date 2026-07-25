import test from 'node:test';
import assert from 'node:assert/strict';
import { createOptionalR2StorageAdapter } from '../src/storage/r2-adapter.js';
import { normalizeProviderError, STORAGE_ERROR_CODES } from '../src/storage/errors.js';

function createProviderError(name, message, statusCode) {
  const error = new Error(message);
  error.name = name;
  error.$metadata = { httpStatusCode: statusCode };
  return error;
}

test('returns null when R2 storage is disabled', () => {
  const adapter = createOptionalR2StorageAdapter({ r2StorageEnabled: false });
  assert.equal(adapter, null);
});

test('throws when R2 storage is enabled but configuration is incomplete', () => {
  assert.throws(
    () => createOptionalR2StorageAdapter({ r2StorageEnabled: true }),
    (error) => error.code === STORAGE_ERROR_CODES.configuration,
  );
});

test('normalizes a 404 provider error to storage object not found', () => {
  const providerError = createProviderError('NotFound', 'Not Found', 404);
  const normalized = normalizeProviderError(providerError, STORAGE_ERROR_CODES.uploadFailed, 'fallback');

  assert.equal(normalized.code, STORAGE_ERROR_CODES.objectNotFound);
  assert.equal(normalized.publicMessage, 'Storage object not found');
  assert.equal(normalized.statusCode, 404);
});

test('normalizes a 503 provider error to provider unavailable and retryable', () => {
  const providerError = createProviderError('ServiceUnavailable', 'Service unavailable', 503);
  const normalized = normalizeProviderError(providerError, STORAGE_ERROR_CODES.uploadFailed, 'fallback');

  assert.equal(normalized.code, STORAGE_ERROR_CODES.providerUnavailable);
  assert.equal(normalized.publicMessage, 'Storage provider unavailable');
  assert.equal(normalized.retryable, true);
  assert.equal(normalized.statusCode, 503);
});
