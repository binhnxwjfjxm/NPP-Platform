const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

const CORE_API_MIGRATIONS = Object.freeze([
  {
    id: '002_core_idempotency',
    sql: `
      CREATE TABLE IF NOT EXISTS shared.core_idempotency_records (
        id bigserial PRIMARY KEY,
        installation_id text NOT NULL,
        actor_id text NOT NULL,
        http_method text NOT NULL,
        route text NOT NULL,
        idempotency_key text NOT NULL,
        request_fingerprint text NOT NULL,
        request_id text NOT NULL,
        status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
        response_status integer NOT NULL DEFAULT 0,
        response_content_type text NOT NULL DEFAULT 'application/json',
        response_body jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz NULL,
        UNIQUE (installation_id, actor_id, http_method, route, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS core_idempotency_records_status_idx
      ON shared.core_idempotency_records (status);
    `,
  },
]);

function validateMigration(migration) {
  if (!migration || !IDENTIFIER_PATTERN.test(String(migration.id ?? ''))) {
    throw new Error('invalid_migration_id');
  }
  if (typeof migration.up !== 'function' && typeof migration.sql !== 'string') {
    throw new Error('invalid_migration_body');
  }
}

export async function runMigrations(adapter, migrations = []) {
  if (!adapter || typeof adapter.query !== 'function') throw new Error('invalid_migration_adapter');

  const ordered = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
  ordered.forEach(validateMigration);

  await adapter.query('BEGIN');
  try {
    await adapter.query('CREATE SCHEMA IF NOT EXISTS shared');
    await adapter.query(`
      CREATE TABLE IF NOT EXISTS shared.schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const existing = await adapter.query('SELECT id FROM shared.schema_migrations ORDER BY id');
    const appliedIds = new Set((existing.rows ?? []).map((row) => row.id));
    const applied = [];

    for (const migration of ordered) {
      if (appliedIds.has(migration.id)) continue;
      if (typeof migration.up === 'function') {
        await migration.up(adapter);
      } else {
        await adapter.query(migration.sql);
      }
      await adapter.query('INSERT INTO shared.schema_migrations (id) VALUES ($1)', [migration.id]);
      applied.push(migration.id);
    }

    await adapter.query('COMMIT');
    return Object.freeze({ status: 'complete', applied: Object.freeze(applied) });
  } catch (error) {
    await adapter.query('ROLLBACK');
    throw error;
  }
}

export { CORE_API_MIGRATIONS };
