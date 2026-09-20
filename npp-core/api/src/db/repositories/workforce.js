import { randomUUID } from 'node:crypto';

const POLICY_COLUMNS = `id, installation_id, code, version, name, work_nature, time_mode,
  fixed_start_time, fixed_end_time, working_days, break_minutes, late_grace_minutes,
  early_leave_grace_minutes, overtime_enabled, overtime_requires_approval, attendance_method,
  timezone, rounding_minutes, minimum_full_day_minutes, minimum_half_day_minutes,
  effective_from, effective_to, supersedes_policy_id, is_active, created_at, created_by`;

const ASSIGNMENT_COLUMNS = `a.id, a.installation_id, a.employee_id, a.work_policy_id,
  a.effective_from, a.effective_to, a.reason, a.created_at, a.created_by,
  p.code AS policy_code, p.version AS policy_version, p.name AS policy_name,
  p.time_mode AS policy_time_mode, p.attendance_method AS policy_attendance_method,
  p.timezone AS policy_timezone`;

const SCHEDULE_COLUMNS = `s.id, s.installation_id, s.employee_id, s.work_policy_id,
  s.work_date, s.schedule_kind, s.scheduled_start_at, s.scheduled_end_at, s.source,
  s.override_reason, s.created_at, s.updated_at, s.created_by, s.updated_by,
  e.code AS employee_code, e.full_name AS employee_name, e.branch_id AS employee_branch_id,
  p.code AS policy_code, p.version AS policy_version, p.name AS policy_name, p.timezone AS policy_timezone`;

