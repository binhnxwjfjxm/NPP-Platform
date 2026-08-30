export async function searchPortalCatalogOptions(client, {
  installationId,
  search = '',
  categoryId = null,
  variantKinds = null,
  limit = 51,
  offset = 0,
}) {
  const term = String(search ?? '').trim();
  const normalized = term.toUpperCase();
  const pattern = `%${term}%`;
  const kinds = Array.isArray(variantKinds) && variantKinds.length > 0 ? variantKinds : null;
  const result = await client.query(
    `SELECT
       pv.id,
       pv.product_id,
       pv.sku,
       pv.name AS variant_name,
       pv.variant_kind,
       pv.unit_id,
       pv.conversion_to_base,
       p.code AS product_code,
       p.name AS product_name,
       category.id AS category_id,
       category.code AS category_code,
       category.name AS category_name,
       parent_category.id AS parent_category_id,
       parent_category.code AS parent_category_code,
       parent_category.name AS parent_category_name,
       brand.id AS brand_id,
       brand.code AS brand_code,
       brand.name AS brand_name,
       u.code AS unit_code,
       u.name AS unit_name
     FROM shared.product_variants pv
     JOIN shared.products p
       ON p.installation_id = pv.installation_id
      AND p.id = pv.product_id
     LEFT JOIN shared.units_of_measure u
       ON u.installation_id = pv.installation_id
      AND u.id = pv.unit_id
     LEFT JOIN shared.product_categories category
       ON category.installation_id = p.installation_id
      AND category.id = p.category_id
     LEFT JOIN shared.product_categories parent_category
       ON parent_category.installation_id = category.installation_id
      AND parent_category.id = category.parent_category_id
     LEFT JOIN shared.product_brands brand
       ON brand.installation_id = p.installation_id
      AND brand.id = p.brand_id
     WHERE pv.installation_id = $1
       AND p.is_active = true
       AND p.is_orderable = true
       AND pv.is_active = true
       AND pv.is_sellable = true
       AND pv.unit_id IS NOT NULL
       AND u.is_active = true
       AND pv.conversion_to_base IS NOT NULL
       AND pv.conversion_to_base > 0
       AND (
         $4::uuid IS NULL
         OR EXISTS (
           WITH RECURSIVE category_tree AS (
             SELECT root.id
             FROM shared.product_categories root
             WHERE root.installation_id = $1
               AND root.id = $4::uuid
             UNION
             SELECT child.id
             FROM shared.product_categories child
             JOIN category_tree parent ON child.parent_category_id = parent.id
             WHERE child.installation_id = $1
           )
           SELECT 1
           FROM category_tree
           WHERE category_tree.id = p.category_id
         )
       )
       AND ($5::text[] IS NULL OR pv.variant_kind = ANY($5::text[]))
       AND (
         $2 = ''
         OR pv.sku ILIKE $3
         OR pv.name ILIKE $3
         OR p.code ILIKE $3
         OR p.name ILIKE $3
         OR COALESCE(category.name, '') ILIKE $3
         OR COALESCE(parent_category.name, '') ILIKE $3
         OR COALESCE(brand.name, '') ILIKE $3
         OR EXISTS (
           SELECT 1
           FROM shared.product_barcodes matching_barcode
           WHERE matching_barcode.installation_id = pv.installation_id
             AND matching_barcode.variant_id = pv.id
             AND matching_barcode.is_active = true
             AND matching_barcode.normalized_barcode ILIKE upper($3)
         )
       )
     ORDER BY
       CASE
         WHEN upper(pv.sku) = $2 THEN 0
         WHEN upper(p.code) = $2 THEN 1
         WHEN EXISTS (
           SELECT 1
           FROM shared.product_barcodes exact_barcode
           WHERE exact_barcode.installation_id = pv.installation_id
             AND exact_barcode.variant_id = pv.id
             AND exact_barcode.is_active = true
             AND exact_barcode.normalized_barcode = $2
         ) THEN 2
         WHEN $2 <> '' AND upper(pv.sku) LIKE $2 || '%' THEN 3
         WHEN $2 <> '' AND upper(p.code) LIKE $2 || '%' THEN 4
         ELSE 5
       END,
       p.code ASC,
       pv.sku ASC,
       pv.id ASC
     LIMIT $6 OFFSET $7`,
    [installationId, normalized, pattern, categoryId, kinds, limit, offset],
  );
  return result.rows;
}

export async function listPortalCatalogCategories(client, { installationId }) {
  const result = await client.query(
    `SELECT id, code, name, parent_category_id, sort_order
     FROM shared.product_categories
     WHERE installation_id = $1
       AND is_active = true
       AND is_catalog_visible = true
     ORDER BY sort_order ASC, code ASC, id ASC`,
    [installationId],
  );
  return result.rows;
}
