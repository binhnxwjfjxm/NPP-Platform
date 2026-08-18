function normalizeId(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function mapBreakdownRow(row) {
  return Object.freeze({
    salesOrderId: row.sales_order_id,
    orderNumber: row.order_number,
    customerName: row.customer_name_snapshot,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code_snapshot,
    warehouseName: row.warehouse_name_snapshot,
    salesSku: row.sales_sku,
    baseSku: row.base_sku,
    baseUnitCode: row.base_unit_code,
    deliveryMode: row.delivery_mode,
    deliveryExecutionMode: row.delivery_execution_mode,
    fulfillmentStatus: row.fulfillment_status,
    demandState: row.demand_state,
    heldBaseQuantity: String(row.held_base_quantity),
    exactHeldBaseQuantity: String(row.exact_held_base_quantity),
    demandHeldBaseQuantity: String(row.demand_held_base_quantity),
  });
}

export async function listWarehouseBusinessHoldSummary(client, {
  installationId,
  warehouseIds,
  warehouseId = null,
  baseVariantId = null,
}) {
  const scopedWarehouseIds = Array.isArray(warehouseIds)
    ? warehouseIds.map(normalizeId).filter(Boolean)
    : [];
  if (scopedWarehouseIds.length === 0) return Object.freeze([]);

  const result = await client.query(
    `WITH inventory_scope AS (
       SELECT
         balance.warehouse_id,
         balance.base_variant_id,
         COALESCE(sum(balance.on_hand_quantity), 0)::numeric(30,12) AS on_hand_quantity,
         COALESCE(sum(balance.reserved_quantity), 0)::numeric(30,12) AS exact_held_quantity
       FROM inventory.inventory_balances balance
       WHERE balance.installation_id = $1
         AND balance.warehouse_id = ANY($2::uuid[])
         AND ($3::uuid IS NULL OR balance.warehouse_id = $3::uuid)
         AND ($4::uuid IS NULL OR balance.base_variant_id = $4::uuid)
       GROUP BY balance.warehouse_id, balance.base_variant_id
     ), demand_scope AS (
       SELECT
         demand.warehouse_id,
         demand.base_variant_id,
         COALESCE(sum(greatest(
           demand.reserved_base_quantity - demand.allocated_base_quantity,
           0::numeric
         )), 0)::numeric(30,12) AS demand_held_quantity
       FROM sales.sales_order_fulfillment_demands demand
       WHERE demand.installation_id = $1
         AND demand.warehouse_id = ANY($2::uuid[])
         AND demand.state = 'ACTIVE'
         AND ($3::uuid IS NULL OR demand.warehouse_id = $3::uuid)
         AND ($4::uuid IS NULL OR demand.base_variant_id = $4::uuid)
       GROUP BY demand.warehouse_id, demand.base_variant_id
     ), scopes AS (
       SELECT warehouse_id, base_variant_id FROM inventory_scope
       UNION
       SELECT warehouse_id, base_variant_id FROM demand_scope
     )
     SELECT
       scopes.warehouse_id,
       scopes.base_variant_id,
       COALESCE(inventory_scope.on_hand_quantity, 0)::numeric(30,12)::text AS on_hand_quantity,
       COALESCE(inventory_scope.exact_held_quantity, 0)::numeric(30,12)::text AS exact_held_quantity,
       COALESCE(demand_scope.demand_held_quantity, 0)::numeric(30,12)::text AS demand_held_quantity,
       greatest(
         COALESCE(inventory_scope.exact_held_quantity, 0)
         + COALESCE(demand_scope.demand_held_quantity, 0),
         0::numeric
       )::numeric(30,12)::text AS held_quantity,
       greatest(
         COALESCE(inventory_scope.on_hand_quantity, 0)
         - COALESCE(inventory_scope.exact_held_quantity, 0)
         - COALESCE(demand_scope.demand_held_quantity, 0),
         0::numeric
       )::numeric(30,12)::text AS available_quantity
     FROM scopes
     LEFT JOIN inventory_scope
       ON inventory_scope.warehouse_id = scopes.warehouse_id
      AND inventory_scope.base_variant_id = scopes.base_variant_id
     LEFT JOIN demand_scope
       ON demand_scope.warehouse_id = scopes.warehouse_id
      AND demand_scope.base_variant_id = scopes.base_variant_id
     ORDER BY scopes.warehouse_id, scopes.base_variant_id`,
    [installationId, scopedWarehouseIds, warehouseId, baseVariantId],
  );
  return Object.freeze((result.rows ?? []).map((row) => Object.freeze({
    warehouseId: row.warehouse_id,
    baseVariantId: row.base_variant_id,
    onHandBaseQuantity: String(row.on_hand_quantity),
    exactHeldBaseQuantity: String(row.exact_held_quantity),
    demandHeldBaseQuantity: String(row.demand_held_quantity),
    heldBaseQuantity: String(row.held_quantity),
    availableBaseQuantity: String(row.available_quantity),
  })));
}

async function loadScopedBusinessHoldSummary(client, {
  installationId,
  warehouseId,
  baseVariantId,
  excludeSalesOrderId,
}) {
  const result = await client.query(
    `WITH inventory_scope AS (
       SELECT
         COALESCE(sum(balance.on_hand_quantity), 0)::numeric(30,12) AS on_hand_quantity,
         COALESCE(sum(balance.reserved_quantity), 0)::numeric(30,12) AS exact_held_quantity
       FROM inventory.inventory_balances balance
       WHERE balance.installation_id = $1
         AND balance.warehouse_id = $2
         AND balance.base_variant_id = $3
     ), excluded_exact AS (
       SELECT COALESCE(sum(reservation.quantity), 0)::numeric(30,12) AS quantity
       FROM sales.sales_order_fulfillment_allocations allocation
       JOIN sales.sales_order_fulfillment_demands demand
         ON demand.installation_id = allocation.installation_id
        AND demand.id = allocation.fulfillment_demand_id
       JOIN inventory.inventory_reservations reservation
         ON reservation.installation_id = allocation.installation_id
        AND reservation.id = allocation.inventory_reservation_id
        AND reservation.state = 'ACTIVE'
       WHERE allocation.installation_id = $1
         AND allocation.warehouse_id = $2
         AND allocation.base_variant_id = $3
         AND $4::uuid IS NOT NULL
         AND demand.sales_order_id = $4::uuid
     ), demand_scope AS (
       SELECT COALESCE(sum(greatest(
         demand.reserved_base_quantity - demand.allocated_base_quantity,
         0::numeric
       )), 0)::numeric(30,12) AS quantity
       FROM sales.sales_order_fulfillment_demands demand
       WHERE demand.installation_id = $1
         AND demand.warehouse_id = $2
         AND demand.base_variant_id = $3
         AND demand.state = 'ACTIVE'
         AND ($4::uuid IS NULL OR demand.sales_order_id <> $4::uuid)
     )
     SELECT
       inventory_scope.on_hand_quantity::numeric(30,12)::text AS on_hand_quantity,
       greatest(
         inventory_scope.exact_held_quantity - excluded_exact.quantity,
         0::numeric
       )::numeric(30,12)::text AS exact_held_quantity,
       demand_scope.quantity::numeric(30,12)::text AS demand_held_quantity,
       greatest(
         inventory_scope.exact_held_quantity - excluded_exact.quantity,
         0::numeric
       )::numeric(30,12) + demand_scope.quantity::numeric(30,12) AS held_quantity,
       greatest(
         inventory_scope.on_hand_quantity
         - greatest(inventory_scope.exact_held_quantity - excluded_exact.quantity, 0::numeric)
         - demand_scope.quantity,
         0::numeric
       )::numeric(30,12)::text AS available_quantity
     FROM inventory_scope CROSS JOIN excluded_exact CROSS JOIN demand_scope`,
    [installationId, warehouseId, baseVariantId, excludeSalesOrderId],
  );
  const row = result.rows?.[0] ?? {};
  return Object.freeze({
    warehouseId,
    baseVariantId,
    onHandBaseQuantity: String(row.on_hand_quantity ?? '0.000000000000'),
    exactHeldBaseQuantity: String(row.exact_held_quantity ?? '0.000000000000'),
    demandHeldBaseQuantity: String(row.demand_held_quantity ?? '0.000000000000'),
    heldBaseQuantity: String(row.held_quantity ?? '0.000000000000'),
    availableBaseQuantity: String(row.available_quantity ?? '0.000000000000'),
  });
}

export async function loadWarehouseBusinessHoldBreakdown(client, {
  installationId,
  warehouseId,
  baseVariantId,
  excludeSalesOrderId = null,
}) {
  const [summary, breakdownResult] = await Promise.all([
    loadScopedBusinessHoldSummary(client, {
      installationId,
      warehouseId,
      baseVariantId,
      excludeSalesOrderId,
    }),
    client.query(
      `WITH exact_by_demand AS (
         SELECT
           allocation.fulfillment_demand_id,
           COALESCE(sum(reservation.quantity), 0)::numeric(30,12) AS exact_held_quantity
         FROM sales.sales_order_fulfillment_allocations allocation
         JOIN inventory.inventory_reservations reservation
           ON reservation.installation_id = allocation.installation_id
          AND reservation.id = allocation.inventory_reservation_id
          AND reservation.state = 'ACTIVE'
        WHERE allocation.installation_id = $1
          AND allocation.warehouse_id = $2
          AND allocation.base_variant_id = $3
        GROUP BY allocation.fulfillment_demand_id
       )
       SELECT
         demand.sales_order_id,
         orders.order_number,
         orders.fulfillment_status,
         version.customer_name_snapshot,
         version.warehouse_code_snapshot,
         version.warehouse_name_snapshot,
         version.delivery_mode,
         version.delivery_execution_mode,
         demand.warehouse_id,
         demand.sku_snapshot AS sales_sku,
         base_variant.sku AS base_sku,
         base_unit.code AS base_unit_code,
         demand.state AS demand_state,
         COALESCE(exact_by_demand.exact_held_quantity, 0)::numeric(30,12) AS exact_held_base_quantity,
         greatest(
           demand.reserved_base_quantity - demand.allocated_base_quantity,
           0::numeric
         )::numeric(30,12) AS demand_held_base_quantity,
         (
           COALESCE(exact_by_demand.exact_held_quantity, 0)
           + greatest(
               demand.reserved_base_quantity - demand.allocated_base_quantity,
               0::numeric
             )
         )::numeric(30,12) AS held_base_quantity
       FROM sales.sales_order_fulfillment_demands demand
       JOIN sales.sales_orders orders
         ON orders.installation_id = demand.installation_id
        AND orders.id = demand.sales_order_id
       JOIN sales.sales_order_versions version
         ON version.installation_id = demand.installation_id
        AND version.id = demand.sales_order_version_id
       JOIN shared.product_variants base_variant
         ON base_variant.installation_id = demand.installation_id
        AND base_variant.id = demand.base_variant_id
       JOIN shared.units_of_measure base_unit
         ON base_unit.installation_id = base_variant.installation_id
        AND base_unit.id = base_variant.unit_id
       LEFT JOIN exact_by_demand
         ON exact_by_demand.fulfillment_demand_id = demand.id
      WHERE demand.installation_id = $1
        AND demand.warehouse_id = $2
        AND demand.base_variant_id = $3
        AND demand.state = 'ACTIVE'
        AND ($4::uuid IS NULL OR demand.sales_order_id <> $4::uuid)
        AND (
          COALESCE(exact_by_demand.exact_held_quantity, 0)
          + greatest(
              demand.reserved_base_quantity - demand.allocated_base_quantity,
              0::numeric
            )
        ) > 0
      ORDER BY orders.order_number, demand.line_number`,
      [installationId, warehouseId, baseVariantId, excludeSalesOrderId],
    ),
  ]);

  return Object.freeze({
    ...summary,
    excludeSalesOrderId: excludeSalesOrderId ?? null,
    orders: Object.freeze((breakdownResult.rows ?? []).map(mapBreakdownRow)),
  });
}
