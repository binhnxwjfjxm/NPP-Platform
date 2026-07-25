import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertInstallationScopedObjectKey,
  buildR2ObjectKey,
  normalizeStorageNamespace,
  sanitizeStorageFilename,
} from '../src/storage/object-key.js';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

test('builds an installation-scoped key with UTC year, month, UUID, and safe filename', () => {
  const key = buildR2ObjectKey({
    installationId: 'install-123',
    namespace: 'documents',
    filename: 'Báo cáo tháng 7.pdf',
    now: new Date('2026-07-25T01:02:03.000Z'),
    uuid: UUID,
  });

  assert.equal(key, `install-123/documents/2026/07/${UUID}-Bao-cao-thang-7.pdf`);
});

test('normalizes filenames without using them as the unique key', () => {
  assert.equal(sanitizeStorageFilename('  ..my  report..pdf  '), 'my-report.pdf');
});

test('rejects traversal, slashes, backslashes, null bytes, and invalid UUIDs', () => {
  for (const filename of ['../file.txt', 'a/b.txt', 'a\\b.txt', 'a\0b.txt']) {
    assert.throws(() => buildR2ObjectKey({
      installationId: 'install',
      namespace: 'documents',
      filename,
      uuid: UUID,
    }), { code: 'STORAGE_KEY_INVALID' });
  }

  assert.throws(() => buildR2ObjectKey({
    installationId: 'install',
    namespace: 'documents',
    filename: 'file.txt',
    uuid: 'not-a-uuid',
  }), { code: 'STORAGE_KEY_INVALID' });
});

test('rejects namespaces outside the allowlist', () => {
  assert.throws(() => normalizeStorageNamespace('private-secrets'), { code: 'STORAGE_KEY_INVALID' });
});

test('validates that existing keys remain inside the server-owned installation scope', () => {
  const key = `install-a/documents/2026/07/${UUID}-file.txt`;
  assert.equal(assertInstallationScopedObjectKey({ key, installationId: 'install-a' }), key);
  assert.throws(
    () => assertInstallationScopedObjectKey({ key, installationId: 'install-b' }),
    { code: 'STORAGE_KEY_INVALID' },
  );
});
