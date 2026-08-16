import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  collectRestoreSnapshotMetadata,
  createSystemRestoreManifest,
  serializeSystemRestoreManifest,
} from '../src/backup/restore-manifest.js';

test('Issue #562 Part 3 builds a technical restore manifest from the same snapshot facts', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("current_setting('server_version')")) return { rows: [{ server_version: '17.4' }] };
      if (sql.includes('information_schema.tables')) {
        return { rows: [
          { table_schema: 'shared', table_name: 'customers' },
          { table_schema: 'sales', table_name: 'sales_orders' },
        ] };
      }
      if (sql.includes('"shared"."customers"')) return { rows: [{ row_count: '7' }] };
      if (sql.includes('"sales"."sales_orders"')) return { rows: [{ row_count: '11' }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const snapshotMetadata = await collectRestoreSnapshotMetadata(client);
  assert.equal(snapshotMetadata.tableCount, 2);
  assert.equal(snapshotMetadata.totalRows, '18');
  assert.deepEqual(snapshotMetadata.tables, [
    { schema: 'shared', table: 'customers', rowCount: '7' },
    { schema: 'sales', table: 'sales_orders', rowCount: '11' },
  ]);

  const manifest = createSystemRestoreManifest({
    backupJobId: '11111111-1111-4111-8111-111111111111',
    installationId: 'installation-test',
    snapshotAt: '2026-08-16T11:00:00.000Z',
    generatedAt: '2026-08-16T11:00:10.000Z',
    schemaVersion: '087_technical_backup_access',
    migrationIds: ['083_backup_delete_foundation', '087_technical_backup_access'],
    dump: {
      filename: 'hung-phat-system-20260816T110000Z.dump',
      key: 'installation-test/backups/2026/08/hung-phat-system.dump',
      size: 12345,
      sha256: 'a'.repeat(64),
    },
    snapshotMetadata,
  });
  assert.equal(manifest.purpose, 'SYSTEM_MOVE_RESTORE');
  assert.equal(manifest.schemaVersion, '087_technical_backup_access');
  assert.deepEqual(manifest.migrationIds, ['083_backup_delete_foundation', '087_technical_backup_access']);
  assert.equal(manifest.artifacts.databaseDump.sizeBytes, 12345);
  assert.equal(manifest.artifacts.databaseDump.sha256, 'a'.repeat(64));
  assert.equal(manifest.reconciliation.totalRows, '18');
  assert.equal(manifest.verification.dumpArchiveListVerified, true);
  assert.equal(manifest.verification.dumpStorageVerified, true);
  assert.equal(manifest.verification.restoreMode, 'PG_RESTORE_CUSTOM_ARCHIVE');
  const serialized = serializeSystemRestoreManifest(manifest).toString('utf8');
  assert.match(serialized, /SYSTEM_MOVE_RESTORE/);
  assert.doesNotMatch(serialized, /DATABASE_URL|password|secret|raw_payload/i);
  assert.equal(queries.filter((sql) => /count\(\*\)/i.test(sql)).length, 2);
});

test('Issue #562 Part 3 keeps one dump and adds only manifest metadata', async () => {
  const runner = await readFile(new URL('../src/services/backup-runner.js', import.meta.url), 'utf8');
  const repository = await readFile(new URL('../src/db/repositories/system-backup.js', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../src/routes/backups.js', import.meta.url), 'utf8');

  assert.equal((runner.match(/--format=custom/g) ?? []).length, 1, 'must keep exactly one pg_dump custom archive path');
  assert.match(runner, /collectRestoreSnapshotMetadata/);
  assert.match(runner, /createSystemRestoreManifest/);
  assert.match(runner, /serializeSystemRestoreManifest/);
  assert.match(runner, /artifact-type': 'system-restore-manifest'/);
  assert.doesNotMatch(runner, /discoverBackupDatasets|buildCsvBundle|buildMultiSheetXlsx/);
  assert.match(repository, /manifest_object_key = \$6/);
  assert.match(repository, /manifest_sha256 = \$7/);
  assert.match(routes, /\['database', 'manifest'\]/);
  assert.match(routes, /artifactType: artifactType/);
});
