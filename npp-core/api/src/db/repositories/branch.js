import { randomUUID } from 'node:crypto';

/**
 * Branch repository for managing branches scoped to an installation
 * All operations preserve installation boundary and require active parent (installation)
 */

export async function insertBranch(client, { installationId, code, name, address, phone, email, createdBy }) {
  const id = randomUUID();
  const now = new Date().toISOString();

  const result = await client.query(
    `INSERT INTO shared.branches
      (id, installation_id, code, name, address, phone, email, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11)
     RETURNING id, installation_id, code, name, address, phone, email, is_active, created_at, updated_at, created_by, updated_by`,
    [id, installationId, code, name, address || null, phone || null, email || null, now, now, createdBy, createdBy],
  );

  return result.rows[0] || null;
}

export async function getBranchById(client, { id }) {
  const result = await client.query(
    `SELECT id, installation_id, code, name, address, phone, email, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.branches
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] || null;
}

export async function getBranchByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT id, installation_id, code, name, address, phone, email, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.branches
     WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );

  return result.rows[0] || null;
}

export async function listBranchesForInstallation(client, { installationId, active, limit = 100, offset = 0 }) {
  let query = `SELECT id, installation_id, code, name, address, phone, email, is_active, created_at, updated_at, created_by, updated_by
               FROM shared.branches
               WHERE installation_id = $1`;
  const params = [installationId];

  if (active !== undefined) {
    query += ` AND is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  query += ` ORDER BY code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await client.query(query, params);
  return result.rows;
}

export async function updateBranch(client, { id, installationId, name, address, phone, email, updatedBy }) {
  const now = new Date().toISOString();

  const result = await client.query(
    `UPDATE shared.branches
     SET name = $1, address = $2, phone = $3, email = $4, updated_at = $5, updated_by = $6
     WHERE id = $7 AND installation_id = $8
     RETURNING id, installation_id, code, name, address, phone, email, is_active, created_at, updated_at, created_by, updated_by`,
    [name, address || null, phone || null, email || null, now, updatedBy, id, installationId],
  );

  return result.rows[0] || null;
}

export async function updateBranchActiveStatus(client, { id, installationId, isActive, updatedBy }) {
  const now = new Date().toISOString();

  const result = await client.query(
    `UPDATE shared.branches
     SET is_active = $1, updated_at = $2, updated_by = $3
     WHERE id = $4 AND installation_id = $5
     RETURNING id, installation_id, code, name, address, phone, email, is_active, created_at, updated_at, created_by, updated_by`,
    [isActive, now, updatedBy, id, installationId],
  );

  return result.rows[0] || null;
}

/**
 * Check if a branch has active warehouses
 * Used to prevent deactivation of branches with active children
 */
export async function hasActiveWarehouses(client, { branchId }) {
  const result = await client.query(
    `SELECT COUNT(*) as count FROM shared.warehouses WHERE branch_id = $1 AND is_active = true`,
    [branchId],
  );

  return (result.rows[0]?.count || 0) > 0;
}
