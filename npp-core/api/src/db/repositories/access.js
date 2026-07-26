import { randomUUID } from 'node:crypto';
import { createPermissionCatalogRows } from '../../access/permissions.js';

const ROLE_COLUMNS = `id, installation_id, code, name, description, is_active, created_at, updated_at, created_by, updated_by`;

function normalizeSearch(search) {
  return typeof search === 'string' ? search.trim() : '';
}

export async function syncPermissionCatalog(client) {
  const rows = createPermissionCatalogRows();
  if (!rows.length) return;

  const values = [];
  const placeholders = rows.map((row, index) => {
    const offset = index * 5;
    values.push(row.permission_key, row.module, row.label, row.description, row.is_system);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, now())`;
  });

  await client.query(
    `INSERT INTO shared.permission_catalog
      (permission_key, module, label, description, is_system, created_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (permission_key) DO UPDATE
     SET module = EXCLUDED.module,
         label = EXCLUDED.label,
         description = EXCLUDED.description,
         is_system = EXCLUDED.is_system`,
    values,
  );
}

export async function listPermissionCatalog(client) {
  const result = await client.query(
    `SELECT permission_key, module, label, description, is_system, created_at
     FROM shared.permission_catalog
     ORDER BY module ASC, permission_key ASC`,
  );
  return result.rows ?? [];
}

export async function permissionKeysExist(client, permissionKeys) {
  const keys = [...new Set((permissionKeys ?? []).filter((item) => typeof item === 'string'))];
  if (keys.length === 0) return [];

  const result = await client.query(
    `SELECT permission_key
     FROM shared.permission_catalog
     WHERE permission_key = ANY($1::text[])`,
    [keys],
  );
  const found = new Set((result.rows ?? []).map((row) => String(row.permission_key)));
  return keys.filter((key) => !found.has(key));
}

export async function insertRole(client, {
  installationId,
  code,
  name,
  description,
  isActive,
  createdBy,
  updatedBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.roles
      (id, installation_id, code, name, description, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (installation_id, code) DO NOTHING
     RETURNING ${ROLE_COLUMNS}`,
    [
      id,
      installationId,
      code,
      name,
      description ?? null,
      Boolean(isActive),
      now,
      now,
      createdBy,
      updatedBy,
    ],
  );
  return result.rows[0] || null;
}

export async function getRoleByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${ROLE_COLUMNS}
     FROM shared.roles
     WHERE id = $1 AND installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getRoleByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${ROLE_COLUMNS}
     FROM shared.roles
     WHERE id = $1 AND installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function listRolePermissionKeys(client, { installationId, roleId }) {
  const result = await client.query(
    `SELECT permission_key
     FROM shared.role_permissions
     WHERE installation_id = $1 AND role_id = $2
     ORDER BY permission_key ASC`,
    [installationId, roleId],
  );
  return (result.rows ?? []).map((row) => String(row.permission_key));
}

export async function getRoleByCodeForInstallation(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${ROLE_COLUMNS}
     FROM shared.roles
     WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );
  return result.rows[0] || null;
}

export async function listRolesForInstallation(client, {
  installationId,
  active,
  search,
  limit = 100,
  offset = 0,
}) {
  const params = [installationId];
  let query = `
    SELECT
      r.id,
      r.installation_id,
      r.code,
      r.name,
      r.description,
      r.is_active,
      r.created_at,
      r.updated_at,
      r.created_by,
      r.updated_by,
      COALESCE(
        ARRAY_AGG(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL),
        ARRAY[]::text[]
      ) AS permission_keys
    FROM shared.roles r
    LEFT JOIN shared.role_permissions rp
      ON rp.installation_id = r.installation_id
     AND rp.role_id = r.id
    WHERE r.installation_id = $1
  `;

  if (active !== undefined) {
    params.push(Boolean(active));
    query += ` AND r.is_active = $${params.length}`;
  }

  const normalizedSearch = normalizeSearch(search);
  if (normalizedSearch) {
    params.push(`%${normalizedSearch.toLowerCase()}%`);
    query += ` AND (LOWER(r.code) LIKE $${params.length} OR LOWER(r.name) LIKE $${params.length} OR LOWER(COALESCE(r.description, '')) LIKE $${params.length})`;
  }

  params.push(limit, offset);
  query += `
    GROUP BY r.id, r.installation_id, r.code, r.name, r.description, r.is_active, r.created_at, r.updated_at, r.created_by, r.updated_by
    ORDER BY r.code ASC
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

  const result = await client.query(query, params);
  return result.rows ?? [];
}

export async function getRoleForInstallationWithPermissions(client, { id, installationId }) {
  const result = await client.query(
    `
    SELECT
      r.id,
      r.installation_id,
      r.code,
      r.name,
      r.description,
      r.is_active,
      r.created_at,
      r.updated_at,
      r.created_by,
      r.updated_by,
      COALESCE(
        ARRAY_AGG(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL),
        ARRAY[]::text[]
      ) AS permission_keys
    FROM shared.roles r
    LEFT JOIN shared.role_permissions rp
      ON rp.installation_id = r.installation_id
     AND rp.role_id = r.id
    WHERE r.installation_id = $1 AND r.id = $2
    GROUP BY r.id, r.installation_id, r.code, r.name, r.description, r.is_active, r.created_at, r.updated_at, r.created_by, r.updated_by
    `,
    [installationId, id],
  );
  return result.rows[0] || null;
}

export async function updateRole(client, {
  id,
  installationId,
  name,
  description,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.roles
     SET name = $1,
         description = $2,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $3
     WHERE id = $4
       AND installation_id = $5
       AND updated_at = $6
     RETURNING ${ROLE_COLUMNS}`,
    [name, description ?? null, updatedBy, id, installationId, expectedUpdatedAt],
  );
  return result.rows[0] || null;
}

export async function updateRoleRecord(client, {
  id,
  installationId,
  name,
  description,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.roles
     SET name = $1,
         description = $2,
         is_active = $3,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $4
     WHERE id = $5
       AND installation_id = $6
       AND updated_at = $7
     RETURNING ${ROLE_COLUMNS}`,
    [name, description ?? null, isActive, updatedBy, id, installationId, expectedUpdatedAt],
  );
  return result.rows[0] || null;
}

export async function updateRoleActiveStatus(client, {
  id,
  installationId,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.roles
     SET is_active = $1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $2
     WHERE id = $3
       AND installation_id = $4
       AND updated_at = $5
     RETURNING ${ROLE_COLUMNS}`,
    [isActive, updatedBy, id, installationId, expectedUpdatedAt],
  );
  return result.rows[0] || null;
}

export async function replaceRolePermissions(client, {
  installationId,
  roleId,
  permissionKeys,
  grantedBy,
}) {
  await client.query(
    `DELETE FROM shared.role_permissions
     WHERE installation_id = $1 AND role_id = $2`,
    [installationId, roleId],
  );

  if (!permissionKeys || permissionKeys.length === 0) return;

  await client.query(
    `INSERT INTO shared.role_permissions (
       installation_id,
       role_id,
       permission_key,
       granted_at,
       granted_by
     )
     SELECT $1, $2, key, now(), $3
     FROM unnest($4::text[]) AS key`,
    [installationId, roleId, grantedBy, permissionKeys],
  );
}
