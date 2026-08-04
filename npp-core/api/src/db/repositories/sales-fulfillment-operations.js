import { randomUUID } from 'node:crypto';

export async function setFulfillmentAllocationWriteContexts(client) {
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_allocation_write_context', 'fulfillment_allocation_service', true)",
  );
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_service', true)",
  );
  await client.query(
    "SELECT set_config('npp.inventory_reservation_write_context', 'reservation_service', true)",
  );
}

export async function lockOperationKey(client, { installationId, operation, idempotencyKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`sales-fulfillment-operation:${installationId}:${operation}:${idempotencyKey}`],
  );
}

export async function lockFulfillmentScope(client, { installationId, warehouseId, baseVariantId }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`sales-fulfillment-scope:${installationId}:${warehouseId}:${baseVariantId}`],
  );
}

export async function lockExactInventoryScope(client, {
  installationId,
  warehouseId,
  locationId,
  baseVariantId,
  lotId,
}) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [[
      'inventory-reservation:scope',
      installationId,
      warehouseId,
      locationId ?? '<null>',
      baseVariantId,
      lotId ?? '<null>',
    ].join(':')],
  );
}

export async function listFulfillmentWork(client, {
  installationId,
  warehouseIds,
  status,
  limit,
  offset,
}) {
  const result = await client.query(
    `SELECT
       demand.id AS fulfillment_demand_id,
       demand.sales_order_id,
       orders.order_number,
       orders.fulfillment_status,
       orders.requested_delivery_date,
       orders.source_type,
       version.customer_code_snapshot,
       version.customer_name_snapshot,
       version.warehouse_code_snapshot,
       version.warehouse_name_snapshot,
       demand.sales_order_version_id,
       demand.sales_order_line_id,
       demand.line_number,
       line.item_name_snapshot,
       line.unit_code_snapshot,
       demand.sku_snapshot,
       demand.warehouse_id,
       demand.base_variant_id,
       demand.ordered_base_quantity,
       demand.reserved_base_quantity,
       demand.backordered_base_quantity,
       demand.allocated_base_quantity,
       demand.picked_base_quantity,
       demand.packed_base_quantity,
       demand.created_at,
       demand.updated_at,
       COALESCE(allocation_totals.allocation_count, 0)::integer AS allocation_count
      FROM sales.sales_order_fulfillment_demands demand
      JOIN sales.sales_orders orders
        ON orders.installation_id = demand.installation_id
       AND orders.id = demand.sales_order_id
      JOIN sales.sales_order_versions version
        ON version.installation_id = demand.installation_id
       AND version.id = demand.sales_order_version_id
      JOIN sales.sales_order_version_lines line
        ON line.installation_id = demand.installation_id
       AND line.id = demand.sales_order_line_id
      LEFT JOIN LATERAL (
        SELECT count(*) AS allocation_count
          FROM sales.sales_order_fulfillment_allocations allocation
         WHERE allocation.installation_id = demand.installation_id
           AND allocation.fulfillment_demand_id = demand.id
      ) allocation_totals ON true
     WHERE demand.installation_id = $1
       AND demand.state = 'ACTIVE'
       AND orders.status = 'confirmed'
       AND demand.warehouse_id = ANY($2::uuid[])
       AND ($3::text IS NULL OR orders.fulfillment_status = $3)
     ORDER BY
       orders.requested_delivery_date ASC NULLS LAST,
       demand.created_at ASC,
       orders.order_number ASC,
       demand.line_number ASC
     LIMIT $4 OFFSET $5`,
    [installationId, warehouseIds, status ?? null, limit, offset],
  );
  return result.rows;
}

