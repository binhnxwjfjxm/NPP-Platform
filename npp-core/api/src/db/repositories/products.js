import { randomUUID } from 'node:crypto';

const PRODUCT_COLUMNS = `p.id, p.installation_id, p.code, p.name, p.catalog_name, p.category_id, p.brand_id, p.description, p.notes, p.is_catalog_visible, p.is_orderable, p.is_active, p.created_at, p.updated_at, p.created_by, p.updated_by, c.code AS category_code, c.name AS category_name, b.code AS brand_code, b.name AS brand_name`;

export async function getProductByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_COLUMNS}
     FROM shared.products p
     LEFT JOIN shared.product_categories c
       ON c.installation_id = p.installation_id AND c.id = p.category_id
     LEFT JOIN shared.product_brands b
       ON b.installation_id = p.installation_id AND b.id = p.brand_id
     WHERE p.id = $1 AND p.installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] ?? null;
}

export async function getProductByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${PRODUCT_COLUMNS}
     FROM shared.products p
     LEFT JOIN shared.product_categories c
       ON c.installation_id = p.installation_id AND c.id = p.category_id
     LEFT JOIN shared.product_brands b
       ON b.installation_id = p.installation_id AND b.id = p.brand_id
     WHERE p.id = $1 AND p.installation_id = $2
     FOR UPDATE OF p`,
    [id, installationId],
  );
  return result.rows[0] ?? null;
}

export async function getProductByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${PRODUCT_COLUMNS}
     FROM shared.products p
     LEFT JOIN shared.product_categories c
       ON c.installation_id = p.installation_id AND c.id = p.category_id
     LEFT JOIN shared.product_brands b
       ON b.installation_id = p.installation_id AND b.id = p.brand_id
     WHERE p.installation_id = $1 AND p.code = $2`,
    [installationId, code],
  );
  return result.rows[0] ?? null;
}

export async function listProductsForInstallation(client, {
  installationId,
  search,
  active,
  catalogVisible,
  orderable,
  categoryId,
  brandId,
  limit = 100,
  offset = 0,
}) {
  let query = `SELECT ${PRODUCT_COLUMNS}
               FROM shared.products p
               LEFT JOIN shared.product_categories c
                 ON c.installation_id = p.installation_id AND c.id = p.category_id
               LEFT JOIN shared.product_brands b
                 ON b.installation_id = p.installation_id AND b.id = p.brand_id
               WHERE p.installation_id = $1`;
  const params = [installationId];
  if (active !== undefined) {
    query += ` AND p.is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }
  if (catalogVisible !== undefined) {
    query += ` AND p.is_catalog_visible = $${params.length + 1}`;
    params.push(Boolean(catalogVisible));
  }
  if (orderable !== undefined) {
    query += ` AND p.is_orderable = $${params.length + 1}`;
    params.push(Boolean(orderable));
  }
  if (categoryId) {
    query += ` AND p.category_id = $${params.length + 1}`;
    params.push(categoryId);
  }
  if (brandId) {
    query += ` AND p.brand_id = $${params.length + 1}`;
    params.push(brandId);
  }
  if (search) {
    query += ` AND (
      p.code ILIKE $${params.length + 1}
      OR p.name ILIKE $${params.length + 1}
      OR COALESCE(p.catalog_name, '') ILIKE $${params.length + 1}
      OR EXISTS (
        SELECT 1 FROM shared.product_variants pv
        WHERE pv.installation_id = p.installation_id
          AND pv.product_id = p.id
          AND pv.sku ILIKE $${params.length + 1}
      )
    )`;
    params.push(`%${search}%`);
  }
  query += ` ORDER BY p.code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);
  const result = await client.query(query, params);
  return result.rows;
}

export async function insertProduct(client, {
  id,
  installationId,
  code,
  name,
  catalogName,
  categoryId,
  brandId,
  description,
  notes,
  isCatalogVisible,
  isOrderable,
  isActive,
  createdBy,
}) {
  const productId = id ?? randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.products
      (id, installation_id, code, name, catalog_name, category_id, brand_id, description, notes,
       is_catalog_visible, is_orderable, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      productId,
      installationId,
      code,
      name,
      catalogName ?? null,
      categoryId ?? null,
      brandId ?? null,
      description ?? null,
      notes ?? null,
      Boolean(isCatalogVisible),
      Boolean(isOrderable),
      Boolean(isActive),
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  if (!result.rows[0]) return null;
  return getProductByIdForInstallation(client, { id: productId, installationId });
}

export async function updateProduct(client, {
  id,
  installationId,
  code,
  name,
  catalogName,
  categoryId,
  brandId,
  description,
  notes,
  isCatalogVisible,
  isOrderable,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const params = [
    name,
    catalogName ?? null,
    categoryId ?? null,
    brandId ?? null,
    description ?? null,
    notes ?? null,
    Boolean(isCatalogVisible),
    Boolean(isOrderable),
    Boolean(isActive),
    updatedBy,
    id ?? null,
    installationId,
    code,
  ];
  let query = `UPDATE shared.products
     SET name = $1,
         catalog_name = $2,
         category_id = $3,
         brand_id = $4,
         description = $5,
         notes = $6,
         is_catalog_visible = $7,
         is_orderable = $8,
         is_active = $9,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $10
     WHERE installation_id = $12
       AND (($11::uuid IS NOT NULL AND id = $11::uuid) OR ($11::uuid IS NULL AND code = $13))`;
  if (typeof expectedUpdatedAt === 'string') {
    query += ' AND updated_at = $14';
    params.push(expectedUpdatedAt);
  }
  query += ' RETURNING id';
  const result = await client.query(query, params);
  const updatedId = result.rows[0]?.id;
  if (!updatedId) return null;
  return getProductByIdForInstallation(client, { id: updatedId, installationId });
}

export async function countActiveVariantsForProduct(client, { productId, installationId }) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM shared.product_variants
     WHERE installation_id = $1 AND product_id = $2 AND is_active = true`,
    [installationId, productId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function countActiveSellableVariantsForProduct(client, { productId, installationId }) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM shared.product_variants
     WHERE installation_id = $1 AND product_id = $2 AND is_active = true AND is_sellable = true
       AND unit_id IS NOT NULL AND conversion_to_base IS NOT NULL`,
    [installationId, productId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function getProductsByIdsOrCodes(client, { installationId, ids, codes }) {
  const result = await client.query(
    `SELECT id, code
     FROM shared.products
     WHERE installation_id = $1
       AND (id = ANY($2::uuid[]) OR code = ANY($3::text[]))`,
    [installationId, ids, codes],
  );
  return result.rows;
}
