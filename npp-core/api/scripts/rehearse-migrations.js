import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { CORE_API_MIGRATIONS, runMigrations } from '../src/migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ARTIFACTS_DIR = path.resolve(__dirname, '../../artifacts');
export const REPORT_FILE = path.join(ARTIFACTS_DIR, 'migration-rehearsal-report.json');
export const REHEARSAL_CONFIRM_ENV = 'MIGRATION_REHEARSAL_CONFIRM';
export const REHEARSAL_CONFIRM_VALUE = 'temporary-database';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function randomSuffix() {
  return randomBytes(5).toString('hex');
}

export function parseDatabaseUrl(value) {
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

export function assertRehearsalSafety(env = process.env) {
  if (String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    fail('production_rehearsal_forbidden', 'Migration rehearsal is forbidden when NODE_ENV=production');
  }
  if (env[REHEARSAL_CONFIRM_ENV] !== REHEARSAL_CONFIRM_VALUE) {
    fail(
      'rehearsal_confirmation_required',
      `Migration rehearsal requires ${REHEARSAL_CONFIRM_ENV}=${REHEARSAL_CONFIRM_VALUE}`,
    );
  }
}

function cloneDatabaseUrl(url, databaseName) {
  const clone = new URL(url.toString());
  clone.pathname = `/${databaseName}`;
  return clone.toString();
}

function buildAdminDatabaseUrl(url) {
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  return adminUrl.toString();
}

function hashIdentifier(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function buildSafeIdentifier(databaseName) {
  return `rehearsal:${hashIdentifier(databaseName)}`;
}

export function buildSpawnEnv(connectionString, sourceEnv = process.env) {
  const parsed = parseDatabaseUrl(connectionString);
  const env = { ...sourceEnv };
  env.PGHOST = parsed.hostname;
  env.PGPORT = parsed.port || '5432';
  env.PGUSER = decodeURIComponent(parsed.username || '');
  env.PGPASSWORD = decodeURIComponent(parsed.password || '');
  env.PGDATABASE = decodeURIComponent(parsed.pathname.slice(1));
  delete env.DATABASE_URL;
  return { env, databaseName: env.PGDATABASE };
}

export function redactOperationalText(value, secrets = []) {
  let text = String(value ?? '');
  text = text.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[REDACTED_DATABASE_URL]');
  for (const secret of secrets.filter(Boolean)) {
    text = text.split(String(secret)).join('[REDACTED]');
  }
  return text;
}

function runCommand(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8' });
  const secrets = [env.PGHOST, env.PGUSER, env.PGPASSWORD];
  if (result.error) {
    const error = new Error(`${command} could not start: ${redactOperationalText(result.error.message, secrets)}`);
    error.code = `${command}_start_failed`;
    throw error;
  }
  if (result.status !== 0) {
    const detail = redactOperationalText(result.stderr || `${command} exited with status ${result.status}`, secrets);
    const error = new Error(`${command} failed: ${detail}`);
    error.code = `${command}_failed`;
    throw error;
  }
  return String(result.stdout ?? '').trim();
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
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
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    );
  } finally {
    await pool.end();
  }
}

