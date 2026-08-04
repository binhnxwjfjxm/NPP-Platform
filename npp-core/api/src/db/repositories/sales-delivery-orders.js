import { randomUUID } from 'node:crypto';

export async function setDeliveryOrderWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.delivery_order_write_context', 'delivery_order_service', true)",
  );
}

export async function lockOperationKey(client, { installationId, operation, idempotencyKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`sales-delivery-order:${installationId}:${operation}:${idempotencyKey}`],
  );
}

export async function listEligiblePackedAllocations(client, {
  installationId,
  warehouseIds,
  salesOrderId = null,
  limit = 500,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT
       allocation.id AS fulfillment_allocation_id,
       allocation.fulfillment_demand_id,
       allocation.sales_order_id,
       allocation.sales_order_version_id,
       allocation.sales_order_line_id,
       allocation.inventory_reservation_id,
       allocation.warehouse_id,
       allocation.location_id,
       allocation.base_variant_id,
       allocation.lot_id,
       allocation.packed_base_quantity,
       allocation.state AS allocation_state,
       orders.order_number,
       orders.delivery_mode,
       orders.delivery_status,
       orders.requested_delivery_date,
       version.customer_id,
       version.customer_code_snapshot,
       version.customer_name_snapshot,
       version.customer_address_id,
       version.customer_address_snapshot,
       version.warehouse_code_snapshot,
       version.warehouse_name_snapshot,
       version.collection_policy,
       demand.backordered_base_quantity,
       demand.sku_snapshot,
       line.item_name_snapshot,
       line.unit_code_snapshot,
       location.code AS location_code,
       location.name AS location_name,
       lot.lot_code,
       lot.expiry_date,
       COALESCE(claimed.claimed_base_quantity, 0) AS claimed_base_quantity,
       allocation.packed_base_quantity - COALESCE(claimed.claimed_base_quantity, 0)
         AS available_for_delivery_order_base_quantity
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
       AND version.version_status = 'confirmed'
      JOIN sales.sales_order_version_lines line
        ON line.installation_id = allocation.installation_id
       AND line.id = allocation.sales_order_line_id
      LEFT JOIN shared.warehouse_locations location
        ON location.installation_id = allocation.installation_id
       AND location.warehouse_id = allocation.warehouse_id
       AND location.id = allocation.location_id
      LEFT JOIN inventory.inventory_lots lot
        ON lot.installation_id = allocation.installation_id
       AND lot.id = allocation.lot_id
      LEFT JOIN LATERAL (
        SELECT sum(delivery_line.delivery_base_quantity) AS claimed_base_quantity
          FROM sales.delivery_order_lines delivery_line
          JOIN sales.delivery_orders delivery_order
            ON delivery_order.installation_id = delivery_line.installation_id
           AND delivery_order.id = delivery_line.delivery_order_id
         WHERE delivery_line.installation_id = allocation.installation_id
           AND delivery_line.fulfillment_allocation_id = allocation.id
           AND delivery_order.status IN ('draft', 'ready_to_dispatch', 'dispatched', 'handed_over')
      ) claimed ON true
     WHERE allocation.installation_id = $1
       AND allocation.warehouse_id = ANY($2::uuid[])
       AND allocation.packed_base_quantity > 0
       AND allocation.packed_base_quantity > COALESCE(claimed.claimed_base_quantity, 0)
       AND ($3::uuid IS NULL OR allocation.sales_order_id = $3)
     ORDER BY orders.requested_delivery_date ASC NULLS LAST,
              allocation.created_at ASC,
              orders.order_number ASC,
              demand.line_number ASC,
              allocation.allocation_sequence ASC
     LIMIT $4 OFFSET $5`,
    [installationId, warehouseIds, salesOrderId, limit, offset],
  );
  return result.rows;
}

export async function getEligibleAllocationForUpdate(client, { installationId, allocationId }) {
  const result = await client.query(
    `SELECT
       allocation.*,
       orders.status AS sales_order_status,
       orders.order_number,
       orders.delivery_mode,
       orders.delivery_status,
       orders.requested_delivery_date,
       version.version_status,
       version.customer_id,
       version.customer_code_snapshot,
       version.customer_name_snapshot,
       version.customer_address_id,
       version.customer_address_snapshot,
       version.warehouse_code_snapshot,
       version.warehouse_name_snapshot,
       version.collection_policy,
       demand.state AS demand_state,
       demand.backordered_base_quantity,
       demand.sku_snapshot,
       line.item_name_snapshot,
       line.unit_code_snapshot,
       location.code AS location_code,
       location.name AS location_name,
       lot.lot_code,
       lot.expiry_date,
       COALESCE(claimed.claimed_base_quantity, 0) AS claimed_base_quantity,
       allocation.packed_base_quantity - COALESCE(claimed.claimed_base_quantity, 0)
         AS available_for_delivery_order_base_quantity
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
      JOIN sales.sales_order_version_lines line
        ON line.installation_id = allocation.installation_id
       AND line.id = allocation.sales_order_line_id
      LEFT JOIN shared.warehouse_locations location
        ON location.installation_id = allocation.installation_id
       AND location.warehouse_id = allocation.warehouse_id
       AND location.id = allocation.location_id
      LEFT JOIN inventory.inventory_lots lot
        ON lot.installation_id = allocation.installation_id
       AND lot.id = allocation.lot_id
      LEFT JOIN LATERAL (
        SELECT sum(delivery_line.delivery_base_quantity) AS claimed_base_quantity
          FROM sales.delivery_order_lines delivery_line
          JOIN sales.delivery_orders delivery_order
            ON delivery_order.installation_id = delivery_line.installation_id
           AND delivery_order.id = delivery_line.delivery_order_id
         WHERE delivery_line.installation_id = allocation.installation_id
           AND delivery_line.fulfillment_allocation_id = allocation.id
           AND delivery_order.status IN ('draft', 'ready_to_dispatch', 'dispatched', 'handed_over')
      ) claimed ON true
     WHERE allocation.installation_id = $1
       AND allocation.id = $2
     FOR UPDATE OF allocation`,
    [installationId, allocationId],
  );
  return result.rows[0] ?? null;
}

export async function getDeliveryOrderByCreateKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM sales.delivery_orders
      WHERE installation_id = $1 AND create_idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function listDeliveryOrders(client, {
  installationId,
  warehouseIds,
  status = null,
  salesOrderId = null,
  limit = 200,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT delivery_order.*,
            orders.order_number,
            COALESCE(line_totals.line_count, 0)::integer AS line_count,
            COALESCE(line_totals.total_base_quantity, 0) AS total_base_quantity,
            latest_issue.id AS inventory_issue_id,
            latest_issue.status AS inventory_issue_status,
            latest_issue.inventory_movement_id,
            latest_issue.inventory_reversal_movement_id,
            latest_issue.receiver_name,
            latest_issue.posted_at AS inventory_issued_at,
            latest_issue.reversed_at AS inventory_issue_reversed_at
       FROM sales.delivery_orders delivery_order
       JOIN sales.sales_orders orders
         ON orders.installation_id = delivery_order.installation_id
        AND orders.id = delivery_order.sales_order_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS line_count, sum(line.delivery_base_quantity) AS total_base_quantity
           FROM sales.delivery_order_lines line
          WHERE line.installation_id = delivery_order.installation_id
            AND line.delivery_order_id = delivery_order.id
       ) line_totals ON true
       LEFT JOIN LATERAL (
         SELECT issue.*
           FROM sales.delivery_order_inventory_issues issue
          WHERE issue.installation_id = delivery_order.installation_id
            AND issue.delivery_order_id = delivery_order.id
          ORDER BY issue.created_at DESC, issue.id DESC
          LIMIT 1
       ) latest_issue ON true
      WHERE delivery_order.installation_id = $1
        AND delivery_order.warehouse_id = ANY($2::uuid[])
        AND ($3::text IS NULL OR delivery_order.status = $3)
        AND ($4::uuid IS NULL OR delivery_order.sales_order_id = $4)
      ORDER BY delivery_order.created_at DESC, delivery_order.id DESC
      LIMIT $5 OFFSET $6`,
    [installationId, warehouseIds, status, salesOrderId, limit, offset],
  );
  return result.rows;
}

