export async function listSalesOrderSkuInventoryPreviews(client, {
  installationId,
  warehouseId,
  variantIds,
}) {
  const ids = [...new Set((Array.isArray(variantIds) ? variantIds : []).filter(Boolean))];
  if (ids.length === 0) return [];
  const result = await client.query(
    `WITH selected AS (
       SELECT pv.id AS sales_variant_id,
              product.is_inventory_managed,
              base_scope.base_variant_count,
              base_scope.base_variant_id,
              base_scope.base_unit_code
         FROM shared.product_variants pv
         JOIN shared.products product
           ON product.installation_id = pv.installation_id
          AND product.id = pv.product_id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS base_variant_count,
                  (array_agg(base_variant.id ORDER BY base_variant.id))[1] AS base_variant_id,
                  (array_agg(base_unit.code ORDER BY base_variant.id))[1] AS base_unit_code
             FROM shared.product_variants base_variant
             LEFT JOIN shared.units_of_measure base_unit
               ON base_unit.installation_id = base_variant.installation_id
              AND base_unit.id = base_variant.unit_id
            WHERE base_variant.installation_id = pv.installation_id
              AND base_variant.product_id = pv.product_id
              AND base_variant.is_inventory_base = true
              AND base_variant.is_active = true
         ) base_scope ON true
        WHERE pv.installation_id = $1
          AND pv.id = ANY($3::uuid[])
     ), balance AS (
       SELECT balance.base_variant_id,
              COALESCE(sum(balance.on_hand_quantity), 0)::numeric(30,12) AS on_hand_quantity,
              COALESCE(sum(balance.reserved_quantity), 0)::numeric(30,12) AS exact_reserved_quantity
         FROM inventory.inventory_balances balance
        WHERE balance.installation_id = $1
          AND balance.warehouse_id = $2
          AND balance.base_variant_id IN (
            SELECT base_variant_id FROM selected
             WHERE base_variant_count = 1 AND base_variant_id IS NOT NULL
          )
        GROUP BY balance.base_variant_id
     ), demand AS (
       SELECT demand.base_variant_id,
              COALESCE(sum(demand.reserved_base_quantity - demand.allocated_base_quantity), 0)::numeric(30,12)
                AS fulfillment_reserved_quantity
         FROM sales.sales_order_fulfillment_demands demand
        WHERE demand.installation_id = $1
          AND demand.warehouse_id = $2
          AND demand.state = 'ACTIVE'
          AND demand.base_variant_id IN (
            SELECT base_variant_id FROM selected
             WHERE base_variant_count = 1 AND base_variant_id IS NOT NULL
          )
        GROUP BY demand.base_variant_id
     )
     SELECT selected.sales_variant_id,
            selected.is_inventory_managed,
            selected.base_variant_count,
            selected.base_variant_id,
            selected.base_unit_code,
            COALESCE(balance.on_hand_quantity, 0)::numeric(30,12)::text AS on_hand_quantity,
            greatest(
              COALESCE(balance.on_hand_quantity, 0)
              - COALESCE(balance.exact_reserved_quantity, 0)
              - COALESCE(demand.fulfillment_reserved_quantity, 0),
              0
            )::numeric(30,12)::text AS available_quantity
       FROM selected
       LEFT JOIN balance ON balance.base_variant_id = selected.base_variant_id
       LEFT JOIN demand ON demand.base_variant_id = selected.base_variant_id`,
    [installationId, warehouseId, ids],
  );
  return result.rows;
}
