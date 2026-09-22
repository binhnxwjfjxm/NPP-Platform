import { randomUUID } from 'node:crypto';

const OVERTIME_COLUMNS = `r.id, r.installation_id, r.employee_id,
  to_char(r.work_date, 'YYYY-MM-DD') AS work_date,
  r.requested_minutes, r.reason, r.policy_id_snapshot, r.policy_code_snapshot,
  r.policy_version_snapshot, r.overtime_requires_approval_snapshot, r.status,
  r.requested_by_actor_id, r.requested_by_employee_id,
  r.reviewed_by_actor_id, r.review_reason, r.reviewed_at,
  r.actual_minutes, r.actual_note, r.actual_recorded_by_actor_id, r.actual_recorded_at,
  r.confirmed_minutes, r.confirm_note, r.confirmed_by_actor_id, r.confirmed_at,
  r.version, r.request_id, r.created_at, r.updated_at`;

const OVERTIME_RETURNING_COLUMNS = `id, installation_id, employee_id,\n  to_char(work_date, 'YYYY-MM-DD') AS work_date,\n  requested_minutes, reason, policy_id_snapshot, policy_code_snapshot,\n  policy_version_snapshot, overtime_requires_approval_snapshot, status,\n  requested_by_actor_id, requested_by_employee_id,\n  reviewed_by_actor_id, review_reason, reviewed_at,\n  actual_minutes, actual_note, actual_recorded_by_actor_id, actual_recorded_at,\n  confirmed_minutes, confirm_note, confirmed_by_actor_id, confirmed_at,\n  version, request_id, created_at, updated_at`;\n\nconst PERIOD_COLUMNS = `p.id, p.installation_id, p.branch_id, p.scope_key,
  to_char(p.period_start, 'YYYY-MM-DD') AS period_start,
  to_char(p.period_end, 'YYYY-MM-DD') AS period_end,
  p.status, p.issue_summary, p.source_fingerprint, p.reconciled_fingerprint,
  p.reconciled_by_actor_id, p.reconciled_at, p.reconciliation_note,
  p.closed_by_actor_id, p.closed_at, p.lock_id, p.revision, p.request_id,
  p.created_at, p.updated_at, p.created_by, p.updated_by`;

function overtimeFilters(params, {
  employeeId = null, employeeQuery = null, status = null,
  dateFrom = null, dateTo = null, branchId = null, branchIds = null,
}) {
  let filters = '';
  if (employeeId) { params.push(employeeId); filters += ` AND r.employee_id = $${params.length}::uuid`; }
  if (employeeQuery) {
    params.push(`%${employeeQuery}%`);
    filters += ` AND (e.code ILIKE $${params.length} OR e.full_name ILIKE $${params.length})`;
  }
  if (status) { params.push(status); filters += ` AND r.status = $${params.length}`; }
  if (dateFrom) { params.push(dateFrom); filters += ` AND r.work_date >= $${params.length}::date`; }
  if (dateTo) { params.push(dateTo); filters += ` AND r.work_date <= $${params.length}::date`; }
  if (branchId) { params.push(branchId); filters += ` AND assignment.branch_id = $${params.length}::uuid`; }
  else if (Array.isArray(branchIds)) { params.push(branchIds); filters += ` AND assignment.branch_id = ANY($${params.length}::uuid[])`; }
  return filters;
}

const OVERTIME_ORG_JOINS = `
  JOIN shared.employees e
    ON e.installation_id = r.installation_id AND e.id = r.employee_id
  LEFT JOIN LATERAL (
    SELECT a.branch_id
      FROM shared.employee_assignments a
     WHERE a.installation_id = r.installation_id
       AND a.employee_id = r.employee_id
       AND a.effective_from <= r.work_date
       AND (a.effective_to IS NULL OR a.effective_to >= r.work_date)
     ORDER BY a.effective_from DESC
     LIMIT 1
  ) assignment ON true
  LEFT JOIN shared.branches b
    ON b.installation_id = r.installation_id AND b.id = assignment.branch_id`;

