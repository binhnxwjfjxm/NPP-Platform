export async function setDeliveryAttemptWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.logistics_write_context', 'delivery_attempt_service', true)",
  );
}

export async function lockDeliveryAttemptKey(client, {
  installationId,
  assignmentId,
  idempotencyKey,
}) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`delivery-attempt:${installationId}:${assignmentId}:${idempotencyKey}`],
  );
}

export async function getActiveDriverByEmployee(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT driver.id,
            driver.code,
            driver.name,
            driver.phone,
            driver.employee_id,
            employee.full_name AS employee_name
       FROM logistics.driver_profiles driver
       JOIN shared.employees employee
         ON employee.installation_id = driver.installation_id
        AND employee.id = driver.employee_id
      WHERE driver.installation_id = $1
        AND driver.employee_id = $2
        AND driver.is_active = true
        AND employee.is_active = true`,
    [installationId, employeeId],
  );
  return result.rows[0] ?? null;
}

export async function listDriverTrips(client, {
  installationId,
  driverProfileId,
  warehouseIds,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT trip.id,
            trip.trip_number,
            trip.warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            trip.vehicle_id,
            vehicle.code AS vehicle_code,
            vehicle.license_plate,
            trip.primary_driver_id,
            driver.code AS driver_code,
            driver.name AS driver_name,
            trip.planned_start_at,
            trip.dispatched_at,
            trip.handover_receiver_name,
            trip.handover_note,
            trip.status,
            count(DISTINCT stop.id)::bigint AS stop_count,
            count(DISTINCT assignment.id) FILTER (WHERE assignment.unassigned_at IS NULL)::bigint AS assignment_count,
            count(DISTINCT attempt.id)::bigint AS attempt_count
       FROM logistics.delivery_trips trip
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = trip.installation_id
        AND warehouse.id = trip.warehouse_id
       JOIN logistics.driver_profiles driver
         ON driver.installation_id = trip.installation_id
        AND driver.id = trip.primary_driver_id
       LEFT JOIN logistics.vehicles vehicle
         ON vehicle.installation_id = trip.installation_id
        AND vehicle.id = trip.vehicle_id
       LEFT JOIN logistics.trip_stops stop
         ON stop.installation_id = trip.installation_id
        AND stop.trip_id = trip.id
       LEFT JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = trip.installation_id
        AND assignment.trip_id = trip.id
        AND assignment.unassigned_at IS NULL
       LEFT JOIN logistics.delivery_attempts attempt
         ON attempt.installation_id = assignment.installation_id
        AND attempt.assignment_id = assignment.id
      WHERE trip.installation_id = $1
        AND trip.primary_driver_id = $2
        AND trip.status = 'dispatched'
        AND trip.warehouse_id = ANY($3::uuid[])
        AND driver.is_active = true
      GROUP BY trip.id,
               warehouse.code,
               warehouse.name,
               vehicle.code,
               vehicle.license_plate,
               driver.code,
               driver.name
      ORDER BY trip.dispatched_at DESC, trip.id DESC
      LIMIT $4 OFFSET $5`,
    [installationId, driverProfileId, warehouseIds, limit, offset],
  );
  return result.rows;
}

