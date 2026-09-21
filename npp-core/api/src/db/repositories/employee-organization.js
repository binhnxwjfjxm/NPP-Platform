import { randomUUID } from 'node:crypto';

export async function listDepartments(client, { installationId }) {
  const result = await client.query(
    `SELECT d.id, d.installation_id, d.code, d.name, d.parent_department_id, d.is_active,
            d.created_at, d.updated_at, d.created_by, d.updated_by,
            parent.code AS parent_code, parent.name AS parent_name
       FROM shared.hr_departments d
       LEFT JOIN shared.hr_departments parent
         ON parent.installation_id = d.installation_id
        AND parent.id = d.parent_department_id
      WHERE d.installation_id = $1
      ORDER BY d.is_active DESC, d.code ASC`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function getDepartmentById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT d.id, d.installation_id, d.code, d.name, d.parent_department_id, d.is_active,
            d.created_at, d.updated_at, d.created_by, d.updated_by,
            parent.code AS parent_code, parent.name AS parent_name
       FROM shared.hr_departments d
       LEFT JOIN shared.hr_departments parent
         ON parent.installation_id = d.installation_id
        AND parent.id = d.parent_department_id
      WHERE d.installation_id = $1 AND d.id = $2`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function getDepartmentByIdForUpdate(client, { installationId, id }) {
  const result = await client.query(
    `SELECT id, installation_id, code, name, parent_department_id, is_active,
            created_at, updated_at, created_by, updated_by
       FROM shared.hr_departments
      WHERE installation_id = $1 AND id = $2
      FOR UPDATE`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function insertDepartment(client, {
  installationId, code, name, parentDepartmentId = null, actorId,
}) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.hr_departments (
       id, installation_id, code, name, parent_department_id, is_active,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,true,$6,$6)
     ON CONFLICT (installation_id, code) DO NOTHING
     RETURNING id, installation_id, code, name, parent_department_id, is_active,
       created_at, updated_at, created_by, updated_by`,
    [id, installationId, code, name, parentDepartmentId, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function updateDepartment(client, {
  installationId, id, code, name, parentDepartmentId = null, isActive, actorId, expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.hr_departments
        SET code = $3,
            name = $4,
            parent_department_id = $5,
            is_active = $6,
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
            updated_by = $7
      WHERE installation_id = $1
        AND id = $2
        AND updated_at = $8
      RETURNING id, installation_id, code, name, parent_department_id, is_active,
        created_at, updated_at, created_by, updated_by`,
    [installationId, id, code, name, parentDepartmentId, isActive, actorId, expectedUpdatedAt],
  );
  return result.rows?.[0] ?? null;
}

export async function listPositions(client, { installationId }) {
  const result = await client.query(
    `SELECT p.id, p.installation_id, p.code, p.name, p.department_id, p.is_active,
            p.created_at, p.updated_at, p.created_by, p.updated_by,
            d.code AS department_code, d.name AS department_name
       FROM shared.hr_positions p
       LEFT JOIN shared.hr_departments d
         ON d.installation_id = p.installation_id
        AND d.id = p.department_id
      WHERE p.installation_id = $1
      ORDER BY p.is_active DESC, p.code ASC`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function getPositionById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT p.id, p.installation_id, p.code, p.name, p.department_id, p.is_active,
            p.created_at, p.updated_at, p.created_by, p.updated_by,
            d.code AS department_code, d.name AS department_name
       FROM shared.hr_positions p
       LEFT JOIN shared.hr_departments d
         ON d.installation_id = p.installation_id
        AND d.id = p.department_id
      WHERE p.installation_id = $1 AND p.id = $2`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function getPositionByIdForUpdate(client, { installationId, id }) {
  const result = await client.query(
    `SELECT id, installation_id, code, name, department_id, is_active,
            created_at, updated_at, created_by, updated_by
       FROM shared.hr_positions
      WHERE installation_id = $1 AND id = $2
      FOR UPDATE`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function insertPosition(client, {
  installationId, code, name, departmentId = null, actorId,
}) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.hr_positions (
       id, installation_id, code, name, department_id, is_active,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,true,$6,$6)
     ON CONFLICT (installation_id, code) DO NOTHING
     RETURNING id, installation_id, code, name, department_id, is_active,
       created_at, updated_at, created_by, updated_by`,
    [id, installationId, code, name, departmentId, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function updatePosition(client, {
  installationId, id, code, name, departmentId = null, isActive, actorId, expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.hr_positions
        SET code = $3,
            name = $4,
            department_id = $5,
            is_active = $6,
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
            updated_by = $7
      WHERE installation_id = $1
        AND id = $2
        AND updated_at = $8
      RETURNING id, installation_id, code, name, department_id, is_active,
        created_at, updated_at, created_by, updated_by`,
    [installationId, id, code, name, departmentId, isActive, actorId, expectedUpdatedAt],
  );
  return result.rows?.[0] ?? null;
}

export async function listManagerCandidates(client, { installationId }) {
  const result = await client.query(
    `SELECT e.id, e.code, e.full_name, e.is_active,
            a.department_id, d.code AS department_code, d.name AS department_name,
            a.position_id, p.code AS position_code, p.name AS position_name
       FROM shared.employees e
       LEFT JOIN LATERAL (
         SELECT x.department_id, x.position_id
           FROM shared.employee_assignments x
          WHERE x.installation_id = e.installation_id
            AND x.employee_id = e.id
            AND x.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
            AND (x.effective_to IS NULL OR x.effective_to >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
          ORDER BY x.effective_from DESC
          LIMIT 1
       ) a ON true
       LEFT JOIN shared.hr_departments d
         ON d.installation_id = e.installation_id AND d.id = a.department_id
       LEFT JOIN shared.hr_positions p
         ON p.installation_id = e.installation_id AND p.id = a.position_id
      WHERE e.installation_id = $1
      ORDER BY e.is_active DESC, e.code ASC`,
    [installationId],
  );
  return result.rows ?? [];
}
