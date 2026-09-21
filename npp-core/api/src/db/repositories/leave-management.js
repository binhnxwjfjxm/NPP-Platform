import { randomUUID } from 'node:crypto';

const LEAVE_TYPE_COLUMNS = `id, installation_id, code, name, is_active, is_paid,
  counts_as_workday, requires_approval, allows_full_day, allows_half_day,
  requires_attachment, version, created_at, updated_at, created_by, updated_by`;

const LEAVE_REQUEST_COLUMNS = `r.id, r.installation_id, r.employee_id, r.leave_type_id,
  r.leave_type_code_snapshot, r.leave_type_name_snapshot, r.leave_is_paid_snapshot,
  r.leave_counts_as_workday_snapshot, r.leave_requires_approval_snapshot,
  r.date_from, r.date_to, r.day_part, r.reason, r.attachment_reference,
  r.status, r.requested_by_actor_id, r.requested_by_employee_id,
  r.reviewed_by_actor_id, r.review_reason, r.reviewed_at,
  r.cancelled_by_actor_id, r.cancel_reason, r.cancelled_at,
  r.version, r.request_id, r.created_at, r.updated_at,
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
  if (employeeId) { params.push(employeeId); sql += ` AND r.employee_id = $${params.length}`; }
  if (employeeQuery) {
    params.push(employeeQuery);
    sql += ` AND (position(lower($${params.length}) in lower(e.code)) > 0 OR position(lower($${params.length}) in lower(e.full_name)) > 0)`;
  }
  if (branchId) { params.push(branchId); sql += ` AND e.branch_id = $${params.length}`; }
  if (Array.isArray(branchIds)) { params.push(branchIds); sql += ` AND e.branch_id = ANY($${params.length}::uuid[])`; }
  if (status) { params.push(status); sql += ` AND r.status = $${params.length}`; }
  if (dateFrom) { params.push(dateFrom); sql += ` AND r.date_to >= $${params.length}::date`; }
  if (dateTo) { params.push(dateTo); sql += ` AND r.date_from <= $${params.length}::date`; }
  return sql;
}

export async function listLeaveTypes(client, { installationId, includeInactive = false }) {
  const result = await client.query(
    `SELECT ${LEAVE_TYPE_COLUMNS}
       FROM shared.leave_types
      WHERE installation_id = $1${includeInactive ? '' : ' AND is_active = true'}
      ORDER BY is_active DESC, name ASC, code ASC`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function getLeaveTypeById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${LEAVE_TYPE_COLUMNS}
       FROM shared.leave_types
      WHERE installation_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function findLeaveTypeByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${LEAVE_TYPE_COLUMNS}
       FROM shared.leave_types
      WHERE installation_id = $1 AND code = $2
      LIMIT 1`,
    [installationId, code],
  );
  return result.rows?.[0] ?? null;
}

export async function insertLeaveType(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.leave_types (
       id, installation_id, code, name, is_active, is_paid, counts_as_workday,
       requires_approval, allows_full_day, allows_half_day, requires_attachment,
       version, created_at, updated_at, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,now(),now(),$12,$12)
     RETURNING ${LEAVE_TYPE_COLUMNS}`,
    [id, values.installationId, values.code, values.name, values.isActive, values.isPaid,
      values.countsAsWorkday, values.requiresApproval, values.allowsFullDay,
      values.allowsHalfDay, values.requiresAttachment, values.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function updateLeaveType(client, values) {
  const result = await client.query(
    `UPDATE shared.leave_types
        SET name = $4, is_active = $5, is_paid = $6, counts_as_workday = $7,
            requires_approval = $8, allows_full_day = $9, allows_half_day = $10,
            requires_attachment = $11, version = version + 1,
            updated_at = now(), updated_by = $12
      WHERE installation_id = $1 AND id = $2 AND version = $3
      RETURNING ${LEAVE_TYPE_COLUMNS}`,
    [values.installationId, values.id, values.expectedVersion, values.name, values.isActive,
      values.isPaid, values.countsAsWorkday, values.requiresApproval, values.allowsFullDay,
      values.allowsHalfDay, values.requiresAttachment, values.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function listLeaveRequests(client, {
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
  const filters = requestFilters(params, { employeeId, employeeQuery, branchId, branchIds, status, dateFrom, dateTo });
  const count = await client.query(
    `SELECT COUNT(*)::integer AS total
       FROM shared.leave_requests r
       JOIN shared.employees e ON e.installation_id = r.installation_id AND e.id = r.employee_id
      WHERE r.installation_id = $1${filters}`,
    params,
  );
  const pageParams = [...params, limit, offset];
  const limitIndex = pageParams.length - 1;
  const offsetIndex = pageParams.length;
  const rows = await client.query(
    `SELECT ${LEAVE_REQUEST_COLUMNS}
       FROM shared.leave_requests r
       JOIN shared.employees e ON e.installation_id = r.installation_id AND e.id = r.employee_id
       LEFT JOIN shared.branches b ON b.installation_id = e.installation_id AND b.id = e.branch_id
      WHERE r.installation_id = $1${filters}
      ORDER BY r.date_from DESC, r.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    pageParams,
  );
  return { total: count.rows?.[0]?.total ?? 0, rows: rows.rows ?? [] };
}

