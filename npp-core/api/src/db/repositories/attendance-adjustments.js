import { randomUUID } from 'node:crypto';

const ADJUSTMENT_DETAIL_COLUMNS = `r.id, r.installation_id, r.employee_id, r.work_date,
  r.requested_check_in_at, r.requested_check_out_at, r.reason, r.request_source,
  r.status, r.requested_by_actor_id, r.requested_by_employee_id,
  r.reviewed_by_actor_id, r.review_reason, r.reviewed_at, r.version,
  r.request_id, r.created_at, r.updated_at,
  e.code AS employee_code, e.full_name AS employee_name, e.branch_id AS employee_branch_id,
  b.code AS branch_code, b.name AS branch_name`;

function requestFilters(params, {
  employeeId = null,
  employeeQuery = null,
  branchId = null,
  branchIds = null,
  status = null,
  dateFrom = null,
  dateTo = null,
}) {
  let sql = '';
  if (employeeId) {
    params.push(employeeId);
    sql += ` AND r.employee_id = $${params.length}`;
  }
  if (employeeQuery) {
    params.push(employeeQuery);
    sql += ` AND (
      position(lower($${params.length}) in lower(e.code)) > 0
      OR position(lower($${params.length}) in lower(e.full_name)) > 0
    )`;
  }
  if (branchId) {
    params.push(branchId);
    sql += ` AND e.branch_id = $${params.length}`;
  }
  if (Array.isArray(branchIds)) {
    params.push(branchIds);
    sql += ` AND e.branch_id = ANY($${params.length}::uuid[])`;
  }
  if (status) {
    params.push(status);
    sql += ` AND r.status = $${params.length}`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    sql += ` AND r.work_date >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    sql += ` AND r.work_date <= $${params.length}::date`;
  }
  return sql;
}

export async function listAdjustmentRequests(client, {
  installationId,
  employeeId = null,
  employeeQuery = null,
  branchId = null,
  branchIds = null,
  status = null,
  dateFrom = null,
  dateTo = null,
  limit = 50,
  offset = 0,
}) {
  const params = [installationId];
  const filters = requestFilters(params, {
    employeeId, employeeQuery, branchId, branchIds, status, dateFrom, dateTo,
  });
  const count = await client.query(
    `SELECT COUNT(*)::integer AS total
       FROM shared.attendance_adjustment_requests r
       JOIN shared.employees e
         ON e.installation_id = r.installation_id AND e.id = r.employee_id
      WHERE r.installation_id = $1${filters}`,
    params,
  );
  const pageParams = [...params, limit, offset];
  const limitIndex = pageParams.length - 1;
  const offsetIndex = pageParams.length;
  const rows = await client.query(
    `SELECT ${ADJUSTMENT_DETAIL_COLUMNS}
       FROM shared.attendance_adjustment_requests r
       JOIN shared.employees e
         ON e.installation_id = r.installation_id AND e.id = r.employee_id
       LEFT JOIN shared.branches b
         ON b.installation_id = e.installation_id AND b.id = e.branch_id
      WHERE r.installation_id = $1${filters}
      ORDER BY r.work_date DESC, r.created_at DESC, r.id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    pageParams,
  );
  return { rows: rows.rows ?? [], total: Number(count.rows?.[0]?.total ?? 0) };
}

