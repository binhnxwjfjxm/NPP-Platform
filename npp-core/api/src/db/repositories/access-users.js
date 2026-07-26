import { randomUUID } from 'node:crypto';

const USER_COLUMNS = 'id, installation_id, employee_id, login_name, is_active, created_at, updated_at, created_by, updated_by';
const USER_SELECT_COLUMNS = 'u.id, u.installation_id, u.employee_id, u.login_name, u.is_active, u.created_at, u.updated_at, u.created_by, u.updated_by';
const USER_WITH_EMPLOYEE_COLUMNS = `${USER_SELECT_COLUMNS}, e.code AS employee_code, e.full_name AS employee_full_name`;
const USER_GROUP_COLUMNS = `${USER_SELECT_COLUMNS}, e.code, e.full_name`;

export async function listUsersForInstallation(client, {
  installationId,
  active,
  search,
  limit = 100,
  offset = 0,
}) {
  const params = [installationId];
  let query = `
    SELECT
      ${USER_WITH_EMPLOYEE_COLUMNS},
      COALESCE(
        ARRAY_AGG(DISTINCT ur.role_id ORDER BY ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL),
        ARRAY[]::uuid[]
      ) AS role_ids
    FROM shared.users u
    LEFT JOIN shared.user_roles ur
      ON ur.installation_id = u.installation_id
     AND ur.user_id = u.id
    LEFT JOIN shared.employees e
      ON e.installation_id = u.installation_id
     AND e.id = u.employee_id
    WHERE u.installation_id = $1
  `;

  if (active !== undefined) {
    params.push(Boolean(active));
    query += ` AND u.is_active = $${params.length}`;
  }

  const normalizedSearch = typeof search === 'string' ? search.trim().toLowerCase() : '';
  if (normalizedSearch) {
    params.push(`%${normalizedSearch}%`);
    query += ` AND (
      LOWER(u.login_name) LIKE $${params.length}
      OR LOWER(COALESCE(e.code, '')) LIKE $${params.length}
      OR LOWER(COALESCE(e.full_name, '')) LIKE $${params.length}
    )`;
  }

  params.push(limit, offset);
  query += `
    GROUP BY ${USER_GROUP_COLUMNS}
    ORDER BY u.login_name ASC
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

  const result = await client.query(query, params);
  return result.rows ?? [];
}

export async function getUserByLoginNameForInstallation(client, { installationId, loginName }) {
  const result = await client.query(
    `SELECT ${USER_COLUMNS}
     FROM shared.users
     WHERE installation_id = $1 AND login_name = $2`,
    [installationId, loginName],
  );
  return result.rows[0] || null;
}

export async function getUserByEmployeeIdForInstallation(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT ${USER_COLUMNS}
     FROM shared.users
     WHERE installation_id = $1 AND employee_id = $2`,
    [installationId, employeeId],
  );
  return result.rows[0] || null;
}

export async function getUserByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${USER_COLUMNS}
     FROM shared.users
     WHERE id = $1 AND installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getUserForInstallationWithRoles(client, { id, installationId }) {
  const result = await client.query(
    `SELECT
       ${USER_WITH_EMPLOYEE_COLUMNS},
       COALESCE(
         ARRAY_AGG(DISTINCT ur.role_id ORDER BY ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL),
         ARRAY[]::uuid[]
       ) AS role_ids
     FROM shared.users u
     LEFT JOIN shared.user_roles ur
       ON ur.installation_id = u.installation_id
      AND ur.user_id = u.id
     LEFT JOIN shared.employees e
       ON e.installation_id = u.installation_id
      AND e.id = u.employee_id
     WHERE u.installation_id = $1 AND u.id = $2
     GROUP BY ${USER_GROUP_COLUMNS}`,
    [installationId, id],
  );
  return result.rows[0] || null;
}

export async function insertUser(client, {
  installationId,
  employeeId,
  loginName,
  isActive,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.users (
       id, installation_id, employee_id, login_name, is_active,
       created_at, updated_at, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7)
     RETURNING ${USER_COLUMNS}`,
    [id, installationId, employeeId, loginName, Boolean(isActive), now, createdBy],
  );
  return result.rows[0] || null;
}

export async function updateUserActiveStatus(client, {
  id,
  installationId,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.users
     SET is_active = $1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $2
     WHERE id = $3
       AND installation_id = $4
       AND updated_at = $5
     RETURNING ${USER_COLUMNS}`,
    [isActive, updatedBy, id, installationId, expectedUpdatedAt],
  );
  return result.rows[0] || null;
}

export async function bumpUserVersion(client, {
  id,
  installationId,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.users
     SET updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $1
     WHERE id = $2
       AND installation_id = $3
       AND updated_at = $4
     RETURNING ${USER_COLUMNS}`,
    [updatedBy, id, installationId, expectedUpdatedAt],
  );
  return result.rows[0] || null;
}

export async function replaceUserRoles(client, {
  installationId,
  userId,
  roleIds,
  createdBy,
}) {
  await client.query(
    `DELETE FROM shared.user_roles
     WHERE installation_id = $1 AND user_id = $2`,
    [installationId, userId],
  );

  if (roleIds.length === 0) return;

  await client.query(
    `INSERT INTO shared.user_roles (
       installation_id, user_id, role_id, created_at, created_by
     )
     SELECT $1, $2, role_id, now(), $3
     FROM unnest($4::uuid[]) AS role_id`,
    [installationId, userId, createdBy, roleIds],
  );
}

export async function listActiveRoleIdsByIds(client, { installationId, roleIds }) {
  if (roleIds.length === 0) return [];
  const result = await client.query(
    `SELECT id
     FROM shared.roles
     WHERE installation_id = $1
       AND id = ANY($2::uuid[])
       AND is_active = true`,
    [installationId, roleIds],
  );
  return result.rows.map((row) => String(row.id));
}
