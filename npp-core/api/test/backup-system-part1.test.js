import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  TECHNICAL_BACKUP_RECIPIENT,
  hashTechnicalBackupCode,
  hashTechnicalBackupUnlockToken,
  issueTechnicalBackupUnlockToken,
  loadTechnicalBackupAccessRuntime,
  parseTechnicalBackupUnlockToken,
  sendTechnicalBackupAccessEmail,
  technicalBackupCodeMatches,
  technicalBackupUnlockTokenMatches,
} from '../src/backup/technical-access.js';

test('technical backup recipient is fixed to the single Owner email', async () => {
  const runtime = loadTechnicalBackupAccessRuntime({
    env: {
      CLOUDFLARE_ACCOUNT_ID: 'account-1',
      CLOUDFLARE_EMAIL_API_TOKEN: 'provider-token',
      INTERNAL_AUTH_EMAIL_FROM: 'security@example.com',
      INTERNAL_AUTH_CHALLENGE_PEPPER: 'p'.repeat(64),
      SECURITY_OWNER_EMAILS: 'other1@example.com,other2@example.com',
      IMPLEMENTATION_OWNER_EMAILS: 'other3@example.com',
    },
  });
  assert.equal(TECHNICAL_BACKUP_RECIPIENT, 'khuongbinh.info@gmail.com');
  assert.equal(runtime.recipient, TECHNICAL_BACKUP_RECIPIENT);

  let requestBody = null;
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        success: true,
        result: { delivered: [TECHNICAL_BACKUP_RECIPIENT], queued: [], permanent_bounces: [] },
      }),
    };
  };
  await sendTechnicalBackupAccessEmail(fetchImpl, runtime, { code: '123456', sourceApp: 'npp-operations-web' });
  assert.deepEqual(requestBody.to, [TECHNICAL_BACKUP_RECIPIENT]);
  assert.ok(!JSON.stringify(requestBody).includes('other1@example.com'));
  assert.ok(!JSON.stringify(requestBody).includes('provider-token'));
});

test('technical backup code and unlock token are challenge-bound and timing-safe comparable', () => {
  const runtime = { pepper: 'p'.repeat(64) };
  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const firstHash = hashTechnicalBackupCode(runtime, firstId, '123456');
  const secondHash = hashTechnicalBackupCode(runtime, secondId, '123456');
  assert.notEqual(firstHash, secondHash);
  assert.equal(technicalBackupCodeMatches(firstHash, firstHash), true);
  assert.equal(technicalBackupCodeMatches(firstHash, secondHash), false);

  const issued = issueTechnicalBackupUnlockToken(runtime, firstId);
  const parsed = parseTechnicalBackupUnlockToken(issued.token);
  assert.equal(parsed.challengeId, firstId);
  const actual = hashTechnicalBackupUnlockToken(runtime, firstId, issued.token);
  assert.equal(technicalBackupUnlockTokenMatches(issued.tokenHash, actual), true);
  const wrong = hashTechnicalBackupUnlockToken(runtime, secondId, issued.token);
  assert.equal(technicalBackupUnlockTokenMatches(issued.tokenHash, wrong), false);
});

test('migration 087 adds technical access state without destructive database SQL', async () => {
  const migration = await readFile(new URL('../../../database/migrations/shared/087_technical_backup_access.sql', import.meta.url), 'utf8');
  const registry = await readFile(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.technical_backup_access_challenges/);
  assert.match(migration, /recipient_email = 'khuongbinh\.info@gmail\.com'/);
  assert.match(migration, /unlock_token_hash/);
  assert.match(migration, /unlock_expires_at/);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  const previous = registry.indexOf("id: '086_mcp_workforce_permission_catalog'");
  const current = registry.indexOf("id: '087_technical_backup_access'");
  assert.ok(previous >= 0 && current > previous);
});

test('Issue 562 Part 1 runner creates only a verified custom dump', async () => {
  const runner = await readFile(new URL('../src/services/backup-runner.js', import.meta.url), 'utf8');
  const repository = await readFile(new URL('../src/db/repositories/system-backup.js', import.meta.url), 'utf8');
  assert.match(runner, /--format=custom/);
  assert.match(runner, /PG_RESTORE_BIN/);
  assert.match(runner, /\['--list', dumpPath\]/);
  assert.match(runner, /checksumSha256/);
  assert.match(runner, /VERIFYING_R2/);
  assert.match(runner, /purpose: 'SYSTEM_BACKUP'/);
  assert.doesNotMatch(runner, /discoverBackupDatasets/);
  assert.doesNotMatch(runner, /buildCsvBundle/);
  assert.doesNotMatch(runner, /buildMultiSheetXlsx/);
  assert.doesNotMatch(runner, /manifestPayload/);
  assert.match(repository, /csv_object_key = NULL/);
  assert.match(repository, /xlsx_object_key = NULL/);
  assert.match(repository, /manifest_object_key = NULL/);
});

test('technical unlock gates the full system backup area and never replaces delete verification', async () => {
  const routes = await readFile(new URL('../src/routes/backups.js', import.meta.url), 'utf8');
  assert.match(routes, /x-technical-backup-unlock/);
  assert.match(routes, /requireTechnicalBackupAccess/);
  assert.match(routes, /includeXlsx: false/);
  assert.match(routes, /artifactType\.toLowerCase\(\) === 'database'/);
  assert.match(routes, /Sao lưu hệ thống chỉ cung cấp file \.dump/);

  const listStart = routes.indexOf("if (isBackupRoot && method === 'GET')");
  const createStart = routes.indexOf("if (isBackupRoot && method === 'POST')");
  const detailStart = routes.indexOf("if (backupMatch && method === 'GET')");
  const downloadStart = routes.indexOf("if (downloadMatch && method === 'POST')");
  assert.ok(listStart >= 0 && createStart > listStart && detailStart > createStart && downloadStart > detailStart);
  assert.match(routes.slice(listStart, createStart), /technicalAccessOrError/);
  assert.match(routes.slice(detailStart, downloadStart), /technicalAccessOrError/);

  const deleteStart = routes.indexOf("if (isDeleteRoot && method === 'POST')");
  const deleteEnd = routes.indexOf("if (deleteVerifyMatch && method === 'POST')");
  assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
  assert.doesNotMatch(routes.slice(deleteStart, deleteEnd), /technicalAccessOrError/);
});
