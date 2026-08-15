import { randomUUID } from 'node:crypto';

export async function setFulfillmentReversalWriteContexts(client) {
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_allocation_write_context', 'fulfillment_reversal_service', true)",
  );
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_reversal_service', true)",
  );
}

export async function lockOperationKey(client, { installationId, operation, idempotencyKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`sales-fulfillment-reversal:${installationId}:${operation}:${idempotencyKey}`],
  );
}

export async function getAllocationForUpdate(client, { installationId, allocationId }) {
  const result = await client.query(
    `SELECT allocation.*,
            demand.sku_snapshot,
            orders.order_number,
            version.customer_code_snapshot,
            version.customer_name_snapshot,
            location.code AS location_code,
            location.name AS location_name,
            lot.lot_code,
            lot.expiry_date,
            COALESCE(claimed.claimed_base_quantity, 0)::numeric(30,12) AS claimed_base_quantity
       FROM sales.sales_order_fulfillment_allocations allocation
       JOIN sales.sales_order_fulfillment_demands demand
         ON demand.installation_id = allocation.installation_id
        AND demand.id = allocation.fulfillment_demand_id
        AND demand.state = 'ACTIVE'
       JOIN sales.sales_orders orders
         ON orders.installation_id = allocation.installation_id
        AND orders.id = allocation.sales_order_id
        AND orders.status = 'confirmed'
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
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(line.delivery_base_quantity), 0) AS claimed_base_quantity
           FROM sales.delivery_order_lines line
           JOIN sales.delivery_orders delivery_order
             ON delivery_order.installation_id = line.installation_id
            AND delivery_order.id = line.delivery_order_id
          WHERE line.installation_id = allocation.installation_id
            AND line.fulfillment_allocation_id = allocation.id
            AND delivery_order.status IN ('draft', 'ready_to_dispatch', 'dispatched', 'handed_over')
       ) claimed ON true
      WHERE allocation.installation_id = $1
        AND allocation.id = $2
      FOR UPDATE OF allocation`,
    [installationId, allocationId],
  );
  return result.rows[0] ?? null;
}

export async function listOrderAllocationsForUpdate(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT allocation.*,
            demand.sku_snapshot,
            orders.order_number,
            version.customer_code_snapshot,
            version.customer_name_snapshot,
            location.code AS location_code,
            location.name AS location_name,
            lot.lot_code,
            lot.expiry_date,
            COALESCE(claimed.claimed_base_quantity, 0)::numeric(30,12) AS claimed_base_quantity
       FROM sales.sales_order_fulfillment_allocations allocation
       JOIN sales.sales_order_fulfillment_demands demand
         ON demand.installation_id = allocation.installation_id
        AND demand.id = allocation.fulfillment_demand_id
        AND demand.state = 'ACTIVE'
       JOIN sales.sales_orders orders
         ON orders.installation_id = allocation.installation_id
        AND orders.id = allocation.sales_order_id
        AND orders.status = 'confirmed'
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
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(line.delivery_base_quantity), 0) AS claimed_base_quantity
           FROM sales.delivery_order_lines line
           JOIN sales.delivery_orders delivery_order
             ON delivery_order.installation_id = line.installation_id
            AND delivery_order.id = line.delivery_order_id
          WHERE line.installation_id = allocation.installation_id
            AND line.fulfillment_allocation_id = allocation.id
            AND delivery_order.status IN ('draft', 'ready_to_dispatch', 'dispatched', 'handed_over')
       ) claimed ON true
      WHERE allocation.installation_id = $1
        AND allocation.sales_order_id = $2
      ORDER BY allocation.fulfillment_demand_id, allocation.allocation_sequence, allocation.id
      FOR UPDATE OF allocation`,
    [installationId, salesOrderId],
  );
  return result.rows;
}

export async function getAllocationEventByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM sales.sales_order_fulfillment_allocation_events
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function getReversalBatchByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM sales.sales_order_fulfillment_reversal_batches
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function decrementAllocationProgress(client, {
  installationId,
  allocationId,
  kind,
  quantity,
  actorId,
}) {
  if (!['PICK', 'PACK'].includes(kind)) throw new Error('invalid_fulfillment_reversal_kind');
  const field = kind === 'PICK' ? 'picked_base_quantity' : 'packed_base_quantity';
  const condition = kind === 'PICK'
    ? 'picked_base_quantity - $3::numeric >= packed_base_quantity'
    : `packed_base_quantity - $3::numeric >= COALESCE((
         SELECT sum(line.delivery_base_quantity)
           FROM sales.delivery_order_lines line
           JOIN sales.delivery_orders delivery_order
             ON delivery_order.installation_id = line.installation_id
            AND delivery_order.id = line.delivery_order_id
          WHERE line.installation_id = sales.sales_order_fulfillment_allocations.installation_id
            AND line.fulfillment_allocation_id = sales.sales_order_fulfillment_allocations.id
            AND delivery_order.status IN ('draft', 'ready_to_dispatch', 'dispatched', 'handed_over')
       ), 0)`;
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_allocations
        SET ${field} = ${field} - $3::numeric,
            state = CASE
              WHEN state = 'COMPLETED' AND (
                CASE WHEN $4 = 'PACK'
                  THEN packed_base_quantity - $3::numeric
                  ELSE packed_base_quantity
                END
              ) < allocated_base_quantity THEN 'ACTIVE'
              ELSE state
            END,
            updated_at = now(),
            updated_by = $5
      WHERE installation_id = $1
        AND id = $2
        AND ${field} >= $3::numeric
        AND ${condition}
      RETURNING *`,
    [installationId, allocationId, quantity, kind, actorId],
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

export async function insertReversalBatch(client, data) {
  const result = await client.query(
    `INSERT INTO sales.sales_order_fulfillment_reversal_batches (
       id, installation_id, sales_order_id, mode, reason,
       idempotency_key, payload_hash, actor_id, request_id, source_app,
       snapshot, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     RETURNING *`,
    [
      data.id,
      data.installationId,
      data.salesOrderId,
      data.mode,
      data.reason,
      data.idempotencyKey,
      data.payloadHash,
      data.actorId,
      data.requestId,
      data.sourceApp,
      JSON.stringify(data.snapshot),
      data.occurredAt,
    ],
  );
  return result.rows[0] ?? null;
}
