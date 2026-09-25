import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assignWorkPolicy, createWorkPolicyVersion, effectiveDateOnly } from '../src/services/workforce.js';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Issue #1110 Lô 2 exposes workforce policy, assignment, and schedule routes', async () => {
  const [server, route, service, repository] = await Promise.all([
    source('src/server.js'),
    source('src/routes/workforce.js'),
    source('src/services/workforce.js'),
    source('src/db/repositories/workforce.js'),
  ]);

  assert.match(server, /handleWorkforceRoutes/);
  for (const path of ['/policies', '/assignments', '/schedules']) assert.match(route, new RegExp(path.replace('/', '\\/')));
  assert.match(route, /coreWorkPolicyRead/);
  assert.match(route, /coreWorkPolicyManage/);
  assert.match(route, /coreWorkScheduleRead/);
  assert.match(route, /coreWorkScheduleManage/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(repository, /shared\.work_policies/);
  assert.match(repository, /shared\.employee_work_policy_assignments/);
  assert.match(repository, /shared\.work_schedules/);
  assert.match(service, /POLICY_VERSION_CONFLICT/);
  assert.match(service, /ASSIGNMENT_EFFECTIVE_DATE_CONFLICT/);
  assert.match(service, /HISTORICAL_SCHEDULE_LOCKED/);
});

test('Issue #1110 Lô 2 uses explicit scope authority instead of deriving company scope from role names', async () => {
  const [context, auth, route] = await Promise.all([
    source('src/request-context-base.js'),
    source('src/internal-workforce-auth.js'),
    source('src/routes/workforce.js'),
  ]);

  assert.match(context, /scopeAuthority: principal\.scopeAuthority === 'COMPANY'/);
  assert.match(context, /scopeAuthority: 'COMPANY'/);
  assert.match(auth, /scopeAuthority: authorization\.ownerKind \? 'COMPANY' : 'ASSIGNED'/);
  assert.match(route, /requestContext\.scopeAuthority === 'COMPANY'/);
  assert.doesNotMatch(route, /COMPANY_SCOPE_ROLES/);
  assert.match(route, /requestContext\.scopes\.branchIds/);
});

