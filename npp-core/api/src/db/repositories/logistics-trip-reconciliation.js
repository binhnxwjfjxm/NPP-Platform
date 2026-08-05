export async function setTripReconciliationWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.logistics_write_context', 'trip_reconciliation_service', true)",
  );
}

export async function lockReconciliationKey(client, {
  installationId,
  tripId,
  operation,
  idempotencyKey,
}) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`trip-reconciliation:${installationId}:${tripId}:${operation}:${idempotencyKey}`],
  );
}

export async function getTripForReconciliation(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT trip.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            vehicle.code AS vehicle_code,
            vehicle.license_plate,
            driver.code AS driver_code,
            driver.name AS driver_name
       FROM logistics.delivery_trips trip
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = trip.installation_id
        AND warehouse.id = trip.warehouse_id
       LEFT JOIN logistics.vehicles vehicle
         ON vehicle.installation_id = trip.installation_id
        AND vehicle.id = trip.vehicle_id
       LEFT JOIN logistics.driver_profiles driver
         ON driver.installation_id = trip.installation_id
        AND driver.id = trip.primary_driver_id
      WHERE trip.installation_id = $1
        AND trip.id = $2
      FOR UPDATE OF trip`,
    [installationId, tripId],
  );
  return result.rows[0] ?? null;
}

export async function getTripForReconciliationRead(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT trip.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            vehicle.code AS vehicle_code,
            vehicle.license_plate,
            driver.code AS driver_code,
            driver.name AS driver_name
       FROM logistics.delivery_trips trip
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = trip.installation_id
        AND warehouse.id = trip.warehouse_id
       LEFT JOIN logistics.vehicles vehicle
         ON vehicle.installation_id = trip.installation_id
        AND vehicle.id = trip.vehicle_id
       LEFT JOIN logistics.driver_profiles driver
         ON driver.installation_id = trip.installation_id
        AND driver.id = trip.primary_driver_id
      WHERE trip.installation_id = $1
        AND trip.id = $2`,
    [installationId, tripId],
  );
  return result.rows[0] ?? null;
}

