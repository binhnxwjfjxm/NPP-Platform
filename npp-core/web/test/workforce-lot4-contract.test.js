import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 4 adds Bảng công to the Nhân sự menu', async () => {
  const shell = await source('app/components/app-shell-core.tsx');
  assert.match(shell, /href: '\/workforce\/timesheet'.*label: 'Bảng công'.*testId: 'nav-timesheet'/);
});

test('Issue #1110 Lô 4 exposes read-only scoped query filters through the workforce gateway', async () => {
  const [gateway, route] = await Promise.all([
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/timesheet/route.ts'),
  ]);

  assert.match(gateway, /getAttendanceTimesheet/);
  assert.match(gateway, /'employeeQuery'/);
  assert.match(gateway, /'branchId'/);
  assert.match(gateway, /'view'/);
  assert.match(gateway, /'limit'/);
  assert.match(gateway, /'offset'/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST|Idempotency-Key/);
});

test('Issue #1110 Lô 4 renders daily and monthly timesheets with office language and event detail', async () => {
  const workspace = await source('app/workforce/timesheet/attendance-timesheet-workspace.tsx');

  assert.match(workspace, /title="Bảng công"/);
  assert.match(workspace, /Theo ngày/);
  assert.match(workspace, /Công theo ngày/);
  assert.match(workspace, /Mỗi nhân sự một hàng/);
  assert.match(workspace, /Xem từng ngày/);
  assert.match(workspace, /view: nextView === 'daily' \? 'employee' : 'monthly'/);
  assert.match(workspace, /Theo tháng/);
  assert.match(workspace, /Bảng công 31 ngày/);
  assert.match(workspace, /Array\.from\(\{ length: 31 \}/);
  assert.match(workspace, /matrixSaturday/);
  assert.match(workspace, /matrixSunday/);
  assert.match(workspace, /setSelectedDay/);
  assert.match(workspace, /type="month"/);
  assert.match(workspace, /Thực tế/);
  assert.match(workspace, /Được tính/);
  assert.match(workspace, /Đi trễ/);
  assert.match(workspace, /Về sớm/);
  assert.match(workspace, /Thiếu chấm công/);
  assert.match(workspace, /Nguồn dữ liệu/);
  assert.match(workspace, /Chi tiết sự kiện/);
  assert.match(workspace, /chưa phải dữ liệu tính lương/);
  assert.doesNotMatch(workspace, /Idempotency-Key|createIdempotencyKey|method:\s*'POST'/);
});

test('Issue #1110 Lô 4 uses bounded pagination instead of loading the full Công Ty history', async () => {
  const [page, workspace] = await Promise.all([
    source('app/workforce/timesheet/page.tsx'),
    source('app/workforce/timesheet/attendance-timesheet-workspace.tsx'),
  ]);

  assert.match(page, /view: 'employee'/);
  assert.match(page, /limit: '100'/);
  assert.match(workspace, /Trang trước/);
  assert.match(workspace, /Trang sau/);
  assert.match(workspace, /Tối đa 93 ngày mỗi lần xem/);
});
