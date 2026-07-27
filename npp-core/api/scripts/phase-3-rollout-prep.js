import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseDatabaseUrl, redactSensitiveText, migrationStatusWithAdapter, migrationVerifyWithAdapter } from '../src/migrations/cli.js';
import {
  PHASE_3_AUDIT_CONFIRM_VALUE,
  PHASE_3_BACKUP_CONFIRM_VALUE,
  buildBackupContract,
  buildMigrationRegistryAudit,
  buildProviderAuditSummary,
} from '../src/migrations/rollout-prep.js';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireConfirmation(env, name, expected) {
  if (env[name] !== expected) {
    fail('confirmation_required', `${name} must equal the documented confirmation token`);
  }
}

async function createReadOnlyAuditReport(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const status = await migrationStatusWithAdapter(pool);
    const verification = await migrationVerifyWithAdapter(pool);
    const provider = await pool.query(
      `SELECT
         current_database() AS database_name,
         current_user,
         session_user,
         version() AS server_version,
         pg_is_in_recovery() AS in_recovery`,
    );
    const row = provider.rows?.[0] ?? {};
    return buildProviderAuditSummary({
      serverVersion: row.server_version ? String(row.server_version) : null,
      databaseName: row.database_name ? String(row.database_name) : null,
      currentUser: row.current_user ? String(row.current_user) : null,
      sessionUser: row.session_user ? String(row.session_user) : null,
      inRecovery: row.in_recovery === null || row.in_recovery === undefined ? null : Boolean(row.in_recovery),
      registryAudit: buildMigrationRegistryAudit({ appliedIds: status.applied }),
      verification,
    });
  } finally {
    await pool.end();
  }
}

function buildBackupContractFromEnv(env) {
  requireConfirmation(env, 'PHASE_3_BACKUP_CONFIRM', PHASE_3_BACKUP_CONFIRM_VALUE);
  return buildBackupContract({
    provider: 'Heroku PostgreSQL',
    appName: env.HEROKU_APP_NAME || env.HEROKU_APP || null,
    backupId: env.PHASE_3_BACKUP_ID || null,
    capturedAt: env.PHASE_3_BACKUP_CAPTURED_AT || null,
    sourceFingerprint: env.PHASE_3_SOURCE_FINGERPRINT || null,
    checksum: env.PHASE_3_BACKUP_CHECKSUM || null,
    sourceLabel: env.PHASE_3_SOURCE_LABEL || null,
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const command = process.argv[2];
  try {
    if (command === 'audit') {
      requireConfirmation(process.env, 'PHASE_3_AUDIT_CONFIRM', PHASE_3_AUDIT_CONFIRM_VALUE);
      const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
      const report = await createReadOnlyAuditReport(databaseUrl);
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else if (command === 'backup-contract') {
      const contract = buildBackupContractFromEnv(process.env);
      process.stdout.write(`${JSON.stringify(contract)}\n`);
    } else {
      fail('usage', 'Usage: node scripts/phase-3-rollout-prep.js <audit|backup-contract>');
    }
  } catch (error) {
    process.stderr.write(`${redactSensitiveText(error.message, process.env.DATABASE_URL)}\n`);
    process.exitCode = 1;
  }
}
