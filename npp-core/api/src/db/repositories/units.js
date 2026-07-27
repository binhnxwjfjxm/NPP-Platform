import { randomUUID } from 'node:crypto';

const UNIT_COLUMNS = `id, installation_id, code, name, symbol, unit_kind, allows_fractional, is_active, created_at, updated_at, created_by, updated_by`;

export async function getUnitById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${UNIT_COLUMNS}
     FROM shared.units_of_measure
     WHERE installation_id = $1 AND id = $2`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getUnitByIdForUpdate(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${UNIT_COLUMNS}
     FROM shared.units_of_measure
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getUnitByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${UNIT_COLUMNS}
     FROM shared.units_of_measure
     WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );
  return result.rows[0] ?? null;
}

export async function listUnits(client, { installationId, search, active, limit = 200, offset = 0 }) {
  let sql = `SELECT ${UNIT_COLUMNS}
             FROM shared.units_of_measure
             WHERE installation_id = $1`;
  const params = [installationId];
  if (active !== undefined) {
    params.push(Boolean(active));
    sql += ` AND is_active = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (code ILIKE $${params.length} OR name ILIKE $${params.length} OR COALESCE(symbol, '') ILIKE $${params.length})`;
  }
  params.push(limit, offset);
  sql += ` ORDER BY code ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const result = await client.query(sql, params);
  return result.rows;
}

export async function insertUnit(client, {
  installationId,
  code,
  name,
  symbol,
  unitKind,
  allowsFractional,
  isActive = true,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.units_of_measure
      (id, installation_id, code, name, symbol, unit_kind, allows_fractional, is_active,
       created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT DO NOTHING
     RETURNING ${UNIT_COLUMNS}`,
    [id, installationId, code, name, symbol ?? null, unitKind, Boolean(allowsFractional), Boolean(isActive), now, now, createdBy, createdBy],
  );
  return result.rows[0] ?? null;
}

export async function updateUnit(client, {
  installationId,
  id,
  name,
  symbol,
  unitKind,
  allowsFractional,
  isActive,
  expectedUpdatedAt,
  updatedBy,
}) {
  const result = await client.query(
    `UPDATE shared.units_of_measure
     SET name = $1,
         symbol = $2,
         unit_kind = $3,
         allows_fractional = $4,
         is_active = $5,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $6
     WHERE installation_id = $7 AND id = $8 AND updated_at = $9
     RETURNING ${UNIT_COLUMNS}`,
    [name, symbol ?? null, unitKind, Boolean(allowsFractional), Boolean(isActive), updatedBy, installationId, id, expectedUpdatedAt],
  );
  return result.rows[0] ?? null;
}

export async function countActiveVariantAssignments(client, { installationId, unitId }) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM shared.product_variants
     WHERE installation_id = $1 AND unit_id = $2 AND is_active = true`,
    [installationId, unitId],
  );
  return result.rows[0]?.count ?? 0;
}
