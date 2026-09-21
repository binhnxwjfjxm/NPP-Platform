import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

test('Issue #1140 Lô 4 adds an append-only leave balance ledger without mutable remaining balance', async () => {
  const [migration, registry] = await Promise.all([
    source('../../database/migrations/shared/152_workforce_leave_balance_ledger.sql'),
    source('src/migrations/index.js'),
  ]);
  assert.match(registry, /152_workforce_leave_balance_ledger/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.leave_balance_ledger/);
  assert.match(migration, /entry_type IN \('OPENING_GRANT', 'ACCRUAL', 'USAGE', 'ADJUSTMENT', 'CARRY_OVER', 'EXPIRY', 'COMPENSATORY', 'REVERSAL'\)/);
  assert.match(migration, /reject_leave_balance_history_mutation/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON shared\.leave_balance_ledger/);
  const schemaSql = migration.replace(/--.*$/gm, '');
  assert.doesNotMatch(schemaSql, /remaining_leave|remaining_balance/i);
});

test('Issue #1140 Lô 4 snapshots balance policy on leave requests and keeps old types opt-in', async () => {
  const migration = await source('../../database/migrations/shared/152_workforce_leave_balance_ledger.sql');
  assert.match(migration, /tracks_balance boolean NOT NULL DEFAULT false/);
  assert.match(migration, /allow_negative_balance boolean NOT NULL DEFAULT false/);
  assert.match(migration, /leave_tracks_balance_snapshot boolean NOT NULL DEFAULT false/);
  assert.match(migration, /leave_allow_negative_balance_snapshot boolean NOT NULL DEFAULT false/);
});

test('Issue #1140 Lô 4 charges leave only on scheduled work days and respects Công Ty days off', async () => {
  const repository = await source('src/db/repositories/leave-management.js');
  assert.match(repository, /listChargeableLeaveDays/);
  assert.match(repository, /shared\.work_schedules/);
  assert.match(repository, /shared\.company_calendar_days/);
  assert.match(repository, /schedule\.source/);
  assert.match(repository, /policy\.working_days/);
  assert.match(repository, /schedule\.schedule_kind = 'WORK'/);
});

test('Issue #1140 Lô 4 uses dated employee scope for requests and ledger history', async () => {
  const [repository, service] = await Promise.all([
    source('src/db/repositories/leave-management.js'),
    source('src/services/leave-management.js'),
  ]);
  assert.match(repository, /shared\.employee_assignments/);
  assert.match(repository, /assignment\.effective_from <= ledger\.effective_date/);
  assert.match(repository, /entry_assignment\.branch_id = ANY/);
  assert.match(service, /leavePeriodScope/);
  assert.match(service, /EMPLOYEE_NOT_EMPLOYED_ON_LEAVE_DATE/);
  assert.match(service, /businessDateValue: normalized\.value\.effectiveDate/);
});

test('Issue #1140 Lô 4 posts usage and reversal entries instead of rewriting balance history', async () => {
  const [repository, service] = await Promise.all([
    source('src/db/repositories/leave-management.js'),
    source('src/services/leave-management.js'),
  ]);
  assert.match(service, /entryType: 'USAGE'/);
  assert.match(service, /entryType: 'REVERSAL'/);
  assert.match(service, /listUsageEntriesForRequest/);
  assert.match(service, /insertLeaveBalanceEntries/);
  assert.match(service, /LEAVE_BALANCE_INSUFFICIENT/);
  assert.match(service, /effectiveDate: String\(usage\.effective_date\)/);
  assert.match(repository, /getMinimumLeaveBalanceFromDate/);
  assert.match(service, /minimumFutureBalance/);
});

test('Issue #1140 Lô 4 exposes a dedicated audited and idempotent leave balance API', async () => {
  const route = await source('src/routes/workforce.js');
  assert.match(route, /'\/leave\/balances\/entries'/);
  assert.match(route, /handleLeaveBalanceEntry/);
  assert.match(route, /postLeaveBalanceEntry/);
  assert.match(route, /post-leave-balance-entry/);
  assert.match(route, /resourceType: 'leave-balance-entry'/);
  assert.match(route, /runIdempotentMutation/);
  assert.match(route, /withAuditOutboxTransaction/);
});
