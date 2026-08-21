import { randomUUID } from 'node:crypto';

const PRODUCT_VARIANT_COLUMNS = `pv.id, pv.installation_id, pv.product_id, pv.sku, pv.name, pv.variant_kind,
  pv.is_inventory_base, pv.is_sellable, pv.is_catalog_visible, pv.is_active,
  pv.unit_id, pv.conversion_to_base, pv.is_purchasable, pv.net_content_value, pv.net_content_uom_code,
  pv.source_unit_label, pv.source_package_description, pv.unit_source_metadata,
  u.code AS unit_code, u.name AS unit_name, u.symbol AS unit_symbol, u.unit_kind, u.allows_fractional,
  pv.created_at, pv.updated_at, pv.created_by, pv.updated_by`;

const BASE_SELECT = `SELECT ${PRODUCT_VARIANT_COLUMNS}
  FROM shared.product_variants pv
  LEFT JOIN shared.units_of_measure u
    ON u.installation_id = pv.installation_id AND u.id = pv.unit_id`;

export async function getProductVariantByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `${BASE_SELECT}
     WHERE pv.id = $1 AND pv.installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] ?? null;
}

export async function getProductVariantByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `${BASE_SELECT}
     WHERE pv.id = $1 AND pv.installation_id = $2
     FOR UPDATE OF pv`,
    [id, installationId],
  );
  return result.rows[0] ?? null;
}

export async function getProductVariantBySku(client, { installationId, sku }) {
  const result = await client.query(
    `${BASE_SELECT}
     WHERE pv.installation_id = $1 AND pv.sku = $2`,
    [installationId, sku],
  );
  return result.rows[0] ?? null;
}

export async function listProductVariantsForProduct(client, { installationId, productId }) {
  const result = await client.query(
    `${BASE_SELECT}
     WHERE pv.installation_id = $1 AND pv.product_id = $2
     ORDER BY pv.is_inventory_base DESC, pv.sku ASC`,
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
  const variantId = id ?? randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.product_variants
      (id, installation_id, product_id, sku, name, variant_kind, is_inventory_base,
       is_sellable, is_catalog_visible, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [variantId, installationId, productId, sku, name, variantKind, Boolean(isInventoryBase),
      Boolean(isSellable), Boolean(isCatalogVisible), Boolean(isActive), now, now, createdBy, createdBy],
  );
  if (!result.rows[0]) return null;
  return getProductVariantByIdForInstallation(client, { id: variantId, installationId });
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
}) {
  const result = await client.query(
    `UPDATE shared.product_variants
     SET name = $1,
         variant_kind = $2,
         is_inventory_base = $3,
         is_sellable = $4,
         is_catalog_visible = $5,
         is_active = $6,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $7
     WHERE id = $8 AND installation_id = $9
     RETURNING id`,
    [name, variantKind, Boolean(isInventoryBase), Boolean(isSellable), Boolean(isCatalogVisible), Boolean(isActive), updatedBy, id, installationId],
  );
  if (!result.rows[0]) return null;
  return getProductVariantByIdForInstallation(client, { id, installationId });
}

export async function updateVariantUnit(client, {
  id,
  installationId,
  unitId,
  conversionToBase,
  isPurchasable,
  netContentValue,
  netContentUomCode,
  sourceUnitLabel,
  sourcePackageDescription,
  unitSourceMetadata,
  expectedUpdatedAt,
  updatedBy,
}) {
  const result = await client.query(
    `UPDATE shared.product_variants
     SET unit_id = $1,
         conversion_to_base = $2,
         is_purchasable = $3,
         net_content_value = $4,
         net_content_uom_code = $5,
         source_unit_label = $6,
         source_package_description = $7,
         unit_source_metadata = $8,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $9
     WHERE installation_id = $10 AND id = $11
       AND ($12::timestamptz IS NULL OR date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $12::timestamptz))
     RETURNING id`,
    [unitId, conversionToBase, Boolean(isPurchasable), netContentValue, netContentUomCode,
      sourceUnitLabel, sourcePackageDescription, unitSourceMetadata ?? {}, updatedBy,
      installationId, id, expectedUpdatedAt ?? null],
  );
  if (!result.rows[0]) return null;
  return getProductVariantByIdForInstallation(client, { id, installationId });
}

export async function countActiveInventoryBaseVariantsForProduct(client, { installationId, productId, excludeVariantId }) {
  const params = [installationId, productId];
  let query = `SELECT COUNT(*)::int AS count
     FROM shared.product_variants
     WHERE installation_id = $1 AND product_id = $2 AND is_inventory_base = true AND is_active = true`;
  if (excludeVariantId) {
    query += ' AND id <> $3';
    params.push(excludeVariantId);
  }
  const result = await client.query(query, params);
  return result.rows[0]?.count ?? 0;
}

export async function countActiveSellableVariantsForProductExcludingVariant(client, { installationId, productId, excludeVariantId }) {
  const params = [installationId, productId];
  let query = `SELECT COUNT(*)::int AS count
     FROM shared.product_variants
     WHERE installation_id = $1 AND product_id = $2 AND is_active = true AND is_sellable = true
       AND unit_id IS NOT NULL AND conversion_to_base IS NOT NULL`;
  if (excludeVariantId) {
    query += ' AND id <> $3';
    params.push(excludeVariantId);
  }
  const result = await client.query(query, params);
  return result.rows[0]?.count ?? 0;
}

export async function getProductVariantsByIdsOrSkus(client, { installationId, ids, skus }) {
  const result = await client.query(
    `${BASE_SELECT}
     WHERE pv.installation_id = $1
       AND (pv.id = ANY($2::uuid[]) OR pv.sku = ANY($3::text[]))`,
    [installationId, ids, skus],
  );
  return result.rows;
}

export async function listProductVariantsForProducts(client, { installationId, productIds }) {
  if (!productIds.length) return [];
  const result = await client.query(
    `${BASE_SELECT}
     WHERE pv.installation_id = $1 AND pv.product_id = ANY($2::uuid[])
     ORDER BY pv.product_id, pv.sku`,
    [installationId, productIds],
  );
  return result.rows;
}
