import { randomUUID } from 'node:crypto';

const SELECT_COLUMNS = `id, installation_id, code, full_name, job_title, phone, email, branch_id,
  is_active, created_at, updated_at, created_by, updated_by`;

export async function insertEmployee(client, {
  installationId,
  code,
  fullName,
  jobTitle,
  phone,
  email,
  branchId,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.employees
      (id, installation_id, code, full_name, job_title, phone, email, branch_id,
       is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12)
     ON CONFLICT (installation_id, code) DO NOTHING
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      installationId,
      code,
      fullName,
      jobTitle || null,
      phone || null,
      email || null,
      branchId || null,
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  return result.rows[0] || null;
}

export async function getEmployeeByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${SELECT_COLUMNS}
     FROM shared.employees
     WHERE id = $1 AND installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getEmployeeByIdForInstallationForShare(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${SELECT_COLUMNS}
     FROM shared.employees
     WHERE id = $1 AND installation_id = $2
     FOR SHARE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getEmployeeByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${SELECT_COLUMNS}
     FROM shared.employees
     WHERE id = $1 AND installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getEmployeeByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${SELECT_COLUMNS}
     FROM shared.employees
     WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );
  return result.rows[0] || null;
}

export async function listEmployeesForInstallation(client, {
  installationId,
  active,
  branchId,
  limit = 100,
  offset = 0,
}) {
  let query = `SELECT e.id, e.installation_id, e.code, e.full_name, e.job_title, e.phone, e.email, e.branch_id,
                      e.is_active, e.created_at, e.updated_at, e.created_by, e.updated_by,
                      a.id AS assignment_id, a.department_id, d.code AS department_code, d.name AS department_name,
                      a.position_id, p.code AS position_code, p.name AS position_name,
                      a.manager_employee_id, m.code AS manager_code, m.full_name AS manager_name,
                      to_char(a.effective_from, 'YYYY-MM-DD') AS assignment_effective_from,
                      CASE WHEN a.effective_to IS NULL THEN NULL ELSE to_char(a.effective_to, 'YYYY-MM-DD') END AS assignment_effective_to
                 FROM shared.employees e
                 LEFT JOIN LATERAL (
                   SELECT x.*
                     FROM shared.employee_assignments x
                    WHERE x.installation_id = e.installation_id
                      AND x.employee_id = e.id
                    ORDER BY x.effective_from DESC, x.created_at DESC, x.id DESC
                    LIMIT 1
                 ) a ON true
                 LEFT JOIN shared.hr_departments d
                   ON d.installation_id = e.installation_id AND d.id = a.department_id
                 LEFT JOIN shared.hr_positions p
                   ON p.installation_id = e.installation_id AND p.id = a.position_id
                 LEFT JOIN shared.employees m
                   ON m.installation_id = e.installation_id AND m.id = a.manager_employee_id
                WHERE e.installation_id = $1`;
  const params = [installationId];

  if (active !== undefined) {
    query += ` AND e.is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  if (branchId) {
    query += ` AND e.branch_id = $${params.length + 1}`;
    params.push(branchId);
  }

  query += ` ORDER BY e.code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await client.query(query, params);
  return result.rows;
}

export async function updateEmployee(client, {
  id,
  installationId,
  fullName,
  jobTitle,
  phone,
  email,
  branchId,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.employees
     SET full_name = $1,
         job_title = $2,
         phone = $3,
         email = $4,
         branch_id = $5,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $6
     WHERE id = $7
       AND installation_id = $8
       AND updated_at = $9
     RETURNING ${SELECT_COLUMNS}`,
    [
      fullName,
      jobTitle || null,
      phone || null,
      email || null,
      branchId || null,
      updatedBy,
      id,
      installationId,
      expectedUpdatedAt,
    ],
  );
  return result.rows[0] || null;
}

export async function updateEmployeeActiveStatus(client, {
  id,
  installationId,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.employees
     SET is_active = $1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $2
     WHERE id = $3
       AND installation_id = $4
       AND updated_at = $5
     RETURNING ${SELECT_COLUMNS}`,
    [isActive, updatedBy, id, installationId, expectedUpdatedAt],
  );
  return result.rows[0] || null;
}

export async function listEmployeeEmployments(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT id, installation_id, employee_id, employment_type,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            CASE WHEN effective_to IS NULL THEN NULL ELSE to_char(effective_to, 'YYYY-MM-DD') END AS effective_to,
            end_reason, data_quality, source, source_reference, created_at, created_by
       FROM shared.employee_employments
      WHERE installation_id = $1 AND employee_id = $2
      ORDER BY effective_from DESC, created_at DESC, id DESC`,
    [installationId, employeeId],
  );
  return result.rows ?? [];
}

export async function listEmployeeAssignments(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT a.id, a.installation_id, a.employee_id, a.branch_id,
            a.department_id, a.position_id, a.manager_employee_id,
            to_char(a.effective_from, 'YYYY-MM-DD') AS effective_from,
            CASE WHEN a.effective_to IS NULL THEN NULL ELSE to_char(a.effective_to, 'YYYY-MM-DD') END AS effective_to,
            a.reason, a.data_quality, a.source, a.source_reference, a.created_at, a.created_by,
            b.code AS branch_code, b.name AS branch_name,
            d.code AS department_code, d.name AS department_name,
            p.code AS position_code, p.name AS position_name,
            m.code AS manager_code, m.full_name AS manager_name
       FROM shared.employee_assignments a
       LEFT JOIN shared.branches b
         ON b.installation_id = a.installation_id AND b.id = a.branch_id
       LEFT JOIN shared.hr_departments d
         ON d.installation_id = a.installation_id AND d.id = a.department_id
       LEFT JOIN shared.hr_positions p
         ON p.installation_id = a.installation_id AND p.id = a.position_id
       LEFT JOIN shared.employees m
         ON m.installation_id = a.installation_id AND m.id = a.manager_employee_id
      WHERE a.installation_id = $1 AND a.employee_id = $2
      ORDER BY a.effective_from DESC, a.created_at DESC, a.id DESC`,
    [installationId, employeeId],
  );
  return result.rows ?? [];
}

