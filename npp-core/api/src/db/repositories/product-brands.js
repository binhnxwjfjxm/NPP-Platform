import { randomUUID } from 'node:crypto';

const PRODUCT_BRAND_COLUMNS = `id, installation_id, code, name, description, is_catalog_visible, is_active, created_at, updated_at, created_by, updated_by`;

export async function insertProductBrand(client, {
  installationId,
  code,
  name,
  description,
  isCatalogVisible,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.product_brands
      (id, installation_id, code, name, description, is_catalog_visible,
       is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10)
     RETURNING ${PRODUCT_BRAND_COLUMNS}`,
    [
      id,
      installationId,
      code,
      name,
      description || null,
      Boolean(isCatalogVisible),
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  return result.rows[0] || null;
}

export async function getProductBrandByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_BRAND_COLUMNS}
     FROM shared.product_brands
     WHERE id = $1 AND installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getProductBrandByIdForInstallationForShare(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_BRAND_COLUMNS}
     FROM shared.product_brands
     WHERE id = $1 AND installation_id = $2
     FOR SHARE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getProductBrandByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_BRAND_COLUMNS}
     FROM shared.product_brands
     WHERE id = $1 AND installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getProductBrandByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${PRODUCT_BRAND_COLUMNS}
     FROM shared.product_brands
     WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );
  return result.rows[0] || null;
}

export async function listProductBrandsForInstallation(client, {
  installationId,
  search,
  active,
  limit = 100,
  offset = 0,
}) {
  let query = `SELECT ${PRODUCT_BRAND_COLUMNS}
               FROM shared.product_brands
               WHERE installation_id = $1`;
  const params = [installationId];

  if (active !== undefined) {
    query += ` AND is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  if (search) {
    query += ` AND (code ILIKE $${params.length + 1} OR name ILIKE $${params.length + 1})`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await client.query(query, params);
  return result.rows;
}

export async function updateProductBrand(client, {
  id,
  installationId,
  name,
  description,
  isCatalogVisible,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const params = [
    name,
    description || null,
    Boolean(isCatalogVisible),
    Boolean(isActive),
    updatedBy,
    id,
    installationId,
  ];
  let query = `UPDATE shared.product_brands
     SET name = $1,
         description = $2,
         is_catalog_visible = $3,
         is_active = $4,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $5
     WHERE id = $6 AND installation_id = $7`;

  if (expectedUpdatedAt) {
    query += ` AND updated_at = $8`;
    params.push(expectedUpdatedAt);
  }

  query += ` RETURNING ${PRODUCT_BRAND_COLUMNS}`;
  const result = await client.query(query, params);
  return result.rows[0] || null;
}

export async function hasActiveProductsForBrand(client, { brandId, installationId }) {
  const result = await client.query(
    `SELECT COUNT(*) AS count
     FROM shared.products
     WHERE installation_id = $1 AND brand_id = $2 AND is_active = true`,
    [installationId, brandId],
  );
  return Number(result.rows[0]?.count || 0) > 0;
}
