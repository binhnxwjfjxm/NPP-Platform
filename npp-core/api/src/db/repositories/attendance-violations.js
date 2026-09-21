import { randomUUID } from 'node:crypto';

const CASE_COLUMNS = `c.id, c.installation_id, c.employee_id,
  to_char(c.work_date, 'YYYY-MM-DD') AS work_date,
  c.violation_kind, c.violation_label_snapshot, c.violation_detail_snapshot,
  c.violation_minutes_snapshot, c.violation_day_fraction_snapshot,
  c.policy_id_snapshot, c.policy_version_snapshot,
  c.status, c.explanation, c.explained_by_actor_id, c.explained_at,
  c.reviewed_by_actor_id, c.review_note, c.reviewed_at, c.outcome,
  c.version, c.request_id, c.created_at, c.updated_at,
  e.code AS employee_code, e.full_name AS employee_name, e.branch_id AS employee_branch_id,
  b.code AS branch_code, b.name AS branch_name`;

function filters(params, {
  employeeId = null,
  employeeIds = null,
  employeeQuery = null,
  branchId = null,
  branchIds = null,
  status = null,
  dateFrom = null,
  dateTo = null,
}) {
  let sql = '';
  if (employeeId) { params.push(employeeId); sql += ` AND c.employee_id = $${params.length}`; }
  if (Array.isArray(employeeIds)) { params.push(employeeIds); sql += ` AND c.employee_id = ANY($${params.length}::uuid[])`; }
  if (employeeQuery) {
    params.push(employeeQuery);
    sql += ` AND (
      position(lower($${params.length}) in lower(e.code)) > 0
      OR position(lower($${params.length}) in lower(e.full_name)) > 0
    )`;
  }
  if (branchId) { params.push(branchId); sql += ` AND e.branch_id = $${params.length}`; }
  if (Array.isArray(branchIds)) { params.push(branchIds); sql += ` AND e.branch_id = ANY($${params.length}::uuid[])`; }
  if (status) { params.push(status); sql += ` AND c.status = $${params.length}`; }
  if (dateFrom) { params.push(dateFrom); sql += ` AND c.work_date >= $${params.length}::date`; }
  if (dateTo) { params.push(dateTo); sql += ` AND c.work_date <= $${params.length}::date`; }
  return sql;
}

export async function listCases(client, {
  installationId,
  employeeId = null,
  employeeIds = null,
  employeeQuery = null,
  branchId = null,
  branchIds = null,
  status = null,
  dateFrom = null,
  dateTo = null,
}) {
  const params = [installationId];
  const where = filters(params, { employeeId, employeeIds, employeeQuery, branchId, branchIds, status, dateFrom, dateTo });
  const result = await client.query(
    `SELECT ${CASE_COLUMNS}
       FROM shared.attendance_violation_cases c
       JOIN shared.employees e
         ON e.installation_id = c.installation_id AND e.id = c.employee_id
       LEFT JOIN shared.branches b
         ON b.installation_id = e.installation_id AND b.id = e.branch_id
      WHERE c.installation_id = $1${where}
      ORDER BY c.work_date DESC, e.code ASC, c.created_at DESC`,
    params,
  );
  return result.rows ?? [];
}

