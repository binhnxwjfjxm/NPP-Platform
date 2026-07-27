import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE_3_BACKUP_CONFIRM_VALUE,
  PHASE_3_ROLLOUT_STATUS_READY,
  buildBackupContract,
  buildMigrationManifest,
  buildMigrationRegistryAudit,
  buildRolloutPrepSummary,
} from '../src/migrations/rollout-prep.js';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

test('migration manifest includes stable checksums and sorted migration ids', () => {
  const manifest = buildMigrationManifest(CORE_API_MIGRATIONS);

  assert.equal(manifest.length, CORE_API_MIGRATIONS.length);
  assert.deepEqual(manifest.map((entry) => entry.id), [...manifest.map((entry) => entry.id)].sort());
  assert.match(manifest[0].checksum, /^[0-9a-f]{64}$/);
  assert.ok(manifest.every((entry) => Number.isInteger(entry.bytes) && entry.bytes > 0));
});

test('registry audit flags missing and unexpected migrations without drifting secrets', () => {
  const audit = buildMigrationRegistryAudit({
    appliedIds: ['002_core_idempotency', '003_core_audit_outbox', '999_unexpected'],
    migrations: CORE_API_MIGRATIONS.slice(0, 3),
  });

  assert.equal(audit.overallMatch, false);
  assert.deepEqual(audit.applied.map((entry) => entry.id), ['002_core_idempotency', '003_core_audit_outbox']);
  assert.deepEqual(audit.pending.map((entry) => entry.id), ['004_org_branches']);
  assert.deepEqual(audit.unexpectedApplied, ['999_unexpected']);
  assert.match(audit.manifestChecksum, /^[0-9a-f]{64}$/);
});

test('backup contract requires explicit confirmation and preserves available metadata only', () => {
  const contract = buildBackupContract({
    appName: 'hung-phat',
    backupId: 'b123',
    capturedAt: '2026-07-27T02:30:00.000Z',
    sourceFingerprint: 'pg:server-17',
    checksum: 'sha256:abc123',
  });

  assert.equal(contract.provider, 'Heroku PostgreSQL');
  assert.equal(contract.captureCommand, 'heroku pg:backups:capture --app hung-phat');
  assert.equal(contract.requiresExplicitConfirmation, true);
  assert.equal(contract.confirmationToken, PHASE_3_BACKUP_CONFIRM_VALUE);
  assert.equal(contract.backupId, 'b123');
  assert.equal(contract.sourceFingerprint, 'pg:server-17');
  assert.equal(contract.checksum, 'sha256:abc123');
});

test('rollout summary advertises READY_FOR_OPERATOR_ROLLOUT when everything passes', () => {
  const summary = buildRolloutPrepSummary({
    status: 'success',
    registryAudit: { overallMatch: true },
    reconciliation: { overallMatch: true },
    regression: { status: 'success' },
    backup: { checksum: 'abc' },
  });

  assert.match(summary, new RegExp(PHASE_3_ROLLOUT_STATUS_READY));
  assert.match(summary, /registry=PASS/);
  assert.match(summary, /reconcile=PASS/);
  assert.match(summary, /regression=PASS/);
});