export async function findOverlappingLeaveRequest(client, {
  installationId, employeeId, dateFrom, dateTo, dayPart, excludeId = null,
}) {
  const params = [installationId, employeeId, dateFrom, dateTo, dayPart];
  let exclude = '';
  if (excludeId) { params.push(excludeId); exclude = ` AND r.id <> $${params.length}`; }
  const result = await client.query(
    `SELECT r.id, r.status, r.date_from, r.date_to, r.day_part
       FROM shared.leave_requests r
      WHERE r.installation_id = $1
        AND r.employee_id = $2
        AND r.status IN ('SUBMITTED', 'APPROVED')
        AND r.date_from <= $4::date
        AND r.date_to >= $3::date
        AND (
          $5 = 'FULL_DAY'
          OR r.day_part = 'FULL_DAY'
          OR (r.date_from = $3::date AND r.date_to = $4::date AND r.day_part = $5)
        )${exclude}
      ORDER BY r.created_at ASC
      LIMIT 1`,
    params,
  );
  return result.rows?.[0] ?? null;
}

export async function insertLeaveRequest(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.leave_requests (
       id, installation_id, employee_id, leave_type_id,
       leave_type_code_snapshot, leave_type_name_snapshot, leave_is_paid_snapshot,
       leave_counts_as_workday_snapshot, leave_requires_approval_snapshot,
       date_from, date_to, day_part, reason, attachment_reference, status,
       requested_by_actor_id, requested_by_employee_id,
       reviewed_by_actor_id, review_reason, reviewed_at,
       version, request_id, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,1,$21,now(),now()
     )
     RETURNING id, installation_id, employee_id, leave_type_id,
       leave_type_code_snapshot, leave_type_name_snapshot, leave_is_paid_snapshot,
       leave_counts_as_workday_snapshot, leave_requires_approval_snapshot,
       date_from, date_to, day_part, reason, attachment_reference, status,
       requested_by_actor_id, requested_by_employee_id, reviewed_by_actor_id,
       review_reason, reviewed_at, cancelled_by_actor_id, cancel_reason, cancelled_at,
       version, request_id, created_at, updated_at`,
    [id, values.installationId, values.employeeId, values.leaveTypeId,
      values.leaveTypeCodeSnapshot, values.leaveTypeNameSnapshot, values.leaveIsPaidSnapshot,
      values.leaveCountsAsWorkdaySnapshot, values.leaveRequiresApprovalSnapshot,
      values.dateFrom, values.dateTo, values.dayPart, values.reason, values.attachmentReference,
      values.status, values.requestedByActorId, values.requestedByEmployeeId,
      values.reviewedByActorId, values.reviewReason, values.reviewedAt, values.requestId],
  );
  return result.rows?.[0] ?? null;
}

export async function getLeaveRequestById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${LEAVE_REQUEST_COLUMNS}
       FROM shared.leave_requests r
       JOIN shared.employees e ON e.installation_id = r.installation_id AND e.id = r.employee_id
       LEFT JOIN shared.branches b ON b.installation_id = e.installation_id AND b.id = e.branch_id
      WHERE r.installation_id = $1 AND r.id = $2${forUpdate ? ' FOR UPDATE OF r' : ''}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function reviewLeaveRequest(client, {
  installationId, id, expectedVersion, nextStatus, reviewerActorId, reviewReason,
}) {
  const result = await client.query(
    `UPDATE shared.leave_requests
        SET status = $4, reviewed_by_actor_id = $5, review_reason = $6,
            reviewed_at = now(), version = version + 1, updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND version = $3 AND status = 'SUBMITTED'
      RETURNING id, installation_id, employee_id, leave_type_id,
        leave_type_code_snapshot, leave_type_name_snapshot, leave_is_paid_snapshot,
        leave_counts_as_workday_snapshot, leave_requires_approval_snapshot,
        date_from, date_to, day_part, reason, attachment_reference, status,
        requested_by_actor_id, requested_by_employee_id, reviewed_by_actor_id,
        review_reason, reviewed_at, cancelled_by_actor_id, cancel_reason, cancelled_at,
        version, request_id, created_at, updated_at`,
    [installationId, id, expectedVersion, nextStatus, reviewerActorId, reviewReason],
  );
  return result.rows?.[0] ?? null;
}

export async function cancelLeaveRequest(client, {
  installationId, id, expectedVersion, allowedStatuses, actorId, cancelReason,
}) {
  const result = await client.query(
    `UPDATE shared.leave_requests
        SET status = 'CANCELLED', cancelled_by_actor_id = $5, cancel_reason = $6,
            cancelled_at = now(), version = version + 1, updated_at = now()
      WHERE installation_id = $1 AND id = $2 AND version = $3 AND status = ANY($4::text[])
      RETURNING id, installation_id, employee_id, leave_type_id,
        leave_type_code_snapshot, leave_type_name_snapshot, leave_is_paid_snapshot,
        leave_counts_as_workday_snapshot, leave_requires_approval_snapshot,
        date_from, date_to, day_part, reason, attachment_reference, status,
        requested_by_actor_id, requested_by_employee_id, reviewed_by_actor_id,
        review_reason, reviewed_at, cancelled_by_actor_id, cancel_reason, cancelled_at,
        version, request_id, created_at, updated_at`,
    [installationId, id, expectedVersion, allowedStatuses, actorId, cancelReason],
  );
  return result.rows?.[0] ?? null;
}