export async function getCaseByFact(client, { installationId, employeeId, workDate, violationKind, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${CASE_COLUMNS}
       FROM shared.attendance_violation_cases c
       JOIN shared.employees e
         ON e.installation_id = c.installation_id AND e.id = c.employee_id
       LEFT JOIN shared.branches b
         ON b.installation_id = e.installation_id AND b.id = e.branch_id
      WHERE c.installation_id = $1
        AND c.employee_id = $2
        AND c.work_date = $3::date
        AND c.violation_kind = $4
      LIMIT 1${forUpdate ? ' FOR UPDATE OF c' : ''}`,
    [installationId, employeeId, workDate, violationKind],
  );
  return result.rows?.[0] ?? null;
}

export async function getCaseById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${CASE_COLUMNS}
       FROM shared.attendance_violation_cases c
       JOIN shared.employees e
         ON e.installation_id = c.installation_id AND e.id = c.employee_id
       LEFT JOIN shared.branches b
         ON b.installation_id = e.installation_id AND b.id = e.branch_id
      WHERE c.installation_id = $1 AND c.id = $2
      LIMIT 1${forUpdate ? ' FOR UPDATE OF c' : ''}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function insertExplanationCase(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.attendance_violation_cases (
       id, installation_id, employee_id, work_date, violation_kind,
       violation_label_snapshot, violation_detail_snapshot,
       violation_minutes_snapshot, violation_day_fraction_snapshot,
       policy_id_snapshot, policy_version_snapshot,
       status, explanation, explained_by_actor_id, explained_at,
       version, request_id, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,
       'EXPLANATION_SUBMITTED',$12,$13,now(),1,$14,now(),now()
     )
     RETURNING id, installation_id, employee_id, to_char(work_date, 'YYYY-MM-DD') AS work_date,
       violation_kind, violation_label_snapshot, violation_detail_snapshot,
       violation_minutes_snapshot, violation_day_fraction_snapshot,
       policy_id_snapshot, policy_version_snapshot, status, explanation,
       explained_by_actor_id, explained_at, reviewed_by_actor_id, review_note,
       reviewed_at, outcome, version, request_id, created_at, updated_at`,
    [id, values.installationId, values.employeeId, values.workDate, values.violationKind,
      values.violationLabel, values.violationDetail, values.violationMinutes,
      values.violationDayFraction, values.policyId, values.policyVersion,
      values.explanation, values.actorId, values.requestId],
  );
  return result.rows?.[0] ?? null;
}

export async function startReview(client, { installationId, id, expectedVersion, actorId }) {
  const result = await client.query(
    `UPDATE shared.attendance_violation_cases
        SET status = 'UNDER_REVIEW',
            reviewed_by_actor_id = $4,
            version = version + 1,
            updated_at = now()
      WHERE installation_id = $1
        AND id = $2
        AND version = $3
        AND status = 'EXPLANATION_SUBMITTED'
      RETURNING id, installation_id, employee_id, to_char(work_date, 'YYYY-MM-DD') AS work_date,
        violation_kind, violation_label_snapshot, violation_detail_snapshot,
        violation_minutes_snapshot, violation_day_fraction_snapshot,
        policy_id_snapshot, policy_version_snapshot, status, explanation,
        explained_by_actor_id, explained_at, reviewed_by_actor_id, review_note,
        reviewed_at, outcome, version, request_id, created_at, updated_at`,
    [installationId, id, expectedVersion, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function resolveCase(client, {
  installationId, id, expectedVersion, actorId, outcome, reviewNote,
}) {
  const result = await client.query(
    `UPDATE shared.attendance_violation_cases
        SET status = 'RESOLVED',
            reviewed_by_actor_id = $4,
            review_note = $5,
            reviewed_at = now(),
            outcome = $6,
            version = version + 1,
            updated_at = now()
      WHERE installation_id = $1
        AND id = $2
        AND version = $3
        AND status IN ('EXPLANATION_SUBMITTED', 'UNDER_REVIEW')
      RETURNING id, installation_id, employee_id, to_char(work_date, 'YYYY-MM-DD') AS work_date,
        violation_kind, violation_label_snapshot, violation_detail_snapshot,
        violation_minutes_snapshot, violation_day_fraction_snapshot,
        policy_id_snapshot, policy_version_snapshot, status, explanation,
        explained_by_actor_id, explained_at, reviewed_by_actor_id, review_note,
        reviewed_at, outcome, version, request_id, created_at, updated_at`,
    [installationId, id, expectedVersion, actorId, reviewNote, outcome],
  );
  return result.rows?.[0] ?? null;
}
