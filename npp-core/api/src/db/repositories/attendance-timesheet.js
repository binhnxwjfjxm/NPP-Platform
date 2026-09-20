const DAY_COLUMNS = `c.employee_id, c.employee_code, c.employee_name,
  c.employee_branch_id, c.branch_code, c.branch_name,
  to_char(c.work_date_date, 'YYYY-MM-DD') AS work_date,
  s.id AS schedule_id, s.work_policy_id AS schedule_work_policy_id,
  s.schedule_kind, s.scheduled_start_at, s.scheduled_end_at,
  s.source AS schedule_source, s.override_reason,
  assigned.work_policy_id AS assigned_work_policy_id,
  p.id AS policy_id, p.code AS policy_code, p.version AS policy_version,
  p.name AS policy_name, p.time_mode AS policy_time_mode,
  p.fixed_start_time AS policy_fixed_start_time, p.fixed_end_time AS policy_fixed_end_time,
  p.working_days AS policy_working_days, p.break_minutes AS policy_break_minutes,
  p.late_grace_minutes AS policy_late_grace_minutes,
  p.early_leave_grace_minutes AS policy_early_leave_grace_minutes,
  p.attendance_method AS policy_attendance_method, p.timezone AS policy_timezone`;

const DAY_JOINS = `
  LEFT JOIN shared.work_schedules s
    ON s.installation_id = c.installation_id
   AND s.employee_id = c.employee_id
   AND s.work_date = c.work_date_date
  LEFT JOIN LATERAL (
    SELECT a.work_policy_id
      FROM shared.employee_work_policy_assignments a
      JOIN shared.work_policies ap
        ON ap.installation_id = a.installation_id AND ap.id = a.work_policy_id
     WHERE a.installation_id = c.installation_id
       AND a.employee_id = c.employee_id
       AND a.effective_from <= c.work_date_date
       AND (a.effective_to IS NULL OR a.effective_to >= c.work_date_date)
       AND ap.effective_from <= c.work_date_date
       AND (ap.effective_to IS NULL OR ap.effective_to >= c.work_date_date)
       AND ap.is_active = true
     ORDER BY a.effective_from DESC, ap.version DESC
     LIMIT 1
  ) assigned ON true
  LEFT JOIN shared.work_policies p
    ON p.installation_id = c.installation_id
   AND p.id = COALESCE(assigned.work_policy_id, s.work_policy_id)`;

function employeeFilters(params, {
  employeeId = null,
  employeeQuery = null,
  branchId = null,
  branchIds = null,
}) {
  let sql = '';
  if (employeeId) {
    params.push(employeeId);
    sql += ` AND e.id = $${params.length}`;
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
  return sql;
}

export async function listDayFacts(client, {
  installationId,
  dateFrom,
  dateTo,
  employeeId = null,
  employeeQuery = null,
  branchId = null,
  branchIds = null,
  limit = 50,
  offset = 0,
}) {
  const params = [installationId, dateFrom, dateTo];
  const filters = employeeFilters(params, { employeeId, employeeQuery, branchId, branchIds });
  const count = await client.query(
    `SELECT COUNT(*)::integer AS total
       FROM shared.employees e
       CROSS JOIN generate_series($2::date, $3::date, interval '1 day') AS d(work_date)
      WHERE e.installation_id = $1${filters}`,
    params,
  );

  const pageParams = [...params, limit, offset];
  const limitIndex = pageParams.length - 1;
  const offsetIndex = pageParams.length;
  const rows = await client.query(
    `WITH candidate AS (
       SELECT e.installation_id, e.id AS employee_id, e.code AS employee_code,
              e.full_name AS employee_name, e.branch_id AS employee_branch_id,
              b.code AS branch_code, b.name AS branch_name, d.work_date::date AS work_date_date
         FROM shared.employees e
         LEFT JOIN shared.branches b
           ON b.installation_id = e.installation_id AND b.id = e.branch_id
         CROSS JOIN generate_series($2::date, $3::date, interval '1 day') AS d(work_date)
        WHERE e.installation_id = $1${filters}
        ORDER BY d.work_date DESC, e.code ASC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
     )
     SELECT ${DAY_COLUMNS}
       FROM candidate c
       ${DAY_JOINS}
      ORDER BY c.work_date_date DESC, c.employee_code ASC`,
    pageParams,
  );
  return { rows: rows.rows ?? [], total: Number(count.rows?.[0]?.total ?? 0) };
}

export async function listEmployeePage(client, {
  installationId,
  employeeId = null,
  employeeQuery = null,
  branchId = null,
  branchIds = null,
  limit = 20,
  offset = 0,
}) {
  const params = [installationId];
  const filters = employeeFilters(params, { employeeId, employeeQuery, branchId, branchIds });
  const count = await client.query(
    `SELECT COUNT(*)::integer AS total
       FROM shared.employees e
      WHERE e.installation_id = $1${filters}`,
    params,
  );
  const pageParams = [...params, limit, offset];
  const limitIndex = pageParams.length - 1;
  const offsetIndex = pageParams.length;
  const rows = await client.query(
    `SELECT e.id, e.code, e.full_name, e.branch_id,
            b.code AS branch_code, b.name AS branch_name
       FROM shared.employees e
       LEFT JOIN shared.branches b
         ON b.installation_id = e.installation_id AND b.id = e.branch_id
      WHERE e.installation_id = $1${filters}
      ORDER BY e.code ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    pageParams,
  );
  return { rows: rows.rows ?? [], total: Number(count.rows?.[0]?.total ?? 0) };
}

export async function listDayFactsForEmployees(client, {
  installationId,
  dateFrom,
  dateTo,
  employeeIds,
}) {
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) return [];
  const result = await client.query(
    `WITH candidate AS (
       SELECT e.installation_id, e.id AS employee_id, e.code AS employee_code,
              e.full_name AS employee_name, e.branch_id AS employee_branch_id,
              b.code AS branch_code, b.name AS branch_name,
              d.work_date::date AS work_date_date, selected.position
         FROM unnest($4::uuid[]) WITH ORDINALITY AS selected(employee_id, position)
         JOIN shared.employees e
           ON e.installation_id = $1 AND e.id = selected.employee_id
         LEFT JOIN shared.branches b
           ON b.installation_id = e.installation_id AND b.id = e.branch_id
         CROSS JOIN generate_series($2::date, $3::date, interval '1 day') AS d(work_date)
     )
     SELECT ${DAY_COLUMNS}, c.position
       FROM candidate c
       ${DAY_JOINS}
      ORDER BY c.position ASC, c.work_date_date ASC`,
    [installationId, dateFrom, dateTo, employeeIds],
  );
  return result.rows ?? [];
}

export async function listEvents(client, {
  installationId,
  employeeIds,
  fromAt,
  toAt,
}) {
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) return [];
  const result = await client.query(
    `SELECT e.id, e.installation_id, e.employee_id, e.schedule_id, e.work_policy_id,
            e.attendance_point_id, e.event_type, e.occurred_at, e.source,
            e.validation_status, e.source_reference, e.note, e.recorded_by,
            e.request_id, e.created_at, p.code AS point_code, p.name AS point_name
       FROM shared.attendance_events e
       LEFT JOIN shared.attendance_points p
         ON p.installation_id = e.installation_id AND p.id = e.attendance_point_id
      WHERE e.installation_id = $1
        AND e.employee_id = ANY($2::uuid[])
        AND e.occurred_at >= $3
        AND e.occurred_at < $4
      ORDER BY e.employee_id ASC, e.occurred_at ASC, e.id ASC`,
    [installationId, employeeIds, fromAt, toAt],
  );
  return result.rows ?? [];
}
