import { randomUUID } from 'node:crypto';

/**
 * Warehouse location repository for managing locations within warehouses
 * All operations preserve installation and warehouse boundaries
 */

export async function insertWarehouseLocation(client, { installationId, warehouseId, code, name, locationType, createdBy }) {
  const id = randomUUID();
  const now = new Date().toISOString();

  const result = await client.query(
    `INSERT INTO shared.warehouse_locations
      (id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10)
     RETURNING id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by`,
    [id, installationId, warehouseId, code, name, locationType, now, now, createdBy, createdBy],
  );

  return result.rows[0] || null;
}

export async function getWarehouseLocationById(client, { id }) {
  const result = await client.query(
    `SELECT id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.warehouse_locations
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] || null;
}

export async function getWarehouseLocationByCode(client, { warehouseId, code }) {
  const result = await client.query(
    `SELECT id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.warehouse_locations
     WHERE warehouse_id = $1 AND code = $2`,
    [warehouseId, code],
  );

  return result.rows[0] || null;
}

export async function listWarehouseLocationsForInstallation(client, { installationId, active, limit = 100, offset = 0 }) {
  let query = `SELECT id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by
               FROM shared.warehouse_locations
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

export async function listWarehouseLocationsForWarehouse(client, { warehouseId, active, limit = 100, offset = 0 }) {
  let query = `SELECT id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by
               FROM shared.warehouse_locations
               WHERE warehouse_id = $1`;
  const params = [warehouseId];

  if (active !== undefined) {
    query += ` AND is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  query += ` ORDER BY code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await client.query(query, params);
  return result.rows;
}

export async function updateWarehouseLocation(client, { id, installationId, name, locationType, updatedBy }) {
  const now = new Date().toISOString();

  const result = await client.query(
    `UPDATE shared.warehouse_locations
     SET name = $1, location_type = $2, updated_at = $3, updated_by = $4
     WHERE id = $5 AND installation_id = $6
     RETURNING id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by`,
    [name, locationType, now, updatedBy, id, installationId],
  );

  return result.rows[0] || null;
}

export async function updateWarehouseLocationActiveStatus(client, { id, installationId, isActive, updatedBy }) {
  const now = new Date().toISOString();

  const result = await client.query(
    `UPDATE shared.warehouse_locations
     SET is_active = $1, updated_at = $2, updated_by = $3
     WHERE id = $4 AND installation_id = $5
     RETURNING id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by`,
    [isActive, now, updatedBy, id, installationId],
  );

  return result.rows[0] || null;
}
