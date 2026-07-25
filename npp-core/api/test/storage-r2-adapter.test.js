import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  createOptionalR2StorageAdapter,
  createR2StorageAdapter,
  sanitizeStorageMetadata,
} from '../src/storage/r2-adapter.js';
import { normalizeProviderError, STORAGE_ERROR_CODES } from '../src/storage/errors.js';

const KEY = 'install-a/documents/2026/07/123e4567-e89b-42d3-a456-426614174000-file.txt';

function config(overrides = {}) {
  return {
    r2Enabled: true,
    r2Endpoint: 'https://example.invalid',
    r2Region: 'auto',
    r2Bucket: 'test-bucket',
    r2AccessKeyId: 'test-access-key',
    r2SecretAccessKey: 'test-secret-key',
    r2MaxObjectBytes: 1024,
    r2PresignedUrlMaxSeconds: 900,
    ...overrides,
  };
}

function fakeClient(responses = []) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next ?? {};
    },
  };
}

test('returns null when R2 is disabled and fails closed for incomplete enabled config', () => {
  assert.equal(createOptionalR2StorageAdapter({ r2Enabled: false }), null);
  assert.throws(() => createR2StorageAdapter({ r2Enabled: true }), {
    code: STORAGE_ERROR_CODES.configuration,
  });
});

test('putObject sends a private scoped command with size, sanitized metadata, and checksum', async () => {
  const client = fakeClient([{ ETag: '"etag-value"' }]);
  const adapter = createR2StorageAdapter(config(), { client });
  const result = await adapter.putObject({
    installationId: 'install-a',
    key: KEY,
    body: Buffer.from('hello'),
    contentType: 'text/plain',
    metadata: {
      request_id: 'req-1',
      authorization: 'Bearer secret',
      note: 'safe',
    },
  });

  assert.equal(client.calls.length, 1);
  assert.ok(client.calls[0] instanceof PutObjectCommand);
  assert.equal(client.calls[0].input.Bucket, 'test-bucket');
  assert.equal(client.calls[0].input.Key, KEY);
  assert.equal(client.calls[0].input.ContentLength, 5);
  assert.deepEqual(client.calls[0].input.Metadata, { request_id: 'req-1', note: 'safe' });
  assert.equal(typeof client.calls[0].input.ChecksumSHA256, 'string');
  assert.equal(result.etag, 'etag-value');
  assert.match(result.checksumSha256, /^[0-9a-f]{64}$/);
});

test('rejects oversized objects before calling the provider', async () => {
  const client = fakeClient();
  const adapter = createR2StorageAdapter(config({ r2MaxObjectBytes: 4 }), { client });
  await assert.rejects(
    adapter.putObject({ installationId: 'install-a', key: KEY, body: Buffer.from('hello') }),
    { code: STORAGE_ERROR_CODES.objectTooLarge },
  );
  assert.equal(client.calls.length, 0);
});

test('maps head, get, delete, and presigned GET to the expected commands', async () => {
  const client = fakeClient([
    { ETag: '"head-etag"', ContentLength: 5, ContentType: 'text/plain', Metadata: { note: 'safe' } },
    { Body: { pipe() {} }, ETag: '"get-etag"', ContentLength: 5, ContentType: 'text/plain' },
    {},
  ]);
  const presignCalls = [];
  const adapter = createR2StorageAdapter(config(), {
    client,
    presign: async (providerClient, command, options) => {
      presignCalls.push({ providerClient, command, options });
      return 'https://signed.example.invalid/object?signature=secret';
    },
  });

  const head = await adapter.headObject({ installationId: 'install-a', key: KEY });
  const downloaded = await adapter.getObject({ installationId: 'install-a', key: KEY });
  const deleted = await adapter.deleteObject({ installationId: 'install-a', key: KEY });
  const signed = await adapter.createPresignedGetUrl({
    installationId: 'install-a',
    key: KEY,
    expiresIn: 60,
    downloadFilename: 'report.pdf',
  });

  assert.ok(client.calls[0] instanceof HeadObjectCommand);
  assert.ok(client.calls[1] instanceof GetObjectCommand);
  assert.ok(client.calls[2] instanceof DeleteObjectCommand);
  assert.equal(head.size, 5);
  assert.equal(downloaded.body.pipe instanceof Function, true);
  assert.equal(deleted.deleted, true);
  assert.ok(presignCalls[0].command instanceof GetObjectCommand);
  assert.equal(presignCalls[0].options.expiresIn, 60);
  assert.equal(signed.expiresIn, 60);
});

test('rejects invalid presign TTL and does not call the presigner', async () => {
  let calls = 0;
  const adapter = createR2StorageAdapter(config(), {
    client: fakeClient(),
    presign: async () => { calls += 1; return 'unused'; },
  });

  for (const expiresIn of [0, -1, 901, 1.5]) {
    await assert.rejects(
      adapter.createPresignedGetUrl({ installationId: 'install-a', key: KEY, expiresIn }),
      { code: STORAGE_ERROR_CODES.keyInvalid },
    );
  }
  assert.equal(calls, 0);
});

test('delete is idempotent when the provider reports not found', async () => {
  const notFound = Object.assign(new Error('provider raw secret'), {
    name: 'NoSuchKey',
    $metadata: { httpStatusCode: 404 },
  });
  const adapter = createR2StorageAdapter(config(), { client: fakeClient([notFound]) });
  assert.deepEqual(await adapter.deleteObject({ installationId: 'install-a', key: KEY }), {
    key: KEY,
    deleted: false,
  });
});

test('provider errors are normalized without leaking provider messages or credentials', () => {
  const providerError = Object.assign(new Error('test-secret-key https://signed.example.invalid/?signature=secret'), {
    name: 'ServiceUnavailable',
    $metadata: { httpStatusCode: 503 },
  });
  const normalized = normalizeProviderError(providerError, STORAGE_ERROR_CODES.uploadFailed, 'Storage upload failed');
  assert.equal(normalized.code, STORAGE_ERROR_CODES.providerUnavailable);
  assert.equal(normalized.retryable, true);
  assert.doesNotMatch(`${normalized.message} ${JSON.stringify(normalized.details)}`, /test-secret-key|signature=secret/);
});

test('metadata sanitizer removes secret-shaped keys and values', () => {
  assert.deepEqual(sanitizeStorageMetadata({
    token: 'secret',
    note: 'safe',
    database_url: 'postgresql://example',
    other: 'Bearer credential',
  }), { note: 'safe' });
});
