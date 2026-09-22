import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 7 turns Bảng lương into an aggregated payroll table with drill-in detail', async () => {
  const [page, panel] = await Promise.all([
    source('app/workforce/payroll/page.tsx'),
    source('app/workforce/payroll/payroll-aggregation-panel.tsx'),
  ]);
  assert.match(page, /PayrollAggregationPanel/);
  assert.match(panel, /Tổng hợp lương/);
  assert.match(panel, /Lương theo công/);
  assert.match(panel, /Công \/ OT/);
  assert.match(panel, /Thu nhập thêm/);
  assert.match(panel, /Hoàn chi/);
  assert.match(panel, /Khấu trừ/);
  assert.match(panel, /Thực nhận/);
  assert.match(panel, /Chi tiết lương/);
  for (const label of ['Lương cố định', 'Theo công & OT', 'Thưởng & phụ cấp', 'Công tác phí & hoàn chi phí', 'Khấu trừ', 'Thực nhận']) {
    assert.match(panel, new RegExp(label.replace(/[&]/g, '\\&')));
  }
});

test('Issue #1140 Lô 7 exposes blockers, warnings and reconciliation but still does not close/export payroll', async () => {
  const [page, panel] = await Promise.all([
    source('app/workforce/payroll/page.tsx'),
    source('app/workforce/payroll/payroll-aggregation-panel.tsx'),
  ]);
  assert.match(panel, /Cần xử lý trước khi đối soát/);
  assert.match(panel, /Xác nhận đối soát/);
  assert.match(panel, /giờ tăng ca đã xác nhận/);
  assert.match(page, /command: 'AGGREGATE'/);
  assert.match(page, /command: 'RECONCILE'/);
  assert.doesNotMatch(page + panel, />Chốt lương</);
  assert.doesNotMatch(page + panel, />Xuất PDF</);
  assert.doesNotMatch(page + panel, />Xuất Excel</);
});

test('Issue #1140 Lô 7 keeps all money totals server-side and reuses canonical idempotency keys', async () => {
  const [page, panel] = await Promise.all([
    source('app/workforce/payroll/page.tsx'),
    source('app/workforce/payroll/payroll-aggregation-panel.tsx'),
  ]);
  assert.match(page, /stableKey\(attempts, operation, payload\)/);
  assert.match(page, /web-payroll-aggregate/);
  assert.match(page, /web-payroll-reconcile/);
  assert.doesNotMatch(page + panel, /reduce\([^\n]*(amount|gross|net|salary)/i);
});
