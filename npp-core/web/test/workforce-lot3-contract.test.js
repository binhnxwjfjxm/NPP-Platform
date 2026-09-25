import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 3 adds Chấm công to the Nhân sự menu', async () => {
  const shell = await source('app/components/app-shell-core.tsx');
  assert.match(shell, /href: '\/workforce\/attendance'.*label: 'Chấm công'.*testId: 'nav-attendance'/);
  assert.match(shell, /Hồ sơ, chấm công, chính sách và lịch làm việc/);
});

test('Issue #1110 Lô 3 uses camera QR scan and policy-controlled manual attendance', async () => {
  const workspace = await source('app/workforce/attendance/attendance-workspace.tsx');
  assert.match(workspace, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(workspace, /BarcodeDetector/);
  assert.match(workspace, /formats: \['qr_code'\]/);
  assert.match(workspace, /Mở camera quét QR/);
  assert.match(workspace, /Chấm công trực tiếp/);
  assert.match(workspace, /attendancePayload\(\s*'MANUAL'/);
  assert.match(workspace, /Không cần nhập thời gian hoặc chọn nơi làm việc/);
  assert.doesNotMatch(workspace, /Dán mã QR/);
  assert.match(workspace, /Ghi nhận vào làm/);
  assert.match(workspace, /Ghi nhận rời nơi làm việc/);
  assert.match(workspace, /Ghi nhận quay lại/);
  assert.match(workspace, /Nơi làm việc/);
  assert.match(workspace, /Hiển thị mã QR/);
  assert.match(workspace, /const payload = \{ branchId: selectedWorkplaceId \}/);
  assert.doesNotMatch(workspace, /Mã điểm/);
  assert.doesNotMatch(workspace, /Tên điểm chấm công/);
  assert.doesNotMatch(workspace, /pointDraft\.code|pointDraft\.name/);
});

test('Issue #1110 Lô 3 reuses canonical idempotency keys and does not send employee or timestamp from browser', async () => {
  const [workspace, gateway] = await Promise.all([
    source('app/workforce/attendance/attendance-workspace.tsx'),
    source('lib/workforce-gateway.ts'),
  ]);
  assert.match(workspace, /createIdempotencyKey\(operation\)/);
  assert.match(workspace, /attendancePayload\('QR', normalized\)/);
  assert.match(workspace, /attendancePayload\(\s*'MANUAL'/);
  assert.match(workspace, /today\?\.nextAction === 'EXIT'.*!options\?\.recordAction/);
  assert.match(workspace, /payload\.exitReason = exitReason/);
  assert.doesNotMatch(workspace, /employeeId:\s*today|occurredAt:/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'attendance-record'\)/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'attendance-qr-token'\)/);
});

test('Issue #1110 Lô 3 renders QR locally without sending short-lived token to an external service', async () => {
  const [qr, workspace] = await Promise.all([
    source('lib/attendance-qr.ts'),
    source('app/workforce/attendance/attendance-workspace.tsx'),
  ]);
  assert.match(qr, /const SIZE = 33/);
  assert.match(qr, /MAX_PAYLOAD_BYTES = 62/);
  assert.match(qr, /reedSolomonRemainder/);
  assert.match(workspace, /createAttendanceQrMatrix/);
  assert.doesNotMatch(qr + workspace, /api\.qrserver|chart\.googleapis|quickchart|external.*qr/i);
});
