import { randomUUID } from 'node:crypto';

export async function setFulfillmentShortageWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.fulfillment_shortage_write_context', 'fulfillment_shortage_service', true)",
  );
}

export async function getShortageByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM sales.sales_order_fulfillment_shortages
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function getDiscrepancyByShortageId(client, { installationId, shortageId }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_discrepancy_observations
      WHERE installation_id = $1
        AND source_shortage_id = $2`,
    [installationId, shortageId],
  );
  return result.rows[0] ?? null;
}

export async function getClosureByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM sales.sales_order_fulfillment_pick_closures
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function getLatestClosure(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT *
       FROM sales.sales_order_fulfillment_pick_closures
      WHERE installation_id = $1
        AND sales_order_id = $2
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1`,
    [installationId, salesOrderId],
  );
  return result.rows[0] ?? null;
}

export async function getExactInventoryBalanceForUpdate(client, {
  installationId,
  warehouseId,
  locationId,
  baseVariantId,
  lotId,
}) {
  const result = await client.query(
    `SELECT balance.on_hand_quantity
       FROM inventory.inventory_balances balance
      WHERE balance.installation_id = $1
        AND balance.warehouse_id = $2
        AND balance.location_id IS NOT DISTINCT FROM $3::uuid
        AND balance.base_variant_id = $4
        AND balance.lot_id IS NOT DISTINCT FROM $5::uuid
      FOR UPDATE`,
    [installationId, warehouseId, locationId, baseVariantId, lotId],
  );
  return result.rows[0] ?? null;
}

