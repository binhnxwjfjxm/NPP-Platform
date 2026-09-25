import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('workforce manual attendance records server time through canonical direct adjustment', async () => {
  const service = await source('src/services/attendance-adjustments.js');
  assert.match(service, /recordNowAction/);
  assert.match(service, /serverNow = recordNowAction \? new Date\(\)/);
  assert.match(service, /requestedCheckInAt: serverNow\.toISOString\(\)/);
  assert.match(service, /requestedCheckOutAt: serverNow\.toISOString\(\)/);
  assert.match(service, /requestSource: 'DIRECT'/);
  assert.match(service, /applyRequestEvents/);
});

test('manual paper leave remains one canonical leave request and feeds leave ledger', async () => {
  const [migration, service, repository] = await Promise.all([
    source('../../database/migrations/shared/159_workforce_manual_attendance_leave.sql'),
    source('src/services/leave-management.js'),
    source('src/db/repositories/leave-management.js'),
  ]);
  assert.match(migration, /request_source/);
  assert.match(migration, /MANUAL_PAPER/);
  assert.match(migration, /ALTER COLUMN requested_by_employee_id DROP NOT NULL/);
  assert.match(service, /export async function submitManualLeaveRequest/);
  assert.match(service, /requestSource: 'MANUAL_PAPER'/);
  assert.match(service, /requestedByEmployeeId: null/);
  assert.match(service, /createCanonicalLeaveRequest/);
  assert.match(service, /postUsage/);
  assert.match(repository, /request_source, r\.manual_approver_name/);
});

test('leave documents use the Company HR R2 tree and guarded workforce route', async () => {
  const [storage, route] = await Promise.all([
    source('src/storage/workforce-leave-documents.js'),
    source('src/routes/workforce.js'),
  ]);
  assert.match(storage, /Tai-lieu\/Nhan-su\/Phieu-nghi/);
  assert.match(storage, /WORKFORCE_LEAVE_DOCUMENT_MIME_TYPES/);
  assert.match(storage, /createR2StorageAdapter/);
  assert.match(route, /\/leave\/attachments/);
  assert.match(route, /coreLeaveApprove/);
  assert.match(route, /upload-leave-document/);
  assert.match(route, /\/leave\/requests\/manual/);
});