export async function listOvertimeRequests(client, values) {
  const params = [values.installationId];
  const filters = overtimeFilters(params, values);
  const count = await client.query(
    `SELECT COUNT(*)::integer AS total
       FROM shared.overtime_requests r
       ${OVERTIME_ORG_JOINS}
      WHERE r.installation_id = $1${filters}`,
    params,
  );
  const pageParams = [...params, values.limit, values.offset];
  const limitIndex = pageParams.length - 1;
  const offsetIndex = pageParams.length;
  const rows = await client.query(
    `SELECT ${OVERTIME_COLUMNS},
            e.code AS employee_code, e.full_name AS employee_name,
            assignment.branch_id AS employee_branch_id,
            b.code AS branch_code, b.name AS branch_name
       FROM shared.overtime_requests r
       ${OVERTIME_ORG_JOINS}
      WHERE r.installation_id = $1${filters}
      ORDER BY r.work_date DESC, r.created_at DESC, r.id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    pageParams,
  );
  return { total: count.rows?.[0]?.total ?? 0, rows: rows.rows ?? [] };
}

export async function getOvertimeRequestById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${OVERTIME_COLUMNS}
       FROM shared.overtime_requests r
      WHERE r.installation_id = $1 AND r.id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function findActiveOvertimeForEmployeeDate(client, { installationId, employeeId, workDate }) {
  const result = await client.query(
    `SELECT ${OVERTIME_COLUMNS}
       FROM shared.overtime_requests r
      WHERE r.installation_id = $1
        AND r.employee_id = $2
        AND r.work_date = $3::date
        AND r.status <> 'REJECTED'
      ORDER BY r.created_at DESC
      LIMIT 1`,
    [installationId, employeeId, workDate],
  );
  return result.rows?.[0] ?? null;
}

export async function insertOvertimeRequest(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.overtime_requests (
       id, installation_id, employee_id, work_date, requested_minutes, reason,
       policy_id_snapshot, policy_code_snapshot, policy_version_snapshot,
       overtime_requires_approval_snapshot, status,
       requested_by_actor_id, requested_by_employee_id,
       reviewed_by_actor_id, review_reason, reviewed_at,
       version, request_id, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1,$17,now(),now()
     )
     RETURNING ${OVERTIME_RETURNING_COLUMNS}`,
    [id, values.installationId, values.employeeId, values.workDate, values.requestedMinutes,
      values.reason, values.policyId, values.policyCode, values.policyVersion,
      values.requiresApproval, values.status, values.actorId, values.employeeId,
      values.reviewedByActorId, values.reviewReason, values.reviewedAt, values.requestId],
  );
  return result.rows?.[0] ?? null;
}

export async function reviewOvertimeRequest(client, {
  installationId, id, expectedVersion, nextStatus, actorId, reviewReason,
}) {
  const result = await client.query(
    `UPDATE shared.overtime_requests
        SET status = $4,
            reviewed_by_actor_id = $5,
            review_reason = $6,
            reviewed_at = now(),
            version = version + 1,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND version = $3 AND status = 'SUBMITTED'
      RETURNING ${OVERTIME_RETURNING_COLUMNS}`,
    [installationId, id, expectedVersion, nextStatus, actorId, reviewReason],
  );
  return result.rows?.[0] ?? null;
}