export async function getLatestEmployeeEmploymentForUpdate(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT id, installation_id, employee_id, employment_type,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            CASE WHEN effective_to IS NULL THEN NULL ELSE to_char(effective_to, 'YYYY-MM-DD') END AS effective_to,
            end_reason, data_quality, source, source_reference, created_at, created_by
       FROM shared.employee_employments
      WHERE installation_id = $1 AND employee_id = $2
      ORDER BY effective_from DESC, created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE`,
    [installationId, employeeId],
  );
  return result.rows?.[0] ?? null;
}

export async function getLatestEmployeeAssignmentForUpdate(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT a.id, a.installation_id, a.employee_id, a.branch_id,
            a.department_id, a.position_id, a.manager_employee_id,
            to_char(a.effective_from, 'YYYY-MM-DD') AS effective_from,
            CASE WHEN a.effective_to IS NULL THEN NULL ELSE to_char(a.effective_to, 'YYYY-MM-DD') END AS effective_to,
            a.reason, a.data_quality, a.source, a.source_reference, a.created_at, a.created_by,
            b.code AS branch_code, b.name AS branch_name,
            d.code AS department_code, d.name AS department_name,
            p.code AS position_code, p.name AS position_name,
            m.code AS manager_code, m.full_name AS manager_name
       FROM shared.employee_assignments a
       LEFT JOIN shared.branches b
         ON b.installation_id = a.installation_id AND b.id = a.branch_id
       LEFT JOIN shared.hr_departments d
         ON d.installation_id = a.installation_id AND d.id = a.department_id
       LEFT JOIN shared.hr_positions p
         ON p.installation_id = a.installation_id AND p.id = a.position_id
       LEFT JOIN shared.employees m
         ON m.installation_id = a.installation_id AND m.id = a.manager_employee_id
      WHERE a.installation_id = $1 AND a.employee_id = $2
      ORDER BY a.effective_from DESC, a.created_at DESC, a.id DESC
      LIMIT 1
      FOR UPDATE OF a`,
    [installationId, employeeId],
  );
  return result.rows?.[0] ?? null;
}