export async function getDeliveryOrderForUpdate(client, {
  installationId,
  deliveryOrderId,
  forUpdate = true,
}) {
  const lockClause = forUpdate ? 'FOR UPDATE OF delivery_order' : '';
  const result = await client.query(
    `SELECT delivery_order.*,
            orders.order_number,
            orders.status AS sales_order_status,
            orders.delivery_mode AS sales_order_delivery_mode
       FROM sales.delivery_orders delivery_order
       JOIN sales.sales_orders orders
         ON orders.installation_id = delivery_order.installation_id
        AND orders.id = delivery_order.sales_order_id
      WHERE delivery_order.installation_id = $1
        AND delivery_order.id = $2
      ${lockClause}`,
    [installationId, deliveryOrderId],
  );
  return result.rows[0] ?? null;
}

export async function listDeliveryOrderLines(client, { installationId, deliveryOrderId }) {
  const result = await client.query(
    `SELECT line.*,
            location.code AS location_code,
            location.name AS location_name,
            lot.lot_code,
            lot.expiry_date,
            latest_issue_line.id AS inventory_issue_line_id,
            latest_issue_line.issue_id AS inventory_issue_id,
            latest_issue_line.inventory_movement_line_id,
            latest_issue_line.issued_base_quantity
       FROM sales.delivery_order_lines line
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = line.installation_id
        AND location.warehouse_id = line.warehouse_id
        AND location.id = line.location_id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = line.installation_id AND lot.id = line.lot_id
       LEFT JOIN LATERAL (
         SELECT issue_line.*
           FROM sales.delivery_order_inventory_issue_lines issue_line
           JOIN sales.delivery_order_inventory_issues issue
             ON issue.installation_id = issue_line.installation_id
            AND issue.id = issue_line.issue_id
          WHERE issue_line.installation_id = line.installation_id
            AND issue_line.delivery_order_line_id = line.id
          ORDER BY issue.created_at DESC, issue.id DESC
          LIMIT 1
       ) latest_issue_line ON true
      WHERE line.installation_id = $1
        AND line.delivery_order_id = $2
      ORDER BY line.line_number ASC`,
    [installationId, deliveryOrderId],
  );
  return result.rows;
}

