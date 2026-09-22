import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 6 pins payroll periods to immutable closed attendance snapshots', async () => {
  const [migration, service, repository] = await Promise.all([
    source('../../database/migrations/shared/154_workforce_payroll_foundation.sql'),
    source('src/services/payroll-foundation.js'),
    source('src/db/repositories/payroll-foundation.js'),
  ]);
  assert.match(migration, /FOREIGN KEY \(installation_id, attendance_period_id, attendance_revision\)/);
  assert.match(migration, /REFERENCES shared\.attendance_period_snapshots \(installation_id, period_id, revision\)/);
  assert.match(migration, /attendance_source_fingerprint/);
  assert.match(service, /source\.status !== 'CLOSED'/);
  assert.match(service, /sourceFingerprint: source\.source_fingerprint/);
  assert.match(service, /getPayrollPeriodEmployee/);
  assert.match(repository, /jsonb_array_elements\(COALESCE\(s\.snapshot->'employees'/);
  assert.doesNotMatch(service, /UPDATE shared\.attendance_/);
});

test('Issue #1140 Lô 6 keeps money exact and salary plus fixed components effective-dated', async () => {
  const [migration, repository, service] = await Promise.all([
    source('../../database/migrations/shared/154_workforce_payroll_foundation.sql'),
    source('src/db/repositories/payroll-foundation.js'),
    source('src/services/payroll-foundation.js'),
  ]);
  assert.match(migration, /monthly_salary numeric\(18,2\)/);
  assert.match(migration, /amount numeric\(18,2\)/);
  assert.match(migration, /payroll_salary_profiles_one_open_idx/);
  assert.match(migration, /payroll_employee_fixed_components_one_open_idx/);
  assert.match(repository, /monthly_salary::text AS monthly_salary/);
  assert.match(repository, /amount::text AS amount/);
  assert.match(service, /closeSalaryProfile/);
  assert.match(service, /closeFixedComponent/);
  assert.match(service, /previousDate\(effectiveFrom\)/);
});

test('Issue #1140 Lô 6 lets Công Ty define payroll components without hard-coded bonus names', async () => {
  const migration = await source('../../database/migrations/shared/154_workforce_payroll_foundation.sql');
  assert.match(migration, /category IN \('INCOME', 'DEDUCTION', 'REIMBURSEMENT'\)/);
  assert.match(migration, /recurrence IN \('FIXED', 'PERIOD'\)/);
  assert.match(migration, /input_mode IN \('AUTOMATIC', 'MANUAL'\)/);
  assert.match(migration, /prorate_by_workdays boolean/);
  assert.match(migration, /include_in_gross boolean/);
  assert.match(migration, /include_in_net boolean/);
  assert.doesNotMatch(migration, /THUONG_DOANH_SO|CONG_TAC_PHI|PHU_CAP_XANG/);
});

test('Issue #1140 Lô 6 period entries are append-only and reimbursements remain a separate category', async () => {
  const migration = await source('../../database/migrations/shared/154_workforce_payroll_foundation.sql');
  assert.match(migration, /payroll_period_components_are_append_only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON shared\.payroll_period_components/);
  assert.match(migration, /REIMBURSEMENT/);
  assert.match(migration, /Payroll never mutates attendance source data/);
});

test('Issue #1140 Lô 6 uses deny-by-default payroll permissions and shared idempotent audit path', async () => {
  const [permissions, routes] = await Promise.all([
    source('src/access/permissions.js'),
    source('src/routes/workforce.js'),
  ]);
  assert.match(permissions, /corePayrollRead: 'core\.payroll\.read'/);
  assert.match(permissions, /corePayrollManage: 'core\.payroll\.manage'/);
  assert.match(routes, /route === '\/payroll'/);
  assert.match(routes, /canManagePayroll \|\| canClosePayroll \|\| canAdjustPayroll/);
  assert.match(routes, /canReadPayroll \|\| canManagePayroll \|\| canClosePayroll \|\| canAdjustPayroll \|\| canExportPayroll/);
  assert.match(routes, /runIdempotentMutation\(req, res, context/);
  assert.match(routes, /route: '\/api\/workforce\/payroll'/);
  assert.match(routes, /withAuditOutboxTransaction/);
});