async function dropDatabase(adminUrl, databaseName) {
  await terminateDatabaseConnections(adminUrl, databaseName);
  const pool = new Pool({ connectionString: adminUrl });
  try {
    await pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await pool.end();
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

async function objectExists(pool, sql, values) {
  const result = await pool.query(sql, values);
  return result.rows?.[0]?.exists === true;
}

async function validateFoundationSchema(pool) {
  const missing = [];
  for (const table of [
    'shared.schema_migrations',
    'shared.core_idempotency_records',
    'shared.core_audit_records',
    'shared.core_outbox_events',
  ]) {
    if (!(await objectExists(pool, 'SELECT to_regclass($1) IS NOT NULL AS exists', [table]))) {
      missing.push(`missing table ${table}`);
    }
  }

  for (const [table, constraint] of [
    ['core_idempotency_records', 'core_idempotency_records_scope_key'],
    ['core_idempotency_records', 'core_idempotency_records_state_shape'],
    ['core_outbox_events', 'core_outbox_events_published_state'],
  ]) {
    const exists = await objectExists(
      pool,
      `SELECT EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'shared' AND t.relname = $1 AND c.conname = $2
       ) AS exists`,
      [table, constraint],
    );
    if (!exists) missing.push(`missing constraint ${constraint}`);
  }

  const triggerExists = await objectExists(
    pool,
    `SELECT EXISTS (
       SELECT 1 FROM pg_trigger g
       JOIN pg_class t ON t.oid = g.tgrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'shared' AND t.relname = 'core_audit_records'
         AND g.tgname = 'core_audit_records_append_only' AND NOT g.tgisinternal
     ) AS exists`,
    [],
  );
  if (!triggerExists) missing.push('missing trigger core_audit_records_append_only');

  const indexExists = await objectExists(
    pool,
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = 'shared' AND indexname = 'core_outbox_events_pending_available_idx'
     ) AS exists`,
    [],
  );
  if (!indexExists) missing.push('missing index core_outbox_events_pending_available_idx');
  return missing;
}

export function cryptoHash(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function captureSnapshot(pool) {
  const migrationResult = await pool.query('SELECT id FROM shared.schema_migrations ORDER BY id');
  const migrations = (migrationResult.rows ?? []).map((row) => String(row.id));
  const tables = ['shared.core_idempotency_records', 'shared.core_audit_records', 'shared.core_outbox_events'];
  const rowCounts = {};
  const checksums = {};

  for (const table of tables) {
    const countResult = await pool.query(`SELECT COUNT(1) AS count FROM ${table}`);
    rowCounts[table] = Number(countResult.rows[0].count);

    const rowsResult = await pool.query(
      `SELECT to_jsonb(t)::text AS row_text FROM ${table} t ORDER BY to_jsonb(t)::text`,
    );
    checksums[table] = cryptoHash((rowsResult.rows ?? []).map((row) => row.row_text).join('|'));
  }

  const constraints = await pool.query(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'shared'
     ORDER BY c.conname`,
  );
  const indexes = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'shared' ORDER BY indexname`,
  );
  const triggers = await pool.query(
    `SELECT g.tgname
     FROM pg_trigger g
     JOIN pg_class t ON t.oid = g.tgrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'shared' AND NOT g.tgisinternal
     ORDER BY g.tgname`,
  );

  return Object.freeze({
    migrations: Object.freeze(migrations),
    rowCounts: Object.freeze(rowCounts),
    checksums: Object.freeze(checksums),
    constraints: Object.freeze((constraints.rows ?? []).map((row) => row.conname)),
    indexes: Object.freeze((indexes.rows ?? []).map((row) => row.indexname)),
    triggers: Object.freeze((triggers.rows ?? []).map((row) => row.tgname)),
  });
}

async function insertSampleData(pool) {
  const auditId = randomUUID();
  const eventId = randomUUID();
  const idempotencyKey = `rehearsal-${randomSuffix()}`;

  await pool.query(
    `INSERT INTO shared.core_audit_records (
       audit_id, installation_id, actor_id, source_app, request_id,
       action, resource_type, after_data, metadata, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,now())`,
    [
      auditId,
      'rehearsal-install',
      'rehearsal-actor',
      'npp-core-api',
      'rehearsal-request',
      'rehearsal.action',
      'rehearsal.resource',
      JSON.stringify({ status: 'ok' }),
      JSON.stringify({ note: 'sample' }),
    ],
  );

  await pool.query(
    `INSERT INTO shared.core_outbox_events (
       event_id, installation_id, aggregate_type, aggregate_id, event_type,
       event_version, payload, metadata, request_id, actor_id, source_app,
       status, attempts, available_at, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,now(),now())`,
    [
      eventId,
      'rehearsal-install',
      'rehearsal.aggregate',
      'rehearsal-aggregate',
      'rehearsal.created',
      1,
      JSON.stringify({ value: 'ok' }),
      JSON.stringify({ note: 'sample' }),
      'rehearsal-request',
      'rehearsal-actor',
      'npp-core-api',
      'pending',
      0,
    ],
  );

  await pool.query(
    `INSERT INTO shared.core_idempotency_records (
       installation_id, actor_id, http_method, route, idempotency_key,
       request_fingerprint, request_id, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'processing')`,
    [
      'rehearsal-install',
      'rehearsal-actor',
      'POST',
      '/api/rehearsal-test',
      idempotencyKey,
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      'rehearsal-request',
    ],
  );
}

async function backupDatabase(sourceDatabaseUrl, backupPath, sourceEnv) {
  const { env } = buildSpawnEnv(sourceDatabaseUrl, sourceEnv);
  runCommand('pg_dump', ['--format=custom', '--file', backupPath], env);
}

async function restoreDatabase(restoreDatabaseUrl, backupPath, sourceEnv) {
  const { env } = buildSpawnEnv(restoreDatabaseUrl, sourceEnv);
  runCommand('pg_restore', ['--no-owner', '--exit-on-error', backupPath], env);
}

function arraysMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function reconcileSnapshots(before, after) {
  const reconciliation = {
    migrationsMatch: arraysMatch(before.migrations, after.migrations),
    rowCountsMatch: arraysMatch(before.rowCounts, after.rowCounts),
    checksumsMatch: arraysMatch(before.checksums, after.checksums),
    constraintsMatch: arraysMatch(before.constraints, after.constraints),
    indexesMatch: arraysMatch(before.indexes, after.indexes),
    triggersMatch: arraysMatch(before.triggers, after.triggers),
  };
  reconciliation.overallMatch = Object.values(reconciliation).every(Boolean);
  return Object.freeze(reconciliation);
}

export async function cleanupResources({ sourceDatabaseName, restoreDatabaseName, adminUrl, backupPath, operations }) {
  const cleanup = { source: 'not-created', restore: 'not-created', backup: 'not-created' };
  const errors = [];

  for (const [key, databaseName] of [['source', sourceDatabaseName], ['restore', restoreDatabaseName]]) {
    if (!databaseName) continue;
    try {
      await operations.dropDatabase(adminUrl, databaseName);
      cleanup[key] = 'dropped';
    } catch (error) {
      cleanup[key] = 'failed';
      errors.push({ code: error.code || `cleanup_${key}_failed`, message: String(error.message) });
    }
  }

  if (backupPath) {
    try {
      operations.removeBackup(backupPath);
      cleanup.backup = 'removed';
    } catch (error) {
      cleanup.backup = 'failed';
      errors.push({ code: error.code || 'cleanup_backup_failed', message: String(error.message) });
    }
  }

  return { cleanup, errors };
}

function createInitialReport(startedAt) {
  return {
    startedAt,
    finishedAt: null,
    status: 'failed',
    postgresVersion: null,
    sourceDatabaseIdentifier: null,
    restoredDatabaseIdentifier: null,
    appliedMigrations: [],
    secondRunMigrations: [],
    preBackupSnapshot: null,
    postRestoreSnapshot: null,
    reconciliation: null,
    cleanup: { source: 'not-created', restore: 'not-created', backup: 'not-created' },
    errors: [],
  };
}

function safeError(error, baseUrl) {
  const secrets = baseUrl
    ? [baseUrl.hostname, decodeURIComponent(baseUrl.username || ''), decodeURIComponent(baseUrl.password || '')]
    : [];
  return {
    code: error.code || 'REHEARSAL_ERROR',
    message: redactOperationalText(error.message, secrets),
  };
}

export async function runMigrationRehearsal({ env = process.env, reportFile = REPORT_FILE } = {}) {
  const report = createInitialReport(new Date().toISOString());
  let baseUrl = null;
  let adminUrl = null;
  let sourceDatabaseName = null;
  let restoreDatabaseName = null;
  let backupPath = null;
  let primaryError = null;

  const operations = {
    dropDatabase,
    removeBackup: (filePath) => {
      if (existsSync(filePath)) rmSync(filePath, { force: true });
    },
  };

  try {
    assertRehearsalSafety(env);
    baseUrl = parseDatabaseUrl(env.DATABASE_URL);
    adminUrl = buildAdminDatabaseUrl(baseUrl);
    sourceDatabaseName = `npp_rehearsal_src_${randomSuffix()}`;
    restoreDatabaseName = `npp_rehearsal_dst_${randomSuffix()}`;
    report.sourceDatabaseIdentifier = buildSafeIdentifier(sourceDatabaseName);
    report.restoredDatabaseIdentifier = buildSafeIdentifier(restoreDatabaseName);

    const sourceDatabaseUrl = cloneDatabaseUrl(baseUrl, sourceDatabaseName);
    const restoreDatabaseUrl = cloneDatabaseUrl(baseUrl, restoreDatabaseName);
    mkdirSync(path.dirname(reportFile), { recursive: true });
    backupPath = path.join(path.dirname(reportFile), `migration-rehearsal-${randomSuffix()}.dump`);

    await createDatabase(adminUrl, sourceDatabaseName);
    await createDatabase(adminUrl, restoreDatabaseName);

    report.postgresVersion = await withPool(sourceDatabaseUrl, async (pool) => {
      const result = await pool.query('SHOW server_version');
      return String(result.rows?.[0]?.server_version ?? 'unknown');
    });

    report.appliedMigrations = await withPool(sourceDatabaseUrl, async (pool) => {
      const result = await runMigrations(pool, CORE_API_MIGRATIONS);
      return [...result.applied];
    });

    report.secondRunMigrations = await withPool(sourceDatabaseUrl, async (pool) => {
      const result = await runMigrations(pool, CORE_API_MIGRATIONS);
      return [...result.applied];
    });
    if (report.secondRunMigrations.length !== 0) {
      fail('migration_idempotency_failed', 'Second migration run applied unexpected migrations');
    }

    const missing = await withPool(sourceDatabaseUrl, validateFoundationSchema);
    if (missing.length > 0) fail('schema_validation_failed', `Missing schema objects: ${missing.join(', ')}`);

    await withPool(sourceDatabaseUrl, insertSampleData);
    report.preBackupSnapshot = await withPool(sourceDatabaseUrl, captureSnapshot);
    await backupDatabase(sourceDatabaseUrl, backupPath, env);
    await restoreDatabase(restoreDatabaseUrl, backupPath, env);
    report.postRestoreSnapshot = await withPool(restoreDatabaseUrl, captureSnapshot);
    report.reconciliation = reconcileSnapshots(report.preBackupSnapshot, report.postRestoreSnapshot);
    if (!report.reconciliation.overallMatch) {
      fail('reconciliation_failed', 'Post-restore snapshot does not match pre-backup snapshot');
    }
  } catch (error) {
    primaryError = error;
    report.errors.push(safeError(error, baseUrl));
  } finally {
    const cleanupResult = await cleanupResources({
      sourceDatabaseName,
      restoreDatabaseName,
      adminUrl,
      backupPath,
      operations,
    });
    report.cleanup = cleanupResult.cleanup;
    report.errors.push(...cleanupResult.errors.map((error) => safeError(error, baseUrl)));
    report.finishedAt = new Date().toISOString();
    report.status = primaryError === null && report.errors.length === 0 ? 'success' : 'failed';
    mkdirSync(path.dirname(reportFile), { recursive: true });
    writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'success') {
    const error = primaryError ?? new Error('Migration rehearsal cleanup failed');
    error.code = error.code || 'rehearsal_failed';
    throw error;
  }
  return Object.freeze(report);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  try {
    const report = await runMigrationRehearsal();
    process.stdout.write(`${JSON.stringify({ status: report.status, report: 'migration-rehearsal-report.json' })}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || 'rehearsal_failed'}\n`);
    process.exitCode = 1;
  }
}