export async function listDeliveryOrderEvents(client, { installationId, deliveryOrderId }) {
  const result = await client.query(
    `SELECT * FROM sales.delivery_order_events
      WHERE installation_id = $1 AND delivery_order_id = $2
      ORDER BY occurred_at ASC, id ASC`,
    [installationId, deliveryOrderId],
  );
  return result.rows;
}

export async function getDeliveryOrderEventByKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM sales.delivery_order_events
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function insertDeliveryOrder(client, data) {
  const result = await client.query(
    `INSERT INTO sales.delivery_orders (
       id, installation_id, sales_order_id, sales_order_version_id,
       customer_id, customer_address_id, warehouse_id, handover_mode,
       customer_code_snapshot, customer_name_snapshot, destination_snapshot,
       warehouse_code_snapshot, warehouse_name_snapshot, requested_delivery_date,
       collection_policy, status, note, create_idempotency_key,
       create_payload_hash, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,
       'draft',$16,$17,$18,$19,$19
     ) RETURNING *`,
    [
      data.id, data.installationId, data.salesOrderId, data.salesOrderVersionId,
      data.customerId, data.customerAddressId, data.warehouseId, data.handoverMode,
      data.customerCode, data.customerName, JSON.stringify(data.destinationSnapshot ?? {}),
      data.warehouseCode, data.warehouseName, data.requestedDeliveryDate,
      data.collectionPolicy, data.note, data.idempotencyKey, data.payloadHash, data.actorId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertDeliveryOrderLine(client, data) {
  const result = await client.query(
    `INSERT INTO sales.delivery_order_lines (
       id, installation_id, delivery_order_id, line_number,
       sales_order_id, sales_order_version_id, sales_order_line_id,
       fulfillment_demand_id, fulfillment_allocation_id,
       inventory_reservation_id, warehouse_id, location_id,
       base_variant_id, lot_id, sku_snapshot, item_name_snapshot,
       unit_code_snapshot, packed_base_quantity_snapshot,
       delivery_base_quantity, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     ) RETURNING *`,
    [
      data.id, data.installationId, data.deliveryOrderId, data.lineNumber,
      data.salesOrderId, data.salesOrderVersionId, data.salesOrderLineId,
      data.fulfillmentDemandId, data.fulfillmentAllocationId, data.inventoryReservationId,
      data.warehouseId, data.locationId, data.baseVariantId, data.lotId,
      data.sku, data.itemName, data.unitCode, data.packedBaseQuantity,
      data.deliveryBaseQuantity, data.actorId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertDeliveryOrderEvent(client, data) {
  const result = await client.query(
    `INSERT INTO sales.delivery_order_events (
       id, installation_id, delivery_order_id, event_type,
       idempotency_key, payload_hash, actor_id, request_id,
       source_app, reason, metadata, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     RETURNING *`,
    [
      randomUUID(), data.installationId, data.deliveryOrderId, data.eventType,
      data.idempotencyKey, data.payloadHash, data.actorId, data.requestId,
      data.sourceApp, data.reason ?? null, JSON.stringify(data.metadata ?? {}), data.occurredAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function confirmDeliveryOrder(client, {
  installationId,
  deliveryOrderId,
  deliveryOrderNumber,
  allocationId,
  actorId,
}) {
  const result = await client.query(
    `UPDATE sales.delivery_orders
        SET status = 'ready_to_dispatch',
            delivery_order_number = $3,
            delivery_order_number_allocation_id = $4,
            confirmed_at = now(),
            confirmed_by = $5,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $5
      WHERE installation_id = $1 AND id = $2 AND status = 'draft'
      RETURNING *`,
    [installationId, deliveryOrderId, deliveryOrderNumber, allocationId, actorId],
  );
  return result.rows[0] ?? null;
}

export async function cancelDeliveryOrder(client, {
  installationId,
  deliveryOrderId,
  reason,
  actorId,
}) {
  const result = await client.query(
    `UPDATE sales.delivery_orders
        SET status = 'cancelled',
            cancelled_at = now(),
            cancelled_by = $3,
            cancellation_reason = $4,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $3
      WHERE installation_id = $1 AND id = $2 AND status = 'draft'
      RETURNING *`,
    [installationId, deliveryOrderId, actorId, reason],
  );
  return result.rows[0] ?? null;
}

export async function refreshSalesOrderDeliveryStatus(client, {
  installationId,
  salesOrderId,
  actorId,
}) {
  const result = await client.query(
    `WITH projected AS (
       SELECT CASE
         WHEN orders.delivery_mode = 'PICKUP' THEN 'not_required'
         WHEN EXISTS (
           SELECT 1 FROM sales.delivery_orders delivery_order
            WHERE delivery_order.installation_id = orders.installation_id
              AND delivery_order.sales_order_id = orders.id
              AND delivery_order.status = 'dispatched'
         ) THEN 'dispatched'
         WHEN EXISTS (
           SELECT 1 FROM sales.delivery_orders delivery_order
            WHERE delivery_order.installation_id = orders.installation_id
              AND delivery_order.sales_order_id = orders.id
              AND delivery_order.status = 'ready_to_dispatch'
         ) THEN 'ready_to_dispatch'
         ELSE 'pending'
       END AS status
       FROM sales.sales_orders orders
       WHERE orders.installation_id = $1 AND orders.id = $2
     )
     UPDATE sales.sales_orders orders
        SET delivery_status = projected.status,
            updated_at = now(),
            updated_by = $3
       FROM projected
      WHERE orders.installation_id = $1
        AND orders.id = $2
        AND orders.status = 'confirmed'
        AND orders.delivery_status IS DISTINCT FROM projected.status
      RETURNING orders.delivery_status`,
    [installationId, salesOrderId, actorId],
  );
  return result.rows[0]?.delivery_status ?? null;
}
