import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REHEARSAL_CONFIRM_VALUE,
  assertRehearsalSafety,
  buildSpawnEnv,
  cleanupResources,
  cryptoHash,
  reconcileSnapshots,
  redactOperationalText,
} from '../scripts/rehearse-migrations.js';

test('buildSpawnEnv removes DATABASE_URL and moves credentials to libpq variables', () => {
  const { env, databaseName } = buildSpawnEnv(
    'postgresql://user:secret@localhost:5432/testdb',
    { DATABASE_URL: 'must-not-survive', KEEP_ME: 'yes' },
  );

  assert.equal(env.PGUSER, 'user');
  assert.equal(env.PGPASSWORD, 'secret');
  assert.equal(env.PGHOST, 'localhost');
  assert.equal(env.PGPORT, '5432');
  assert.equal(env.PGDATABASE, 'testdb');
  assert.equal(databaseName, 'testdb');
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.KEEP_ME, 'yes');
});

test('cryptoHash is stable and distinguishes different values', () => {
  assert.equal(cryptoHash('hello'), cryptoHash('hello'));
  assert.notEqual(cryptoHash('hello'), cryptoHash('world'));
  assert.match(cryptoHash('hello'), /^[0-9a-f]{64}$/);
});

test('rehearsal safety rejects production and requires explicit temporary-database confirmation', () => {
  assert.throws(
    () => assertRehearsalSafety({ NODE_ENV: 'production', MIGRATION_REHEARSAL_CONFIRM: REHEARSAL_CONFIRM_VALUE }),
    /forbidden/,
  );
  assert.throws(() => assertRehearsalSafety({ NODE_ENV: 'test' }), /requires/);
  assert.doesNotThrow(() => assertRehearsalSafety({
    NODE_ENV: 'test',
    MIGRATION_REHEARSAL_CONFIRM: REHEARSAL_CONFIRM_VALUE,
  }));
});

function snapshot(overrides = {}) {
  return {
    migrations: ['002_core_idempotency', '003_core_audit_outbox'],
    rowCounts: { audit: 1, outbox: 1 },
    checksums: { audit: 'aaa', outbox: 'bbb' },
    constraints: ['constraint-a'],
    indexes: ['index-a'],
    triggers: ['trigger-a'],
    ...overrides,
  };
}

test('reconciliation passes identical snapshots and fails changed counts or checksums', () => {
  assert.equal(reconcileSnapshots(snapshot(), snapshot()).overallMatch, true);
  const countMismatch = reconcileSnapshots(snapshot(), snapshot({ rowCounts: { audit: 2, outbox: 1 } }));
  assert.equal(countMismatch.rowCountsMatch, false);
  assert.equal(countMismatch.overallMatch, false);
  const checksumMismatch = reconcileSnapshots(snapshot(), snapshot({ checksums: { audit: 'changed', outbox: 'bbb' } }));
  assert.equal(checksumMismatch.checksumsMatch, false);
  assert.equal(checksumMismatch.overallMatch, false);
});

test('cleanup attempts source, restore, and backup even when one cleanup operation fails', async () => {
  const calls = [];
  const result = await cleanupResources({
    sourceDatabaseName: 'source-db',
    restoreDatabaseName: 'restore-db',
    adminUrl: 'postgresql://redacted',
    backupPath: '/tmp/rehearsal.dump',
    operations: {
      async dropDatabase(_adminUrl, databaseName) {
        calls.push(`drop:${databaseName}`);
        if (databaseName === 'source-db') throw new Error('source cleanup failed');
      },
      removeBackup(filePath) {
        calls.push(`remove:${filePath}`);
      },
    },
  });

  assert.deepEqual(calls, [
    'drop:source-db',
    'drop:restore-db',
    'remove:/tmp/rehearsal.dump',
  ]);
  assert.equal(result.cleanup.source, 'failed');
  assert.equal(result.cleanup.restore, 'dropped');
  assert.equal(result.cleanup.backup, 'removed');
  assert.equal(result.errors.length, 1);
});

test('operational errors redact URLs, hostnames, usernames, and passwords', () => {
  const text = redactOperationalText(
    'postgresql://user:password@db.example:5432/prod failed for db.example user password',
    ['db.example', 'user', 'password'],
  );
  assert.doesNotMatch(text, /postgresql:\/\/|db\.example|user|password/);
});
