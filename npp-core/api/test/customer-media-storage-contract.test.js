import test from 'node:test';
import assert from 'node:assert/strict';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { assertInstallationScopedObjectKey } from '../src/storage/object-key.js';
import { createR2StorageAdapter } from '../src/storage/r2-adapter.js';

function config() {
  return {
    r2Enabled: true,
    r2Endpoint: 'https://example.invalid',
    r2Region: 'auto',
    r2Bucket: 'shared-installation-bucket',
    r2AccessKeyId: 'test-access-key',
    r2SecretAccessKey: 'test-secret-key',
    r2MaxObjectBytes: 5 * 1024 * 1024,
    r2PresignedUrlMaxSeconds: 900,
  };
}

test('Core storage accepts the existing MCP outlet key only for the same installation', () => {
  assert.equal(
    assertInstallationScopedObjectKey({
      installationId: 'installation-a',
      key: 'mcp-plan/outlets/installation-a/route-customer-1/media-1.jpg',
    }),
    'mcp-plan/outlets/installation-a/route-customer-1/media-1.jpg',
  );
  assert.throws(() => assertInstallationScopedObjectKey({
    installationId: 'installation-b',
    key: 'mcp-plan/outlets/installation-a/route-customer-1/media-1.jpg',
  }));
});

test('Core can issue a short-lived private PUT using the existing R2 adapter', async () => {
  const presignCalls = [];
  const adapter = createR2StorageAdapter(config(), {
    client: { async send() { return {}; } },
    presign: async (client, command, options) => {
      presignCalls.push({ client, command, options });
      return 'https://signed.example.invalid/upload';
    },
  });
  const result = await adapter.createPresignedPutUrl({
    installationId: 'installation-a',
    key: 'installation-a/images/2026/08/123e4567-e89b-42d3-a456-426614174000-customer.jpg',
    contentType: 'image/jpeg',
    expiresIn: 300,
  });
  assert.equal(result.url, 'https://signed.example.invalid/upload');
  assert.equal(result.expiresIn, 300);
  assert.equal(presignCalls.length, 1);
  assert.ok(presignCalls[0].command instanceof PutObjectCommand);
  assert.equal(presignCalls[0].command.input.ContentType, 'image/jpeg');
  assert.equal(presignCalls[0].options.expiresIn, 300);
});
