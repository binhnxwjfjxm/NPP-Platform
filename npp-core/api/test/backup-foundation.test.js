import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCsvBundle, exportDataset, sanitizeSheetName, writeStoredZip } from '../src/backup/artifacts.js';
import { claimQueuedBackupJob } from '../src/db/repositories/backup.js';
import {
  hashOwnerDeletionCode,
  loadOwnerDeletionChallengeRuntime,
  ownerDeletionCodeMatches,
  sendOwnerDeletionChallengeEmail,
} from '../src/backup/owner-delete-challenge.js';
import '../src/services/backup.js';
import '../src/services/backup-runner.js';
import '../src/routes/backups.js';

test('backup zip writer produces a valid stored ZIP envelope without buffering files into one source buffer', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'npp-backup-test-'));
  try {
    const csv = path.join(dir, 'customers.csv');
    const zip = path.join(dir, 'bundle.zip');
    await writeFile(csv, '\ufeffid,name\r\n1,Khách A\r\n');
    const result = await buildCsvBundle(zip, {
      jobId: '00000000-0000-4000-8000-000000000001',
      snapshotAt: '2026-08-15T03:00:00.000Z',
      datasets: [{ key: 'shared.customers', rowCount: 1, sha256: 'a'.repeat(64), csvPath: csv }],
    });
    const bytes = await readFile(zip);
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
    assert.equal(result.size, bytes.length);
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('sheet names are Excel-safe, <=31 chars and unique', () => {
  const used = new Set();
  const first = sanitizeSheetName('sales.sales_order_lines/[unsafe]*?', used);
  const second = sanitizeSheetName('sales.sales_order_lines/[unsafe]*?', used);
  assert.ok(first.length <= 31);
  assert.ok(second.length <= 31);
  assert.notEqual(first.toLowerCase(), second.toLowerCase());
  assert.doesNotMatch(first, /[\\/*?:\[\]]/);
});

test('delete challenge uses all unique Owner emails and never exposes provider credential in payload', async () => {
  const runtime = loadOwnerDeletionChallengeRuntime({
    env: {
      RESEND_API_KEY: 're_test_only',
      INTERNAL_AUTH_EMAIL_FROM: 'security@example.com',
      INTERNAL_AUTH_CHALLENGE_PEPPER: 'x'.repeat(64),
    },
    ownerConfig: {
      securityOwnerEmails: ['Owner1@example.com', 'owner2@example.com'],
      implementationOwnerEmails: ['owner3@example.com', 'owner1@example.com'],
    },
  });
  assert.deepEqual(runtime.recipients, ['owner1@example.com', 'owner2@example.com', 'owner3@example.com']);
  let requestBody = null;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ id: 'email-123' }),
    };
  };
  const sent = await sendOwnerDeletionChallengeEmail(fetchImpl, runtime, { code: '123456', sourceApp: 'npp-operations', intentId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(sent.recipientCount, 3);
  assert.deepEqual(requestBody.to, runtime.recipients);
  assert.equal(requestBody.from, 'security@example.com');
  assert.ok(!JSON.stringify(requestBody).includes('re_test_only'));
});

test('delete code HMAC is intent-bound and timing-safe comparable', () => {
  const runtime = { pepper: 'p'.repeat(64) };
  const a = hashOwnerDeletionCode(runtime, '11111111-1111-4111-8111-111111111111', '123456');
  const b = hashOwnerDeletionCode(runtime, '22222222-2222-4222-8222-222222222222', '123456');
  assert.notEqual(a, b);
  assert.equal(ownerDeletionCodeMatches(a, a), true);
  assert.equal(ownerDeletionCodeMatches(a, b), false);
});

test('generic stored ZIP supports in-memory metadata entry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'npp-zip-test-'));
  try {
    const zip = path.join(dir, 'test.zip');
    await writeStoredZip(zip, [{ name: 'manifest.json', content: '{"ok":true}\n' }]);
    const bytes = await readFile(zip);
    assert.ok(bytes.includes(Buffer.from('manifest.json')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CSV export neutralizes spreadsheet formula injection for string cells', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'npp-csv-formula-test-'));
  try {
    const csvPath = path.join(dir, 'customers.csv');
    let fetchCount = 0;
    const client = {
      async query(sql) {
        if (String(sql).startsWith('FETCH FORWARD')) {
          fetchCount += 1;
          return fetchCount === 1
            ? { rows: [{ name: '=HYPERLINK("https://example.invalid")', balance: -25 }] }
            : { rows: [] };
        }
        return { rows: [] };
      },
    };
    await exportDataset(client, {
      key: 'shared.customers', schema: 'shared', table: 'customers', columns: ['name', 'balance'],
    }, { csvPath });
    const csv = await readFile(csvPath, 'utf8');
    assert.match(csv, /'="?HYPERLINK|"'=HYPERLINK/);
    assert.match(csv, /,-25\r?\n/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Owner challenge fails closed unless every configured Owner is accepted', async () => {
  const runtime = loadOwnerDeletionChallengeRuntime({
    env: {
      RESEND_API_KEY: 're_test_only',
      INTERNAL_AUTH_EMAIL_FROM: 'security@example.com',
      INTERNAL_AUTH_CHALLENGE_PEPPER: 'x'.repeat(64),
    },
    ownerConfig: {
      securityOwnerEmails: ['owner1@example.com', 'owner2@example.com'],
      implementationOwnerEmails: ['owner3@example.com'],
    },
  });
  const fetchImpl = async () => ({
    ok: false,
    json: async () => ({ error: { message: 'rejected' } }),
  });
  await assert.rejects(
    sendOwnerDeletionChallengeEmail(fetchImpl, runtime, { code: '123456', sourceApp: 'npp-operations-web', intentId: '33333333-3333-4333-8333-333333333333' }),
    /DATA_DELETION_CHALLENGE_DELIVERY_FAILED/,
  );
});

test('queued backup claim is atomic at repository boundary', async () => {
  let captured = null;
  const client = {
    async query(sql, values) {
      captured = { sql, values };
      return { rows: [{ id: values[1], status: 'SNAPSHOTTING' }] };
    },
  };
  const result = await claimQueuedBackupJob(client, {
    installationId: 'npp-main',
    jobId: '00000000-0000-4000-8000-000000000001',
    startedAt: '2026-08-15T03:30:00.000Z',
  });
  assert.equal(result.status, 'SNAPSHOTTING');
  assert.match(captured.sql, /status = 'QUEUED'/);
  assert.match(captured.sql, /UPDATE shared\.backup_jobs/);
});

test('backup service persists rejected Owner attempts and audits terminal challenge transitions', async () => {
  const source = await readFile(new URL('../src/services/backup.js', import.meta.url), 'utf8');
  assert.match(source, /action: 'data_deletion_challenge_rejected'/);
  assert.match(source, /action: 'data_deletion_challenge_expired'/);
  assert.match(source, /expectedAuditCount: 1/);
  assert.match(source, /failed: true/);
});

test('backup runner fails closed for a configured public R2 bucket and audits VERIFIED\/FAILED outcomes', async () => {
  const source = await readFile(new URL('../src/services/backup-runner.js', import.meta.url), 'utf8');
  assert.match(source, /config\.r2PublicBaseUrl/);
  assert.match(source, /BACKUP_STORAGE_PUBLIC_BUCKET_FORBIDDEN/);
  assert.match(source, /action: 'backup_verified'/);
  assert.match(source, /action: 'backup_failed'/);
});

test('backup route requires a dedicated BACKUP_R2_BUCKET and does not silently reuse public storage', async () => {
  const source = await readFile(new URL('../src/routes/backups.js', import.meta.url), 'utf8');
  assert.match(source, /BACKUP_R2_BUCKET/);
  assert.match(source, /BACKUP_R2_MAX_OBJECT_BYTES/);
  assert.match(source, /samePublicBucket/);
});

test('delete foundation migration is registered as 083, creates authorization gate only, and contains no purge execution SQL', async () => {
  const source = await readFile(new URL('../../../database/migrations/shared/083_backup_delete_foundation.sql', import.meta.url), 'utf8');
  const migrationRegistrySource = await readFile(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
  assert.match(migrationRegistrySource, /083_backup_delete_foundation/);
  assert.doesNotMatch(migrationRegistrySource, /082_backup_delete_foundation/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS shared\.data_deletion_intents/);
  assert.match(source, /core\.data-deletion\.authorize/);
  assert.doesNotMatch(source, /TRUNCATE\s+/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+(?:shared|mcp|sales|purchasing|inventory|logistics|accounting|reporting)\./i);
});
