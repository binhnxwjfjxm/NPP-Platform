import { createHash } from 'node:crypto';
import { CORE_API_MIGRATIONS } from './index.js';

export const PHASE_3_AUDIT_CONFIRM_VALUE = 'I_UNDERSTAND_THIS_IS_READ_ONLY';
export const PHASE_3_BACKUP_CONFIRM_VALUE = 'I_UNDERSTAND_THIS_IS_A_FRESH_PRODUCTION_BACKUP';
export const PHASE_3_ROLLOUT_STATUS_READY = 'READY_FOR_OPERATOR_ROLLOUT';

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function migrationChecksumEntry(migration) {
  return {
    id: String(migration.id),
    checksum: sha256(migration.sql),
    bytes: Buffer.byteLength(String(migration.sql), 'utf8'),
  };
}

function normaliseMigrationInput(migrations) {
  if (!Array.isArray(migrations)) return CORE_API_MIGRATIONS;
  return migrations;
}

export function buildMigrationManifest(migrations = CORE_API_MIGRATIONS) {
  return Object.freeze(
    normaliseMigrationInput(migrations)
      .map(migrationChecksumEntry)
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

export function buildMigrationRegistryAudit({
  appliedIds = [],
  migrations = CORE_API_MIGRATIONS,
} = {}) {
  const manifest = buildMigrationManifest(migrations);
  const manifestById = new Map(manifest.map((entry) => [entry.id, entry]));
  const applied = [...new Set((appliedIds ?? []).map((id) => String(id)))].sort();
  const pending = manifest.filter((entry) => !applied.includes(entry.id));
  const unexpectedApplied = applied.filter((id) => !manifestById.has(id));
  const appliedEntries = applied
    .filter((id) => manifestById.has(id))
    .map((id) => manifestById.get(id));

  const registryChecksum = sha256(
    manifest.map((entry) => `${entry.id}:${entry.checksum}:${entry.bytes}`).join('\n'),
  );

  return Object.freeze({
    manifest: Object.freeze(manifest),
    applied: Object.freeze(appliedEntries),
    pending: Object.freeze(pending),
    unexpectedApplied: Object.freeze(unexpectedApplied),
    appliedCount: appliedEntries.length,
    pendingCount: pending.length,
    unexpectedAppliedCount: unexpectedApplied.length,
    manifestChecksum: registryChecksum,
    overallMatch: pending.length === 0 && unexpectedApplied.length === 0,
  });
}

export function buildBackupContract({
  provider = 'Heroku PostgreSQL',
  appName = null,
  backupId = null,
  capturedAt = null,
  sourceFingerprint = null,
  checksum = null,
  sourceLabel = null,
  captureCommand = null,
} = {}) {
  const command = captureCommand
    || (appName ? `heroku pg:backups:capture --app ${appName}` : null);

  return Object.freeze({
    provider,
    appName,
    sourceLabel,
    backupId,
    capturedAt,
    sourceFingerprint,
    checksum,
    captureCommand: command,
    requiresExplicitConfirmation: true,
    confirmationToken: PHASE_3_BACKUP_CONFIRM_VALUE,
  });
}

export function buildProviderAuditSummary({
  serverVersion = null,
  databaseName = null,
  currentUser = null,
  sessionUser = null,
  inRecovery = null,
  registryAudit,
  verification,
} = {}) {
  return Object.freeze({
    provider: {
      serverVersion,
      databaseName,
      currentUser,
      sessionUser,
      inRecovery,
    },
    registryAudit,
    verification,
  });
}

export function buildRolloutPrepSummary(report = {}) {
  const sections = [];
  sections.push(report.status === 'success' ? PHASE_3_ROLLOUT_STATUS_READY : 'NOT_READY');
  if (report.registryAudit) {
    sections.push(`registry=${report.registryAudit.overallMatch ? 'PASS' : 'FAIL'}`);
  }
  if (report.reconciliation) {
    sections.push(`reconcile=${report.reconciliation.overallMatch ? 'PASS' : 'FAIL'}`);
  }
  if (report.regression) {
    sections.push(`regression=${report.regression.status === 'success' ? 'PASS' : 'FAIL'}`);
  }
  if (report.backup) {
    sections.push(`backup=${report.backup.checksum ? 'captured' : 'missing'}`);
  }
  return sections.join(' | ');
}