export async function listWorkPolicies(client, { installationId }) {
  const result = await client.query(
    `SELECT ${POLICY_COLUMNS}
       FROM shared.work_policies
      WHERE installation_id = $1
      ORDER BY code ASC, version DESC`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function getWorkPolicyById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${POLICY_COLUMNS}
       FROM shared.work_policies
      WHERE installation_id = $1 AND id = $2`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function getWorkPolicyByIdForUpdate(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${POLICY_COLUMNS}
       FROM shared.work_policies
      WHERE installation_id = $1 AND id = $2
      FOR UPDATE`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function getLatestWorkPolicyVersionForUpdate(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${POLICY_COLUMNS}
       FROM shared.work_policies
      WHERE installation_id = $1 AND code = $2
      ORDER BY version DESC
      LIMIT 1
      FOR UPDATE`,
    [installationId, code],
  );
  return result.rows?.[0] ?? null;
}

export async function closeWorkPolicyVersion(client, { installationId, id, effectiveTo }) {
  await client.query(
    `UPDATE shared.work_policies
        SET effective_to = $3
      WHERE installation_id = $1 AND id = $2`,
    [installationId, id, effectiveTo],
  );
}

export async function insertWorkPolicy(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.work_policies (
       id, installation_id, code, version, name, work_nature, time_mode,
       fixed_start_time, fixed_end_time, working_days, break_minutes, late_grace_minutes,
       early_leave_grace_minutes, overtime_enabled, overtime_requires_approval,
       attendance_method, timezone, rounding_minutes, minimum_full_day_minutes,
       minimum_half_day_minutes, effective_from, effective_to, supersedes_policy_id,
       is_active, created_at, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::smallint[],$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,true,now(),$24
     )
     RETURNING ${POLICY_COLUMNS}`,
    [
      id, values.installationId, values.code, values.version, values.name, values.workNature,
      values.timeMode, values.fixedStartTime, values.fixedEndTime, values.workingDays,
      values.breakMinutes, values.lateGraceMinutes, values.earlyLeaveGraceMinutes,
      values.overtimeEnabled, values.overtimeRequiresApproval, values.attendanceMethod,
      values.timezone, values.roundingMinutes, values.minimumFullDayMinutes,
      values.minimumHalfDayMinutes, values.effectiveFrom, values.effectiveTo,
      values.supersedesPolicyId, values.createdBy,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function getEmployeeScopeRecord(client, { installationId, employeeId, lock = 'share' }) {
  const suffix = lock === 'update' ? ' FOR UPDATE' : lock === 'share' ? ' FOR SHARE' : '';
  const result = await client.query(
    `SELECT id, code, full_name, branch_id, is_active
       FROM shared.employees
      WHERE installation_id = $1 AND id = $2${suffix}`,
    [installationId, employeeId],
  );
  return result.rows?.[0] ?? null;
}

export async function listEmployeePolicyAssignments(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT ${ASSIGNMENT_COLUMNS}
       FROM shared.employee_work_policy_assignments a
       JOIN shared.work_policies p
         ON p.installation_id = a.installation_id AND p.id = a.work_policy_id
      WHERE a.installation_id = $1 AND a.employee_id = $2
      ORDER BY a.effective_from DESC, a.created_at DESC`,
    [installationId, employeeId],
  );
  return result.rows ?? [];
}

export async function getLatestEmployeePolicyAssignmentForUpdate(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT id, installation_id, employee_id, work_policy_id, effective_from, effective_to,
            reason, created_at, created_by
       FROM shared.employee_work_policy_assignments
      WHERE installation_id = $1 AND employee_id = $2
      ORDER BY effective_from DESC, created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [installationId, employeeId],
  );
  return result.rows?.[0] ?? null;
}

export async function closeEmployeePolicyAssignment(client, { installationId, id, effectiveTo }) {
  await client.query(
    `UPDATE shared.employee_work_policy_assignments
        SET effective_to = $3
      WHERE installation_id = $1 AND id = $2`,
    [installationId, id, effectiveTo],
  );
}

export async function insertEmployeePolicyAssignment(client, values) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO shared.employee_work_policy_assignments (
       id, installation_id, employee_id, work_policy_id, effective_from, effective_to,
       reason, created_at, created_by
     ) VALUES ($1,$2,$3,$4,$5,NULL,$6,now(),$7)`,
    [id, values.installationId, values.employeeId, values.workPolicyId, values.effectiveFrom, values.reason, values.createdBy],
  );
  const rows = await listEmployeePolicyAssignments(client, {
    installationId: values.installationId,
    employeeId: values.employeeId,
  });
  return rows.find((row) => row.id === id) ?? null;
}

export async function getEffectiveEmployeePolicyAssignment(client, { installationId, employeeId, workDate }) {
  const result = await client.query(
    `SELECT ${ASSIGNMENT_COLUMNS}
       FROM shared.employee_work_policy_assignments a
       JOIN shared.work_policies p
         ON p.installation_id = a.installation_id AND p.id = a.work_policy_id
      WHERE a.installation_id = $1
        AND a.employee_id = $2
        AND a.effective_from <= $3
        AND (a.effective_to IS NULL OR a.effective_to >= $3)
        AND p.effective_from <= $3
        AND (p.effective_to IS NULL OR p.effective_to >= $3)
        AND p.is_active = true
      ORDER BY a.effective_from DESC, p.version DESC
      LIMIT 1`,
    [installationId, employeeId, workDate],
  );
  return result.rows?.[0] ?? null;
}

export async function listWorkSchedules(client, {
  installationId,
  employeeId = null,
  dateFrom,
  dateTo,
  branchIds = null,
}) {
  const params = [installationId, dateFrom, dateTo];
  let query = `SELECT ${SCHEDULE_COLUMNS}
       FROM shared.work_schedules s
       JOIN shared.employees e
         ON e.installation_id = s.installation_id AND e.id = s.employee_id
       LEFT JOIN shared.work_policies p
         ON p.installation_id = s.installation_id AND p.id = s.work_policy_id
      WHERE s.installation_id = $1 AND s.work_date BETWEEN $2 AND $3`;
  if (employeeId) {
    params.push(employeeId);
    query += ` AND s.employee_id = $${params.length}`;
  }
  if (Array.isArray(branchIds)) {
    params.push(branchIds);
    query += ` AND e.branch_id = ANY($${params.length}::uuid[])`;
  }
  query += ' ORDER BY s.work_date ASC, e.code ASC';
  const result = await client.query(query, params);
  return result.rows ?? [];
}

export async function getWorkScheduleById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${SCHEDULE_COLUMNS}
       FROM shared.work_schedules s
       JOIN shared.employees e
         ON e.installation_id = s.installation_id AND e.id = s.employee_id
       LEFT JOIN shared.work_policies p
         ON p.installation_id = s.installation_id AND p.id = s.work_policy_id
      WHERE s.installation_id = $1 AND s.id = $2`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function getWorkScheduleForEmployeeDateForUpdate(client, { installationId, employeeId, workDate }) {
  const result = await client.query(
    `SELECT id, installation_id, employee_id, work_policy_id, work_date, schedule_kind,
            scheduled_start_at, scheduled_end_at, source, override_reason,
            created_at, updated_at, created_by, updated_by
       FROM shared.work_schedules
      WHERE installation_id = $1 AND employee_id = $2 AND work_date = $3
      FOR UPDATE`,
    [installationId, employeeId, workDate],
  );
  return result.rows?.[0] ?? null;
}

export async function insertWorkSchedule(client, values) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO shared.work_schedules (
       id, installation_id, employee_id, work_policy_id, work_date, schedule_kind,
       scheduled_start_at, scheduled_end_at, source, override_reason,
       created_at, updated_at, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OVERRIDE',$9,now(),now(),$10,$10)`,
    [
      id, values.installationId, values.employeeId, values.workPolicyId, values.workDate,
      values.scheduleKind, values.scheduledStartAt, values.scheduledEndAt, values.overrideReason, values.actorId,
    ],
  );
  return getWorkScheduleById(client, { installationId: values.installationId, id });
}

export async function updateWorkSchedule(client, values) {
  const result = await client.query(
    `UPDATE shared.work_schedules
        SET work_policy_id = $4,
            schedule_kind = $5,
            scheduled_start_at = $6,
            scheduled_end_at = $7,
            source = 'OVERRIDE',
            override_reason = $8,
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
            updated_by = $9
      WHERE installation_id = $1
        AND employee_id = $2
        AND work_date = $3
        AND updated_at = $10
      RETURNING id`,
    [
      values.installationId, values.employeeId, values.workDate, values.workPolicyId,
      values.scheduleKind, values.scheduledStartAt, values.scheduledEndAt,
      values.overrideReason, values.actorId, values.expectedUpdatedAt,
    ],
  );
  if (!result.rows?.[0]) return null;
  return getWorkScheduleById(client, { installationId: values.installationId, id: result.rows[0].id });
}
