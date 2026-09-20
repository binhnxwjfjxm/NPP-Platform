import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 1 keeps canonical employee identity and current scope model', async () => {
  const [employees, users, authRepo, requestContext, decision] = await Promise.all([
    source('../../database/migrations/shared/007_hr_employees.sql'),
    source('../../database/migrations/shared/009_access_users_role_assignments.sql'),
    source('src/db/repositories/internal-workforce-auth.js'),
    source('src/request-context-base.js'),
    source('../../docs/operations/issue-1110-workforce-attendance-foundation.md'),
  ]);

  assert.match(employees, /CREATE TABLE IF NOT EXISTS shared\.employees/);
  assert.match(users, /employee_id uuid NOT NULL/);
  assert.match(users, /REFERENCES shared\.employees \(installation_id, id\)/);
  assert.match(users, /NEW\.employee_id IS DISTINCT FROM OLD\.employee_id/);
  assert.match(authRepo, /e\.id AS employee_id/);
  assert.match(authRepo, /JOIN shared\.employees e/);
  assert.match(requestContext, /employeeId: typeof principal\.employeeId/);
  assert.match(requestContext, /branchIds: frozenStrings\(scopes\.branchIds\)/);
  assert.doesNotMatch(requestContext, /teamIds:/);
  assert.match(decision, /không tự tạo TEAM scope/);
});

test('Issue #1110 Lô 1 registers workforce permissions deny-by-default', async () => {
  const [permissions, requestContext, migration] = await Promise.all([
    source('src/access/permissions.js'),
    source('src/request-context-base.js'),
    source('../../database/migrations/shared/140_workforce_attendance_foundation.sql'),
  ]);

  for (const permission of [
    'core.work-policy.read',
    'core.work-policy.manage',
    'core.work-schedule.read',
    'core.work-schedule.manage',
    'core.attendance.self.read',
    'core.attendance.self.record',
    'core.attendance.read',
    'core.attendance.adjust',
  ]) {
    assert.match(permissions, new RegExp(permission.replaceAll('.', '\\.')));
    assert.match(migration, new RegExp(permission.replaceAll('.', '\\.')));
  }

  assert.match(permissions, /WORKFORCE_PERMISSION_CATALOG/);
  assert.match(permissions, /PERMISSION_REGISTRY = new Set\(PERMISSION_CATALOG/);
  assert.match(requestContext, /PERMISSIONS\.coreAttendanceSelfRecord/);
  assert.match(requestContext, /PERMISSIONS\.coreAttendanceAdjust/);
});

test('Issue #1110 Lô 1 migration versions policy and preserves attendance event lineage', async () => {
  const migration = await source('../../database/migrations/shared/140_workforce_attendance_foundation.sql');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.work_policies/);
  assert.match(migration, /version integer NOT NULL/);
  assert.match(migration, /UNIQUE \(installation_id, code, version\)/);
  assert.match(migration, /effective_from date NOT NULL/);
  assert.match(migration, /supersedes_policy_id uuid NULL/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.employee_work_policy_assignments/);
  assert.match(migration, /REFERENCES shared\.employees \(installation_id, id\)/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.work_schedules/);
  assert.match(migration, /scheduled_start_at timestamptz NULL/);
  assert.match(migration, /scheduled_end_at timestamptz NULL/);
  assert.match(migration, /scheduled_end_at > scheduled_start_at/);
  assert.match(migration, /source IN \('POLICY', 'OVERRIDE'\)/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared\.attendance_events/);
  assert.match(migration, /event_type IN \('CHECK_IN', 'CHECK_OUT'\)/);
  assert.match(migration, /source IN \('QR', 'MANUAL', 'ADJUSTMENT', 'SYSTEM'\)/);
  assert.match(migration, /validation_status IN \('VALID', 'PENDING', 'INVALID'\)/);
  assert.match(migration, /recorded_by text NOT NULL/);
  assert.match(migration, /request_id text NOT NULL/);
  assert.match(migration, /attendance_events_source_reference_unique/);

  assert.doesNotMatch(migration, /\b(?:sales|inventory|purchasing|logistics|mcp)\./i);
});

test('Issue #1110 Lô 1 is registered after current migration 139 and reuses canonical platform contracts', async () => {
  const [registry, decision, idempotency, audit] = await Promise.all([
    source('src/migrations/index.js'),
    source('../../docs/operations/issue-1110-workforce-attendance-foundation.md'),
    source('src/idempotency-derived.js'),
    source('src/audit-outbox.js'),
  ]);

  const oldIndex = registry.indexOf("139_inventory_stocktake_line_annotation");
  const newIndex = registry.indexOf("140_workforce_attendance_foundation");
  assert.ok(oldIndex >= 0 && newIndex > oldIndex);

  assert.match(idempotency, /createIdempotencyKey.*from '@npp\/contracts'/s);
  assert.match(audit, /shared\.core_audit_records/);
  assert.match(audit, /shared\.core_outbox_events/);
  assert.match(decision, /không tạo idempotency\/audit\/outbox riêng/);
  assert.match(decision, /withAuditOutboxTransaction/);
});
