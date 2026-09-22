import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyPayrollAdjustment } from '../src/services/payroll-closeout.js';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 8 freezes reconciled payroll into append-only close and payslip snapshots', async () => {
  const [migration, service] = await Promise.all([
    source('../../database/migrations/shared/156_workforce_payroll_closeout.sql'),
    source('src/services/payroll-closeout.js'),
  ]);
  assert.match(migration, /payroll_close_snapshots/);
  assert.match(migration, /payroll_payslip_snapshots/);
  assert.match(migration, /payroll_adjustments/);
  assert.match(migration, /payroll_closeout_history_is_append_only/);
  assert.match(service, /source\.status !== 'RECONCILED'/);
  assert.match(service, /reconciled_fingerprint !== source\.calculation_fingerprint/);
  assert.match(service, /buildPayrollCalculation/);
  assert.doesNotMatch(service, /UPDATE shared\.attendance_/);
});

test('Issue #1140 Lô 8 adjustment keeps exact decimal money and creates a new payslip revision', () => {
  const before = {
    period: { from: '2026-09-01', to: '2026-09-30' },
    employee: { id: 'e', code: 'NV1', name: 'A' },
    pay: {
      incomeTotal: '100.00',
      reimbursementTotal: '0.00',
      deductionTotal: '50.00',
      grossIncome: '10100.00',
      netPay: '10050.00',
    },
    adjustments: [],
  };
  const after = applyPayrollAdjustment(before, {
    id: 'a1',
    componentTypeId: 'c1',
    componentCode: 'KT',
    componentName: 'Khấu trừ',
    category: 'DEDUCTION',
    includeInGross: false,
    includeInNet: true,
    direction: 'ADD',
    amount: '100.01',
    reason: 'Đối soát bổ sung',
    actorId: 'actor',
    requestId: 'req',
  });
  assert.equal(after.pay.deductionTotal, '150.01');
  assert.equal(after.pay.netPay, '9949.99');
  assert.equal(before.pay.netPay, '10050.00');
  assert.equal(after.adjustments.length, 1);
});

test('Issue #1140 Lô 8 separates close, adjust and export permissions and keeps audit/outbox route ownership', async () => {
  const [permissions, route] = await Promise.all([
    source('src/access/permissions.js'),
    source('src/routes/workforce.js'),
  ]);
  for (const permission of ['core.payroll.close', 'core.payroll.adjust', 'core.payroll.export']) {
    assert.match(permissions, new RegExp(permission.replace(/\./g, '\\.')));
  }
  assert.match(route, /command === 'CLOSE'/);
  assert.match(route, /command === 'ADJUST'/);
  assert.match(route, /payrollCloseoutService\.mutatePayrollCloseout/);
  assert.match(route, /runIdempotentMutation/);
});
