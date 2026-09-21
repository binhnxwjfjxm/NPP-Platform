import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseAttendanceQrPayload, hashAttendanceQrToken } from '../src/services/workforce.js';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 3 registers QR attendance migration after foundation', async () => {
  const [registry, migration, permissions, requestContext] = await Promise.all([
    source('src/migrations/index.js'),
    source('../../database/migrations/shared/141_workforce_attendance_qr.sql'),
    source('src/access/permissions.js'),
    source('src/request-context-base.js'),
  ]);

  assert.ok(registry.indexOf('141_workforce_attendance_qr') > registry.indexOf('140_workforce_attendance_foundation'));
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.attendance_points/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.attendance_qr_tokens/);
  assert.match(migration, /token_hash text NOT NULL/);
  assert.doesNotMatch(migration, /\btoken\s+text\b/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS attendance_point_id uuid/);
  assert.match(migration, /core\.attendance-point\.manage/);
  assert.match(permissions, /coreAttendancePointManage: 'core\.attendance-point\.manage'/);
  assert.match(requestContext, /PERMISSIONS\.coreAttendancePointManage/);
});

test('Issue #1110 Lô 3 QR payload parser accepts only canonical short payload and hashes raw token', () => {
  const raw = 'A'.repeat(43);
  const payload = `NPPATT.${raw}`;
  assert.equal(parseAttendanceQrPayload(payload), raw);
  assert.equal(parseAttendanceQrPayload('https://example.com/' + raw), null);
  assert.equal(parseAttendanceQrPayload('NPPATT.short'), null);
  assert.equal(hashAttendanceQrToken(raw), createHash('sha256').update(raw).digest('hex'));
});

test('Issue #1110 Lô 3 attendance record trusts session employee and server time only', async () => {
  const [route, service, repository] = await Promise.all([
    source('src/routes/workforce.js'),
    source('src/services/workforce.js'),
    source('src/db/repositories/workforce.js'),
  ]);

  assert.match(route, /employeeId: context\.requestContext\.employeeId/);
  assert.doesNotMatch(route, /employeeId:\s*payload\?\.employeeId/);
  assert.match(route, /coreAttendanceSelfRead/);
  assert.match(route, /coreAttendanceSelfRecord/);
  assert.match(route, /coreAttendancePointManage/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);

  assert.match(service, /occurredAt: now\.toISOString\(\)/);
  assert.match(service, /recordManualAttendance/);
  assert.match(service, /source: 'MANUAL'/);
  assert.match(service, /attendance-manual/);
  assert.match(service, /ATTENDANCE_MIN_EVENT_GAP_MS = 60_000/);
  assert.match(service, /QR_TOKEN_EXPIRED/);
  assert.match(service, /attendance_method/);
  assert.match(service, /sourceReference = createHash\('sha256'\)/);
  assert.doesNotMatch(service, /payload\?\.occurredAt|payload\?\.eventType/);

  assert.match(repository, /INSERT INTO shared\.attendance_events/);
  assert.match(repository, /values\.source \?\? 'QR'/);
  assert.match(repository, /ON CONFLICT \(installation_id, source, source_reference\)/);
  assert.doesNotMatch(repository, /UPDATE shared\.attendance_events/);
});

test('Issue #1110 Lô 3 attendance point management remains branch scoped', async () => {
  const [route, repository] = await Promise.all([
    source('src/routes/workforce.js'),
    source('src/db/repositories/workforce.js'),
  ]);

  assert.match(route, /requestContext\.scopes\.branchIds/);
  assert.match(route, /companyScope: isCompanyScope\(context\.requestContext\)/);
  assert.match(route, /SCOPE_FORBIDDEN/);
  assert.match(repository, /p\.branch_id = ANY\(/);
  assert.match(repository, /id = ANY\(/);
});
