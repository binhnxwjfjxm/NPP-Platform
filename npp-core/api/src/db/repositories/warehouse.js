import { randomUUID } from 'node:crypto';

/**
 * Warehouse repository for managing warehouses scoped to installation and branch
 * All operations preserve installation and branch boundaries
 */

export async function insertWarehouse(client, { installationId, branchId, code, name, warehouseType, createdBy }) {
  const id = randomUUID();
  const now = new Date().toISOString();

  const result = await client.query(
    `INSERT INTO shared.warehouses
      (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10)
     RETURNING id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by`,
    [id, installationId, branchId, code, name, warehouseType, now, now, createdBy, createdBy],
  );

  return result.rows[0] || null;
}

export async function getWarehouseById(client, { id }) {
  const result = await client.query(
    `SELECT id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.warehouses
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] || null;
}

export async function getWarehouseByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.warehouses
     WHERE id = $1 AND installation_id = $2`,
    [id, installationId],
  );

  return result.rows[0] || null;
}

export async function getWarehouseByIdForInstallationForShare(client, { id, installationId }) {
  const result = await client.query(
    `SELECT id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.warehouses
     WHERE id = $1 AND installation_id = $2
     FOR SHARE`,
    [id, installationId],
  );

  return result.rows[0] || null;
}

export async function getWarehouseByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.warehouses
     WHERE id = $1 AND installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );

  return result.rows[0] || null;
}

export async function getWarehouseByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.warehouses
     WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );

  return result.rows[0] || null;
}

export async function listWarehousesForInstallation(client, { installationId, active, limit = 100, offset = 0 }) {
  let query = `SELECT id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by
               FROM shared.warehouses
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

export async function listWarehousesForBranch(client, { branchId, installationId, active, limit = 100, offset = 0 }) {
  let query = `SELECT id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by
               FROM shared.warehouses
               WHERE branch_id = $1 AND installation_id = $2`;
  const params = [branchId, installationId];

  if (active !== undefined) {
    query += ` AND is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  query += ` ORDER BY code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await client.query(query, params);
  return result.rows;
}

export async function updateWarehouse(client, { id, installationId, name, warehouseType, updatedBy, expectedUpdatedAt = null }) {
  const params = [name, warehouseType, updatedBy, id, installationId];
  let query = `UPDATE shared.warehouses
     SET name = $1,
         warehouse_type = $2,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $3
     WHERE id = $4 AND installation_id = $5`;

  if (expectedUpdatedAt) {
    query += ` AND updated_at = $6`;
    params.push(expectedUpdatedAt);
  }

  query += ` RETURNING id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by`;

  const result = await client.query(query, params);
  return result.rows[0] || null;
}

export async function updateWarehouseActiveStatus(client, { id, installationId, isActive, updatedBy, expectedUpdatedAt = null }) {
  const params = [isActive, updatedBy, id, installationId];
  let query = `UPDATE shared.warehouses
     SET is_active = $1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $2
     WHERE id = $3 AND installation_id = $4`;

  if (expectedUpdatedAt) {
    query += ` AND updated_at = $5`;
    params.push(expectedUpdatedAt);
  }

  query += ` RETURNING id, installation_id, branch_id, code, name, warehouse_type, is_active, created_at, updated_at, created_by, updated_by`;

  const result = await client.query(query, params);
  return result.rows[0] || null;
}

/**
 * Check if a warehouse has active locations
 * Used to prevent deactivation of warehouses with active children
 */
export async function hasActiveLocations(client, { warehouseId, installationId }) {
  const result = await client.query(
    `SELECT COUNT(*) as count FROM shared.warehouse_locations WHERE warehouse_id = $1 AND installation_id = $2 AND is_active = true`,
    [warehouseId, installationId],
  );

  return (result.rows[0]?.count || 0) > 0;
}
