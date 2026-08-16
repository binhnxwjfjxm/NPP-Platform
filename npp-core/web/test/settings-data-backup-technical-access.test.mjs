import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('settings technical backup UI exposes one dump plus the restore information file with canonical idempotency keys', async () => {
  const workspace = await readFile(new URL('../app/settings/data-backup/data-backup-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /createIdempotencyKey/);
  assert.match(workspace, /SAO LƯU HỆ THỐNG/);
  assert.match(workspace, /KHU VỰC KỸ THUẬT/);
  assert.match(workspace, /DI CHUYỂN & KHÔI PHỤC/);
  assert.match(workspace, /khuongbinh\.info@gmail\.com/);
  assert.match(workspace, /TẢI \.DUMP/);
  assert.match(workspace, /TẢI TỆP THÔNG TIN/);
  assert.match(workspace, /download\(latestVerified, 'manifest'\)/);
  assert.match(workspace, /artifactType: BackupArtifactType/);
  assert.match(workspace, /R2 riêng tư/);
  assert.match(workspace, /Xóa dữ liệu luôn dùng bước xác nhận riêng/);
  assert.match(workspace, /if \(unlocked\.unlocked\) \{\s*setJobs\(await request<BackupJob\[]>\('\/api\/backups'\)\);/);
  assert.match(workspace, /canReadBackup && technicalAccess\.unlocked \? <section/);
  assert.match(workspace, /Nhập mã xác nhận để mở chức năng sao lưu hệ thống/);
  assert.match(workspace, /Tệp thông tin không phải bản sao dữ liệu thứ hai/);
  assert.doesNotMatch(workspace, /ZIP CSV/);
  assert.doesNotMatch(workspace, /Excel nhiều sheet/);
  assert.doesNotMatch(workspace, /\bmigration\b/i);
});

test('technical unlock token stays in an HttpOnly cookie scoped away from delete routes', async () => {
  const gateway = await readFile(new URL('../lib/backup-gateway.ts', import.meta.url), 'utf8');
  const verifyRoute = await readFile(new URL('../app/api/backups/technical-access/[id]/verify/route.ts', import.meta.url), 'utf8');
  assert.match(gateway, /TECHNICAL_BACKUP_UNLOCK_COOKIE/);
  assert.match(gateway, /x-technical-backup-unlock/);
  assert.match(verifyRoute, /httpOnly: true/);
  assert.match(verifyRoute, /sameSite: 'strict'/);
  assert.match(verifyRoute, /path: '\/api\/backups'/);
  assert.match(verifyRoute, /data: \{ unlocked: true, expiresAt: data\.expiresAt \}/);
  assert.doesNotMatch(verifyRoute, /data: \{[^}]*token: data\.token/);
});

test('backup capability includes read permission for Owner-only technical metadata', async () => {
  const accessRoute = await readFile(new URL('../app/api/backups/access/route.ts', import.meta.url), 'utf8');
  assert.match(accessRoute, /canReadBackup: isOwner && permissions\.includes\('core\.backup\.read'\)/);
  assert.match(accessRoute, /canCreateBackup: isOwner/);
  assert.match(accessRoute, /canDownloadBackup: isOwner/);
});