export async function resolveEmployeeAtDate(client, { installationId, employeeId, businessDate }) {
  const result = await client.query(
    `SELECT e.id, e.installation_id, e.code, e.full_name, e.job_title, e.phone, e.email,
            emp.id AS employment_id, emp.employment_type,
            to_char(emp.effective_from, 'YYYY-MM-DD') AS employment_effective_from,
            CASE WHEN emp.effective_to IS NULL THEN NULL ELSE to_char(emp.effective_to, 'YYYY-MM-DD') END AS employment_effective_to,
            emp.data_quality AS employment_data_quality,
            a.id AS assignment_id, a.branch_id, a.department_id, a.position_id, a.manager_employee_id,
            to_char(a.effective_from, 'YYYY-MM-DD') AS assignment_effective_from,
            CASE WHEN a.effective_to IS NULL THEN NULL ELSE to_char(a.effective_to, 'YYYY-MM-DD') END AS assignment_effective_to,
            a.data_quality AS assignment_data_quality,
            b.code AS branch_code, b.name AS branch_name,
            d.code AS department_code, d.name AS department_name,
            p.code AS position_code, p.name AS position_name,
            m.code AS manager_code, m.full_name AS manager_name
       FROM shared.employees e
       JOIN LATERAL (
         SELECT x.* FROM shared.employee_employments x
          WHERE x.installation_id = e.installation_id AND x.employee_id = e.id
            AND x.effective_from <= $3::date
            AND (x.effective_to IS NULL OR x.effective_to >= $3::date)
          ORDER BY x.effective_from DESC LIMIT 1
       ) emp ON true
       LEFT JOIN LATERAL (
         SELECT x.* FROM shared.employee_assignments x
          WHERE x.installation_id = e.installation_id AND x.employee_id = e.id
            AND x.effective_from <= $3::date
            AND (x.effective_to IS NULL OR x.effective_to >= $3::date)
          ORDER BY x.effective_from DESC LIMIT 1
       ) a ON true
       LEFT JOIN shared.branches b
         ON b.installation_id = e.installation_id AND b.id = a.branch_id
       LEFT JOIN shared.hr_departments d
         ON d.installation_id = e.installation_id AND d.id = a.department_id
       LEFT JOIN shared.hr_positions p
         ON p.installation_id = e.installation_id AND p.id = a.position_id
       LEFT JOIN shared.employees m
         ON m.installation_id = e.installation_id AND m.id = a.manager_employee_id
      WHERE e.installation_id = $1 AND e.id = $2`,
    [installationId, employeeId, businessDate],
  );
  return result.rows?.[0] ?? null;
}