export async function insertShortage(client, data) {
  const id = data.id ?? randomUUID();
  const result = await client.query(
    `INSERT INTO sales.sales_order_fulfillment_shortages (
       id, installation_id, fulfillment_demand_id, allocation_id, sales_order_id,
       warehouse_id, location_id, base_variant_id, lot_id,
       required_base_quantity, picked_base_quantity, remaining_base_quantity,
       reason, actor_id, request_id, source_app, idempotency_key, payload_hash,
       metadata, occurred_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20
     )
     RETURNING *`,
    [
      id,
      data.installationId,
      data.fulfillmentDemandId,
      data.allocationId,
      data.salesOrderId,
      data.warehouseId,
      data.locationId,
      data.baseVariantId,
      data.lotId,
      data.requiredQuantity,
      data.pickedQuantity,
      data.remainingQuantity,
      data.reason,
      data.actorId,
      data.requestId,
      data.sourceApp,
      data.idempotencyKey,
      data.payloadHash,
      JSON.stringify(data.metadata ?? {}),
      data.occurredAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertDiscrepancyObservation(client, data) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_discrepancy_observations (
       id, installation_id, source_shortage_id, warehouse_id, location_id,
       base_variant_id, sku_snapshot, lot_id, lot_code_snapshot,
       book_base_quantity, observed_base_quantity, reason,
       actor_id, request_id, source_app, idempotency_key, payload_hash,
       occurred_at, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb
     )
     RETURNING *`,
    [
      data.id ?? randomUUID(),
      data.installationId,
      data.shortageId,
      data.warehouseId,
      data.locationId,
      data.baseVariantId,
      data.skuSnapshot,
      data.lotId,
      data.lotCodeSnapshot,
      data.bookQuantity,
      data.observedQuantity,
      data.reason,
      data.actorId,
      data.requestId,
      data.sourceApp,
      data.idempotencyKey,
      data.payloadHash,
      data.occurredAt,
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  return result.rows[0] ?? null;
}

export async function listOrderPickingDemands(client, {
  installationId,
  salesOrderId,
  forUpdate = false,
}) {
  const lock = forUpdate ? ' FOR UPDATE OF demand' : '';
  const result = await client.query(
    `SELECT demand.*
       FROM sales.sales_order_fulfillment_demands demand
       JOIN sales.sales_orders orders
         ON orders.installation_id = demand.installation_id
        AND orders.id = demand.sales_order_id
        AND orders.status = 'confirmed'
      WHERE demand.installation_id = $1
        AND demand.sales_order_id = $2
        AND demand.state = 'ACTIVE'
      ORDER BY demand.line_number ASC${lock}`,
    [installationId, salesOrderId],
  );
  return result.rows;
}

export async function listOrderOpenAllocations(client, {
  installationId,
  salesOrderId,
  forUpdate = false,
}) {
  const lock = forUpdate ? ' FOR UPDATE OF allocation' : '';
  const result = await client.query(
    `SELECT allocation.*,
            EXISTS (
              SELECT 1
                FROM sales.sales_order_fulfillment_shortages shortage
               WHERE shortage.installation_id = allocation.installation_id
                 AND shortage.allocation_id = allocation.id
                 AND shortage.remaining_base_quantity > 0
            ) AS has_shortage
       FROM sales.sales_order_fulfillment_allocations allocation
      WHERE allocation.installation_id = $1
        AND allocation.sales_order_id = $2
        AND allocation.state = 'ACTIVE'
        AND allocation.picked_base_quantity < allocation.allocated_base_quantity
      ORDER BY allocation.fulfillment_demand_id, allocation.allocation_sequence${lock}`,
    [installationId, salesOrderId],
  );
  return result.rows;
}

export async function listUnallocatedAlternativeSources(client, {
  installationId,
  demandId,
  warehouseId,
  baseVariantId,
  forUpdate = false,
}) {
  const lock = forUpdate ? ' FOR UPDATE OF balance' : '';
  const result = await client.query(
    `SELECT
       balance.warehouse_id,
       balance.location_id,
       location.code AS location_code,
       location.name AS location_name,
       balance.base_variant_id,
       balance.lot_id,
       lot.lot_code,
       balance.available_quantity
      FROM inventory.inventory_balances balance
      LEFT JOIN shared.warehouse_locations location
        ON location.installation_id = balance.installation_id
       AND location.warehouse_id = balance.warehouse_id
       AND location.id = balance.location_id
      LEFT JOIN inventory.inventory_lots lot
        ON lot.installation_id = balance.installation_id
       AND lot.id = balance.lot_id
      LEFT JOIN inventory.product_tracking_policies policy
        ON policy.installation_id = balance.installation_id
       AND policy.base_variant_id = balance.base_variant_id
     WHERE balance.installation_id = $1
       AND balance.warehouse_id = $2
       AND balance.base_variant_id = $3
       AND balance.available_quantity > 0
       AND NOT EXISTS (
         SELECT 1
           FROM sales.sales_order_fulfillment_allocations allocation
          WHERE allocation.installation_id = balance.installation_id
            AND allocation.fulfillment_demand_id = $4
            AND allocation.location_id IS NOT DISTINCT FROM balance.location_id
            AND allocation.lot_id IS NOT DISTINCT FROM balance.lot_id
       )
       AND (
         balance.location_id IS NULL
         OR (location.is_active = true AND location.location_type = 'storage')
       )
       AND (
         COALESCE(policy.lot_tracking_mode, 'NONE') = 'NONE'
         OR balance.lot_id IS NOT NULL
       )
       AND (
         COALESCE(policy.expiry_tracking_mode, 'NONE') <> 'REQUIRED'
         OR lot.expiry_date IS NOT NULL
       )
       AND (lot.expiry_date IS NULL OR lot.expiry_date >= CURRENT_DATE)
     ORDER BY location.code ASC NULLS LAST, lot.lot_code ASC NULLS LAST${lock}`,
    [installationId, warehouseId, baseVariantId, demandId],
  );
  return result.rows;
}

export async function insertPickClosure(client, data) {
  const result = await client.query(
    `INSERT INTO sales.sales_order_fulfillment_pick_closures (
       id, installation_id, sales_order_id, close_mode,
       ordered_base_quantity, picked_base_quantity, remaining_base_quantity,
       backordered_base_quantity, shortage_count,
       actor_id, request_id, source_app, idempotency_key, payload_hash,
       snapshot, occurred_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16
     )
     RETURNING *`,
    [
      data.id ?? randomUUID(),
      data.installationId,
      data.salesOrderId,
      data.closeMode,
      data.orderedQuantity,
      data.pickedQuantity,
      data.remainingQuantity,
      data.backorderedQuantity,
      data.shortageCount,
      data.actorId,
      data.requestId,
      data.sourceApp,
      data.idempotencyKey,
      data.payloadHash,
      JSON.stringify(data.snapshot),
      data.occurredAt,
    ],
  );
  return result.rows[0] ?? null;
}
