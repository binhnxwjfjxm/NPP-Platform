import test from 'node:test';
import assert from 'node:assert/strict';
import { buildR2ObjectKey } from '../src/storage/object-key.js';

test('builds an R2 object key from structured components', () => {
  const key = buildR2ObjectKey({
    installationId: 'install-123',
    namespace: 'documents',
    objectName: 'receipt.pdf',
    version: '1',
    suffix: 'final',
  });

  assert.equal(key, 'install-123/documents/receipt.pdf/v1.final');
});

test('builds an R2 object key with encoded segments', () => {
  const key = buildR2ObjectKey({
    installationId: 'install id',
    namespace: 'invoices',
    objectName: 'January report',
  });

  assert.equal(key, 'install%20id/invoices/January%20report');
});

test('throws when R2 object key components contain path traversal', () => {
  assert.throws(
    () => buildR2ObjectKey({ installationId: 'install', namespace: '..', objectName: 'file.txt' }),
    { name: 'StorageError', message: /cannot contain path traversal/ },
  );
});
