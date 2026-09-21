import { randomUUID } from 'node:crypto';

const LEAVE_TYPE_COLUMNS = `id, installation_id, code, name, is_active, is_paid,
  counts_as_workday, requires_approval, allows_full_day, allows_half_day,
  requires_attachment, tracks_balance, allow_negative_balance,
  version, created_at, updated_at, created_by, updated_by`;

const LEAVE_REQUEST_COLUMNS = `r.id, r.installation_id, r.employee_id, r.leave_type_id,
  r.leave_type_code_snapshot, r.leave_type_name_snapshot, r.leave_is_paid_snapshot,
  r.leave_counts_as_workday_snapshot, r.leave_requires_approval_snapshot,
  r.leave_tracks_balance_snapshot, r.leave_allow_negative_balance_snapshot,
  r.date_from, r.date_to, r.day_part, r.reason, r.attachment_reference,
  r.status, r.requested_by_actor_id, r.requested_by_employee_id,
  r.reviewed_by_actor_id, r.review_reason, r.reviewed_at,
  r.cancelled_by_actor_id, r.cancel_reason, r.cancelled_at,
  r.version, r.request_id, r.created_at, r.updated_at,
  e.code AS employee_code, e.full_name AS employee_name, org_assignment.branch_id AS employee_branch_id,
  b.code AS branch_code, b.name AS branch_name`;