export async function getDriverTrip(client, {
  installationId,
  tripId,
  driverProfileId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT trip.id,
            trip.trip_number,
            trip.warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            trip.vehicle_id,
            vehicle.code AS vehicle_code,
            vehicle.license_plate,
            vehicle.vehicle_type,
            trip.primary_driver_id,
            driver.code AS driver_code,
            driver.name AS driver_name,
            driver.phone AS driver_phone,
            trip.planned_start_at,
            trip.dispatched_at,
            trip.handover_receiver_name,
            trip.handover_note,
            trip.status,
            trip.note
       FROM logistics.delivery_trips trip
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = trip.installation_id
        AND warehouse.id = trip.warehouse_id
       JOIN logistics.driver_profiles driver
         ON driver.installation_id = trip.installation_id
        AND driver.id = trip.primary_driver_id
       LEFT JOIN logistics.vehicles vehicle
         ON vehicle.installation_id = trip.installation_id
        AND vehicle.id = trip.vehicle_id
      WHERE trip.installation_id = $1
        AND trip.id = $2
        AND trip.primary_driver_id = $3
        AND trip.status = 'dispatched'
        AND trip.warehouse_id = ANY($4::uuid[])
        AND driver.is_active = true`,
    [installationId, tripId, driverProfileId, warehouseIds],
  );
  return result.rows[0] ?? null;
}

export async function listDriverTripStops(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT stop.id,
            stop.stop_sequence,
            stop.customer_id,
            stop.customer_address_id,
            stop.address_snapshot,
            stop.planned_arrival_at,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'assignmentId', assignment.id,
                  'deliveryOrderId', delivery_order.id,
                  'deliveryOrderNumber', delivery_order.delivery_order_number,
                  'salesOrderId', delivery_order.sales_order_id,
                  'customerCode', delivery_order.customer_code_snapshot,
                  'customerName', delivery_order.customer_name_snapshot,
                  'requestedDeliveryDate', delivery_order.requested_delivery_date,
                  'collectionPolicy', delivery_order.collection_policy,
                  'assignedAt', assignment.assigned_at,
                  'dispatchItemId', dispatch_item.id,
                  'inventoryIssueId', dispatch_item.inventory_issue_id,
                  'attempt', CASE WHEN attempt.id IS NULL THEN NULL ELSE jsonb_build_object(
                    'id', attempt.id,
                    'result', attempt.result,
                    'attemptedAt', attempt.attempted_at,
                    'reasonCode', attempt.reason_code,
                    'note', attempt.note,
                    'rescheduledFor', attempt.rescheduled_for
                  ) END,
                  'lines', COALESCE((
                    SELECT jsonb_agg(
                      jsonb_build_object(
                        'deliveryOrderLineId', issue_line.delivery_order_line_id,
                        'inventoryIssueLineId', issue_line.id,
                        'sku', delivery_line.sku_snapshot,
                        'itemName', delivery_line.item_name_snapshot,
                        'unitCode', delivery_line.unit_code_snapshot,
                        'issuedBaseQuantity', issue_line.issued_base_quantity::text,
                        'deliveredBaseQuantity', attempt_line.delivered_base_quantity::text
                      ) ORDER BY delivery_line.line_number, issue_line.id
                    )
                      FROM sales.delivery_order_inventory_issue_lines issue_line
                      JOIN sales.delivery_order_lines delivery_line
                        ON delivery_line.installation_id = issue_line.installation_id
                       AND delivery_line.id = issue_line.delivery_order_line_id
                      LEFT JOIN logistics.delivery_attempt_lines attempt_line
                        ON attempt_line.installation_id = issue_line.installation_id
                       AND attempt_line.attempt_id = attempt.id
                       AND attempt_line.inventory_issue_line_id = issue_line.id
                     WHERE issue_line.installation_id = assignment.installation_id
                       AND issue_line.issue_id = dispatch_item.inventory_issue_id
                  ), '[]'::jsonb)
                ) ORDER BY assignment.assigned_at, assignment.id
              ) FILTER (
                WHERE assignment.id IS NOT NULL
                  AND assignment.unassigned_at IS NULL
              ),
              '[]'::jsonb
            ) AS assignments
       FROM logistics.trip_stops stop
       LEFT JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = stop.installation_id
        AND assignment.trip_stop_id = stop.id
        AND assignment.unassigned_at IS NULL
       LEFT JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = assignment.installation_id
        AND delivery_order.id = assignment.delivery_order_id
       LEFT JOIN logistics.trip_dispatch_items dispatch_item
         ON dispatch_item.installation_id = assignment.installation_id
        AND dispatch_item.assignment_id = assignment.id
       LEFT JOIN logistics.delivery_attempts attempt
         ON attempt.installation_id = assignment.installation_id
        AND attempt.assignment_id = assignment.id
      WHERE stop.installation_id = $1
        AND stop.trip_id = $2
      GROUP BY stop.id
      ORDER BY stop.stop_sequence, stop.id`,
    [installationId, tripId],
  );
  return result.rows;
}