export async function getActiveDemandForUpdate(client, { installationId, demandId }) {
  const result = await client.query(
    `SELECT
       demand.*,
       orders.order_number,
       orders.status AS sales_order_status,
       orders.fulfillment_status,
       orders.requested_delivery_date,
       version.customer_code_snapshot,
       version.customer_name_snapshot,
       version.warehouse_code_snapshot,
       version.warehouse_name_snapshot,
       line.item_name_snapshot,
       line.unit_code_snapshot,
       COALESCE(policy.lot_tracking_mode, 'NONE') AS lot_tracking_mode,
       COALESCE(policy.expiry_tracking_mode, 'NONE') AS expiry_tracking_mode,
       COALESCE(policy.location_required, false) AS location_required
      FROM sales.sales_order_fulfillment_demands demand
      JOIN sales.sales_orders orders
        ON orders.installation_id = demand.installation_id
       AND orders.id = demand.sales_order_id
      JOIN sales.sales_order_versions version
        ON version.installation_id = demand.installation_id
       AND version.id = demand.sales_order_version_id
      JOIN sales.sales_order_version_lines line
        ON line.installation_id = demand.installation_id
       AND line.id = demand.sales_order_line_id
      LEFT JOIN inventory.product_tracking_policies policy
        ON policy.installation_id = demand.installation_id
       AND policy.base_variant_id = demand.base_variant_id
     WHERE demand.installation_id = $1
       AND demand.id = $2
       AND demand.state = 'ACTIVE'
     FOR UPDATE OF demand`,
    [installationId, demandId],
  );
  return result.rows[0] ?? null;
}

export async function listAllocationCandidates(client, {
  installationId,
  warehouseId,
  baseVariantId,
}) {
  const result = await client.query(
    `SELECT
       balance.warehouse_id,
       balance.location_id,
       location.location_code,
       location.location_name,
       balance.base_variant_id,
       balance.lot_id,
       lot.lot_code,
       lot.expiry_date,
       balance.on_hand_quantity,
       balance.reserved_quantity,
       balance.available_quantity,
       COALESCE(policy.lot_tracking_mode, 'NONE') AS lot_tracking_mode,
       COALESCE(policy.expiry_tracking_mode, 'NONE') AS expiry_tracking_mode,
       COALESCE(policy.location_required, false) AS location_required,
       receipt.first_received_at,
       CASE
         WHEN COALESCE(policy.expiry_tracking_mode, 'NONE') <> 'NONE' THEN 'FEFO'
         ELSE 'FIFO'
       END AS allocation_policy
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
      LEFT JOIN LATERAL (
        SELECT min(movement.posted_at) AS first_received_at
          FROM inventory.inventory_movement_lines movement_line
          JOIN inventory.inventory_movements movement
            ON movement.installation_id = movement_line.installation_id
           AND movement.id = movement_line.movement_id
         WHERE movement_line.installation_id = balance.installation_id
           AND movement_line.warehouse_id = balance.warehouse_id
           AND movement_line.location_id IS NOT DISTINCT FROM balance.location_id
           AND movement_line.base_variant_id = balance.base_variant_id
           AND movement_line.lot_id IS NOT DISTINCT FROM balance.lot_id
           AND movement_line.direction = 'IN'
      ) receipt ON true
     WHERE balance.installation_id = $1
       AND balance.warehouse_id = $2
       AND balance.base_variant_id = $3
       AND balance.available_quantity > 0
       AND (balance.location_id IS NULL OR location.is_active = true)
       AND (
         COALESCE(policy.lot_tracking_mode, 'NONE') = 'NONE'
         OR balance.lot_id IS NOT NULL
       )
       AND (
         COALESCE(policy.expiry_tracking_mode, 'NONE') = 'NONE'
         OR (lot.expiry_date IS NOT NULL AND lot.expiry_date >= CURRENT_DATE)
       )
       AND (
         COALESCE(policy.location_required, false) = false
         OR balance.location_id IS NOT NULL
       )
     ORDER BY
       CASE
         WHEN COALESCE(policy.expiry_tracking_mode, 'NONE') <> 'NONE'
         THEN lot.expiry_date
       END ASC NULLS LAST,
       CASE
         WHEN COALESCE(policy.expiry_tracking_mode, 'NONE') = 'NONE'
         THEN receipt.first_received_at
       END ASC NULLS LAST,
       location.location_code ASC NULLS LAST,
       lot.lot_code ASC NULLS LAST,
       balance.location_id ASC NULLS LAST,
       balance.lot_id ASC NULLS LAST
     FOR UPDATE OF balance`,
    [installationId, warehouseId, baseVariantId],
  );
  return result.rows;
}

