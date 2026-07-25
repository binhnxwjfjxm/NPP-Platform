import { Pool } from 'pg';
import { CORE_API_MIGRATIONS, runMigrations } from './index.js';

const PRODUCTION_ALLOW_ENV = 'MIGRATION_ALLOW_PRODUCTION';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseDatabaseUrl(value) {
  if (!value) fail('missing_database_url', 'DATABASE_URL is required for migration commands');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('invalid_database_url', 'DATABASE_URL must be a valid PostgreSQL connection string');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    fail('invalid_database_url', 'DATABASE_URL must use postgres or postgresql scheme');
  }
  return url.toString();
}

function sanitizeDatabaseIdentifier(connectionString) {
  try {
    const url = new URL(connectionString);
    const dbName = url.pathname ? url.pathname.slice(1) : 'unknown';
    return `database:${dbName || 'unknown'}`;
  } catch {
    return 'database:unknown';
  }
}

function shouldRejectProduction(nodeEnv) {
  const normalized = String(nodeEnv ?? '').trim().toLowerCase();
  return normalized === 'production' && process.env[PRODUCTION_ALLOW_ENV] !== 'true';
}

function jsonLog(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function createPool(connectionString) {
  const pool = new Pool({ connectionString });
  return pool;
}

async function closePool(pool) {
  if (!pool) return;
  await pool.end();
}

async function getAppliedMigrations(adapter) {
  const result = await adapter.query(`
    SELECT id FROM shared.schema_migrations ORDER BY id
  `);
  return (result.rows ?? []).map((row) => String(row.id));
}

function buildMigrationStatus(applied, all) {
  const appliedSet = new Set(applied);
  return {
    applied,
    pending: all.filter((migration) => !appliedSet.has(migration.id)).map((migration) => migration.id),
  };
}

export async function migrationStatus({ databaseUrl }) {
  const connectionString = parseDatabaseUrl(databaseUrl);
  const pool = await createPool(connectionString);
  try {
    const applied = await getAppliedMigrations(pool);
    return buildMigrationStatus(applied, CORE_API_MIGRATIONS);
  } finally {
    await closePool(pool);
  }
}

export async function migrationMigrate({ databaseUrl }) {
  const connectionString = parseDatabaseUrl(databaseUrl);
  const pool = await createPool(connectionString);
  try {
    const result = await runMigrations(pool, CORE_API_MIGRATIONS);
    return { applied: result.applied };
  } finally {
    await closePool(pool);
  }
}

async function queryObjectExistence(adapter, schema, name, type) {
  const result = await adapter.query(
    `SELECT COUNT(1) AS count FROM information_schema.${type}s WHERE table_schema = $1 AND ${type}_name = $2`,
    [schema, name],
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

async function queryConstraintExists(adapter, constraintName) {
  const result = await adapter.query(
    `SELECT COUNT(1) AS count FROM pg_constraint WHERE conname = $1`,
    [constraintName],
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

async function queryTriggerExists(adapter, triggerName) {
  const result = await adapter.query(
    `SELECT COUNT(1) AS count FROM pg_trigger WHERE tgname = $1`,
    [triggerName],
  );
  return Number(result.rows[0]?.count ?? 0) > 0;
}

export async function migrationVerify({ databaseUrl }) {
  const connectionString = parseDatabaseUrl(databaseUrl);
  const pool = await createPool(connectionString);
  try {
    const status = await migrationStatus({ databaseUrl: connectionString });
    const missing = [];

    if (status.pending.length > 0) {
      missing.push(`pending migrations: ${status.pending.join(', ')}`);
    }

    const requiredTables = [
      { schema: 'shared', name: 'schema_migrations' },
      { schema: 'shared', name: 'core_idempotency_records' },
      { schema: 'shared', name: 'core_audit_records' },
      { schema: 'shared', name: 'core_outbox_events' },
    ];

    for (const table of requiredTables) {
      const exists = await queryObjectExistence(pool, table.schema, table.name, 'table');
      if (!exists) missing.push(`missing table ${table.schema}.${table.name}`);
    }

    const requiredConstraints = [
      'core_idempotency_records_scope_key',
      'core_idempotency_records_state_shape',
      'core_outbox_events_published_state',
    ];

    for (const constraint of requiredConstraints) {
      const exists = await queryConstraintExists(pool, constraint);
      if (!exists) missing.push(`missing constraint ${constraint}`);
    }

    const requiredTrigger = 'core_audit_records_append_only';
    if (!(await queryTriggerExists(pool, requiredTrigger))) {
      missing.push(`missing trigger ${requiredTrigger}`);
    }

    if (missing.length > 0) {
      return { verified: false, issues: missing };
    }

    return { verified: true, issues: [] };
  } finally {
    await closePool(pool);
  }
}

function usage() {
  console.error('Usage: node src/migrations/cli.js <status|migrate|verify>');
}

async function handleCommand(command) {
  const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
  if (shouldRejectProduction(process.env.NODE_ENV)) {
    fail('production_migration_forbidden', 'Migration commands are not allowed in production without explicit MIGRATION_ALLOW_PRODUCTION=true');
  }

  const identifier = sanitizeDatabaseIdentifier(databaseUrl);
  const baseLog = {
    timestamp: new Date().toISOString(),
    command,
    databaseIdentifier: identifier,
    status: 'started',
  };
  jsonLog(baseLog);

  let result;
  try {
    if (command === 'status') {
      result = await migrationStatus({ databaseUrl });
    } else if (command === 'migrate') {
      result = await migrationMigrate({ databaseUrl });
    } else if (command === 'verify') {
      result = await migrationVerify({ databaseUrl });
    } else {
      usage();
      process.exit(1);
    }

    jsonLog({
      timestamp: new Date().toISOString(),
      command,
      databaseIdentifier: identifier,
      status: 'success',
      result,
    });
    process.exit(command === 'verify' && result.verified === false ? 1 : 0);
  } catch (error) {
    jsonLog({
      timestamp: new Date().toISOString(),
      command,
      databaseIdentifier: identifier,
      status: 'error',
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: String(error.message),
      },
    });
    process.exit(1);
  }
}

if (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('cli.mjs')) {
  const command = process.argv[2];
  if (!command) {
    usage();
    process.exit(1);
  }
  handleCommand(command);
}
