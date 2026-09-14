export async function listTrackingPolicyCandidates(client, {
  installationId,
  search = null,
  limit = 500,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT variant.id AS base_variant_id,
            variant.sku AS base_sku,
            variant.name AS base_variant_name,
            variant.is_active AS base_variant_active,
            variant.is_inventory_base,
            product.code AS product_code,
            product.name AS product_name,
            product.is_active AS product_active,
            (policy.base_variant_id IS NOT NULL) AS has_policy,
            COALESCE((
              SELECT string_agg(concat_ws(' ', related.sku, related.name), ' ' ORDER BY related.sku)
                FROM shared.product_variants related
               WHERE related.installation_id = variant.installation_id
                 AND related.product_id = variant.product_id
            ), '') AS related_variant_search_text
       FROM shared.product_variants variant
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = variant.installation_id
        AND policy.base_variant_id = variant.id
      WHERE variant.installation_id = $1
        AND variant.is_inventory_base = true
        AND (
          $2::text IS NULL OR
          variant.sku ILIKE $2 OR
          variant.name ILIKE $2 OR
          product.code ILIKE $2 OR
          product.name ILIKE $2 OR
          EXISTS (
            SELECT 1
              FROM shared.product_variants related_search
             WHERE related_search.installation_id = variant.installation_id
               AND related_search.product_id = variant.product_id
               AND (
                 related_search.sku ILIKE $2 OR
                 related_search.name ILIKE $2
               )
          )
        )
      ORDER BY variant.is_active DESC, product.is_active DESC, variant.sku ASC, variant.id ASC
      LIMIT $3 OFFSET $4`,
    [
      installationId,
      search ? `%${String(search).trim()}%` : null,
      limit,
      offset,
    ],
  );
  return result.rows ?? [];
}
