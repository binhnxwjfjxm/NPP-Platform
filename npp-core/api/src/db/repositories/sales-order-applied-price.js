function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

export async function listLastPurchasePrices(client, {
  installationId,
  customerId,
  variantIds,
}) {
  const ids = [...new Set(
    (Array.isArray(variantIds) ? variantIds : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean),
  )];
  if (ids.length === 0) return [];

  const result = await client.query(
    `WITH selected_variants AS (
       SELECT variant.id AS variant_id,
              variant.unit_id
         FROM shared.product_variants AS variant
        WHERE variant.installation_id = $1
          AND variant.id = ANY($3::uuid[])
     )
     SELECT DISTINCT ON (line.variant_id)
            line.variant_id,
            line.unit_id,
            trim_scale(line.unit_price)::text AS unit_price_minor,
            line.id AS source_line_id,
            version.version_number AS source_version_number,
            version.confirmed_at AS source_confirmed_at,
            sales_order.id AS source_sales_order_id,
            sales_order.order_number AS source_sales_order_number
       FROM sales.sales_orders AS sales_order
       JOIN sales.sales_order_versions AS version
         ON version.installation_id = sales_order.installation_id
        AND version.sales_order_id = sales_order.id
        AND version.version_number = sales_order.current_version_number
       JOIN sales.sales_order_version_lines AS line
         ON line.installation_id = version.installation_id
        AND line.sales_order_version_id = version.id
       JOIN selected_variants AS selected
         ON selected.variant_id = line.variant_id
        AND selected.unit_id = line.unit_id
      WHERE sales_order.installation_id = $1
        AND sales_order.customer_id = $2
        AND sales_order.status IN ('confirmed', 'closed')
        AND version.version_status = 'confirmed'
        AND version.confirmed_at IS NOT NULL
      ORDER BY line.variant_id ASC,
               version.confirmed_at DESC,
               sales_order.id DESC,
               version.version_number DESC,
               line.id DESC`,
    [installationId, customerId, ids],
  );
  return rows(result);
}
