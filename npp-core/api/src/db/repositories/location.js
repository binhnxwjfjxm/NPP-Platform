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

export async function getWarehouseLocationByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by
     FROM shared.warehouse_locations
     WHERE id = $1 AND installation_id = $2`,
    [id, installationId],
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

export async function listWarehouseLocationsForWarehouse(client, { warehouseId, installationId, active, limit = 100, offset = 0 }) {
  let query = `SELECT id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by
               FROM shared.warehouse_locations
               WHERE warehouse_id = $1 AND installation_id = $2`;
  const params = [warehouseId, installationId];

  if (active !== undefined) {
    query += ` AND is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  query += ` ORDER BY code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await client.query(query, params);
  return result.rows;
}

export async function updateWarehouseLocation(client, { id, installationId, name, locationType, updatedBy, expectedUpdatedAt = null }) {
  const params = [name, locationType, updatedBy, id, installationId];
  let query = `UPDATE shared.warehouse_locations
     SET name = $1,
         location_type = $2,
         updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond'),
         updated_by = $3
     WHERE id = $4 AND installation_id = $5`;

  if (expectedUpdatedAt) {
    query += ` AND updated_at = $6`;
    params.push(expectedUpdatedAt);
  }

  query += ` RETURNING id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by`;

  const result = await client.query(query, params);
  return result.rows[0] || null;
}

export async function updateWarehouseLocationActiveStatus(client, { id, installationId, isActive, updatedBy, expectedUpdatedAt = null }) {
  const params = [isActive, updatedBy, id, installationId];
  let query = `UPDATE shared.warehouse_locations
     SET is_active = $1,
         updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond'),
         updated_by = $2
     WHERE id = $3 AND installation_id = $4`;

  if (expectedUpdatedAt) {
    query += ` AND updated_at = $5`;
    params.push(expectedUpdatedAt);
  }

  query += ` RETURNING id, installation_id, warehouse_id, code, name, location_type, is_active, created_at, updated_at, created_by, updated_by`;

  const result = await client.query(query, params);
  return result.rows[0] || null;
}