export async function getAdjustmentRequestById(client, {
  installationId,
  id,
  forUpdate = false,
}) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const result = await client.query(
    `SELECT id, installation_id, employee_id, work_date,
            requested_check_in_at, requested_check_out_at, reason, request_source,
            status, requested_by_actor_id, requested_by_employee_id,
            reviewed_by_actor_id, review_reason, reviewed_at, version,
            request_id, created_at, updated_at
       FROM shared.attendance_adjustment_requests
      WHERE installation_id = $1 AND id = $2${suffix}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function getAdjustmentRequestDetailById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${ADJUSTMENT_DETAIL_COLUMNS}
       FROM shared.attendance_adjustment_requests r
       JOIN shared.employees e
         ON e.installation_id = r.installation_id AND e.id = r.employee_id
       LEFT JOIN shared.branches b
         ON b.installation_id = e.installation_id AND b.id = e.branch_id
      WHERE r.installation_id = $1 AND r.id = $2`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function findPendingAdjustmentRequest(client, {
  installationId,
  employeeId,
  workDate,
}) {
  const result = await client.query(
    `SELECT id, status, version
       FROM shared.attendance_adjustment_requests
      WHERE installation_id = $1
        AND employee_id = $2
        AND work_date = $3
        AND status = 'SUBMITTED'
      ORDER BY created_at DESC
      LIMIT 1`,
    [installationId, employeeId, workDate],
  );
  return result.rows?.[0] ?? null;
}

export async function insertAdjustmentRequest(client, values) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO shared.attendance_adjustment_requests (
       id, installation_id, employee_id, work_date,
       requested_check_in_at, requested_check_out_at, reason,
       request_source, status, requested_by_actor_id, requested_by_employee_id,
       reviewed_by_actor_id, review_reason, reviewed_at,
       version, request_id, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,now(),now()
     )`,
    [
      id,
      values.installationId,
      values.employeeId,
      values.workDate,
      values.requestedCheckInAt,
      values.requestedCheckOutAt,
      values.reason,
      values.requestSource,
      values.status,
      values.requestedByActorId,
      values.requestedByEmployeeId,
      values.reviewedByActorId,
      values.reviewReason,
      values.reviewedAt,
      values.requestId,
    ],
  );
  return getAdjustmentRequestDetailById(client, { installationId: values.installationId, id });
}

export async function transitionAdjustmentRequest(client, {
  installationId,
  id,
  expectedVersion,
  nextStatus,
  reviewerActorId,
  reviewReason,
}) {
  const result = await client.query(
    `UPDATE shared.attendance_adjustment_requests
        SET status = $4,
            reviewed_by_actor_id = $5,
            review_reason = $6,
            reviewed_at = now(),
            version = version + 1,
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond')
      WHERE installation_id = $1
        AND id = $2
        AND version = $3
        AND status = 'SUBMITTED'
      RETURNING id`,
    [installationId, id, expectedVersion, nextStatus, reviewerActorId, reviewReason],
  );
  if (!result.rows?.[0]) return null;
  return getAdjustmentRequestDetailById(client, { installationId, id });
}

export async function insertAdjustmentEvent(client, values) {
  const id = randomUUID();
  const inserted = await client.query(
    `INSERT INTO shared.attendance_events (
       id, installation_id, employee_id, schedule_id, work_policy_id,
       attendance_point_id, event_type, occurred_at, source, validation_status,
       source_reference, note, recorded_by, request_id, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,NULL,$6,$7,'ADJUSTMENT','VALID',$8,$9,$10,$11,now()
     )
     ON CONFLICT (installation_id, source, source_reference)
     WHERE source_reference IS NOT NULL
     DO NOTHING
     RETURNING id, installation_id, employee_id, schedule_id, work_policy_id,
               attendance_point_id, event_type, occurred_at, source, validation_status,
               source_reference, note, recorded_by, request_id, created_at`,
    [
      id,
      values.installationId,
      values.employeeId,
      values.scheduleId,
      values.workPolicyId,
      values.eventType,
      values.occurredAt,
      values.sourceReference,
      values.note,
      values.actorId,
      values.requestId,
    ],
  );
  if (inserted.rows?.[0]) return inserted.rows[0];
  const existing = await client.query(
    `SELECT id, installation_id, employee_id, schedule_id, work_policy_id,
            attendance_point_id, event_type, occurred_at, source, validation_status,
            source_reference, note, recorded_by, request_id, created_at
       FROM shared.attendance_events
      WHERE installation_id = $1
        AND source = 'ADJUSTMENT'
        AND source_reference = $2`,
    [values.installationId, values.sourceReference],
  );
  return existing.rows?.[0] ?? null;
}

export async function listAttendanceEventsForAudit(client, {
  installationId,
  employeeId,
  fromAt,
  toAt,
}) {
  const result = await client.query(
    `SELECT id, employee_id, schedule_id, work_policy_id, attendance_point_id,
            event_type, occurred_at, source, validation_status, source_reference,
            note, recorded_by, request_id, created_at
       FROM shared.attendance_events
      WHERE installation_id = $1
        AND employee_id = $2
        AND occurred_at >= $3
        AND occurred_at < $4
      ORDER BY occurred_at ASC, created_at ASC, id ASC`,
    [installationId, employeeId, fromAt, toAt],
  );
  return result.rows ?? [];
}

export async function listRequestsForTimesheet(client, {
  installationId,
  employeeIds,
  dateFrom,
  dateTo,
}) {
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) return [];
  const result = await client.query(
    `SELECT id, employee_id, work_date, requested_check_in_at, requested_check_out_at,
            reason, request_source, status, requested_by_actor_id,
            reviewed_by_actor_id, review_reason, reviewed_at, version,
            request_id, created_at, updated_at
       FROM shared.attendance_adjustment_requests
      WHERE installation_id = $1
        AND employee_id = ANY($2::uuid[])
        AND work_date BETWEEN $3::date AND $4::date
      ORDER BY employee_id ASC, work_date ASC, created_at DESC, id DESC`,
    [installationId, employeeIds, dateFrom, dateTo],
  );
  return result.rows ?? [];
}

export async function lockAttendanceMutationScope(client, { installationId }) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [`attendance-period-lock:${installationId}`],
  );
}

export async function getPeriodLockForEmployeeDate(client, {
  installationId,
  branchId,
  workDate,
}) {
  const result = await client.query(
    `SELECT id, installation_id, branch_id, period_start, period_end,
            reason, locked_by_actor_id, request_id, locked_at
       FROM shared.attendance_period_locks
      WHERE installation_id = $1
        AND period_start <= $2::date
        AND period_end >= $2::date
        AND (branch_id IS NULL OR branch_id = $3::uuid)
      ORDER BY (branch_id IS NULL) DESC, locked_at DESC
      LIMIT 1`,
    [installationId, workDate, branchId],
  );
  return result.rows?.[0] ?? null;
}

export async function listPeriodLocksForTimesheet(client, {
  installationId,
  dateFrom,
  dateTo,
}) {
  const result = await client.query(
    `SELECT id, installation_id, branch_id, period_start, period_end,
            reason, locked_by_actor_id, request_id, locked_at
       FROM shared.attendance_period_locks
      WHERE installation_id = $1
        AND period_start <= $3::date
        AND period_end >= $2::date
      ORDER BY period_start DESC, locked_at DESC`,
    [installationId, dateFrom, dateTo],
  );
  return result.rows ?? [];
}

export async function listPeriodLocks(client, {
  installationId,
  branchId = null,
  branchIds = null,
  dateFrom = null,
  dateTo = null,
  limit = 100,
  offset = 0,
}) {
  const params = [installationId];
  let filters = '';
  if (branchId) {
    params.push(branchId);
    filters += ` AND (l.branch_id IS NULL OR l.branch_id = $${params.length})`;
  } else if (Array.isArray(branchIds)) {
    params.push(branchIds);
    filters += ` AND (l.branch_id IS NULL OR l.branch_id = ANY($${params.length}::uuid[]))`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    filters += ` AND l.period_end >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    filters += ` AND l.period_start <= $${params.length}::date`;
  }
  const pageParams = [...params, limit, offset];
  const limitIndex = pageParams.length - 1;
  const offsetIndex = pageParams.length;
  const result = await client.query(
    `SELECT l.id, l.installation_id, l.branch_id, l.period_start, l.period_end,
            l.reason, l.locked_by_actor_id, l.request_id, l.locked_at,
            b.code AS branch_code, b.name AS branch_name
       FROM shared.attendance_period_locks l
       LEFT JOIN shared.branches b
         ON b.installation_id = l.installation_id AND b.id = l.branch_id
      WHERE l.installation_id = $1${filters}
      ORDER BY l.period_start DESC, l.locked_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    pageParams,
  );
  return result.rows ?? [];
}

export async function findOverlappingPeriodLock(client, {
  installationId,
  branchId,
  periodStart,
  periodEnd,
}) {
  const params = [installationId, periodStart, periodEnd];
  let scope = '';
  if (branchId) {
    params.push(branchId);
    scope = ` AND (branch_id IS NULL OR branch_id = $4)`;
  }
  const result = await client.query(
    `SELECT id, branch_id, period_start, period_end, reason, locked_at
       FROM shared.attendance_period_locks
      WHERE installation_id = $1
        AND period_start <= $3::date
        AND period_end >= $2::date
        ${scope}
      ORDER BY locked_at DESC
      LIMIT 1`,
    params,
  );
  return result.rows?.[0] ?? null;
}

export async function insertPeriodLock(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.attendance_period_locks (
       id, installation_id, branch_id, period_start, period_end,
       reason, locked_by_actor_id, request_id, locked_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     RETURNING id, installation_id, branch_id, period_start, period_end,
               reason, locked_by_actor_id, request_id, locked_at`,
    [
      id,
      values.installationId,
      values.branchId,
      values.periodStart,
      values.periodEnd,
      values.reason,
      values.actorId,
      values.requestId,
    ],
  );
  return result.rows?.[0] ?? null;
}
