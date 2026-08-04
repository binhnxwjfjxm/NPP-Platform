import { randomUUID } from 'node:crypto';

export async function setDeliveryIssueWriteContext(client) {
  await client.query(
    `SELECT set_config('npp.delivery_issue_write_context', 'delivery_issue_service', true),
            set_config('npp.delivery_order_write_context', 'delivery_issue_service', true),
            set_config('npp.sales_fulfillment_write_context', 'delivery_issue_service', true)`,
  );
}

export async function setCustomerReturnWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.customer_return_write_context', 'customer_return_service', true)",
  );
}

export async function lockOperationKey(client, { installationId, operation, idempotencyKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`sales-delivery-inventory:${installationId}:${operation}:${idempotencyKey}`],
  );
}

export async function getDeliveryOrderIssueSource(client, {
  installationId,
  deliveryOrderId,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT delivery_order.*,
            orders.order_number,
            orders.status AS sales_order_status,
            orders.delivery_mode AS sales_order_delivery_mode,
            orders.delivery_status AS sales_order_delivery_status
       FROM sales.delivery_orders delivery_order
       JOIN sales.sales_orders orders
         ON orders.installation_id = delivery_order.installation_id
        AND orders.id = delivery_order.sales_order_id
      WHERE delivery_order.installation_id = $1
        AND delivery_order.id = $2
      ${forUpdate ? 'FOR UPDATE OF delivery_order' : ''}`,
    [installationId, deliveryOrderId],
  );
  return result.rows?.[0] ?? null;
}

export async function listDeliveryOrderIssueSourceLines(client, {
  installationId,
  deliveryOrderId,
}) {
  const result = await client.query(
    `SELECT line.*,
            base.sku AS base_sku,
            base.unit_id AS base_unit_id,
            unit.code AS base_unit_code,
            allocation.allocated_base_quantity,
            allocation.packed_base_quantity,
            allocation.state AS allocation_state,
            demand.state AS demand_state,
            demand.issued_base_quantity AS demand_issued_base_quantity,
            reservation.state AS reservation_state,
            reservation.quantity AS reservation_quantity,
            reservation.consumed_quantity AS reservation_consumed_quantity,
            location.code AS location_code,
            location.name AS location_name,
            lot.lot_code,
            lot.expiry_date
       FROM sales.delivery_order_lines line
       JOIN sales.sales_order_fulfillment_allocations allocation
         ON allocation.installation_id = line.installation_id
        AND allocation.id = line.fulfillment_allocation_id
       JOIN sales.sales_order_fulfillment_demands demand
         ON demand.installation_id = line.installation_id
        AND demand.id = line.fulfillment_demand_id
       JOIN inventory.inventory_reservations reservation
         ON reservation.installation_id = line.installation_id
        AND reservation.id = line.inventory_reservation_id
       JOIN shared.product_variants base
         ON base.installation_id = line.installation_id
        AND base.id = line.base_variant_id
       JOIN shared.units_of_measure unit
         ON unit.installation_id = base.installation_id
        AND unit.id = base.unit_id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = line.installation_id
        AND location.warehouse_id = line.warehouse_id
        AND location.id = line.location_id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = line.installation_id
        AND lot.id = line.lot_id
      WHERE line.installation_id = $1
        AND line.delivery_order_id = $2
      ORDER BY line.line_number ASC`,
    [installationId, deliveryOrderId],
  );
  return result.rows ?? [];
}

export async function getIssueByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM sales.delivery_order_inventory_issues
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows?.[0] ?? null;
}

export async function getIssueById(client, { installationId, issueId, forUpdate = false }) {
  const result = await client.query(
    `SELECT issue.*,
            delivery_order.sales_order_id,
            delivery_order.customer_id,
            delivery_order.warehouse_id,
            delivery_order.handover_mode,
            delivery_order.delivery_order_number,
            delivery_order.status AS delivery_order_status
       FROM sales.delivery_order_inventory_issues issue
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = issue.installation_id
        AND delivery_order.id = issue.delivery_order_id
      WHERE issue.installation_id = $1
        AND issue.id = $2
      ${forUpdate ? 'FOR UPDATE OF issue' : ''}`,
    [installationId, issueId],
  );
  return result.rows?.[0] ?? null;
}

export async function getActiveIssueForDeliveryOrder(client, {
  installationId,
  deliveryOrderId,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT *
       FROM sales.delivery_order_inventory_issues
      WHERE installation_id = $1
        AND delivery_order_id = $2
        AND status IN ('POSTING', 'POSTED')
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [installationId, deliveryOrderId],
  );
  return result.rows?.[0] ?? null;
}

export async function listIssueLines(client, { installationId, issueId }) {
  const result = await client.query(
    `SELECT issue_line.*,
            delivery_line.sales_order_id,
            delivery_line.sales_order_line_id,
            delivery_line.sku_snapshot,
            delivery_line.item_name_snapshot,
            delivery_line.unit_code_snapshot,
            location.code AS location_code,
            location.name AS location_name,
            lot.lot_code,
            lot.expiry_date,
            movement_line.base_quantity_delta,
            movement_line.source_quantity
       FROM sales.delivery_order_inventory_issue_lines issue_line
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = issue_line.installation_id
        AND delivery_line.id = issue_line.delivery_order_line_id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = issue_line.installation_id
        AND location.warehouse_id = issue_line.warehouse_id
        AND location.id = issue_line.location_id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = issue_line.installation_id
        AND lot.id = issue_line.lot_id
       LEFT JOIN inventory.inventory_movement_lines movement_line
         ON movement_line.installation_id = issue_line.installation_id
        AND movement_line.id = issue_line.inventory_movement_line_id
      WHERE issue_line.installation_id = $1
        AND issue_line.issue_id = $2
      ORDER BY delivery_line.line_number ASC`,
    [installationId, issueId],
  );
  return result.rows ?? [];
}

export async function insertIssue(client, data) {
  const result = await client.query(
    `INSERT INTO sales.delivery_order_inventory_issues (
       id, installation_id, delivery_order_id, issue_source_type, issue_source_id,
       status, receiver_name, receiver_note, idempotency_key, payload_hash,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,'POSTING',$6,$7,$8,$9,$10,$10)
     RETURNING *`,
    [
      data.id,
      data.installationId,
      data.deliveryOrderId,
      data.issueSourceType,
      data.issueSourceId,
      data.receiverName ?? null,
      data.receiverNote ?? null,
      data.idempotencyKey,
      data.payloadHash,
      data.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertIssueLine(client, data) {
  const result = await client.query(
    `INSERT INTO sales.delivery_order_inventory_issue_lines (
       id, installation_id, issue_id, delivery_order_id, delivery_order_line_id,
       fulfillment_demand_id, fulfillment_allocation_id, inventory_reservation_id,
       warehouse_id, location_id, base_variant_id, lot_id, issued_base_quantity,
       created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      data.id,
      data.installationId,
      data.issueId,
      data.deliveryOrderId,
      data.deliveryOrderLineId,
      data.fulfillmentDemandId,
      data.fulfillmentAllocationId,
      data.inventoryReservationId,
      data.warehouseId,
      data.locationId,
      data.baseVariantId,
      data.lotId,
      data.quantity,
      data.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function attachMovementLineToIssueLine(client, {
  installationId,
  issueLineId,
  movementLineId,
}) {
  const result = await client.query(
    `UPDATE sales.delivery_order_inventory_issue_lines
        SET inventory_movement_line_id = $3
      WHERE installation_id = $1
        AND id = $2
        AND inventory_movement_line_id IS NULL
      RETURNING *`,
    [installationId, issueLineId, movementLineId],
  );
  return result.rows?.[0] ?? null;
}

export async function finalizeIssue(client, {
  installationId,
  issueId,
  movementId,
  actorId,
  postedAt,
}) {
  const result = await client.query(
    `UPDATE sales.delivery_order_inventory_issues
        SET status = 'POSTED',
            inventory_movement_id = $3,
            posted_at = $4,
            posted_by = $5,
            updated_at = $4,
            updated_by = $5
      WHERE installation_id = $1
        AND id = $2
        AND status = 'POSTING'
      RETURNING *`,
    [installationId, issueId, movementId, postedAt, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function reverseIssue(client, {
  installationId,
  issueId,
  reversalMovementId,
  reason,
  actorId,
  reversedAt,
}) {
  const result = await client.query(
    `UPDATE sales.delivery_order_inventory_issues
        SET status = 'REVERSED',
            inventory_reversal_movement_id = $3,
            reversal_reason = $4,
            reversed_at = $5,
            reversed_by = $6,
            updated_at = $5,
            updated_by = $6
      WHERE installation_id = $1
        AND id = $2
        AND status = 'POSTED'
      RETURNING *`,
    [installationId, issueId, reversalMovementId, reason, reversedAt, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function insertReservationAdjustment(client, data) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_reservation_issue_adjustments (
       id, installation_id, reservation_id, adjustment_type, quantity,
       source_document_type, source_document_id, source_line_id,
       idempotency_key, payload_hash, actor_id, request_id, source_app,
       metadata, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
     RETURNING *`,
    [
      data.id ?? randomUUID(),
      data.installationId,
      data.reservationId,
      data.adjustmentType,
      data.quantity,
      data.sourceDocumentType,
      data.sourceDocumentId,
      data.sourceLineId,
      data.idempotencyKey,
      data.payloadHash,
      data.actorId,
      data.requestId,
      data.sourceApp,
      JSON.stringify(data.metadata ?? {}),
      data.occurredAt,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function updateDeliveryOrderIssueStatus(client, {
  installationId,
  deliveryOrderId,
  status,
  actorId,
}) {
  const result = await client.query(
    `UPDATE sales.delivery_orders
        SET status = $3,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $4
      WHERE installation_id = $1
        AND id = $2
        AND status IS DISTINCT FROM $3
      RETURNING *`,
    [installationId, deliveryOrderId, status, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function refreshFulfillmentIssuedProjection(client, {
  installationId,
  demandIds,
  actorId,
}) {
  if (!Array.isArray(demandIds) || demandIds.length === 0) return [];
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_demands demand
        SET issued_base_quantity = COALESCE((
              SELECT sum(issue_line.issued_base_quantity)
                FROM sales.delivery_order_inventory_issue_lines issue_line
                JOIN sales.delivery_order_inventory_issues issue
                  ON issue.installation_id = issue_line.installation_id
                 AND issue.id = issue_line.issue_id
               WHERE issue_line.installation_id = demand.installation_id
                 AND issue_line.fulfillment_demand_id = demand.id
                 AND issue.status = 'POSTED'
            ), 0)::numeric(30,12),
            updated_at = now(),
            updated_by = $3
      WHERE demand.installation_id = $1
        AND demand.id = ANY($2::uuid[])
      RETURNING demand.id, demand.sales_order_id, demand.issued_base_quantity`,
    [installationId, demandIds, actorId],
  );
  return result.rows ?? [];
}

export async function refreshSalesOrderFulfillmentStatus(client, {
  installationId,
  salesOrderId,
  actorId,
}) {
  const result = await client.query(
    `WITH projected AS (
       SELECT CASE
         WHEN count(*) = 0 THEN NULL
         WHEN sum(demand.issued_base_quantity) = sum(demand.reserved_base_quantity)
              AND sum(demand.reserved_base_quantity) > 0
              AND sum(demand.backordered_base_quantity) = 0 THEN 'issued'
         WHEN sum(demand.issued_base_quantity) > 0 THEN 'partially_issued'
         WHEN sum(demand.packed_base_quantity) = sum(demand.reserved_base_quantity)
              AND sum(demand.reserved_base_quantity) > 0
              AND sum(demand.backordered_base_quantity) = 0 THEN 'packed'
         WHEN sum(demand.packed_base_quantity) > 0 THEN 'partially_packed'
         WHEN sum(demand.picked_base_quantity) = sum(demand.reserved_base_quantity)
              AND sum(demand.reserved_base_quantity) > 0
              AND sum(demand.backordered_base_quantity) = 0 THEN 'picked'
         WHEN sum(demand.picked_base_quantity) > 0 THEN 'partially_picked'
         WHEN sum(demand.allocated_base_quantity) = sum(demand.reserved_base_quantity)
              AND sum(demand.reserved_base_quantity) > 0
              AND sum(demand.backordered_base_quantity) = 0 THEN 'allocated'
         WHEN sum(demand.allocated_base_quantity) > 0 THEN 'partially_allocated'
         WHEN sum(demand.reserved_base_quantity) = 0 THEN 'backordered'
         WHEN sum(demand.backordered_base_quantity) > 0 THEN 'partially_reserved'
         ELSE 'reserved'
       END AS status
       FROM sales.sales_order_fulfillment_demands demand
       WHERE demand.installation_id = $1
         AND demand.sales_order_id = $2
         AND demand.state = 'ACTIVE'
     )
     UPDATE sales.sales_orders orders
        SET fulfillment_status = projected.status,
            updated_at = now(),
            updated_by = $3
       FROM projected
      WHERE orders.installation_id = $1
        AND orders.id = $2
        AND orders.status = 'confirmed'
        AND projected.status IS NOT NULL
        AND orders.fulfillment_status IS DISTINCT FROM projected.status
      RETURNING orders.fulfillment_status`,
    [installationId, salesOrderId, actorId],
  );
  return result.rows?.[0]?.fulfillment_status ?? null;
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
           SELECT 1
             FROM sales.delivery_orders delivery_order
            WHERE delivery_order.installation_id = orders.installation_id
              AND delivery_order.sales_order_id = orders.id
              AND delivery_order.status = 'dispatched'
         ) THEN 'dispatched'
         WHEN EXISTS (
           SELECT 1
             FROM sales.delivery_orders delivery_order
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
  return result.rows?.[0]?.delivery_status ?? null;
}

export async function hasBlockingCustomerReturn(client, { installationId, issueId }) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM sales.customer_return_lines line
         JOIN sales.customer_returns header
           ON header.installation_id = line.installation_id
          AND header.id = line.customer_return_id
        WHERE line.installation_id = $1
          AND line.issue_id = $2
          AND header.status IN ('draft', 'received')
     ) AS blocking`,
    [installationId, issueId],
  );
  return result.rows?.[0]?.blocking === true;
}

export async function listReturnEligibility(client, {
  installationId,
  warehouseIds,
  deliveryOrderId = null,
  limit = 500,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT issue_line.id AS issue_line_id,
            issue_line.issue_id,
            issue.inventory_movement_id,
            issue_line.inventory_movement_line_id,
            issue.delivery_order_id,
            delivery_order.delivery_order_number,
            delivery_order.sales_order_id,
            orders.order_number,
            delivery_order.customer_id,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            issue_line.delivery_order_line_id,
            delivery_line.sales_order_line_id,
            issue_line.warehouse_id,
            delivery_order.warehouse_code_snapshot,
            delivery_order.warehouse_name_snapshot,
            issue_line.location_id,
            location.code AS location_code,
            location.name AS location_name,
            issue_line.base_variant_id,
            issue_line.lot_id,
            lot.lot_code,
            lot.expiry_date,
            delivery_line.sku_snapshot,
            delivery_line.item_name_snapshot,
            delivery_line.unit_code_snapshot,
            issue_line.issued_base_quantity,
            COALESCE(returned.claimed_base_quantity, 0) AS claimed_return_base_quantity,
            issue_line.issued_base_quantity - COALESCE(returned.claimed_base_quantity, 0)
              AS available_return_base_quantity
       FROM sales.delivery_order_inventory_issue_lines issue_line
       JOIN sales.delivery_order_inventory_issues issue
         ON issue.installation_id = issue_line.installation_id
        AND issue.id = issue_line.issue_id
        AND issue.status = 'POSTED'
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = issue_line.installation_id
        AND delivery_order.id = issue.delivery_order_id
       JOIN sales.sales_orders orders
         ON orders.installation_id = delivery_order.installation_id
        AND orders.id = delivery_order.sales_order_id
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = issue_line.installation_id
        AND delivery_line.id = issue_line.delivery_order_line_id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = issue_line.installation_id
        AND location.warehouse_id = issue_line.warehouse_id
        AND location.id = issue_line.location_id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = issue_line.installation_id
        AND lot.id = issue_line.lot_id
       LEFT JOIN LATERAL (
         SELECT sum(CASE
           WHEN header.status = 'received' THEN COALESCE(receipt.accepted_base_quantity, 0)
           ELSE return_line.requested_base_quantity
         END) AS claimed_base_quantity
           FROM sales.customer_return_lines return_line
           JOIN sales.customer_returns header
             ON header.installation_id = return_line.installation_id
            AND header.id = return_line.customer_return_id
           LEFT JOIN sales.customer_return_receipt_lines receipt
             ON receipt.installation_id = return_line.installation_id
            AND receipt.customer_return_line_id = return_line.id
          WHERE return_line.installation_id = issue_line.installation_id
            AND return_line.issue_line_id = issue_line.id
            AND header.status IN ('draft', 'received')
       ) returned ON true
      WHERE issue_line.installation_id = $1
        AND issue_line.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR issue.delivery_order_id = $3)
        AND issue_line.issued_base_quantity > COALESCE(returned.claimed_base_quantity, 0)
      ORDER BY issue.posted_at DESC, delivery_order.delivery_order_number, delivery_line.line_number
      LIMIT $4 OFFSET $5`,
    [installationId, warehouseIds, deliveryOrderId, limit, offset],
  );
  return result.rows ?? [];
}

export async function getReturnSourceLineForUpdate(client, {
  installationId,
  issueLineId,
}) {
  const result = await client.query(
    `SELECT eligibility.*
       FROM (
         SELECT issue_line.id AS issue_line_id,
                issue_line.issue_id,
                issue.status AS issue_status,
                issue.inventory_movement_id,
                issue_line.inventory_movement_line_id,
                issue.delivery_order_id,
                delivery_order.delivery_order_number,
                delivery_order.status AS delivery_order_status,
                delivery_order.sales_order_id,
                delivery_order.customer_id,
                delivery_order.customer_code_snapshot,
                delivery_order.customer_name_snapshot,
                issue_line.delivery_order_line_id,
                delivery_line.sales_order_line_id,
                issue_line.warehouse_id,
                issue_line.location_id,
                issue_line.base_variant_id,
                issue_line.lot_id,
                delivery_line.sku_snapshot,
                delivery_line.item_name_snapshot,
                delivery_line.unit_code_snapshot,
                issue_line.issued_base_quantity,
                COALESCE((
                  SELECT sum(CASE
                    WHEN header.status = 'received' THEN COALESCE(receipt.accepted_base_quantity, 0)
                    ELSE return_line.requested_base_quantity
                  END)
                    FROM sales.customer_return_lines return_line
                    JOIN sales.customer_returns header
                      ON header.installation_id = return_line.installation_id
                     AND header.id = return_line.customer_return_id
                    LEFT JOIN sales.customer_return_receipt_lines receipt
                      ON receipt.installation_id = return_line.installation_id
                     AND receipt.customer_return_line_id = return_line.id
                   WHERE return_line.installation_id = issue_line.installation_id
                     AND return_line.issue_line_id = issue_line.id
                     AND header.status IN ('draft', 'received')
                ), 0) AS claimed_return_base_quantity
           FROM sales.delivery_order_inventory_issue_lines issue_line
           JOIN sales.delivery_order_inventory_issues issue
             ON issue.installation_id = issue_line.installation_id
            AND issue.id = issue_line.issue_id
           JOIN sales.delivery_orders delivery_order
             ON delivery_order.installation_id = issue_line.installation_id
            AND delivery_order.id = issue.delivery_order_id
           JOIN sales.delivery_order_lines delivery_line
             ON delivery_line.installation_id = issue_line.installation_id
            AND delivery_line.id = issue_line.delivery_order_line_id
          WHERE issue_line.installation_id = $1
            AND issue_line.id = $2
       ) eligibility
      FOR UPDATE`,
    [installationId, issueLineId],
  );
  return result.rows?.[0] ?? null;
}

export async function getCustomerReturnByCreateKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM sales.customer_returns
      WHERE installation_id = $1 AND create_idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows?.[0] ?? null;
}

export async function insertCustomerReturn(client, data) {
  const result = await client.query(
    `INSERT INTO sales.customer_returns (
       id, installation_id, customer_id, warehouse_id, status, note,
       create_idempotency_key, create_payload_hash, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$8)
     RETURNING *`,
    [
      data.id,
      data.installationId,
      data.customerId,
      data.warehouseId,
      data.note ?? null,
      data.idempotencyKey,
      data.payloadHash,
      data.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertCustomerReturnLine(client, data) {
  const result = await client.query(
    `INSERT INTO sales.customer_return_lines (
       id, installation_id, customer_return_id, line_number,
       delivery_order_id, delivery_order_line_id, issue_id, issue_line_id,
       inventory_movement_id, inventory_movement_line_id,
       sales_order_id, sales_order_line_id, customer_id,
       warehouse_id, location_id, base_variant_id, lot_id,
       sku_snapshot, item_name_snapshot, unit_code_snapshot,
       requested_base_quantity, reason_code, reason_note, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
     ) RETURNING *`,
    [
      data.id,
      data.installationId,
      data.customerReturnId,
      data.lineNumber,
      data.deliveryOrderId,
      data.deliveryOrderLineId,
      data.issueId,
      data.issueLineId,
      data.inventoryMovementId,
      data.inventoryMovementLineId,
      data.salesOrderId,
      data.salesOrderLineId,
      data.customerId,
      data.warehouseId,
      data.locationId,
      data.baseVariantId,
      data.lotId,
      data.sku,
      data.itemName,
      data.unitCode,
      data.quantity,
      data.reasonCode,
      data.reasonNote,
      data.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function listCustomerReturns(client, {
  installationId,
  warehouseIds,
  status = null,
  limit = 200,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT header.*,
            customer.code AS customer_code,
            customer.name AS customer_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            COALESCE(totals.line_count, 0)::integer AS line_count,
            COALESCE(totals.requested_quantity, 0) AS requested_base_quantity,
            COALESCE(totals.accepted_quantity, 0) AS accepted_base_quantity
       FROM sales.customer_returns header
       JOIN shared.customers customer
         ON customer.installation_id = header.installation_id
        AND customer.id = header.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = header.installation_id
        AND warehouse.id = header.warehouse_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS line_count,
                sum(line.requested_base_quantity) AS requested_quantity,
                sum(COALESCE(receipt.accepted_base_quantity, 0)) AS accepted_quantity
           FROM sales.customer_return_lines line
           LEFT JOIN sales.customer_return_receipt_lines receipt
             ON receipt.installation_id = line.installation_id
            AND receipt.customer_return_line_id = line.id
          WHERE line.installation_id = header.installation_id
            AND line.customer_return_id = header.id
       ) totals ON true
      WHERE header.installation_id = $1
        AND header.warehouse_id = ANY($2::uuid[])
        AND ($3::text IS NULL OR header.status = $3)
      ORDER BY header.created_at DESC, header.id DESC
      LIMIT $4 OFFSET $5`,
    [installationId, warehouseIds, status, limit, offset],
  );
  return result.rows ?? [];
}

export async function getCustomerReturn(client, {
  installationId,
  customerReturnId,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT header.*,
            customer.code AS customer_code,
            customer.name AS customer_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM sales.customer_returns header
       JOIN shared.customers customer
         ON customer.installation_id = header.installation_id
        AND customer.id = header.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = header.installation_id
        AND warehouse.id = header.warehouse_id
      WHERE header.installation_id = $1
        AND header.id = $2
      ${forUpdate ? 'FOR UPDATE OF header' : ''}`,
    [installationId, customerReturnId],
  );
  return result.rows?.[0] ?? null;
}

export async function listCustomerReturnLines(client, { installationId, customerReturnId }) {
  const result = await client.query(
    `SELECT line.*,
            delivery_order.delivery_order_number,
            orders.order_number,
            location.code AS location_code,
            location.name AS location_name,
            lot.lot_code,
            lot.expiry_date,
            receipt.id AS receipt_line_id,
            receipt.accepted_base_quantity,
            receipt.inventory_movement_line_id AS receipt_inventory_movement_line_id
       FROM sales.customer_return_lines line
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = line.installation_id
        AND delivery_order.id = line.delivery_order_id
       JOIN sales.sales_orders orders
         ON orders.installation_id = line.installation_id
        AND orders.id = line.sales_order_id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = line.installation_id
        AND location.warehouse_id = line.warehouse_id
        AND location.id = line.location_id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = line.installation_id
        AND lot.id = line.lot_id
       LEFT JOIN sales.customer_return_receipt_lines receipt
         ON receipt.installation_id = line.installation_id
        AND receipt.customer_return_line_id = line.id
      WHERE line.installation_id = $1
        AND line.customer_return_id = $2
      ORDER BY line.line_number ASC`,
    [installationId, customerReturnId],
  );
  return result.rows ?? [];
}

export async function listCustomerReturnEvents(client, { installationId, customerReturnId }) {
  const result = await client.query(
    `SELECT * FROM sales.customer_return_events
      WHERE installation_id = $1 AND customer_return_id = $2
      ORDER BY occurred_at ASC, id ASC`,
    [installationId, customerReturnId],
  );
  return result.rows ?? [];
}

export async function getCustomerReturnEventByKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM sales.customer_return_events
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows?.[0] ?? null;
}

export async function insertCustomerReturnEvent(client, data) {
  const result = await client.query(
    `INSERT INTO sales.customer_return_events (
       id, installation_id, customer_return_id, event_type, idempotency_key,
       payload_hash, actor_id, request_id, source_app, reason, metadata, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     RETURNING *`,
    [
      randomUUID(),
      data.installationId,
      data.customerReturnId,
      data.eventType,
      data.idempotencyKey,
      data.payloadHash,
      data.actorId,
      data.requestId,
      data.sourceApp,
      data.reason ?? null,
      JSON.stringify(data.metadata ?? {}),
      data.occurredAt,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function receiveCustomerReturn(client, {
  installationId,
  customerReturnId,
  returnNumber,
  numberAllocationId,
  movementId,
  actorId,
  receivedAt,
}) {
  const result = await client.query(
    `UPDATE sales.customer_returns
        SET status = 'received',
            return_number = $3,
            return_number_allocation_id = $4,
            inventory_movement_id = $5,
            received_at = $6,
            received_by = $7,
            revision = revision + 1,
            updated_at = $6,
            updated_by = $7
      WHERE installation_id = $1
        AND id = $2
        AND status = 'draft'
      RETURNING *`,
    [installationId, customerReturnId, returnNumber, numberAllocationId, movementId, receivedAt, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function insertCustomerReturnReceiptLine(client, data) {
  const result = await client.query(
    `INSERT INTO sales.customer_return_receipt_lines (
       id, installation_id, customer_return_id, customer_return_line_id,
       inventory_movement_line_id, accepted_base_quantity, metadata, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING *`,
    [
      data.id ?? randomUUID(),
      data.installationId,
      data.customerReturnId,
      data.customerReturnLineId,
      data.inventoryMovementLineId,
      data.quantity,
      JSON.stringify(data.metadata ?? {}),
      data.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function cancelCustomerReturn(client, {
  installationId,
  customerReturnId,
  reason,
  actorId,
}) {
  const result = await client.query(
    `UPDATE sales.customer_returns
        SET status = 'cancelled',
            cancelled_at = now(),
            cancelled_by = $3,
            cancellation_reason = $4,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $3
      WHERE installation_id = $1
        AND id = $2
        AND status = 'draft'
      RETURNING *`,
    [installationId, customerReturnId, actorId, reason],
  );
  return result.rows?.[0] ?? null;
}
