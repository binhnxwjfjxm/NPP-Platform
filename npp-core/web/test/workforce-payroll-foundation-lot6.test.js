import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 6 adds exactly one Tính lương sidebar item and keeps six functions as inner tabs', async () => {
  const [shell, page] = await Promise.all([
    source('app/components/app-shell-core.tsx'),
    source('app/workforce/payroll/page.tsx'),
  ]);
  assert.equal((shell.match(/href: '\/workforce\/payroll'/g) ?? []).length, 1);
  assert.match(shell, /label: 'Tính lương'/);
  for (const label of ['Bảng lương', 'Đối soát', 'Thiết lập lương', 'Khoản thu & khấu trừ', 'Phiếu lương', 'Lịch sử kỳ lương']) {
    assert.match(page, new RegExp(label.replace(/[&]/g, '\\&')));
  }
  assert.equal((shell.match(/Phiếu lương|Lịch sử kỳ lương|Thiết lập lương|Khoản thu & khấu trừ/g) ?? []).length, 0);
});

test('Issue #1140 Lô 6 keeps Bảng lương as the default payroll tab as later slices extend the page', async () => {
  const page = await source('app/workforce/payroll/page.tsx');
  assert.match(page, /useState<Tab>\('board'\)/);
  assert.match(page, /Bảng lương kỳ hiện tại/);
});

test('Issue #1140 Lô 6 keeps reimbursement separate from salary income in office language', async () => {
  const page = await source('app/workforce/payroll/page.tsx');
  assert.match(page, /Thu nhập lương/);
  assert.match(page, /Khấu trừ/);
  assert.match(page, /Hoàn chi phí/);
  assert.match(page, /Hoàn chi phí được quản lý riêng với thu nhập lương/);
  assert.doesNotMatch(page, />\\s*(schema|endpoint|payload|revision id)\\s*</i);
});

test('Issue #1140 Lô 6 reuses canonical idempotency key on retry and forwards it unchanged', async () => {
  const [page, gateway, route] = await Promise.all([
    source('app/workforce/payroll/page.tsx'),
    source('lib/workforce-gateway.ts'),
    source('app/api/workforce/payroll/route.ts'),
  ]);
  assert.match(page, /createIdempotencyKey\(operation\)/);
  assert.match(page, /if \(current\?\.payload === serialized\) return current\.key/);
  assert.match(gateway, /mutationKey\(idempotencyKey, 'payroll-foundation'\)/);
  assert.match(route, /request\.headers\.get\('idempotency-key'\)/);
});

test('Issue #1140 Lô 6 shows dated salary/fixed history and period-specific entries without client-side totals', async () => {
  const page = await source('app/workforce/payroll/page.tsx');
  assert.match(page, /Mức lương theo ngày áp dụng/);
  assert.match(page, /Khoản áp dụng định kỳ theo nhân sự/);
  assert.match(page, /Khoản linh động theo kỳ/);
  assert.match(page, /Ngày áp dụng/);
  assert.doesNotMatch(page, /reduce\([^\n]*amount|grossTotal|netTotal|salaryTotal/);
});
