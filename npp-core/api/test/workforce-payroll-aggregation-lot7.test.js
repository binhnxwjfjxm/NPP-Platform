import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePayrollSnapshot } from '../src/services/payroll-aggregation.js';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

const period = {
  id: '10000000-0000-4000-8000-000000000001',
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  branch_id: null,
  currency_code: 'VND',
  attendance_revision: 1,
};

test('Issue #1140 Lô 7 calculates money exactly from closed attendance inputs without floating point money arithmetic', () => {
  const result = calculatePayrollSnapshot({
    period,
    attendanceSnapshot: {
      employees: [{
        employeeId: '20000000-0000-4000-8000-000000000001',
        employeeCode: 'NV001',
        employeeName: 'Nhân sự A',
        workDays: 20,
        completedDays: 18,
        paidLeaveDays: 1,
        unpaidLeaveDays: 1,
        confirmedOvertimeMinutes: 120,
        incompleteDays: 0,
        unexcusedAbsenceDays: 0,
        violationDays: 0,
      }],
    },
    salaryProfiles: [{
      id: '30000000-0000-4000-8000-000000000001',
      employee_id: '20000000-0000-4000-8000-000000000001',
      monthly_salary: '10000000.00',
      currency_code: 'VND',
      effective_from: '2026-01-01',
      effective_to: null,
    }],
    fixedComponents: [{
      id: '40000000-0000-4000-8000-000000000001',
      employee_id: '20000000-0000-4000-8000-000000000001',
      component_type_id: '50000000-0000-4000-8000-000000000001',
      amount: '1000000.00',
      effective_from: '2026-01-01',
      effective_to: null,
      component_code: 'PC',
      component_name: 'Phụ cấp',
      category: 'INCOME',
      prorate_by_workdays: true,
      include_in_gross: true,
      include_in_net: true,
      type_effective_from: '2026-01-01',
      type_effective_to: null,
    }],
    periodComponents: [
      {
        id: '60000000-0000-4000-8000-000000000001',
        employee_id: '20000000-0000-4000-8000-000000000001',
        component_type_id: '70000000-0000-4000-8000-000000000001',
        amount: '500000.00',
        component_code: 'THUONG',
        component_name: 'Thưởng',
        category: 'INCOME',
        include_in_gross: true,
        include_in_net: true,
        source: 'MANUAL',
      },
      {
        id: '60000000-0000-4000-8000-000000000002',
        employee_id: '20000000-0000-4000-8000-000000000001',
        component_type_id: '70000000-0000-4000-8000-000000000002',
        amount: '200000.00',
        component_code: 'HOANCHI',
        component_name: 'Hoàn chi',
        category: 'REIMBURSEMENT',
        include_in_gross: false,
        include_in_net: true,
        source: 'MANUAL',
      },
      {
        id: '60000000-0000-4000-8000-000000000003',
        employee_id: '20000000-0000-4000-8000-000000000001',
        component_type_id: '70000000-0000-4000-8000-000000000003',
        amount: '100000.00',
        component_code: 'KHAUTRU',
        component_name: 'Khấu trừ',
        category: 'DEDUCTION',
        include_in_gross: false,
        include_in_net: true,
        source: 'MANUAL',
      },
    ],
  });
  const row = result.snapshot.rows[0];
  assert.equal(row.salaryAmount, '9500000.00');
  assert.equal(row.incomeTotal, '1450000.00');
  assert.equal(row.reimbursementTotal, '200000.00');
  assert.equal(row.deductionTotal, '100000.00');
  assert.equal(row.grossIncome, '10950000.00');
  assert.equal(row.netPay, '11050000.00');
  assert.equal(result.issueSummary.warnings.confirmedOvertimeEmployees, 1);
});


test('completed workdays stay fully payable even when attendance carries informational violation counts', () => {
  const result = calculatePayrollSnapshot({
    period,
    attendanceSnapshot: {
      employees: [{
        employeeId: '20000000-0000-4000-8000-000000000009',
        employeeCode: 'NV009',
        employeeName: 'Nhân sự linh hoạt',
        workDays: 1,
        completedDays: 1,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        confirmedOvertimeMinutes: 0,
        incompleteDays: 0,
        unexcusedAbsenceDays: 0,
        violationDays: 1,
      }],
    },
    salaryProfiles: [{
      id: '30000000-0000-4000-8000-000000000009',
      employee_id: '20000000-0000-4000-8000-000000000009',
      monthly_salary: '1000000.00',
      currency_code: 'VND',
      effective_from: '2026-01-01',
      effective_to: null,
    }],
    fixedComponents: [],
    periodComponents: [],
  });
  const row = result.snapshot.rows[0];
  assert.equal(row.standardWorkDays, 1);
  assert.equal(row.payableWorkDays, 1);
  assert.equal(row.salaryAmount, '1000000.00');
});

test('Issue #1140 Lô 7 blocks reconciliation inputs when salary or fixed effective-date coverage is ambiguous', () => {
  const result = calculatePayrollSnapshot({
    period,
    attendanceSnapshot: {
      employees: [{
        employeeId: '20000000-0000-4000-8000-000000000002',
        employeeCode: 'NV002',
        employeeName: 'Nhân sự B',
        workDays: 20,
        completedDays: 20,
        paidLeaveDays: 0,
        confirmedOvertimeMinutes: 0,
      }],
    },
    salaryProfiles: [],
    fixedComponents: [{
      id: '40000000-0000-4000-8000-000000000002',
      employee_id: '20000000-0000-4000-8000-000000000002',
      component_type_id: '50000000-0000-4000-8000-000000000002',
      amount: '500000.00',
      effective_from: '2026-09-15',
      effective_to: null,
      component_code: 'PC2',
      component_name: 'Phụ cấp giữa kỳ',
      category: 'INCOME',
      prorate_by_workdays: false,
      include_in_gross: true,
      include_in_net: true,
      type_effective_from: '2026-01-01',
      type_effective_to: null,
    }],
    periodComponents: [],
  });
  assert.equal(result.issueSummary.blockers.missingSalaryProfiles, 1);
  assert.equal(result.issueSummary.blockers.fixedComponentCoverageConflicts, 1);
  assert.ok(result.blockerTotal >= 2);
});

test('Issue #1140 Lô 7 persists append-only calculation revisions and reconciliation lineage', async () => {
  const [migration, repository, service] = await Promise.all([
    source('../../database/migrations/shared/155_workforce_payroll_aggregation.sql'),
    source('src/db/repositories/payroll-aggregation.js'),
    source('src/services/payroll-aggregation.js'),
  ]);
  assert.match(migration, /payroll_calculation_snapshots/);
  assert.match(migration, /payroll_calculation_snapshots_are_append_only/);
  assert.match(migration, /reconciled_fingerprint/);
  assert.match(repository, /attendance_period_snapshots/);
  assert.match(repository, /markPayrollPeriodsDirtyForEmployeeFromDate/);
  assert.match(service, /createHash\('sha256'\)/);
  assert.match(service, /PAYROLL_PERIOD_HAS_BLOCKERS/);
  assert.match(service, /PAYROLL_WARNINGS_UNACKNOWLEDGED/);
  assert.doesNotMatch(service, /Number\([^\n]*(monthly_salary|\.amount)/);
  assert.doesNotMatch(service, /UPDATE shared\.attendance_/);
});
