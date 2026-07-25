import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { CORE_API_MIGRATIONS, runMigrations } from '../src/migrations/index.js';
import { migrationStatus, migrationVerify } from '../src/migrations/cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACTS_DIR = path.resolve(__dirname, '../../artifacts');
const REPORT_FILE = path.join(ARTIFACTS_DIR, 'migration-rehearsal-report.json');

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function randomSuffix() {
  return randomBytes(5).toString('hex');
}

function parseDatabaseUrl(value) {
  if (!value) fail('missing_database_url', 'DATABASE_URL is required for migration rehearsal');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('invalid_database_url', 'DATABASE_URL must be a valid PostgreSQL connection string');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    fail('invalid_database_url', 'DATABASE_URL must use postgres or postgresql scheme');
  }
  return url;
}

function cloneDatabaseUrl(url, databaseName) {
  const clone = new URL(url.toString());
  clone.pathname = `/${databaseName}`;
  return clone.toString();
}

function buildSafeIdentifier(url, databaseName) {
  return `rehearsal:${databaseName}`;
}

function buildAdminDatabaseUrl(url) {
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  return adminUrl.toString();
}

function buildSpawnEnv(url) {
  const env = { ...process.env };
  let cleanUrl = url;
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      env.PGPASSWORD = parsed.password;
      parsed.password = '';
    }
    if (parsed.username) {
      env.PGUSER = parsed.username;
      parsed.username = '';
    }
    env.PGDATABASE = parsed.pathname ? parsed.pathname.slice(1) : '';
    env.PGHOST = parsed.hostname;
    env.PGPORT = parsed.port || '5432';
    cleanUrl = parsed.toString();
  } catch {
    // fallback to original URL if parsing fails
  }
  return { env, cleanUrl };
}

