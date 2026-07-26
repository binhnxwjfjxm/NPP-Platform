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
  let query = `SELECT ${SELECT_COLUMNS}
               FROM shared.employees
               WHERE installation_id = $1`;
  const params = [installationId];

  if (active !== undefined) {
    query += ` AND is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  if (branchId) {
    query += ` AND branch_id = $${params.length + 1}`;
    params.push(branchId);
  }

  query += ` ORDER BY code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