test('Issue #1110 Lô 2 makes employee PATCH idempotent with the canonical store', async () => {
  const route = await source('src/routes/employees.js');
  const idempotency = await source('src/idempotency.js');

  assert.match(route, /async function handlePatch/);
  assert.match(route, /requireIdempotencyKey\(req\)/);
  assert.match(route, /route: `\/api\/employees\/\$\{id\}`/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(idempotency, /IDEMPOTENCY_KEY_PATTERN/);
});

test('Issue #1110 Lô 2 preserves policy history and blocks retroactive schedule edits', async () => {
  const service = await source('src/services/workforce.js');

  assert.match(service, /version = latest \? Number\(latest\.version\) \+ 1 : 1/);
  assert.match(service, /previousDate\(validation\.normalized\.effectiveFrom\)/);
  assert.match(service, /effectiveFrom < localDate\(\)/);
  assert.match(service, /workDate <= localDate\(\)/);
  assert.match(service, /expectedUpdatedAt/);
  assert.match(service, /SCHEDULE_CONFLICT/);
});

test('Issue #1110 resolves the policy version effective on each work date without losing the assignment family', async () => {
  const [workforceRepo, timesheetRepo, planningRepo, leaveRepo] = await Promise.all([
    source('src/db/repositories/workforce.js'),
    source('src/db/repositories/attendance-timesheet.js'),
    source('src/db/repositories/workforce-planning.js'),
    source('src/db/repositories/leave-management.js'),
  ]);

  assert.match(workforceRepo, /JOIN shared\.work_policies assigned_policy/);
  assert.match(workforceRepo, /effective_policy\.code = assigned_policy\.code/);
  assert.match(workforceRepo, /p\.id AS work_policy_id/);
  assert.match(timesheetRepo, /candidate\.code = assigned_policy\.code/);
  assert.match(planningRepo, /p\.code = assigned_policy\.code/);
  assert.match(planningRepo, /p\.id AS work_policy_id/);
  assert.match(leaveRepo, /candidate\.code = assigned_policy\.code/);
});


test('Issue #1110 normalizes PostgreSQL effective dates before workforce comparisons', async () => {
  assert.equal(effectiveDateOnly('2026-09-20'), '2026-09-20');
  assert.equal(effectiveDateOnly('2026-09-20T00:00:00.000Z'), '2026-09-20');
  assert.equal(effectiveDateOnly(new Date('2026-09-20T00:00:00.000Z')), '2026-09-20');

  const service = await source('src/services/workforce.js');
  assert.match(service, /policyEffectiveFrom > effectiveFrom/);
  assert.match(service, /policyEffectiveTo < effectiveFrom/);
  assert.match(service, /policyEffectiveFrom > workDate/);
  assert.doesNotMatch(service, /String\([^\n)]*effective_(?:from|to)/);
});


function companyToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

test('Issue #1110 same-day work-policy edits create a new version while keeping the old policy row for existing assignments', async () => {
  const today = companyToday();
  const policyId = '11111111-1111-4111-8111-111111111111';
  const existing = {
    id: policyId,
    installation_id: 'npp-production',
    code: 'OFFICE',
    version: 1,
    name: 'Văn phòng cũ',
    work_nature: null,
    time_mode: 'FIXED',
    fixed_start_time: '08:00:00',
    fixed_end_time: '17:00:00',
    working_days: [1, 2, 3, 4, 5],
    break_minutes: 60,
    late_grace_minutes: 0,
    early_leave_grace_minutes: 0,
    overtime_enabled: false,
    overtime_requires_approval: true,
    attendance_method: 'QR',
    attendance_basis: 'TIME',
    timezone: 'Asia/Ho_Chi_Minh',
    rounding_minutes: 0,
    minimum_full_day_minutes: null,
    minimum_half_day_minutes: null,
    effective_from: today,
    effective_to: null,
    supersedes_policy_id: null,
    is_active: true,
    created_at: new Date().toISOString(),
    created_by: 'owner',
  };
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ sql, params });
      if (sql.includes('FROM shared.work_policies') && sql.includes('id = $2') && sql.includes('FOR UPDATE')) {
        return { rows: [existing] };
      }
      if (sql.includes('FROM shared.work_policies') && sql.includes('ORDER BY version DESC') && sql.includes('FOR UPDATE')) {
        return { rows: [existing] };
      }
      if (sql.includes('UPDATE shared.work_policies') && sql.includes('SET effective_to = $3')) {
        assert.equal(params[2], today);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO shared.work_policies')) {
        return { rows: [{
          ...existing,
          id: '66666666-6666-4666-8666-666666666666',
          version: 2,
          name: 'Văn phòng mới',
          attendance_method: 'ALL',
          supersedes_policy_id: policyId,
        }] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };

  const result = await createWorkPolicyVersion(client, {
    installationId: 'npp-production',
    actorId: 'owner',
    payload: {
      basePolicyId: policyId,
      name: 'Văn phòng mới',
      workNature: '',
      timeMode: 'FIXED',
      fixedStartTime: '08:00',
      fixedEndTime: '17:00',
      workingDays: [1, 2, 3, 4, 5],
      breakMinutes: 60,
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
      overtimeEnabled: false,
      overtimeRequiresApproval: true,
      attendanceMethod: 'ALL',
      attendanceBasis: 'TIME',
      timezone: 'Asia/Ho_Chi_Minh',
      roundingMinutes: 0,
      minimumFullDayMinutes: null,
      minimumHalfDayMinutes: null,
      effectiveFrom: today,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'version');
  assert.equal(result.policy.version, 2);
  assert.equal(result.policy.supersedes_policy_id, policyId);
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO shared.work_policies')));
  assert.ok(statements.some(({ sql, params }) => sql.includes('SET effective_to = $3') && params[2] === today));
  assert.ok(!statements.some(({ sql }) => sql.includes('SET name = $3')));
});
test('Issue #1110 same-day employee policy changes replace that date assignment without closing it to yesterday', async () => {
  const today = companyToday();
  const employeeId = '22222222-2222-4222-8222-222222222222';
  const oldPolicyId = '33333333-3333-4333-8333-333333333333';
  const newPolicyId = '44444444-4444-4444-8444-444444444444';
  const assignmentId = '55555555-5555-4555-8555-555555555555';
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push(sql);
      if (sql.includes('FROM shared.employees e')) {
        return { rows: [{ id: employeeId, code: 'NV001', full_name: 'Nhân viên 1', branch_id: null, is_active: true }] };
      }
      if (sql.includes('FROM shared.work_policies') && sql.includes('id = $2') && !sql.includes('FOR UPDATE')) {
        return { rows: [{
          id: newPolicyId,
          installation_id: 'npp-production',
          code: 'OFFICE',
          version: 1,
          name: 'Văn phòng',
          effective_from: today,
          effective_to: null,
          is_active: true,
        }] };
      }
      if (sql.includes('FROM shared.employee_work_policy_assignments') && sql.includes('ORDER BY effective_from DESC') && sql.includes('FOR UPDATE')) {
        return { rows: [{
          id: assignmentId,
          installation_id: 'npp-production',
          employee_id: employeeId,
          work_policy_id: oldPolicyId,
          effective_from: today,
          effective_to: null,
          reason: null,
          created_at: new Date().toISOString(),
          created_by: 'owner',
        }] };
      }
      if (sql.includes('UPDATE shared.employee_work_policy_assignments') && sql.includes('SET work_policy_id = $3')) {
        return { rows: [{ id: assignmentId }] };
      }
      if (sql.includes('FROM shared.employee_work_policy_assignments a') && sql.includes('JOIN shared.work_policies p')) {
        return { rows: [{
          id: assignmentId,
          installation_id: 'npp-production',
          employee_id: employeeId,
          work_policy_id: newPolicyId,
          effective_from: today,
          effective_to: null,
          reason: 'Đổi phương thức chấm công',
          created_at: new Date().toISOString(),
          created_by: 'owner',
          policy_code: 'OFFICE',
          policy_version: 1,
          policy_name: 'Văn phòng',
          policy_time_mode: 'FIXED',
          policy_attendance_method: 'ALL',
          policy_attendance_basis: 'TIME',
          policy_timezone: 'Asia/Ho_Chi_Minh',
        }] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };

  const result = await assignWorkPolicy(client, {
    installationId: 'npp-production',
    actorId: 'owner',
    payload: {
      employeeId,
      workPolicyId: newPolicyId,
      effectiveFrom: today,
      reason: 'Đổi phương thức chấm công',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'update');
  assert.equal(result.assignment.id, assignmentId);
  assert.equal(result.assignment.work_policy_id, newPolicyId);
  assert.ok(statements.some((sql) => sql.includes('SET work_policy_id = $3')));
  assert.ok(!statements.some((sql) => sql.includes('INSERT INTO shared.employee_work_policy_assignments')));
  assert.ok(!statements.some((sql) => sql.includes('SET effective_to = $3')));
});