export async function recordOvertimeActual(client, {
  installationId, id, expectedVersion, actualMinutes, actualNote, actorId,
}) {
  const result = await client.query(
    `UPDATE shared.overtime_requests
        SET status = 'ACTUAL_RECORDED',
            actual_minutes = $4,
            actual_note = $5,
            actual_recorded_by_actor_id = $6,
            actual_recorded_at = now(),
            version = version + 1,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND version = $3 AND status = 'APPROVED'
      RETURNING ${OVERTIME_RETURNING_COLUMNS}`,
    [installationId, id, expectedVersion, actualMinutes, actualNote, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function confirmOvertimeRequest(client, {
  installationId, id, expectedVersion, confirmedMinutes, confirmNote, actorId,
}) {
  const result = await client.query(
    `UPDATE shared.overtime_requests
        SET status = 'CONFIRMED',
            confirmed_minutes = $4,
            confirm_note = $5,
            confirmed_by_actor_id = $6,
            confirmed_at = now(),
            version = version + 1,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND version = $3 AND status = 'ACTUAL_RECORDED'
      RETURNING ${OVERTIME_RETURNING_COLUMNS}`,
    [installationId, id, expectedVersion, confirmedMinutes, confirmNote, actorId],
  );
  return result.rows?.[0] ?? null;
}

function overtimeScopeSql(branchId, branchIds, params) {
  if (branchId) {
    params.push(branchId);
    return ` AND assignment.branch_id = $${params.length}::uuid`;
  }
  if (Array.isArray(branchIds)) {
    params.push(branchIds);
    return ` AND assignment.branch_id = ANY($${params.length}::uuid[])`;
  }
  return '';
}

export async function listConfirmedOvertimeForPeriod(client, {
  installationId, dateFrom, dateTo, branchId = null, branchIds = null,
}) {
  const params = [installationId, dateFrom, dateTo];
  const scope = overtimeScopeSql(branchId, branchIds, params);
  const result = await client.query(
    `SELECT r.employee_id, COALESCE(SUM(r.confirmed_minutes), 0)::integer AS confirmed_minutes
       FROM shared.overtime_requests r
       LEFT JOIN LATERAL (
         SELECT a.branch_id
           FROM shared.employee_assignments a
          WHERE a.installation_id = r.installation_id
            AND a.employee_id = r.employee_id
            AND a.effective_from <= r.work_date
            AND (a.effective_to IS NULL OR a.effective_to >= r.work_date)
          ORDER BY a.effective_from DESC LIMIT 1
       ) assignment ON true
      WHERE r.installation_id = $1
        AND r.work_date BETWEEN $2::date AND $3::date
        AND r.status = 'CONFIRMED'${scope}
      GROUP BY r.employee_id`,
    params,
  );
  return result.rows ?? [];
}

export async function countOutstandingOvertimeForPeriod(client, {
  installationId, dateFrom, dateTo, branchId = null, branchIds = null,
}) {
  const params = [installationId, dateFrom, dateTo];
  const scope = overtimeScopeSql(branchId, branchIds, params);
  const result = await client.query(
    `SELECT COUNT(*)::integer AS total
       FROM shared.overtime_requests r
       LEFT JOIN LATERAL (
         SELECT a.branch_id
           FROM shared.employee_assignments a
          WHERE a.installation_id = r.installation_id
            AND a.employee_id = r.employee_id
            AND a.effective_from <= r.work_date
            AND (a.effective_to IS NULL OR a.effective_to >= r.work_date)
          ORDER BY a.effective_from DESC LIMIT 1
       ) assignment ON true
      WHERE r.installation_id = $1
        AND r.work_date BETWEEN $2::date AND $3::date
        AND r.status IN ('SUBMITTED', 'APPROVED', 'ACTUAL_RECORDED')${scope}`,
    params,
  );
  return result.rows?.[0]?.total ?? 0;
}

export async function getAttendancePeriodByKey(client, {
  installationId, branchId, periodStart, periodEnd, forUpdate = false,
}) {
  const scopeKey = branchId ?? 'COMPANY';
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, b.code AS branch_code, b.name AS branch_name
       FROM shared.attendance_periods p
       LEFT JOIN shared.branches b
         ON b.installation_id = p.installation_id AND b.id = p.branch_id
      WHERE p.installation_id = $1
        AND p.scope_key = $2
        AND p.period_start = $3::date
        AND p.period_end = $4::date${forUpdate ? ' FOR UPDATE OF p' : ''}`,
    [installationId, scopeKey, periodStart, periodEnd],
  );
  return result.rows?.[0] ?? null;
}

export async function getAttendancePeriodById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, b.code AS branch_code, b.name AS branch_name
       FROM shared.attendance_periods p
       LEFT JOIN shared.branches b
         ON b.installation_id = p.installation_id AND b.id = p.branch_id
      WHERE p.installation_id = $1 AND p.id = $2${forUpdate ? ' FOR UPDATE OF p' : ''}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function listAttendancePeriods(client, {
  installationId, branchId = null, branchIds = null, dateFrom = null, dateTo = null,
}) {
  const params = [installationId];
  let filters = '';
  if (branchId) { params.push(branchId); filters += ` AND p.branch_id = $${params.length}::uuid`; }
  else if (Array.isArray(branchIds)) {
    params.push(branchIds);
    filters += ` AND p.branch_id = ANY($${params.length}::uuid[])`;
  }
  if (dateFrom) { params.push(dateFrom); filters += ` AND p.period_end >= $${params.length}::date`; }
  if (dateTo) { params.push(dateTo); filters += ` AND p.period_start <= $${params.length}::date`; }
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, b.code AS branch_code, b.name AS branch_name
       FROM shared.attendance_periods p
       LEFT JOIN shared.branches b
         ON b.installation_id = p.installation_id AND b.id = p.branch_id
      WHERE p.installation_id = $1${filters}
      ORDER BY p.period_start DESC, p.branch_id NULLS FIRST, p.created_at DESC
      LIMIT 100`,
    params,
  );
  return result.rows ?? [];
}

export async function insertAttendancePeriod(client, values) {
  const id = randomUUID();
  const scopeKey = values.branchId ?? 'COMPANY';
  const result = await client.query(
    `INSERT INTO shared.attendance_periods (
       id, installation_id, branch_id, scope_key, period_start, period_end,
       status, issue_summary, source_fingerprint, request_id,
       created_by, updated_by, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8::jsonb,$9,$10,$11,$11,now(),now())
     RETURNING ${PERIOD_COLUMNS}`,
    [id, values.installationId, values.branchId, scopeKey, values.periodStart, values.periodEnd,
      values.status, JSON.stringify(values.issueSummary), values.sourceFingerprint,
      values.requestId, values.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function updateAttendancePeriodAggregation(client, values) {
  const result = await client.query(
    `UPDATE shared.attendance_periods
        SET status = $3,
            issue_summary = $4::jsonb,
            source_fingerprint = $5,
            reconciled_fingerprint = CASE WHEN $3 IN ('AGGREGATING','NEEDS_ACTION') THEN NULL ELSE reconciled_fingerprint END,
            reconciled_by_actor_id = CASE WHEN $3 IN ('AGGREGATING','NEEDS_ACTION') THEN NULL ELSE reconciled_by_actor_id END,
            reconciled_at = CASE WHEN $3 IN ('AGGREGATING','NEEDS_ACTION') THEN NULL ELSE reconciled_at END,
            reconciliation_note = CASE WHEN $3 IN ('AGGREGATING','NEEDS_ACTION') THEN NULL ELSE reconciliation_note END,
            closed_by_actor_id = CASE WHEN $3 IN ('AGGREGATING','NEEDS_ACTION') THEN NULL ELSE closed_by_actor_id END,
            closed_at = CASE WHEN $3 IN ('AGGREGATING','NEEDS_ACTION') THEN NULL ELSE closed_at END,
            request_id = $6,
            updated_by = $7,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2
      RETURNING ${PERIOD_COLUMNS}`,
    [values.installationId, values.id, values.status, JSON.stringify(values.issueSummary),
      values.sourceFingerprint, values.requestId, values.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function reconcileAttendancePeriod(client, values) {
  const result = await client.query(
    `UPDATE shared.attendance_periods
        SET status = 'RECONCILED',
            issue_summary = $3::jsonb,
            source_fingerprint = $4,
            reconciled_fingerprint = $4,
            reconciled_by_actor_id = $5,
            reconciled_at = now(),
            reconciliation_note = $6,
            request_id = $7,
            updated_by = $5,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status <> 'CLOSED'
      RETURNING ${PERIOD_COLUMNS}`,
    [values.installationId, values.id, JSON.stringify(values.issueSummary),
      values.sourceFingerprint, values.actorId, values.note, values.requestId],
  );
  return result.rows?.[0] ?? null;
}

export async function closeAttendancePeriod(client, values) {
  const result = await client.query(
    `UPDATE shared.attendance_periods
        SET status = 'CLOSED',
            issue_summary = $3::jsonb,
            source_fingerprint = $4,
            closed_by_actor_id = $5,
            closed_at = now(),
            lock_id = $6,
            revision = $7,
            request_id = $8,
            updated_by = $5,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND status = 'RECONCILED'
      RETURNING ${PERIOD_COLUMNS}`,
    [values.installationId, values.id, JSON.stringify(values.issueSummary),
      values.sourceFingerprint, values.actorId, values.lockId, values.revision, values.requestId],
  );
  return result.rows?.[0] ?? null;
}

export async function insertAttendancePeriodSnapshot(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.attendance_period_snapshots (
       id, installation_id, period_id, revision, source_fingerprint,
       snapshot, request_id, created_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,now())
     RETURNING id, installation_id, period_id, revision, source_fingerprint,
               snapshot, request_id, created_by, created_at`,
    [id, values.installationId, values.periodId, values.revision,
      values.sourceFingerprint, JSON.stringify(values.snapshot), values.requestId, values.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function getAttendancePeriodSnapshot(client, { installationId, periodId, revision = null }) {
  const params = [installationId, periodId];
  let revisionFilter = '';
  if (revision !== null) { params.push(revision); revisionFilter = ` AND revision = $${params.length}`; }
  const result = await client.query(
    `SELECT id, installation_id, period_id, revision, source_fingerprint,
            snapshot, request_id, created_by, created_at
       FROM shared.attendance_period_snapshots
      WHERE installation_id = $1 AND period_id = $2${revisionFilter}
      ORDER BY revision DESC
      LIMIT 1`,
    params,
  );
  return result.rows?.[0] ?? null;
}

export async function markClosedAttendancePeriodsDirtyForEmployeeRange(client, {
  installationId, employeeId, dateFrom, dateTo, actorId, requestId,
}) {
  const result = await client.query(
    `UPDATE shared.attendance_periods p
        SET status = 'NEEDS_ACTION',
            source_fingerprint = NULL,
            reconciled_fingerprint = NULL,
            reconciled_by_actor_id = NULL,
            reconciled_at = NULL,
            reconciliation_note = NULL,
            closed_by_actor_id = NULL,
            closed_at = NULL,
            issue_summary = jsonb_build_object('postCloseCorrection', true),
            request_id = $5,
            updated_by = $4,
            updated_at = now()
      WHERE p.installation_id = $1
        AND p.status = 'CLOSED'
        AND p.period_start <= $3::date
        AND p.period_end >= $2::date
        AND (
          p.branch_id IS NULL
          OR EXISTS (
            SELECT 1
              FROM shared.employee_assignments a
             WHERE a.installation_id = p.installation_id
               AND a.employee_id = $6
               AND a.branch_id = p.branch_id
               AND a.effective_from <= LEAST(p.period_end, $3::date)
               AND (a.effective_to IS NULL OR a.effective_to >= GREATEST(p.period_start, $2::date))
          )
        )
      RETURNING p.id`,
    [installationId, dateFrom, dateTo, actorId, requestId, employeeId],
  );
  return result.rows ?? [];
}
