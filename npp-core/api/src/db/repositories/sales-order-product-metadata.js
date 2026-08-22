function uniqueProductIds(productIds) {
  return [...new Set((Array.isArray(productIds) ? productIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

export async function listSalesOrderProductMetadata(client, { installationId, productIds }) {
  const ids = uniqueProductIds(productIds);
  if (ids.length === 0) return [];

  const result = await client.query(
    `SELECT
       product.id AS product_id,
       category.id AS category_id,
       category.code AS category_code,
       category.name AS category_name,
       parent_category.id AS parent_category_id,
       parent_category.code AS parent_category_code,
       parent_category.name AS parent_category_name,
       brand.id AS brand_id,
       brand.code AS brand_code,
       brand.name AS brand_name
     FROM shared.products product
     LEFT JOIN shared.product_categories category
       ON category.installation_id = product.installation_id
      AND category.id = product.category_id
     LEFT JOIN shared.product_categories parent_category
       ON parent_category.installation_id = category.installation_id
      AND parent_category.id = category.parent_category_id
     LEFT JOIN shared.product_brands brand
       ON brand.installation_id = product.installation_id
      AND brand.id = product.brand_id
     WHERE product.installation_id = $1
       AND product.id = ANY($2::uuid[])`,
    [installationId, ids],
  );

  return result.rows;
}
