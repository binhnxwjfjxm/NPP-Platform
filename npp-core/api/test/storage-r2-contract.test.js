import test from 'node:test';
import assert from 'node:assert/strict';
import { executeR2ContractOperation, normalizeR2ContractPayload } from '../src/storage/r2-contract.js';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

function requestContext() {
  return {
    installationId: 'install-a',
    actorId: 'actor-a',
    employeeId: null,
    requestId: 'req-a',
    sourceApp: 'npp-core-api',
    receivedAt: '2026-07-25T00:00:00.000Z',
  };
}

function auditAdapter({ failInsert = false } = {}) {
  const calls = [];
  return {
    calls,
    async connect() {
      return {
        async query(sql) {
          const normalized = String(sql).trim().toLowerCase();
          calls.push(normalized);
          if (failInsert && normalized.startsWith('insert into shared.core_audit_records')) {
            throw new Error('audit unavailable');
          }
          if (
            normalized === 'begin'
            || normalized === 'commit'
            || normalized === 'rollback'
            || normalized.startsWith('insert into shared.core_audit_records')
          ) return { rows: [] };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        async release() {},
      };
    },
  };
}

function storageAdapter({ deleteFailure = false } = {}) {
  const calls = [];
  return {
    calls,
    async putObject(input) {
      calls.push({ operation: 'put', input });
      return { key: input.key, size: input.contentLength, contentType: input.contentType, etag: 'put-etag', checksumSha256: 'a'.repeat(64) };
    },
    async headObject(input) {
      calls.push({ operation: 'head', input });
      return { key: input.key, size: 4, contentType: 'text/plain', etag: 'head-etag' };
    },
    async deleteObject(input) {
      calls.push({ operation: 'delete', input });
      if (deleteFailure) throw Object.assign(new Error('delete failed'), { code: 'STORAGE_DELETE_FAILED' });
      return { key: input.key, deleted: true };
    },
  };
}

test('contract operation uploads, verifies, writes audit only, and deletes the object', async () => {
  const storage = storageAdapter();
  const audit = auditAdapter();
  const result = await executeR2ContractOperation({
    storageAdapter: storage,
    auditAdapter: audit,
    requestContext: requestContext(),
    payload: { namespace: 'contracts', filename: 'check.txt', content: 'test' },
    now: new Date('2026-07-25T00:00:00.000Z'),
    uuid: UUID,
  });

  assert.equal(result.key, `install-a/contracts/2026/07/${UUID}-check.txt`);
  assert.deepEqual(storage.calls.map((call) => call.operation), ['put', 'head', 'delete']);
  assert.equal(result.deleted, true);
  assert.ok(audit.calls.some((sql) => sql.startsWith('insert into shared.core_audit_records')));
  assert.ok(!audit.calls.some((sql) => sql.includes('core_outbox_events')));
});

test('audit failure triggers compensating delete and returns a stable error', async () => {
  const storage = storageAdapter();
  await assert.rejects(
    executeR2ContractOperation({
      storageAdapter: storage,
      auditAdapter: auditAdapter({ failInsert: true }),
      requestContext: requestContext(),
      payload: { content: 'test' },
      uuid: UUID,
    }),
    { code: 'STORAGE_AUDIT_FAILED' },
  );
  assert.deepEqual(storage.calls.map((call) => call.operation), ['put', 'head', 'delete']);
});

test('failed compensating delete returns cleanup failure without leaking provider details', async () => {
  const storage = storageAdapter({ deleteFailure: true });
  await assert.rejects(
    executeR2ContractOperation({
      storageAdapter: storage,
      auditAdapter: auditAdapter({ failInsert: true }),
      requestContext: requestContext(),
      payload: { content: 'test' },
      uuid: UUID,
    }),
    (error) => error.code === 'STORAGE_AUDIT_CLEANUP_FAILED' && !/delete failed/.test(error.message),
  );
});

test('contract payload is small, textual, and non-sensitive by construction', () => {
  assert.equal(normalizeR2ContractPayload({}).body.toString('utf8'), 'npp-r2-contract-check');
  assert.throws(() => normalizeR2ContractPayload({ content: Buffer.from('binary') }), {
    code: 'STORAGE_KEY_INVALID',
  });
  assert.throws(() => normalizeR2ContractPayload({ content: 'x'.repeat(4097) }), {
    code: 'STORAGE_OBJECT_TOO_LARGE',
  });
});
