import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPayrollPayslipPdf } from '../lib/payroll-payslip-pdf.js';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 8 exposes close, post-close adjustment, payslip history and office exports', async () => {
  const [page, panel, exportRoute, pdfRoute] = await Promise.all([
    source('app/workforce/payroll/page.tsx'),
    source('app/workforce/payroll/payroll-closeout-panel.tsx'),
    source('app/api/workforce/payroll/export/route.ts'),
    source('app/api/workforce/payroll/payslip-pdf/route.ts'),
  ]);
  assert.match(page, /command: 'CLOSE'/);
  assert.match(page, /command: 'ADJUST'/);
  assert.match(panel, />Chốt lương</);
  assert.match(panel, /Điều chỉnh lương sau chốt/);
  assert.match(panel, /Lịch sử phiếu lương/);
  assert.match(panel, /Số liệu từ kỳ lương đã chốt/);
  assert.match(panel, />Xuất PDF</);
  assert.match(panel, />Xuất Excel</);
  assert.match(exportRoute, /createTabularXlsx/);
  assert.match(pdfRoute, /application\/pdf/);
});

test('Issue #1140 Lô 8 PDF builder returns an actual PDF document', () => {
  const file = buildPayrollPayslipPdf({
    revision: 2,
    snapshot: {
      period: { from: '2026-09-01', to: '2026-09-30' },
      employee: { code: 'NV001', name: 'Nguyễn Văn A', branchName: 'Công Ty' },
      pay: {
        salaryAmount: '10000000.00',
        incomeTotal: '500000.00',
        reimbursementTotal: '200000.00',
        deductionTotal: '100000.00',
        grossIncome: '10500000.00',
        netPay: '10600000.00',
      },
      adjustments: [],
    },
  });
  assert.equal(file.subarray(0, 8).toString('latin1'), '%PDF-1.4');
});

test('Issue #1140 Lô 8 keeps retry idempotency canonical and does not mutate timesheet from payroll UI', async () => {
  const page = await source('app/workforce/payroll/page.tsx');
  assert.match(page, /stableKey\(attempts, operation, payload\)/);
  assert.match(page, /web-payroll-close/);
  assert.match(page, /web-payroll-adjust/);
  assert.doesNotMatch(page, /attendance\/adjustments|attendance\/record/);
});
