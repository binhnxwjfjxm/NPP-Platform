export async function setTripDispatchWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.logistics_write_context', 'trip_dispatch_service', true)",
  );
}

export async function lockDispatchKey(client, { installationId, tripId, idempotencyKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`logistics-trip-dispatch:${installationId}:${tripId}:${idempotencyKey}`],
  );
}

export async function getTripForDispatch(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT trip.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            vehicle.code AS vehicle_code,
            vehicle.license_plate,
            vehicle.is_active AS vehicle_is_active,
            vehicle.operational_status AS vehicle_operational_status,
            driver.code AS driver_code,
            driver.name AS driver_name,
            driver.is_active AS driver_is_active
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

export async function listAssignmentsForDispatch(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT assignment.id AS assignment_id,
            assignment.trip_stop_id,
            assignment.delivery_order_id,
            stop.stop_sequence,
            delivery_order.status AS delivery_order_status,
            delivery_order.handover_mode,
            delivery_order.warehouse_id,
            delivery_order.delivery_order_number,
            delivery_order.sales_order_id,
            delivery_order.customer_id,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            orders.status AS sales_order_status,
            orders.delivery_mode AS sales_order_delivery_mode
       FROM logistics.trip_order_assignments assignment
       JOIN logistics.trip_stops stop
         ON stop.installation_id = assignment.installation_id
        AND stop.id = assignment.trip_stop_id
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = assignment.installation_id
        AND delivery_order.id = assignment.delivery_order_id
       JOIN sales.sales_orders orders
         ON orders.installation_id = delivery_order.installation_id
        AND orders.id = delivery_order.sales_order_id
      WHERE assignment.installation_id = $1
        AND assignment.trip_id = $2
        AND assignment.unassigned_at IS NULL
      ORDER BY stop.stop_sequence, assignment.assigned_at, assignment.id
      FOR UPDATE OF assignment, delivery_order`,
    [installationId, tripId],
  );
  return result.rows;
}

export async function insertDispatchItem(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_dispatch_items (
       id, installation_id, dispatch_id, trip_id, assignment_id,
       trip_stop_id, delivery_order_id, inventory_issue_id,
       inventory_movement_id, posted_at, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.dispatchId,
      values.tripId,
      values.assignmentId,
      values.tripStopId,
      values.deliveryOrderId,
      values.inventoryIssueId,
      values.inventoryMovementId,
      values.postedAt,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function markTripDispatched(client, values) {
  const result = await client.query(
    `UPDATE logistics.delivery_trips
        SET status = 'dispatched',
            dispatch_id = $3,
            dispatch_idempotency_key = $4,
            dispatch_payload_hash = $5,
            handover_receiver_name = $6,
            handover_note = $7,
            dispatched_at = $8,
            dispatched_by = $9,
            revision = revision + 1,
            updated_at = $8,
            updated_by = $9
      WHERE installation_id = $1
        AND id = $2
        AND status = 'locked'
      RETURNING *`,
    [
      values.installationId,
      values.tripId,
      values.dispatchId,
      values.idempotencyKey,
      values.payloadHash,
      values.handoverReceiverName,
      values.handoverNote,
      values.dispatchedAt,
      values.actorId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertDispatchTripEvent(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_events (
       id, installation_id, trip_id, event_type, idempotency_key,
       payload_hash, actor_id, request_id, source_app, reason,
       metadata, occurred_at
     ) VALUES ($1,$2,$3,'DISPATCHED',$4,$5,$6,$7,$8,NULL,$9,$10)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.tripId,
      values.idempotencyKey,
      values.payloadHash,
      values.actorId,
      values.requestId,
      values.sourceApp,
      values.metadata,
      values.occurredAt,
    ],
  );
  return result.rows[0];
}

export async function listDispatchItems(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT item.*,
            delivery_order.delivery_order_number,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            issue.status AS inventory_issue_status,
            movement.movement_type,
            movement.document_date,
            movement.posted_at AS movement_posted_at
       FROM logistics.trip_dispatch_items item
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = item.installation_id
        AND delivery_order.id = item.delivery_order_id
       JOIN sales.delivery_order_inventory_issues issue
         ON issue.installation_id = item.installation_id
        AND issue.id = item.inventory_issue_id
       JOIN inventory.inventory_movements movement
         ON movement.installation_id = item.installation_id
        AND movement.id = item.inventory_movement_id
      WHERE item.installation_id = $1
        AND item.trip_id = $2
      ORDER BY item.posted_at, item.id`,
    [installationId, tripId],
  );
  return result.rows;
}
