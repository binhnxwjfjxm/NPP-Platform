const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

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