export async function getAttemptLineageForDriver(client, {
  installationId,
  tripId,
  assignmentId,
  driverProfileId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT trip.id AS trip_id,
            trip.trip_number,
            trip.status AS trip_status,
            trip.warehouse_id,
            trip.primary_driver_id,
            assignment.id AS assignment_id,
            assignment.trip_stop_id,
            assignment.delivery_order_id,
            assignment.unassigned_at,
            delivery_order.delivery_order_number,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            dispatch_item.id AS dispatch_item_id,
            dispatch_item.inventory_issue_id,
            dispatch_item.inventory_movement_id,
            issue.status AS inventory_issue_status
       FROM logistics.delivery_trips trip
       JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = trip.installation_id
        AND assignment.trip_id = trip.id
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = assignment.installation_id
        AND delivery_order.id = assignment.delivery_order_id
       JOIN logistics.trip_dispatch_items dispatch_item
         ON dispatch_item.installation_id = assignment.installation_id
        AND dispatch_item.assignment_id = assignment.id
       JOIN sales.delivery_order_inventory_issues issue
         ON issue.installation_id = dispatch_item.installation_id
        AND issue.id = dispatch_item.inventory_issue_id
      WHERE trip.installation_id = $1
        AND trip.id = $2
        AND assignment.id = $3
        AND trip.primary_driver_id = $4
        AND trip.status = 'dispatched'
        AND trip.warehouse_id = ANY($5::uuid[])
        AND assignment.unassigned_at IS NULL
      FOR UPDATE OF trip, assignment, issue`,
    [installationId, tripId, assignmentId, driverProfileId, warehouseIds],
  );
  return result.rows[0] ?? null;
}

export async function listAttemptIssueLines(client, { installationId, inventoryIssueId }) {
  const result = await client.query(
    `SELECT issue_line.id AS inventory_issue_line_id,
            issue_line.delivery_order_line_id,
            issue_line.issued_base_quantity,
            delivery_line.line_number,
            delivery_line.sku_snapshot,
            delivery_line.item_name_snapshot,
            delivery_line.unit_code_snapshot
       FROM sales.delivery_order_inventory_issue_lines issue_line
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = issue_line.installation_id
        AND delivery_line.id = issue_line.delivery_order_line_id
      WHERE issue_line.installation_id = $1
        AND issue_line.issue_id = $2
      ORDER BY delivery_line.line_number, issue_line.id
      FOR UPDATE OF issue_line`,
    [installationId, inventoryIssueId],
  );
  return result.rows;
}

export async function getAttemptByAssignment(client, { installationId, assignmentId }) {
  const result = await client.query(
    `SELECT *
       FROM logistics.delivery_attempts
      WHERE installation_id = $1
        AND assignment_id = $2`,
    [installationId, assignmentId],
  );
  return result.rows[0] ?? null;
}

export async function getAttemptByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM logistics.delivery_attempts
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function listAttemptLines(client, { installationId, attemptId }) {
  const result = await client.query(
    `SELECT line.*,
            delivery_line.line_number,
            delivery_line.sku_snapshot,
            delivery_line.item_name_snapshot,
            delivery_line.unit_code_snapshot
       FROM logistics.delivery_attempt_lines line
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = line.installation_id
        AND delivery_line.id = line.delivery_order_line_id
      WHERE line.installation_id = $1
        AND line.attempt_id = $2
      ORDER BY delivery_line.line_number, line.inventory_issue_line_id`,
    [installationId, attemptId],
  );
  return result.rows;
}

export async function insertDeliveryAttempt(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.delivery_attempts (
       id, installation_id, trip_id, trip_stop_id, assignment_id,
       delivery_order_id, dispatch_item_id, inventory_issue_id,
       driver_profile_id, result, attempted_at, reason_code, note,
       rescheduled_for, idempotency_key, payload_hash,
       actor_id, request_id, source_app, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$17
     )
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.tripId,
      values.tripStopId,
      values.assignmentId,
      values.deliveryOrderId,
      values.dispatchItemId,
      values.inventoryIssueId,
      values.driverProfileId,
      values.result,
      values.attemptedAt,
      values.reasonCode,
      values.note,
      values.rescheduledFor,
      values.idempotencyKey,
      values.payloadHash,
      values.actorId,
      values.requestId,
      values.sourceApp,
    ],
  );
  return result.rows[0];
}

export async function insertDeliveryAttemptLine(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.delivery_attempt_lines (
       id, installation_id, attempt_id, delivery_order_line_id,
       inventory_issue_line_id, issued_base_quantity,
       delivered_base_quantity, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.attemptId,
      values.deliveryOrderLineId,
      values.inventoryIssueLineId,
      values.issuedBaseQuantity,
      values.deliveredBaseQuantity,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function insertDeliveryAttemptTripEvent(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_events (
       id, installation_id, trip_id, event_type, idempotency_key,
       payload_hash, actor_id, request_id, source_app, reason,
       metadata, occurred_at
     ) VALUES ($1,$2,$3,'DELIVERY_ATTEMPT_RECORDED',$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
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
      values.reason,
      JSON.stringify(values.metadata ?? {}),
      values.occurredAt,
    ],
  );
  return result.rows[0];
}

export async function listTripAttempts(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT attempt.*,
            delivery_order.delivery_order_number,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            stop.stop_sequence
       FROM logistics.delivery_attempts attempt
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = attempt.installation_id
        AND delivery_order.id = attempt.delivery_order_id
       JOIN logistics.trip_stops stop
         ON stop.installation_id = attempt.installation_id
        AND stop.id = attempt.trip_stop_id
      WHERE attempt.installation_id = $1
        AND attempt.trip_id = $2
      ORDER BY stop.stop_sequence, attempt.attempted_at, attempt.id`,
    [installationId, tripId],
  );
  return result.rows;
}