export async function listReconciliationLines(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT assignment.id AS assignment_id,
            assignment.trip_stop_id,
            stop.stop_sequence,
            assignment.delivery_order_id,
            delivery_order.delivery_order_number,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            attempt.id AS attempt_id,
            attempt.result AS attempt_result,
            attempt.attempted_at,
            attempt.reason_code,
            attempt.rescheduled_for,
            dispatch_item.inventory_issue_id,
            issue_line.id AS inventory_issue_line_id,
            issue_line.delivery_order_line_id,
            issue_line.warehouse_id,
            issue_line.location_id,
            issue_line.base_variant_id,
            issue_line.lot_id,
            issue_line.issued_base_quantity,
            delivery_line.sku_snapshot,
            delivery_line.item_name_snapshot,
            delivery_line.unit_code_snapshot,
            base.sku AS base_sku,
            base.unit_id AS base_unit_id,
            unit.code AS base_unit_code,
            location.code AS location_code,
            location.name AS location_name,
            lot.lot_code,
            lot.expiry_date,
            COALESCE((
              SELECT sum(attempt_line.delivered_base_quantity)
                FROM logistics.delivery_attempt_lines attempt_line
               WHERE attempt_line.installation_id = issue_line.installation_id
                 AND attempt_line.attempt_id = attempt.id
                 AND attempt_line.inventory_issue_line_id = issue_line.id
            ), 0)::numeric(30,12) AS delivered_base_quantity,
            COALESCE((
              SELECT sum(receipt_line.returned_base_quantity)
                FROM logistics.trip_return_receipt_lines receipt_line
                JOIN logistics.trip_return_receipts receipt
                  ON receipt.installation_id = receipt_line.installation_id
                 AND receipt.id = receipt_line.receipt_id
               WHERE receipt_line.installation_id = issue_line.installation_id
                 AND receipt_line.inventory_issue_line_id = issue_line.id
                 AND receipt.status = 'POSTED'
            ), 0)::numeric(30,12) AS returned_base_quantity
       FROM logistics.trip_order_assignments assignment
       JOIN logistics.trip_stops stop
         ON stop.installation_id = assignment.installation_id
        AND stop.id = assignment.trip_stop_id
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = assignment.installation_id
        AND delivery_order.id = assignment.delivery_order_id
       JOIN logistics.trip_dispatch_items dispatch_item
         ON dispatch_item.installation_id = assignment.installation_id
        AND dispatch_item.assignment_id = assignment.id
       JOIN sales.delivery_order_inventory_issue_lines issue_line
         ON issue_line.installation_id = dispatch_item.installation_id
        AND issue_line.issue_id = dispatch_item.inventory_issue_id
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = issue_line.installation_id
        AND delivery_line.id = issue_line.delivery_order_line_id
       JOIN shared.product_variants base
         ON base.installation_id = issue_line.installation_id
        AND base.id = issue_line.base_variant_id
       JOIN shared.units_of_measure unit
         ON unit.installation_id = base.installation_id
        AND unit.id = base.unit_id
       LEFT JOIN logistics.delivery_attempts attempt
         ON attempt.installation_id = assignment.installation_id
        AND attempt.assignment_id = assignment.id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = issue_line.installation_id
        AND location.warehouse_id = issue_line.warehouse_id
        AND location.id = issue_line.location_id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = issue_line.installation_id
        AND lot.id = issue_line.lot_id
      WHERE assignment.installation_id = $1
        AND assignment.trip_id = $2
        AND assignment.unassigned_at IS NULL
      ORDER BY stop.stop_sequence, delivery_order.delivery_order_number,
               delivery_line.line_number, issue_line.id`,
    [installationId, tripId],
  );
  return result.rows;
}

export async function getReceiptByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM logistics.trip_return_receipts
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function listReturnReceipts(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT receipt.*,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', line.id,
                'assignmentId', line.assignment_id,
                'attemptId', line.attempt_id,
                'inventoryIssueLineId', line.inventory_issue_line_id,
                'inventoryMovementLineId', line.inventory_movement_line_id,
                'returnedBaseQuantity', line.returned_base_quantity::text,
                'sku', delivery_line.sku_snapshot,
                'itemName', delivery_line.item_name_snapshot,
                'unitCode', delivery_line.unit_code_snapshot
              ) ORDER BY delivery_line.line_number, line.id)
                FROM logistics.trip_return_receipt_lines line
                JOIN sales.delivery_order_inventory_issue_lines issue_line
                  ON issue_line.installation_id = line.installation_id
                 AND issue_line.id = line.inventory_issue_line_id
                JOIN sales.delivery_order_lines delivery_line
                  ON delivery_line.installation_id = issue_line.installation_id
                 AND delivery_line.id = issue_line.delivery_order_line_id
               WHERE line.installation_id = receipt.installation_id
                 AND line.receipt_id = receipt.id
            ), '[]'::jsonb) AS lines
       FROM logistics.trip_return_receipts receipt
      WHERE receipt.installation_id = $1
        AND receipt.trip_id = $2
        AND receipt.status = 'POSTED'
      ORDER BY receipt.received_at, receipt.id`,
    [installationId, tripId],
  );
  return result.rows;
}

export async function listReceiptSourceLinesForUpdate(client, {
  installationId,
  tripId,
  inventoryIssueLineIds,
}) {
  const result = await client.query(
    `SELECT assignment.id AS assignment_id,
            assignment.trip_stop_id,
            assignment.delivery_order_id,
            delivery_order.delivery_order_number,
            attempt.id AS attempt_id,
            attempt.result AS attempt_result,
            dispatch_item.inventory_issue_id,
            issue_line.id AS inventory_issue_line_id,
            issue_line.delivery_order_line_id,
            issue_line.warehouse_id,
            issue_line.location_id,
            issue_line.base_variant_id,
            issue_line.lot_id,
            issue_line.issued_base_quantity,
            base.sku AS base_sku,
            base.unit_id AS base_unit_id,
            unit.code AS base_unit_code,
            lot.lot_code,
            lot.expiry_date,
            COALESCE((
              SELECT sum(attempt_line.delivered_base_quantity)
                FROM logistics.delivery_attempt_lines attempt_line
               WHERE attempt_line.installation_id = issue_line.installation_id
                 AND attempt_line.attempt_id = attempt.id
                 AND attempt_line.inventory_issue_line_id = issue_line.id
            ), 0)::numeric(30,12) AS delivered_base_quantity,
            COALESCE((
              SELECT sum(receipt_line.returned_base_quantity)
                FROM logistics.trip_return_receipt_lines receipt_line
                JOIN logistics.trip_return_receipts receipt
                  ON receipt.installation_id = receipt_line.installation_id
                 AND receipt.id = receipt_line.receipt_id
               WHERE receipt_line.installation_id = issue_line.installation_id
                 AND receipt_line.inventory_issue_line_id = issue_line.id
                 AND receipt.status = 'POSTED'
            ), 0)::numeric(30,12) AS returned_base_quantity
       FROM logistics.trip_order_assignments assignment
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = assignment.installation_id
        AND delivery_order.id = assignment.delivery_order_id
       JOIN logistics.trip_dispatch_items dispatch_item
         ON dispatch_item.installation_id = assignment.installation_id
        AND dispatch_item.assignment_id = assignment.id
       JOIN sales.delivery_order_inventory_issue_lines issue_line
         ON issue_line.installation_id = dispatch_item.installation_id
        AND issue_line.issue_id = dispatch_item.inventory_issue_id
       JOIN shared.product_variants base
         ON base.installation_id = issue_line.installation_id
        AND base.id = issue_line.base_variant_id
       JOIN shared.units_of_measure unit
         ON unit.installation_id = base.installation_id
        AND unit.id = base.unit_id
       LEFT JOIN logistics.delivery_attempts attempt
         ON attempt.installation_id = assignment.installation_id
        AND attempt.assignment_id = assignment.id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = issue_line.installation_id
        AND lot.id = issue_line.lot_id
      WHERE assignment.installation_id = $1
        AND assignment.trip_id = $2
        AND assignment.unassigned_at IS NULL
        AND issue_line.id = ANY($3::uuid[])
      ORDER BY issue_line.id
      FOR UPDATE OF issue_line`,
    [installationId, tripId, inventoryIssueLineIds],
  );
  return result.rows;
}

