import { randomUUID } from 'node:crypto';

const PRODUCT_CATEGORY_COLUMNS = `id, installation_id, code, name, parent_category_id, description, sort_order, is_catalog_visible, is_active, created_at, updated_at, created_by, updated_by`;

export async function insertProductCategory(client, {
  installationId,
  code,
  name,
  parentCategoryId,
  description,
  sortOrder,
  isCatalogVisible,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.product_categories
      (id, installation_id, code, name, parent_category_id, description, sort_order,
       is_catalog_visible, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12)
     RETURNING ${PRODUCT_CATEGORY_COLUMNS}`,
    [
      id,
      installationId,
      code,
      name,
      parentCategoryId || null,
      description || null,
      sortOrder,
      Boolean(isCatalogVisible),
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  return result.rows[0] || null;
}

export async function getProductCategoryByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_CATEGORY_COLUMNS}
     FROM shared.product_categories
     WHERE id = $1 AND installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getProductCategoryByIdForInstallationForShare(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_CATEGORY_COLUMNS}
     FROM shared.product_categories
     WHERE id = $1 AND installation_id = $2
     FOR SHARE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getProductCategoryByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_CATEGORY_COLUMNS}
     FROM shared.product_categories
     WHERE id = $1 AND installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getProductCategoryByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${PRODUCT_CATEGORY_COLUMNS}
     FROM shared.product_categories
     WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );
  return result.rows[0] || null;
}

export async function listProductCategoriesForInstallation(client, {
  installationId,
  search,
  active,
  limit = 100,
  offset = 0,
}) {
  let query = `SELECT ${PRODUCT_CATEGORY_COLUMNS}
               FROM shared.product_categories
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

  query += ` ORDER BY sort_order ASC, code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await client.query(query, params);
  return result.rows;
}

export async function updateProductCategory(client, {
  id,
  installationId,
  name,
  parentCategoryId,
  description,
  sortOrder,
  isCatalogVisible,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const params = [
    name,
    parentCategoryId || null,
    description || null,
    sortOrder,
    Boolean(isCatalogVisible),
    Boolean(isActive),
    updatedBy,
    id,
    installationId,
  ];
  let query = `UPDATE shared.product_categories
     SET name = $1,
         parent_category_id = $2,
         description = $3,
         sort_order = $4,
         is_catalog_visible = $5,
         is_active = $6,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $7
     WHERE id = $8 AND installation_id = $9`;

  if (expectedUpdatedAt) {
    query += ` AND updated_at = $10`;
    params.push(expectedUpdatedAt);
  }

  query += ` RETURNING ${PRODUCT_CATEGORY_COLUMNS}`;
  const result = await client.query(query, params);
  return result.rows[0] || null;
}

export async function hasActiveProductsForCategory(client, { categoryId, installationId }) {
  const result = await client.query(
    `SELECT COUNT(*) AS count
     FROM shared.products
     WHERE installation_id = $1 AND category_id = $2 AND is_active = true`,
    [installationId, categoryId],
  );
  return Number(result.rows[0]?.count || 0) > 0;
}

export async function isProductCategoryDescendantOf(client, { installationId, categoryId, ancestorId }) {
  const result = await client.query(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_category_id
       FROM shared.product_categories
       WHERE installation_id = $1 AND id = $2
       UNION ALL
       SELECT pc.id, pc.parent_category_id
       FROM shared.product_categories pc
       JOIN chain ON pc.id = chain.parent_category_id
       WHERE pc.installation_id = $1
     )
     SELECT 1
     FROM chain
     WHERE id = $3
     LIMIT 1`,
    [installationId, categoryId, ancestorId],
  );
  return result.rowCount > 0;
}