const LEAVE_REQUEST_ORG_JOINS = `
  LEFT JOIN LATERAL (
    SELECT a.branch_id
      FROM shared.employee_assignments a
     WHERE a.installation_id = r.installation_id
       AND a.employee_id = r.employee_id
       AND a.effective_from <= r.date_from
       AND (a.effective_to IS NULL OR a.effective_to >= r.date_from)
     ORDER BY a.effective_from DESC
     LIMIT 1
  ) org_assignment ON true
  LEFT JOIN shared.branches b
    ON b.installation_id = r.installation_id
   AND b.id = org_assignment.branch_id`;

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
  if (branchId) { params.push(branchId); sql += ` AND org_assignment.branch_id = ${params.length}`; }
  if (Array.isArray(branchIds)) {
    params.push(branchIds);
    sql += ` AND NOT EXISTS (
      SELECT 1
        FROM generate_series(r.date_from, r.date_to, interval '1 day') AS scope_day(work_date)
        LEFT JOIN LATERAL (
          SELECT a.branch_id
            FROM shared.employee_assignments a
           WHERE a.installation_id = r.installation_id
             AND a.employee_id = r.employee_id
             AND a.effective_from <= scope_day.work_date::date
             AND (a.effective_to IS NULL OR a.effective_to >= scope_day.work_date::date)
           ORDER BY a.effective_from DESC
           LIMIT 1
        ) scoped_assignment ON true
       WHERE scoped_assignment.branch_id IS NULL
          OR NOT (scoped_assignment.branch_id = ANY(${params.length}::uuid[]))
    )`;
  }
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
       tracks_balance, allow_negative_balance,
       version, created_at, updated_at, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,now(),now(),$14,$14)
     RETURNING ${LEAVE_TYPE_COLUMNS}`,
    [id, values.installationId, values.code, values.name, values.isActive, values.isPaid,
      values.countsAsWorkday, values.requiresApproval, values.allowsFullDay,
      values.allowsHalfDay, values.requiresAttachment, values.tracksBalance,
      values.allowNegativeBalance, values.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function updateLeaveType(client, values) {
  const result = await client.query(
    `UPDATE shared.leave_types
        SET name = $4, is_active = $5, is_paid = $6, counts_as_workday = $7,
            requires_approval = $8, allows_full_day = $9, allows_half_day = $10,
            requires_attachment = $11, tracks_balance = $12, allow_negative_balance = $13,
            version = version + 1, updated_at = now(), updated_by = $14
      WHERE installation_id = $1 AND id = $2 AND version = $3
      RETURNING ${LEAVE_TYPE_COLUMNS}`,
    [values.installationId, values.id, values.expectedVersion, values.name, values.isActive,
      values.isPaid, values.countsAsWorkday, values.requiresApproval, values.allowsFullDay,
      values.allowsHalfDay, values.requiresAttachment, values.tracksBalance,
      values.allowNegativeBalance, values.actorId],
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
       ${LEAVE_REQUEST_ORG_JOINS}
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
       ${LEAVE_REQUEST_ORG_JOINS}
      WHERE r.installation_id = $1${filters}
      ORDER BY r.date_from DESC, r.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    pageParams,
  );
  return { total: count.rows?.[0]?.total ?? 0, rows: rows.rows ?? [] };
}

export async function listRequestsForTimesheet(client, {
  installationId,
  employeeIds,
  dateFrom,
  dateTo,
}) {
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) return [];
  const result = await client.query(
    `SELECT r.id, r.installation_id, r.employee_id, r.leave_type_id,
            r.leave_type_code_snapshot, r.leave_type_name_snapshot,
            r.leave_is_paid_snapshot, r.leave_counts_as_workday_snapshot,
            r.leave_requires_approval_snapshot,
            to_char(r.date_from, 'YYYY-MM-DD') AS date_from,
            to_char(r.date_to, 'YYYY-MM-DD') AS date_to,
            r.day_part, r.reason, r.attachment_reference, r.status,
            r.reviewed_by_actor_id, r.review_reason, r.reviewed_at,
            r.version, r.request_id, r.created_at, r.updated_at
       FROM shared.leave_requests r
      WHERE r.installation_id = $1
        AND r.employee_id = ANY($2::uuid[])
        AND r.status IN ('SUBMITTED', 'APPROVED')
        AND r.date_to >= $3::date
        AND r.date_from <= $4::date
      ORDER BY r.employee_id ASC, r.date_from ASC, r.created_at ASC`,
    [installationId, employeeIds, dateFrom, dateTo],
  );
  return result.rows ?? [];
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
       leave_tracks_balance_snapshot, leave_allow_negative_balance_snapshot,
       date_from, date_to, day_part, reason, attachment_reference, status,
       requested_by_actor_id, requested_by_employee_id,
       reviewed_by_actor_id, review_reason, reviewed_at,
       version, request_id, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,1,$23,now(),now()
     )
     RETURNING id, installation_id, employee_id, leave_type_id,
       leave_type_code_snapshot, leave_type_name_snapshot, leave_is_paid_snapshot,
       leave_counts_as_workday_snapshot, leave_requires_approval_snapshot,
       leave_tracks_balance_snapshot, leave_allow_negative_balance_snapshot,
       date_from, date_to, day_part, reason, attachment_reference, status,
       requested_by_actor_id, requested_by_employee_id, reviewed_by_actor_id,
       review_reason, reviewed_at, cancelled_by_actor_id, cancel_reason, cancelled_at,
       version, request_id, created_at, updated_at`,
    [id, values.installationId, values.employeeId, values.leaveTypeId,
      values.leaveTypeCodeSnapshot, values.leaveTypeNameSnapshot, values.leaveIsPaidSnapshot,
      values.leaveCountsAsWorkdaySnapshot, values.leaveRequiresApprovalSnapshot,
      values.leaveTracksBalanceSnapshot, values.leaveAllowNegativeBalanceSnapshot,
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
       ${LEAVE_REQUEST_ORG_JOINS}
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


export async function getLeavePeriodScopeRows(client, { installationId, employeeId, dateFrom, dateTo }) {
  const result = await client.query(
    `SELECT to_char(day_value.work_date::date, 'YYYY-MM-DD') AS work_date,
            employment.id AS employment_id,
            assignment.branch_id
       FROM generate_series($3::date, $4::date, interval '1 day') AS day_value(work_date)
       LEFT JOIN LATERAL (
         SELECT x.id
           FROM shared.employee_employments x
          WHERE x.installation_id = $1
            AND x.employee_id = $2
            AND x.effective_from <= day_value.work_date::date
            AND (x.effective_to IS NULL OR x.effective_to >= day_value.work_date::date)
          ORDER BY x.effective_from DESC
          LIMIT 1
       ) employment ON true
       LEFT JOIN LATERAL (
         SELECT x.branch_id
           FROM shared.employee_assignments x
          WHERE x.installation_id = $1
            AND x.employee_id = $2
            AND x.effective_from <= day_value.work_date::date
            AND (x.effective_to IS NULL OR x.effective_to >= day_value.work_date::date)
          ORDER BY x.effective_from DESC
          LIMIT 1
       ) assignment ON true
      ORDER BY day_value.work_date ASC`,
    [installationId, employeeId, dateFrom, dateTo],
  );
  return result.rows ?? [];
}

export async function listChargeableLeaveDays(client, { installationId, employeeId, dateFrom, dateTo, dayPart }) {
  const result = await client.query(
    `SELECT to_char(day_value.work_date::date, 'YYYY-MM-DD') AS work_date,
            CASE WHEN $5 = 'FULL_DAY' THEN 1::numeric ELSE 0.5::numeric END AS units
       FROM generate_series($3::date, $4::date, interval '1 day') AS day_value(work_date)
       LEFT JOIN shared.work_schedules schedule
         ON schedule.installation_id = $1
        AND schedule.employee_id = $2
        AND schedule.work_date = day_value.work_date::date
       LEFT JOIN shared.company_calendar_days calendar_day
         ON calendar_day.installation_id = $1
        AND calendar_day.calendar_date = day_value.work_date::date
        AND calendar_day.is_active = true
       LEFT JOIN LATERAL (
         SELECT assignment.work_policy_id
           FROM shared.employee_work_policy_assignments assignment
           JOIN shared.work_policies assigned_policy
             ON assigned_policy.installation_id = assignment.installation_id
            AND assigned_policy.id = assignment.work_policy_id
          WHERE assignment.installation_id = $1
            AND assignment.employee_id = $2
            AND assignment.effective_from <= day_value.work_date::date
            AND (assignment.effective_to IS NULL OR assignment.effective_to >= day_value.work_date::date)
            AND assigned_policy.effective_from <= day_value.work_date::date
            AND (assigned_policy.effective_to IS NULL OR assigned_policy.effective_to >= day_value.work_date::date)
            AND assigned_policy.is_active = true
          ORDER BY assignment.effective_from DESC, assigned_policy.version DESC
          LIMIT 1
       ) assigned ON true
       LEFT JOIN shared.work_policies policy
         ON policy.installation_id = $1
        AND policy.id = COALESCE(assigned.work_policy_id, schedule.work_policy_id)
      WHERE NOT (calendar_day.id IS NOT NULL AND COALESCE(schedule.source, '') <> 'OVERRIDE')
        AND (
          schedule.schedule_kind = 'WORK'
          OR (
            schedule.schedule_kind IS NULL
            AND policy.id IS NOT NULL
            AND EXTRACT(DOW FROM day_value.work_date)::integer = ANY(policy.working_days)
          )
        )
      ORDER BY day_value.work_date ASC`,
    [installationId, employeeId, dateFrom, dateTo, dayPart],
  );
  return result.rows ?? [];
}

export async function getLeaveBalanceAsOf(client, { installationId, employeeId, leaveTypeId, asOfDate }) {
  const result = await client.query(
    `SELECT COALESCE(SUM(quantity_days), 0)::numeric AS balance_days
       FROM shared.leave_balance_ledger
      WHERE installation_id = $1
        AND employee_id = $2
        AND leave_type_id = $3
        AND effective_date <= $4::date`,
    [installationId, employeeId, leaveTypeId, asOfDate],
  );
  return Number(result.rows?.[0]?.balance_days ?? 0);
}

export async function insertLeaveBalanceEntries(client, {
  installationId, employeeId, leaveTypeId, leaveTypeCodeSnapshot, leaveTypeNameSnapshot,
  entries, actorId, requestId,
}) {
  const inserted = [];
  for (const entry of entries) {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO shared.leave_balance_ledger (
         id, installation_id, employee_id, leave_type_id,
         leave_type_code_snapshot, leave_type_name_snapshot,
         entry_type, quantity_days, effective_date, source_type, source_id,
         reverses_entry_id, reason, request_id, created_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),$15)
       RETURNING id, installation_id, employee_id, leave_type_id,
         leave_type_code_snapshot, leave_type_name_snapshot, entry_type,
         quantity_days, to_char(effective_date, 'YYYY-MM-DD') AS effective_date,
         source_type, source_id, reverses_entry_id, reason, request_id, created_at, created_by`,
      [id, installationId, employeeId, leaveTypeId, leaveTypeCodeSnapshot, leaveTypeNameSnapshot,
        entry.entryType, entry.quantityDays, entry.effectiveDate, entry.sourceType, entry.sourceId,
        entry.reversesEntryId ?? null, entry.reason, requestId, actorId],
    );
    inserted.push(result.rows[0]);
  }
  return inserted;
}

export async function listUsageEntriesForRequest(client, { installationId, requestId }) {
  const result = await client.query(
    `SELECT id, employee_id, leave_type_id, quantity_days,
            to_char(effective_date, 'YYYY-MM-DD') AS effective_date
       FROM shared.leave_balance_ledger
      WHERE installation_id = $1
        AND source_type = 'LEAVE_REQUEST'
        AND source_id = $2
        AND entry_type = 'USAGE'
      ORDER BY effective_date ASC, created_at ASC`,
    [installationId, requestId],
  );
  return result.rows ?? [];
}

export async function listLeaveBalances(client, {
  installationId, asOfDate, employeeId = null, employeeQuery = null,
  branchIds = null, leaveTypeId = null, limit = 100,
}) {
  const result = await client.query(
    `SELECT e.id AS employee_id, e.code AS employee_code, e.full_name AS employee_name,
            org_assignment.branch_id, branch.code AS branch_code, branch.name AS branch_name,
            leave_type.id AS leave_type_id, leave_type.code AS leave_type_code,
            leave_type.name AS leave_type_name, leave_type.is_active,
            leave_type.allow_negative_balance,
            COALESCE(SUM(ledger.quantity_days) FILTER (WHERE ledger.effective_date <= $2::date), 0)::numeric AS balance_days,
            MAX(ledger.effective_date) AS last_activity_date
       FROM shared.employees e
       JOIN LATERAL (
         SELECT employment.id
           FROM shared.employee_employments employment
          WHERE employment.installation_id = e.installation_id
            AND employment.employee_id = e.id
            AND employment.effective_from <= $2::date
            AND (employment.effective_to IS NULL OR employment.effective_to >= $2::date)
          ORDER BY employment.effective_from DESC
          LIMIT 1
       ) active_employment ON true
       LEFT JOIN LATERAL (
         SELECT assignment.branch_id
           FROM shared.employee_assignments assignment
          WHERE assignment.installation_id = e.installation_id
            AND assignment.employee_id = e.id
            AND assignment.effective_from <= $2::date
            AND (assignment.effective_to IS NULL OR assignment.effective_to >= $2::date)
          ORDER BY assignment.effective_from DESC
          LIMIT 1
       ) org_assignment ON true
       LEFT JOIN shared.branches branch
         ON branch.installation_id = e.installation_id
        AND branch.id = org_assignment.branch_id
       JOIN shared.leave_types leave_type
         ON leave_type.installation_id = e.installation_id
        AND leave_type.tracks_balance = true
       LEFT JOIN shared.leave_balance_ledger ledger
         ON ledger.installation_id = e.installation_id
        AND ledger.employee_id = e.id
        AND ledger.leave_type_id = leave_type.id
      WHERE e.installation_id = $1
        AND ($3::uuid IS NULL OR e.id = $3::uuid)
        AND ($4::text IS NULL
          OR position(lower($4) in lower(e.code)) > 0
          OR position(lower($4) in lower(e.full_name)) > 0)
        AND ($5::uuid[] IS NULL OR org_assignment.branch_id = ANY($5::uuid[]))
        AND ($6::uuid IS NULL OR leave_type.id = $6::uuid)
      GROUP BY e.id, e.code, e.full_name, org_assignment.branch_id,
               branch.code, branch.name, leave_type.id, leave_type.code,
               leave_type.name, leave_type.is_active, leave_type.allow_negative_balance
      ORDER BY e.full_name ASC, e.code ASC, leave_type.name ASC
      LIMIT $7`,
    [installationId, asOfDate, employeeId, employeeQuery, branchIds, leaveTypeId, limit],
  );
  return result.rows ?? [];
}

export async function listLeaveBalanceEntries(client, {
  installationId, employeeId, leaveTypeId, limit = 100,
}) {
  const result = await client.query(
    `SELECT ledger.id, ledger.employee_id, employee.code AS employee_code,
            employee.full_name AS employee_name, ledger.leave_type_id,
            ledger.leave_type_code_snapshot, ledger.leave_type_name_snapshot,
            ledger.entry_type, ledger.quantity_days,
            to_char(ledger.effective_date, 'YYYY-MM-DD') AS effective_date,
            ledger.source_type, ledger.source_id, ledger.reverses_entry_id,
            ledger.reason, ledger.request_id, ledger.created_at, ledger.created_by
       FROM shared.leave_balance_ledger ledger
       JOIN shared.employees employee
         ON employee.installation_id = ledger.installation_id
        AND employee.id = ledger.employee_id
      WHERE ledger.installation_id = $1
        AND ledger.employee_id = $2
        AND ledger.leave_type_id = $3
      ORDER BY ledger.effective_date DESC, ledger.created_at DESC
      LIMIT $4`,
    [installationId, employeeId, leaveTypeId, limit],
  );
  return result.rows ?? [];
}
