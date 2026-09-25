import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('manager manual attendance is a real attendance event and direct adjustment remains correction-only', async () => {
  const [workforce, adjustment, route] = await Promise.all([
    source('src/services/workforce.js'),
    source('src/services/attendance-adjustments.js'),
    source('src/routes/workforce.js'),
  ]);
  assert.match(workforce, /recordManagedManualAttendance/);
  assert.match(workforce, /recordAction: normalizedAction/);
  assert.match(workforce, /source: 'MANUAL'/);
  assert.match(workforce, /Quản lý chấm công tay theo giờ hệ thống/);
  assert.match(route, /\/attendance\/manual/);
  assert.match(route, /managedByOperator: true/);
  assert.doesNotMatch(adjustment, /recordNowAction/);
  assert.match(adjustment, /const reason = reasonValue\(payload\?\.reason\)/);
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