export async function insertEmployeeEmployment(client, { installationId, employeeId, employmentType, effectiveFrom, effectiveTo = null, endReason = null, dataQuality = 'CONFIRMED', source = 'HR', sourceReference = null, createdBy }) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.employee_employments (id, installation_id, employee_id, employment_type, effective_from, effective_to, end_reason, data_quality, source, source_reference, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11)
     RETURNING id, installation_id, employee_id, employment_type,
       to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
       CASE WHEN effective_to IS NULL THEN NULL ELSE to_char(effective_to, 'YYYY-MM-DD') END AS effective_to,
       end_reason, data_quality, source, source_reference, created_at, created_by`,
    [id, installationId, employeeId, employmentType, effectiveFrom, effectiveTo, endReason, dataQuality, source, sourceReference, createdBy],
  );
  return result.rows[0];
}

export async function updateEmployeeEmploymentPeriod(client, { installationId, id, employmentType, effectiveFrom, effectiveTo = null, endReason = null, dataQuality = 'CONFIRMED' }) {
  const result = await client.query(
    `UPDATE shared.employee_employments
        SET employment_type = $3, effective_from = $4::date, effective_to = $5::date,
            end_reason = $6, data_quality = $7, source = 'HR'
      WHERE installation_id = $1 AND id = $2
      RETURNING id, installation_id, employee_id, employment_type,
        to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
        CASE WHEN effective_to IS NULL THEN NULL ELSE to_char(effective_to, 'YYYY-MM-DD') END AS effective_to,
        end_reason, data_quality, source, source_reference, created_at, created_by`,
    [installationId, id, employmentType, effectiveFrom, effectiveTo, endReason, dataQuality],
  );
  return result.rows?.[0] ?? null;
}

export async function insertEmployeeAssignment(client, {
  installationId, employeeId, branchId, departmentId = null, positionId = null, managerEmployeeId = null,
  effectiveFrom, effectiveTo = null, reason = null, dataQuality = 'CONFIRMED',
  source = 'HR', sourceReference = null, createdBy,
}) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.employee_assignments (
       id, installation_id, employee_id, branch_id, department_id, position_id, manager_employee_id,
       effective_from, effective_to, reason, data_quality, source, source_reference, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12,$13,$14)
     RETURNING id, installation_id, employee_id, branch_id, department_id, position_id, manager_employee_id,
       to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
       CASE WHEN effective_to IS NULL THEN NULL ELSE to_char(effective_to, 'YYYY-MM-DD') END AS effective_to,
       reason, data_quality, source, source_reference, created_at, created_by`,
    [id, installationId, employeeId, branchId, departmentId, positionId, managerEmployeeId,
      effectiveFrom, effectiveTo, reason, dataQuality, source, sourceReference, createdBy],
  );
  return result.rows[0];
}

export async function updateEmployeeAssignmentPeriod(client, {
  installationId, id, branchId, departmentId = null, positionId = null, managerEmployeeId = null,
  effectiveFrom, effectiveTo = null, reason = null, dataQuality = 'CONFIRMED',
}) {
  const result = await client.query(
    `UPDATE shared.employee_assignments
        SET branch_id = $3,
            department_id = $4,
            position_id = $5,
            manager_employee_id = $6,
            effective_from = $7::date,
            effective_to = $8::date,
            reason = $9,
            data_quality = $10,
            source = 'HR'
      WHERE installation_id = $1 AND id = $2
      RETURNING id, installation_id, employee_id, branch_id, department_id, position_id, manager_employee_id,
        to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
        CASE WHEN effective_to IS NULL THEN NULL ELSE to_char(effective_to, 'YYYY-MM-DD') END AS effective_to,
        reason, data_quality, source, source_reference, created_at, created_by`,
    [installationId, id, branchId, departmentId, positionId, managerEmployeeId,
      effectiveFrom, effectiveTo, reason, dataQuality],
  );
  return result.rows?.[0] ?? null;
}

export async function findEmploymentOverlap(client, { installationId, employeeId, effectiveFrom, effectiveTo = null, excludeId = null }) {
  const result = await client.query(
    `SELECT id FROM shared.employee_employments
      WHERE installation_id = $1 AND employee_id = $2
        AND ($5::uuid IS NULL OR id <> $5::uuid)
        AND effective_from <= COALESCE($4::date, 'infinity'::date)
        AND (effective_to IS NULL OR effective_to >= $3::date)
      LIMIT 1`,
    [installationId, employeeId, effectiveFrom, effectiveTo, excludeId],
  );
  return result.rows?.[0] ?? null;
}

export async function findAssignmentOverlap(client, { installationId, employeeId, effectiveFrom, effectiveTo = null, excludeId = null }) {
  const result = await client.query(
    `SELECT id FROM shared.employee_assignments
      WHERE installation_id = $1 AND employee_id = $2
        AND ($5::uuid IS NULL OR id <> $5::uuid)
        AND effective_from <= COALESCE($4::date, 'infinity'::date)
        AND (effective_to IS NULL OR effective_to >= $3::date)
      LIMIT 1`,
    [installationId, employeeId, effectiveFrom, effectiveTo, excludeId],
  );
  return result.rows?.[0] ?? null;
}
