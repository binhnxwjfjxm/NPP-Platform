import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_CONFIRM_VALUE,
  assertMigrationSafety,
  buildMigrationStatus,
  collectVerificationIssues,
  migrationStatusWithAdapter,
  redactSensitiveText,
  sanitizeDatabaseIdentifier,
} from '../src/migrations/cli.js';

const migrations = [{ id: '001_first' }, { id: '002_second' }];

test('migration status reports all migrations pending on an empty database', async () => {
  const adapter = {
    async query(sql) {
      assert.match(String(sql), /to_regclass/);
      return { rows: [{ exists: false }] };
    },
  };

  const status = await migrationStatusWithAdapter(adapter, migrations);
  assert.deepEqual(status.applied, []);
  assert.deepEqual(status.pending, ['001_first', '002_second']);
});

test('buildMigrationStatus separates applied and pending migrations', () => {
  const status = buildMigrationStatus(['001_first'], migrations);
  assert.deepEqual(status.applied, ['001_first']);
  assert.deepEqual(status.pending, ['002_second']);
});

test('production guard requires two explicit confirmations', () => {
  assert.throws(
    () => assertMigrationSafety({ nodeEnv: 'production', allowProduction: 'true', productionConfirm: 'wrong' }),
    /require both/,
  );
  assert.doesNotThrow(() => assertMigrationSafety({
    nodeEnv: 'production',
    allowProduction: 'true',
    productionConfirm: PRODUCTION_CONFIRM_VALUE,
  }));
  assert.doesNotThrow(() => assertMigrationSafety({ nodeEnv: 'test' }));
});

test('verification issues identify missing tables, constraints, triggers, and indexes', () => {
  const issues = collectVerificationIssues({
    status: { pending: ['003_pending'] },
    tables: { 'shared.required_table': false },
    constraints: { required_constraint: false },
    triggers: { required_trigger: false },
    indexes: { required_index: false },
  });

  assert.deepEqual(issues, [
    'pending migrations: 003_pending',
    'missing table shared.required_table',
    'missing constraint required_constraint',
    'missing trigger required_trigger',
    'missing index required_index',
  ]);
});

test('migration logging helpers do not expose connection details', () => {
  const databaseUrl = 'postgresql://migration_user:super-secret@db.internal.example:5432/npp_prod';
  const redacted = redactSensitiveText(`failed for ${databaseUrl} on db.internal.example as migration_user`, databaseUrl);

  assert.doesNotMatch(redacted, /super-secret|migration_user|db\.internal\.example|postgresql:\/\//);
  assert.match(sanitizeDatabaseIdentifier(databaseUrl), /^database:[0-9a-f]{12}$/);
  assert.doesNotMatch(sanitizeDatabaseIdentifier(databaseUrl), /npp_prod/);
});
