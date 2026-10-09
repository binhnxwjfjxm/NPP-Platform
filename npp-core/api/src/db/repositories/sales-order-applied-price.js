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

export async function getStandardPriceResolutionContext(client, {
  installationId,
  variantId,
  currencyCode,
  priceAt,
  quantity,
  channelId = null,
  customerGroupId = null,
  customerId = null,
}) {
  const result = await client.query(
    `SELECT
       (
         SELECT jsonb_build_object(
           'id', variant.id,
           'product_id', variant.product_id,
           'sku', variant.sku,
           'name', variant.name,
           'is_active', variant.is_active,
           'is_sellable', variant.is_sellable,
           'unit_id', variant.unit_id,
           'conversion_to_base', trim_scale(variant.conversion_to_base)::text,
           'product_code', product.code,
           'product_name', product.name
         )
           FROM shared.product_variants AS variant
           JOIN shared.products AS product
             ON product.installation_id = variant.installation_id
            AND product.id = variant.product_id
          WHERE variant.installation_id = $1
            AND variant.id = $2
          LIMIT 1
       ) AS variant,
       (
         SELECT jsonb_build_object('id', channel.id, 'is_active', channel.is_active)
           FROM shared.sales_channels AS channel
          WHERE channel.installation_id = $1
            AND channel.id = $6
          LIMIT 1
       ) AS channel,
       (
         SELECT jsonb_build_object(
           'id', customer.id,
           'group_id', customer.group_id,
           'is_active', customer.is_active
         )
           FROM shared.customers AS customer
          WHERE customer.installation_id = $1
            AND customer.id = $8
          LIMIT 1
       ) AS customer,
       (
         SELECT jsonb_build_object('id', customer_group.id, 'is_active', customer_group.is_active)
           FROM shared.customer_groups AS customer_group
          WHERE customer_group.installation_id = $1
            AND customer_group.id = $7
          LIMIT 1
       ) AS customer_group,
       COALESCE((
         SELECT jsonb_agg(
           to_jsonb(candidate)
           ORDER BY candidate.priority DESC,
                    candidate.list_rank DESC,
                    candidate.effective_at DESC NULLS LAST,
                    candidate.created_at DESC,
                    candidate.item_id
         )
           FROM (
             SELECT
               item.id AS item_id,
               item.adjustment_type,
               item.amount_minor::text AS amount_minor,
               item.rate_bps::text AS rate_bps,
               trim_scale(item.min_quantity)::text AS min_quantity,
               trim_scale(item.max_quantity)::text AS max_quantity,
               item.source_kind,
               item.source_key,
               item.external_rule_code,
               price_list.id AS price_list_id,
               price_list.code AS price_list_code,
               price_list.name AS price_list_name,
               price_list.list_type,
               price_list.priority,
               price_list.stacking_mode,
               price_list.stop_processing,
               price_list.channel_id,
               price_list.customer_group_id,
               price_list.customer_id,
               CASE price_list.list_type
                 WHEN 'CUSTOM' THEN 6
                 WHEN 'CUSTOMER' THEN 5
                 WHEN 'PROMOTION' THEN 4
                 WHEN 'CUSTOMER_GROUP' THEN 3
                 WHEN 'CHANNEL' THEN 2
                 WHEN 'BASE' THEN 1
                 ELSE 0
               END AS list_rank,
               COALESCE(item.effective_from, price_list.effective_from) AS effective_at,
               item.created_at
             FROM shared.price_list_items AS item
             JOIN shared.price_lists AS price_list
               ON price_list.installation_id = item.installation_id
              AND price_list.id = item.price_list_id
            WHERE item.installation_id = $1
              AND item.variant_id = $2
              AND price_list.currency_code = $3
              AND price_list.is_active = true
              AND item.is_active = true
              AND (price_list.effective_from IS NULL OR price_list.effective_from <= $4)
              AND (price_list.effective_to IS NULL OR price_list.effective_to > $4)
              AND (item.effective_from IS NULL OR item.effective_from <= $4)
              AND (item.effective_to IS NULL OR item.effective_to > $4)
              AND item.min_quantity <= $5
              AND (item.max_quantity IS NULL OR item.max_quantity >= $5)
              AND (
                price_list.list_type = 'BASE'
                OR (
                  (price_list.channel_id IS NULL OR price_list.channel_id = $6)
                  AND (
                    price_list.customer_group_id IS NULL
                    OR price_list.customer_group_id = COALESCE(
                      (
                        SELECT customer.group_id
                          FROM shared.customers AS customer
                         WHERE customer.installation_id = $1
                           AND customer.id = $8
                         LIMIT 1
                      ),
                      $7::uuid
                    )
                  )
                  AND (price_list.customer_id IS NULL OR price_list.customer_id = $8)
                )
              )
           ) AS candidate
       ), '[]'::jsonb) AS candidates`,
    [
      installationId,
      variantId,
      currencyCode,
      priceAt,
      quantity,
      channelId,
      customerGroupId,
      customerId,
    ],
  );
  return rows(result)[0] ?? null;
}
