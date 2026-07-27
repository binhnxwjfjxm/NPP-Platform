import { randomUUID } from 'node:crypto';

const PRODUCT_VARIANT_COLUMNS = `id, installation_id, product_id, sku, name, variant_kind, is_inventory_base, is_sellable, is_catalog_visible, is_active, created_at, updated_at, created_by, updated_by`;

export async function getProductVariantByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_VARIANT_COLUMNS}
     FROM shared.product_variants
     WHERE id = $1 AND installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getProductVariantByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_VARIANT_COLUMNS}
     FROM shared.product_variants
     WHERE id = $1 AND installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getProductVariantBySku(client, { installationId, sku }) {
  const result = await client.query(
    `SELECT ${PRODUCT_VARIANT_COLUMNS}
     FROM shared.product_variants
     WHERE installation_id = $1 AND sku = $2`,
    [installationId, sku],
  );
  return result.rows[0] || null;
}

export async function listProductVariantsForProduct(client, { installationId, productId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_VARIANT_COLUMNS}
     FROM shared.product_variants
     WHERE installation_id = $1 AND product_id = $2
     ORDER BY sku ASC`,
    [installationId, productId],
  );
  return result.rows;
}

export async function insertProductVariant(client, {
  id,
  installationId,
  productId,
  sku,
  name,
  variantKind,
  isInventoryBase,
  isSellable,
  isCatalogVisible,
  isActive,
  createdBy,
}) {
  const variantId = id || randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.product_variants
      (id, installation_id, product_id, sku, name, variant_kind, is_inventory_base,
       is_sellable, is_catalog_visible, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING ${PRODUCT_VARIANT_COLUMNS}`,
    [
      variantId,
      installationId,
      productId,
      sku,
      name,
      variantKind,
      Boolean(isInventoryBase),
      Boolean(isSellable),
      Boolean(isCatalogVisible),
      Boolean(isActive),
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  return result.rows[0] || null;
}

export async function updateProductVariant(client, {
  id,
  installationId,
  name,
  variantKind,
  isInventoryBase,
  isSellable,
  isCatalogVisible,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const params = [
    name,
    variantKind,
    Boolean(isInventoryBase),
    Boolean(isSellable),
    Boolean(isCatalogVisible),
    Boolean(isActive),
    updatedBy,
    id,
    installationId,
  ];
  let query = `UPDATE shared.product_variants
     SET name = $1,
         variant_kind = $2,
         is_inventory_base = $3,
         is_sellable = $4,
         is_catalog_visible = $5,
         is_active = $6,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $7
     WHERE id = $8 AND installation_id = $9`;

  if (expectedUpdatedAt) {
    query += ` AND updated_at = $10`;
    params.push(expectedUpdatedAt);
  }

  query += ` RETURNING ${PRODUCT_VARIANT_COLUMNS}`;
  const result = await client.query(query, params);
  return result.rows[0] || null;
}

export async function countActiveInventoryBaseVariantsForProduct(client, { installationId, productId, excludeVariantId }) {
  const params = [installationId, productId];
  let query = `SELECT COUNT(*) AS count
     FROM shared.product_variants
     WHERE installation_id = $1 AND product_id = $2 AND is_inventory_base = true AND is_active = true`;
  if (excludeVariantId) {
    query += ` AND id <> $3`;
    params.push(excludeVariantId);
  }
  const result = await client.query(query, params);
  return Number(result.rows[0]?.count || 0);
}

export async function countActiveSellableVariantsForProductExcludingVariant(client, {
  installationId,
  productId,
  excludeVariantId,
}) {
  const params = [installationId, productId];
  let query = `SELECT COUNT(*) AS count
     FROM shared.product_variants
     WHERE installation_id = $1 AND product_id = $2 AND is_active = true AND is_sellable = true`;
  if (excludeVariantId) {
    query += ` AND id <> $3`;
    params.push(excludeVariantId);
  }
  const result = await client.query(query, params);
  return Number(result.rows[0]?.count || 0);
}

export async function getProductVariantsByIdsOrSkus(client, { installationId, ids, skus }) {
  const result = await client.query(
    `SELECT ${PRODUCT_VARIANT_COLUMNS}
     FROM shared.product_variants
     WHERE installation_id = $1
       AND (id = ANY($2::uuid[]) OR sku = ANY($3::text[]))`,
    [installationId, ids, skus],
  );
  return result.rows;
}
