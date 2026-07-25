import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_API_MIGRATIONS, runMigrations } from '../src/migrations/index.js';

function fakeAdapter(existingIds = []) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql: String(sql).trim(), values });
      if (String(sql).startsWith('SELECT id')) {
        return { rows: existingIds.map((id) => ({ id })) };
      }
      return { rows: [] };
    },
  };
}

test('runs unapplied migrations in ID order and records checkpoints', async () => {
  const adapter = fakeAdapter(['001_shared']);
  const executed = [];
  const result = await runMigrations(adapter, [
    { id: '003_sales', up: async () => executed.push('003_sales') },
    { id: '001_shared', up: async () => executed.push('001_shared') },
    { id: '002_inventory', sql: 'CREATE SCHEMA IF NOT EXISTS inventory' },
  ]);

  assert.deepEqual(executed, ['003_sales']);
  assert.deepEqual(result.applied, ['002_inventory', '003_sales']);
  assert.equal(adapter.calls[0].sql, 'BEGIN');
  assert.equal(adapter.calls.at(-1).sql, 'COMMIT');
  assert.deepEqual(
    adapter.calls.filter((call) => call.sql.startsWith('INSERT INTO')).map((call) => call.values[0]),
    ['002_inventory', '003_sales'],
  );
});

test('rolls back when a migration fails', async () => {
  const adapter = fakeAdapter();
  await assert.rejects(
    runMigrations(adapter, [{ id: '001_broken', up: async () => { throw new Error('boom'); } }]),
    /boom/,
  );
  assert.equal(adapter.calls.at(-1).sql, 'ROLLBACK');
});

test('registers idempotency from the shared SQL migration file', () => {
  const migration = CORE_API_MIGRATIONS.find(({ id }) => id === '002_core_idempotency');

  assert.ok(migration);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS shared\.core_idempotency_records/);
  assert.match(migration.sql, /UNIQUE \(installation_id, actor_id, http_method, route, idempotency_key\)/);
  assert.match(migration.sql, /status IN \('processing', 'completed', 'failed'\)/);
  assert.match(migration.sql, /response_body jsonb/);
});

test('registers audit and outbox migration from the shared SQL file', () => {
  const migration = CORE_API_MIGRATIONS.find(({ id }) => id === '003_core_audit_outbox');

  assert.ok(migration);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS shared\.core_audit_records/);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS shared\.core_outbox_events/);
  assert.match(migration.sql, /PRIMARY KEY/);
  assert.match(migration.sql, /CHECK \(status IN \('pending', 'published', 'failed'\)\)/);
  assert.match(migration.sql, /ON shared\.core_outbox_events \(status, available_at\)/);
});