function runCommand(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8' });
  if (result.error) {
    throw Object.assign(new Error(`Command failed: ${command} ${args.join(' ')}`), { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(result.stderr ? result.stderr.trim() : `Command exited with status ${result.status}`);
  }
  return result.stdout.trim();
}

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

async function createDatabase(adminUrl, databaseName) {
  const pool = new Pool({ connectionString: adminUrl });
  try {
    await pool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await pool.end();
  }
}

async function terminateDatabaseConnections(adminUrl, databaseName) {
  const pool = new Pool({ connectionString: adminUrl });
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
  } finally {
    await pool.end();
  }
}

async function dropDatabase(adminUrl, databaseName) {
  try {
    await terminateDatabaseConnections(adminUrl, databaseName);
    const pool = new Pool({ connectionString: adminUrl });
    try {
      await pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    } finally {
      await pool.end();
    }
  } catch (error) {
    throw Object.assign(new Error(`Failed to drop database ${databaseName}: ${error.message}`), { code: 'drop_database_failed' });
  }
}

async function withPool(databaseUrl, callback) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function validateFoundationSchema(pool) {
  const requiredTables = [
    'shared.schema_migrations',
    'shared.core_idempotency_records',
    'shared.core_audit_records',
    'shared.core_outbox_events',
  ];

  const missing = [];
  for (const table of requiredTables) {
    const [schema, tableName] = table.split('.');
    const result = await pool.query(
      `SELECT COUNT(1) AS count FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      [schema, tableName],
    );
    if (Number(result.rows[0].count) === 0) missing.push(`missing table ${table}`);
  }

  const requiredConstraints = [
    'core_idempotency_records_scope_key',
    'core_idempotency_records_state_shape',
    'core_outbox_events_published_state',
  ];

  for (const constraint of requiredConstraints) {
    const result = await pool.query(
      `SELECT COUNT(1) AS count FROM pg_constraint WHERE conname = $1`,
      [constraint],
    );
    if (Number(result.rows[0].count) === 0) missing.push(`missing constraint ${constraint}`);
  }

  const triggerResult = await pool.query(
    `SELECT COUNT(1) AS count FROM pg_trigger WHERE tgname = $1`,
    ['core_audit_records_append_only'],
  );
  if (Number(triggerResult.rows[0].count) === 0) missing.push('missing trigger core_audit_records_append_only');

  const indexResult = await pool.query(
    `SELECT COUNT(1) AS count FROM pg_indexes WHERE schemaname = 'shared' AND indexname = $1`,
    ['core_outbox_events_pending_available_idx'],
  );
  if (Number(indexResult.rows[0].count) === 0) missing.push('missing index core_outbox_events_pending_available_idx');

  return missing;
}

function normalizeJsonRow(row) {
  return JSON.stringify(row, Object.keys(row).sort());
}

async function captureSnapshot(pool) {
  const migrationResult = await pool.query('SELECT id FROM shared.schema_migrations ORDER BY id');
  const migrations = (migrationResult.rows ?? []).map((row) => String(row.id));

  const rowCounts = {};
  const tables = ['shared.core_idempotency_records', 'shared.core_audit_records', 'shared.core_outbox_events'];
  for (const table of tables) {
    const [schema, tableName] = table.split('.');
    const countResult = await pool.query(
      `SELECT COUNT(1) AS count FROM ${schema}.${tableName}`,
    );
    rowCounts[table] = Number(countResult.rows[0].count);
  }

  const checksums = {};
  for (const table of tables) {
    const [schema, tableName] = table.split('.');
    const rowsResult = await pool.query(
      `SELECT row_to_json(t) AS row FROM ${schema}.${tableName} t ORDER BY 1`,
    );
    const rows = (rowsResult.rows ?? []).map((row) => normalizeJsonRow(row.row));
    const hash = cryptoHash(rows.join('|'));
    checksums[table] = hash;
  }

  const constraints = await pool.query(
    `SELECT conname FROM pg_constraint WHERE connamespace = 'shared'::regnamespace ORDER BY conname`,
  );
  const indexes = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'shared' ORDER BY indexname`,
  );
  const triggers = await pool.query(
    `SELECT tgname FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'shared'::regnamespace) ORDER BY tgname`,
  );

  return {
    migrations,
    rowCounts,
    checksums,
    constraints: (constraints.rows ?? []).map((row) => row.conname),
    indexes: (indexes.rows ?? []).map((row) => row.indexname),
    triggers: (triggers.rows ?? []).map((row) => row.tgname),
  };
}

function cryptoHash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function insertSampleData(pool) {
  const auditId = randomBytes(16).toString('hex');
  const eventId = randomBytes(16).toString('hex');
  const idempotencyKey = `rehearsal-${randomSuffix()}`;

  await pool.query(
    `INSERT INTO shared.core_audit_records (audit_id, installation_id, actor_id, source_app, request_id, action, resource_type, after_data, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now())`,
    [auditId, 'rehearsal-install', 'rehearsal-actor', 'npp-core-api', 'rehearsal-req', 'rehearsal.action', 'rehearsal.resource', JSON.stringify({ status: 'ok' }), JSON.stringify({ note: 'sample' })],
  );

  await pool.query(
    `INSERT INTO shared.core_outbox_events (event_id, installation_id, aggregate_type, aggregate_id, event_type, event_version, payload, metadata, request_id, actor_id, source_app, status, attempts, available_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, now(), now())`,
    [eventId, 'rehearsal-install', 'rehearsal.aggregate', 'rehearsal-aggregate', 'rehearsal.created', 1, JSON.stringify({ value: 'ok' }), JSON.stringify({ note: 'sample' }), 'rehearsal-req', 'rehearsal-actor', 'npp-core-api', 'pending', 0],
  );

  await pool.query(
    `INSERT INTO shared.core_idempotency_records (installation_id, actor_id, http_method, route, idempotency_key, request_fingerprint, request_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')`,
    ['rehearsal-install', 'rehearsal-actor', 'POST', '/api/rehearse-test', idempotencyKey, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'rehearsal-req'],
  );
}

async function backupDatabase(sourceDatabaseUrl, backupPath) {
  const { env, cleanUrl } = buildSpawnEnv(sourceDatabaseUrl);
  runCommand('pg_dump', ['--format=custom', '--file', backupPath, cleanUrl], env);
}

async function restoreDatabase(restoreDatabaseUrl, backupPath) {
  const { env, cleanUrl } = buildSpawnEnv(restoreDatabaseUrl);
  runCommand('pg_restore', ['--no-owner', '--dbname', cleanUrl, backupPath], env);
}

async function run() {
  const startedAt = new Date().toISOString();
  let status = 'failed';
  const report = {
    startedAt,
    finishedAt: null,
    status: 'failed',
    postgresVersion: null,
    sourceDatabaseIdentifier: null,
    restoredDatabaseIdentifier: null,
    appliedMigrations: null,
    secondRunMigrations: null,
    preBackupSnapshot: null,
    postRestoreSnapshot: null,
    reconciliation: null,
    cleanup: {
      source: null,
      restore: null,
    },
    errors: [],
  };

  let sourceDatabaseName = null;
  let restoreDatabaseName = null;
  let backupPath = null;
  let adminUrl = null;

  try {
    if (String(process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
      fail('production_rehearsal_forbidden', 'Migration rehearsal is forbidden when NODE_ENV=production');
    }

    const baseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
    adminUrl = buildAdminDatabaseUrl(baseUrl);
    sourceDatabaseName = `npp_rehearsal_src_${randomSuffix()}`;
    restoreDatabaseName = `npp_rehearsal_dst_${randomSuffix()}`;
    report.sourceDatabaseIdentifier = buildSafeIdentifier(baseUrl, sourceDatabaseName);
    report.restoredDatabaseIdentifier = buildSafeIdentifier(baseUrl, restoreDatabaseName);

    const sourceDatabaseUrl = cloneDatabaseUrl(baseUrl, sourceDatabaseName);
    const restoreDatabaseUrl = cloneDatabaseUrl(baseUrl, restoreDatabaseName);

    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    backupPath = path.join(ARTIFACTS_DIR, `migration-rehearsal-${randomSuffix()}.dump`);

    await createDatabase(adminUrl, sourceDatabaseName);
    await createDatabase(adminUrl, restoreDatabaseName);

    const basePool = new Pool({ connectionString: sourceDatabaseUrl });
    try {
      const versionResult = await basePool.query('SELECT version() AS version');
      report.postgresVersion = versionResult.rows[0]?.version ?? 'unknown';
    } finally {
      await basePool.end();
    }

    await withPool(sourceDatabaseUrl, async (pool) => {
      const migrationResult = await runMigrations(pool, CORE_API_MIGRATIONS);
      report.appliedMigrations = migrationResult.applied;
    });

    const secondRun = await withPool(sourceDatabaseUrl, async (pool) => {
      const result = await runMigrations(pool, CORE_API_MIGRATIONS);
      return result.applied;
    });
    report.secondRunMigrations = secondRun;
    if (secondRun.length > 0) {
      fail('migration_idempotency_failed', 'Second migration run applied unexpected migrations');
    }

    await withPool(sourceDatabaseUrl, validateFoundationSchema).then((missing) => {
      if (missing.length > 0) fail('schema_validation_failed', `Missing schema objects: ${missing.join(', ')}`);
    });

    await withPool(sourceDatabaseUrl, insertSampleData);
    report.preBackupSnapshot = await withPool(sourceDatabaseUrl, captureSnapshot);

    backupDatabase(sourceDatabaseUrl, backupPath);
    await restoreDatabase(restoreDatabaseUrl, backupPath);
    report.postRestoreSnapshot = await withPool(restoreDatabaseUrl, captureSnapshot);

    const migrationsMatch = report.preBackupSnapshot.migrations.join('|') === report.postRestoreSnapshot.migrations.join('|');
    const rowCountsMatch = JSON.stringify(report.preBackupSnapshot.rowCounts) === JSON.stringify(report.postRestoreSnapshot.rowCounts);
    const checksumsMatch = JSON.stringify(report.preBackupSnapshot.checksums) === JSON.stringify(report.postRestoreSnapshot.checksums);
    const constraintsMatch = JSON.stringify(report.preBackupSnapshot.constraints) === JSON.stringify(report.postRestoreSnapshot.constraints);
    const indexesMatch = JSON.stringify(report.preBackupSnapshot.indexes) === JSON.stringify(report.postRestoreSnapshot.indexes);
    const triggersMatch = JSON.stringify(report.preBackupSnapshot.triggers) === JSON.stringify(report.postRestoreSnapshot.triggers);

    report.reconciliation = {
      migrationsMatch,
      rowCountsMatch,
      checksumsMatch,
      constraintsMatch,
      indexesMatch,
      triggersMatch,
      overallMatch: migrationsMatch && rowCountsMatch && checksumsMatch && constraintsMatch && indexesMatch && triggersMatch,
    };

    if (!report.reconciliation.overallMatch) {
      fail('reconciliation_failed', 'Post-restore snapshot does not match pre-backup snapshot');
    }

    status = 'success';
    report.status = 'success';
  } catch (error) {
    report.errors.push({ code: error.code || 'REHEARSAL_ERROR', message: String(error.message) });
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.cleanup.source = null;
    report.cleanup.restore = null;
    try {
      if (sourceDatabaseName) await dropDatabase(adminUrl, sourceDatabaseName);
      report.cleanup.source = 'dropped';
    } catch (cleanupError) {
      report.cleanup.source = `failed: ${cleanupError.message}`;
      report.errors.push({ code: cleanupError.code || 'cleanup_source_failed', message: String(cleanupError.message) });
    }
    try {
      if (restoreDatabaseName) await dropDatabase(adminUrl, restoreDatabaseName);
      report.cleanup.restore = 'dropped';
    } catch (cleanupError) {
      report.cleanup.restore = `failed: ${cleanupError.message}`;
      report.errors.push({ code: cleanupError.code || 'cleanup_restore_failed', message: String(cleanupError.message) });
    }
    try {
      if (backupPath && existsSync(backupPath)) rmSync(backupPath);
    } catch {
      // best-effort cleanup
    }
    try {
      writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
    } catch (writeError) {
      report.errors.push({ code: writeError.code || 'report_write_failed', message: String(writeError.message) });
    }
    if (status === 'success' && report.errors.length > 0) {
      status = 'failed';
      report.status = 'failed';
    }
    if (status !== 'success') {
      process.exit(1);
    }
  }
}

export { buildSpawnEnv, cryptoHash };

if (process.argv[1].endsWith('rehearse-migrations.js')) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