export async function getAllocationsByOperationKey(client, {
  installationId,
  operationIdempotencyKey,
}) {
  const result = await client.query(
    `SELECT *
       FROM sales.sales_order_fulfillment_allocations
      WHERE installation_id = $1
        AND operation_idempotency_key = $2
      ORDER BY allocation_sequence ASC`,
    [installationId, operationIdempotencyKey],
  );
  return result.rows;
}

export async function incrementDemandAllocatedQuantity(client, {
  installationId,
  demandId,
  quantity,
  actorId,
}) {
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_demands
        SET allocated_base_quantity = allocated_base_quantity + $3::numeric,
            updated_at = now(),
            updated_by = $4
      WHERE installation_id = $1
        AND id = $2
        AND state = 'ACTIVE'
        AND allocated_base_quantity + $3::numeric <= reserved_base_quantity
      RETURNING *`,
    [installationId, demandId, quantity, actorId],
  );
  return result.rows[0] ?? null;
}

export async function insertInventoryReservation(client, data) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_reservations (
       id, installation_id, warehouse_id, location_id, base_variant_id, lot_id,
       quantity, state, source_domain, source_document_type, source_document_id,
       activated_at, transitioned_at, idempotency_key, payload_hash, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'ACTIVE','SALES','SALES_FULFILLMENT_ALLOCATION',$8,
       $9,$9,$10,$11,$12::jsonb
     )
     RETURNING *`,
    [
      data.id,
      data.installationId,
      data.warehouseId,
      data.locationId,
      data.baseVariantId,
      data.lotId,
      data.quantity,
      data.allocationId,
      data.occurredAt,
      data.idempotencyKey,
      data.payloadHash,
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertInventoryReservationEvent(client, data) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_reservation_events (
       id, installation_id, reservation_id, transition, actor_id, request_id,
       source_app, payload_hash, occurred_at, metadata
     ) VALUES ($1,$2,$3,'CREATE_ACTIVE',$4,$5,$6,$7,$8,$9::jsonb)
     RETURNING *`,
    [
      randomUUID(),
      data.installationId,
      data.reservationId,
      data.actorId,
      data.requestId,
      data.sourceApp,
      data.payloadHash,
      data.occurredAt,
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertAllocation(client, data) {
  const result = await client.query(
    `INSERT INTO sales.sales_order_fulfillment_allocations (
       id, installation_id, fulfillment_demand_id, sales_order_id,
       sales_order_version_id, sales_order_line_id, warehouse_id, location_id,
       base_variant_id, lot_id, inventory_reservation_id, allocation_sequence,
       allocation_policy, policy_rank, manual_override_reason,
       allocated_base_quantity, picked_base_quantity, packed_base_quantity,
       state, operation_idempotency_key, idempotency_key, payload_hash,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,0,
       'ACTIVE',$17,$18,$19,$20,$20
     )
     RETURNING *`,
    [
      data.id,
      data.installationId,
      data.demandId,
      data.salesOrderId,
      data.salesOrderVersionId,
      data.salesOrderLineId,
      data.warehouseId,
      data.locationId,
      data.baseVariantId,
      data.lotId,
      data.inventoryReservationId,
      data.allocationSequence,
      data.allocationPolicy,
      data.policyRank,
      data.manualOverrideReason,
      data.quantity,
      data.operationIdempotencyKey,
      data.idempotencyKey,
      data.payloadHash,
      data.actorId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertAllocationEvent(client, data) {
  const result = await client.query(
    `INSERT INTO sales.sales_order_fulfillment_allocation_events (
       id, installation_id, allocation_id, event_type, quantity_delta,
       actor_id, request_id, source_app, idempotency_key, payload_hash,
       reason, metadata, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     RETURNING *`,
    [
      randomUUID(),
      data.installationId,
      data.allocationId,
      data.eventType,
      data.quantity,
      data.actorId,
      data.requestId,
      data.sourceApp,
      data.idempotencyKey,
      data.payloadHash,
      data.reason,
      JSON.stringify(data.metadata ?? {}),
      data.occurredAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function getAllocationForUpdate(client, { installationId, allocationId }) {
  const result = await client.query(
    `SELECT
       allocation.*,
       demand.sku_snapshot,
       orders.order_number,
       version.customer_code_snapshot,
       version.customer_name_snapshot,
       location.location_code,
       location.location_name,
       lot.lot_code,
       lot.expiry_date
      FROM sales.sales_order_fulfillment_allocations allocation
      JOIN sales.sales_order_fulfillment_demands demand
        ON demand.installation_id = allocation.installation_id
       AND demand.id = allocation.fulfillment_demand_id
      JOIN sales.sales_orders orders
        ON orders.installation_id = allocation.installation_id
       AND orders.id = allocation.sales_order_id
      JOIN sales.sales_order_versions version
        ON version.installation_id = allocation.installation_id
       AND version.id = allocation.sales_order_version_id
      LEFT JOIN shared.warehouse_locations location
        ON location.installation_id = allocation.installation_id
       AND location.warehouse_id = allocation.warehouse_id
       AND location.id = allocation.location_id
      LEFT JOIN inventory.inventory_lots lot
        ON lot.installation_id = allocation.installation_id
       AND lot.id = allocation.lot_id
     WHERE allocation.installation_id = $1
       AND allocation.id = $2
     FOR UPDATE OF allocation`,
    [installationId, allocationId],
  );
  return result.rows[0] ?? null;
}

export async function getAllocationEventByIdempotencyKey(client, {
  installationId,
  idempotencyKey,
}) {
  const result = await client.query(
    `SELECT *
       FROM sales.sales_order_fulfillment_allocation_events
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function incrementAllocationProgress(client, {
  installationId,
  allocationId,
  field,
  quantity,
  actorId,
}) {
  if (!['picked_base_quantity', 'packed_base_quantity'].includes(field)) {
    throw new Error('invalid_fulfillment_progress_field');
  }
  const capField = field === 'picked_base_quantity'
    ? 'allocated_base_quantity'
    : 'picked_base_quantity';
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_allocations
        SET ${field} = ${field} + $3::numeric,
            state = CASE
              WHEN $4 = 'packed_base_quantity'
               AND packed_base_quantity + $3::numeric = allocated_base_quantity
              THEN 'COMPLETED'
              ELSE state
            END,
            updated_at = now(),
            updated_by = $5
      WHERE installation_id = $1
        AND id = $2
        AND state = 'ACTIVE'
        AND ${field} + $3::numeric <= ${capField}
      RETURNING *`,
    [installationId, allocationId, quantity, field, actorId],
  );
  return result.rows[0] ?? null;
}

export async function listDemandAllocations(client, { installationId, demandId }) {
  const result = await client.query(
    `SELECT
       allocation.*,
       location.location_code,
       location.location_name,
       lot.lot_code,
       lot.expiry_date
      FROM sales.sales_order_fulfillment_allocations allocation
      LEFT JOIN shared.warehouse_locations location
        ON location.installation_id = allocation.installation_id
       AND location.warehouse_id = allocation.warehouse_id
       AND location.id = allocation.location_id
      LEFT JOIN inventory.inventory_lots lot
        ON lot.installation_id = allocation.installation_id
       AND lot.id = allocation.lot_id
     WHERE allocation.installation_id = $1
       AND allocation.fulfillment_demand_id = $2
     ORDER BY allocation.allocation_sequence ASC`,
    [installationId, demandId],
  );
  return result.rows;
}

export async function listAllocationEvents(client, { installationId, allocationId }) {
  const result = await client.query(
    `SELECT *
       FROM sales.sales_order_fulfillment_allocation_events
      WHERE installation_id = $1
        AND allocation_id = $2
      ORDER BY occurred_at ASC, id ASC`,
    [installationId, allocationId],
  );
  return result.rows;
}