export async function insertReturnReceipt(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_return_receipts (
       id, installation_id, trip_id, warehouse_id, status,
       received_at, note, idempotency_key, payload_hash,
       actor_id, request_id, source_app, created_by
     ) VALUES ($1,$2,$3,$4,'POSTING',$5,$6,$7,$8,$9,$10,$11,$9)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.tripId,
      values.warehouseId,
      values.receivedAt,
      values.note,
      values.idempotencyKey,
      values.payloadHash,
      values.actorId,
      values.requestId,
      values.sourceApp,
    ],
  );
  return result.rows[0];
}

export async function insertReturnReceiptLine(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_return_receipt_lines (
       id, installation_id, receipt_id, trip_id, assignment_id,
       attempt_id, inventory_issue_line_id, returned_base_quantity, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.receiptId,
      values.tripId,
      values.assignmentId,
      values.attemptId,
      values.inventoryIssueLineId,
      values.returnedBaseQuantity,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function attachMovementLine(client, {
  installationId,
  receiptLineId,
  movementLineId,
}) {
  const result = await client.query(
    `UPDATE logistics.trip_return_receipt_lines
        SET inventory_movement_line_id = $3
      WHERE installation_id = $1
        AND id = $2
        AND inventory_movement_line_id IS NULL
      RETURNING *`,
    [installationId, receiptLineId, movementLineId],
  );
  return result.rows[0] ?? null;
}

export async function finalizeReturnReceipt(client, {
  installationId,
  receiptId,
  movementId,
}) {
  const result = await client.query(
    `UPDATE logistics.trip_return_receipts
        SET status = 'POSTED',
            inventory_movement_id = $3
      WHERE installation_id = $1
        AND id = $2
        AND status = 'POSTING'
      RETURNING *`,
    [installationId, receiptId, movementId],
  );
  return result.rows[0] ?? null;
}

export async function insertTripEvent(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_events (
       id, installation_id, trip_id, event_type, idempotency_key,
       payload_hash, actor_id, request_id, source_app, reason,
       metadata, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.tripId,
      values.eventType,
      values.idempotencyKey,
      values.payloadHash,
      values.actorId,
      values.requestId,
      values.sourceApp,
      values.reason,
      JSON.stringify(values.metadata ?? {}),
      values.occurredAt,
    ],
  );
  return result.rows[0];
}

export async function closeTrip(client, values) {
  const result = await client.query(
    `UPDATE logistics.delivery_trips
        SET status = 'closed',
            closed_at = $3,
            closed_by = $4,
            close_note = $5,
            close_idempotency_key = $6,
            close_payload_hash = $7,
            revision = revision + 1,
            updated_at = $3,
            updated_by = $4
      WHERE installation_id = $1
        AND id = $2
        AND status = 'dispatched'
      RETURNING *`,
    [
      values.installationId,
      values.tripId,
      values.closedAt,
      values.actorId,
      values.note,
      values.idempotencyKey,
      values.payloadHash,
    ],
  );
  return result.rows[0] ?? null;
}
