export async function listRoutes(client, { installationId, active = null, limit = 200, offset = 0 }) {
  const result = await client.query(
    `SELECT route.*, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name
       FROM logistics.delivery_routes route
       LEFT JOIN shared.warehouses warehouse
         ON warehouse.installation_id = route.installation_id
        AND warehouse.id = route.default_warehouse_id
      WHERE route.installation_id = $1
        AND ($2::boolean IS NULL OR route.is_active = $2)
      ORDER BY route.is_active DESC, route.code, route.id
      LIMIT $3 OFFSET $4`,
    [installationId, active, limit, offset],
  );
  return result.rows;
}

export async function insertRoute(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.delivery_routes (
       id, installation_id, code, name, description, default_warehouse_id,
       is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$7)
     RETURNING *`,
    [values.id, values.installationId, values.code, values.name, values.description, values.defaultWarehouseId, values.actorId],
  );
  return result.rows[0];
}

export async function listVehicles(client, { installationId, active = null, limit = 200, offset = 0 }) {
  const result = await client.query(
    `SELECT *
       FROM logistics.vehicles
      WHERE installation_id = $1
        AND ($2::boolean IS NULL OR is_active = $2)
      ORDER BY is_active DESC, code, id
      LIMIT $3 OFFSET $4`,
    [installationId, active, limit, offset],
  );
  return result.rows;
}

export async function insertVehicle(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.vehicles (
       id, installation_id, code, license_plate, vehicle_type,
       capacity_weight, capacity_volume, operational_status,
       is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'AVAILABLE',true,$8,$8)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.code,
      values.licensePlate,
      values.vehicleType,
      values.capacityWeight,
      values.capacityVolume,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function listDrivers(client, { installationId, active = null, limit = 200, offset = 0 }) {
  const result = await client.query(
    `SELECT *
       FROM logistics.driver_profiles
      WHERE installation_id = $1
        AND ($2::boolean IS NULL OR is_active = $2)
      ORDER BY is_active DESC, code, id
      LIMIT $3 OFFSET $4`,
    [installationId, active, limit, offset],
  );
  return result.rows;
}

export async function insertDriver(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.driver_profiles (
       id, installation_id, code, employee_id, name, phone,
       license_reference, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$8)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.code,
      values.employeeId,
      values.name,
      values.phone,
      values.licenseReference,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function allocateTripNumber(client, { installationId, businessDate }) {
  const result = await client.query(
    `INSERT INTO logistics.trip_number_counters (installation_id, business_date, last_value)
     VALUES ($1,$2,1)
     ON CONFLICT (installation_id, business_date)
     DO UPDATE SET last_value = logistics.trip_number_counters.last_value + 1,
                   updated_at = now()
     RETURNING last_value`,
    [installationId, businessDate],
  );
  return Number(result.rows[0].last_value);
}

export async function findTripByCreateKey(client, { installationId, idempotencyKey, forUpdate = false }) {
  const result = await client.query(
    `SELECT * FROM logistics.delivery_trips
      WHERE installation_id = $1 AND create_idempotency_key = $2
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function insertTrip(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.delivery_trips (
       id, installation_id, trip_number, warehouse_id, delivery_route_id,
       vehicle_id, primary_driver_id, planned_start_at, status, note,
       revision, create_idempotency_key, create_payload_hash,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,1,$10,$11,$12,$12)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.tripNumber,
      values.warehouseId,
      values.deliveryRouteId,
      values.vehicleId,
      values.primaryDriverId,
      values.plannedStartAt,
      values.note,
      values.idempotencyKey,
      values.payloadHash,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function listTrips(client, { installationId, warehouseIds, status = null, limit = 200, offset = 0 }) {
  const result = await client.query(
    `SELECT trip.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            route.code AS route_code,
            route.name AS route_name,
            vehicle.code AS vehicle_code,
            vehicle.license_plate,
            driver.code AS driver_code,
            driver.name AS driver_name,
            count(DISTINCT stop.id)::bigint AS stop_count,
            count(DISTINCT assignment.id) FILTER (WHERE assignment.unassigned_at IS NULL)::bigint AS assignment_count
       FROM logistics.delivery_trips trip
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = trip.installation_id AND warehouse.id = trip.warehouse_id
       LEFT JOIN logistics.delivery_routes route
         ON route.installation_id = trip.installation_id AND route.id = trip.delivery_route_id
       LEFT JOIN logistics.vehicles vehicle
         ON vehicle.installation_id = trip.installation_id AND vehicle.id = trip.vehicle_id
       LEFT JOIN logistics.driver_profiles driver
         ON driver.installation_id = trip.installation_id AND driver.id = trip.primary_driver_id
       LEFT JOIN logistics.trip_stops stop
         ON stop.installation_id = trip.installation_id AND stop.trip_id = trip.id
       LEFT JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = trip.installation_id AND assignment.trip_id = trip.id
      WHERE trip.installation_id = $1
        AND trip.warehouse_id = ANY($2::uuid[])
        AND ($3::text IS NULL OR trip.status = $3)
      GROUP BY trip.id, warehouse.code, warehouse.name, route.code, route.name,
               vehicle.code, vehicle.license_plate, driver.code, driver.name
      ORDER BY trip.created_at DESC, trip.id DESC
      LIMIT $4 OFFSET $5`,
    [installationId, warehouseIds, status, limit, offset],
  );
  return result.rows;
}

export async function getTrip(client, { installationId, tripId, forUpdate = false }) {
  const result = await client.query(
    `SELECT trip.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            route.code AS route_code,
            route.name AS route_name,
            vehicle.code AS vehicle_code,
            vehicle.license_plate,
            driver.code AS driver_code,
            driver.name AS driver_name
       FROM logistics.delivery_trips trip
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = trip.installation_id AND warehouse.id = trip.warehouse_id
       LEFT JOIN logistics.delivery_routes route
         ON route.installation_id = trip.installation_id AND route.id = trip.delivery_route_id
       LEFT JOIN logistics.vehicles vehicle
         ON vehicle.installation_id = trip.installation_id AND vehicle.id = trip.vehicle_id
       LEFT JOIN logistics.driver_profiles driver
         ON driver.installation_id = trip.installation_id AND driver.id = trip.primary_driver_id
      WHERE trip.installation_id = $1 AND trip.id = $2
      ${forUpdate ? 'FOR UPDATE OF trip' : ''}`,
    [installationId, tripId],
  );
  return result.rows[0] ?? null;
}

export async function listTripStops(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT stop.*,
            COALESCE(jsonb_agg(
              jsonb_build_object(
                'assignmentId', assignment.id,
                'deliveryOrderId', delivery_order.id,
                'deliveryOrderNumber', delivery_order.delivery_order_number,
                'salesOrderId', delivery_order.sales_order_id,
                'customerCode', delivery_order.customer_code_snapshot,
                'customerName', delivery_order.customer_name_snapshot,
                'requestedDeliveryDate', delivery_order.requested_delivery_date,
                'collectionPolicy', delivery_order.collection_policy,
                'assignedAt', assignment.assigned_at
              ) ORDER BY assignment.assigned_at, assignment.id
            ) FILTER (WHERE assignment.id IS NOT NULL AND assignment.unassigned_at IS NULL), '[]'::jsonb) AS assignments
       FROM logistics.trip_stops stop
       LEFT JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = stop.installation_id
        AND assignment.trip_stop_id = stop.id
        AND assignment.unassigned_at IS NULL
       LEFT JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = assignment.installation_id
        AND delivery_order.id = assignment.delivery_order_id
      WHERE stop.installation_id = $1 AND stop.trip_id = $2
      GROUP BY stop.id
      ORDER BY stop.stop_sequence, stop.id`,
    [installationId, tripId],
  );
  return result.rows;
}

export async function listTripEvents(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT * FROM logistics.trip_events
      WHERE installation_id = $1 AND trip_id = $2
      ORDER BY occurred_at, id`,
    [installationId, tripId],
  );
  return result.rows;
}

export async function listEligibleDeliveryOrders(client, { installationId, warehouseIds, warehouseId = null, limit = 500, offset = 0 }) {
  const result = await client.query(
    `SELECT delivery_order.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            count(line.id)::bigint AS line_count,
            COALESCE(sum(line.delivery_base_quantity), 0)::numeric(30,12) AS total_base_quantity
       FROM sales.delivery_orders delivery_order
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = delivery_order.installation_id
        AND warehouse.id = delivery_order.warehouse_id
       JOIN sales.delivery_order_lines line
         ON line.installation_id = delivery_order.installation_id
        AND line.delivery_order_id = delivery_order.id
       LEFT JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = delivery_order.installation_id
        AND assignment.delivery_order_id = delivery_order.id
        AND assignment.unassigned_at IS NULL
      WHERE delivery_order.installation_id = $1
        AND delivery_order.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR delivery_order.warehouse_id = $3)
        AND delivery_order.handover_mode = 'DELIVERY'
        AND delivery_order.status = 'ready_to_dispatch'
        AND assignment.id IS NULL
      GROUP BY delivery_order.id, warehouse.code, warehouse.name
      ORDER BY delivery_order.requested_delivery_date NULLS LAST, delivery_order.created_at, delivery_order.id
      LIMIT $4 OFFSET $5`,
    [installationId, warehouseIds, warehouseId, limit, offset],
  );
  return result.rows;
}

export async function getDeliveryOrderForAssignment(client, { installationId, deliveryOrderId }) {
  const result = await client.query(
    `SELECT * FROM sales.delivery_orders
      WHERE installation_id = $1 AND id = $2
      FOR UPDATE`,
    [installationId, deliveryOrderId],
  );
  return result.rows[0] ?? null;
}

export async function findActiveAssignment(client, { installationId, deliveryOrderId, forUpdate = false }) {
  const result = await client.query(
    `SELECT assignment.*, trip.status AS trip_status, trip.warehouse_id
       FROM logistics.trip_order_assignments assignment
       JOIN logistics.delivery_trips trip
         ON trip.installation_id = assignment.installation_id AND trip.id = assignment.trip_id
      WHERE assignment.installation_id = $1
        AND assignment.delivery_order_id = $2
        AND assignment.unassigned_at IS NULL
      ${forUpdate ? 'FOR UPDATE OF assignment' : ''}`,
    [installationId, deliveryOrderId],
  );
  return result.rows[0] ?? null;
}

export async function findStop(client, { installationId, tripId, customerId, customerAddressId }) {
  const result = await client.query(
    `SELECT * FROM logistics.trip_stops
      WHERE installation_id = $1 AND trip_id = $2
        AND customer_id = $3 AND customer_address_id = $4
      FOR UPDATE`,
    [installationId, tripId, customerId, customerAddressId],
  );
  return result.rows[0] ?? null;
}

export async function nextStopSequence(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT COALESCE(max(stop_sequence), 0) + 1 AS next_sequence
       FROM logistics.trip_stops
      WHERE installation_id = $1 AND trip_id = $2`,
    [installationId, tripId],
  );
  return Number(result.rows[0].next_sequence);
}

export async function insertStop(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_stops (
       id, installation_id, trip_id, stop_sequence, customer_id,
       customer_address_id, address_snapshot, planned_arrival_at,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.tripId,
      values.stopSequence,
      values.customerId,
      values.customerAddressId,
      values.addressSnapshot,
      values.plannedArrivalAt,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function insertAssignment(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_order_assignments (
       id, installation_id, trip_id, trip_stop_id, delivery_order_id,
       assigned_by
     ) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [values.id, values.installationId, values.tripId, values.tripStopId, values.deliveryOrderId, values.actorId],
  );
  return result.rows[0];
}

export async function unassignDeliveryOrder(client, values) {
  const result = await client.query(
    `UPDATE logistics.trip_order_assignments
        SET unassigned_at = now(), unassigned_by = $4, unassignment_reason = $5
      WHERE installation_id = $1 AND trip_id = $2 AND delivery_order_id = $3
        AND unassigned_at IS NULL
      RETURNING *`,
    [values.installationId, values.tripId, values.deliveryOrderId, values.actorId, values.reason],
  );
  return result.rows[0] ?? null;
}

export async function deleteEmptyStop(client, { installationId, stopId }) {
  await client.query(
    `DELETE FROM logistics.trip_stops stop
      WHERE stop.installation_id = $1 AND stop.id = $2
        AND NOT EXISTS (
          SELECT 1 FROM logistics.trip_order_assignments assignment
           WHERE assignment.installation_id = stop.installation_id
             AND assignment.trip_stop_id = stop.id
             AND assignment.unassigned_at IS NULL
        )`,
    [installationId, stopId],
  );
}

export async function updateTripPlan(client, values) {
  const result = await client.query(
    `UPDATE logistics.delivery_trips
        SET delivery_route_id = $3,
            vehicle_id = $4,
            primary_driver_id = $5,
            planned_start_at = $6,
            note = $7,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $8
      WHERE installation_id = $1 AND id = $2 AND status = 'draft'
      RETURNING *`,
    [
      values.installationId,
      values.tripId,
      values.deliveryRouteId,
      values.vehicleId,
      values.primaryDriverId,
      values.plannedStartAt,
      values.note,
      values.actorId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function transitionTrip(client, values) {
  const result = await client.query(
    `UPDATE logistics.delivery_trips
        SET status = $3,
            planned_at = CASE WHEN $3 = 'planned' THEN now() ELSE planned_at END,
            planned_by = CASE WHEN $3 = 'planned' THEN $5 ELSE planned_by END,
            reopened_at = CASE WHEN $3 = 'draft' THEN now() ELSE reopened_at END,
            reopened_by = CASE WHEN $3 = 'draft' THEN $5 ELSE reopened_by END,
            reopen_reason = CASE WHEN $3 = 'draft' THEN $4 ELSE reopen_reason END,
            locked_at = CASE WHEN $3 = 'locked' THEN now() ELSE locked_at END,
            locked_by = CASE WHEN $3 = 'locked' THEN $5 ELSE locked_by END,
            revision = revision + 1,
            updated_at = now(),
            updated_by = $5
      WHERE installation_id = $1 AND id = $2 AND status = $6
      RETURNING *`,
    [values.installationId, values.tripId, values.nextStatus, values.reason, values.actorId, values.expectedStatus],
  );
  return result.rows[0] ?? null;
}

export async function reorderStops(client, { installationId, tripId, stopIds, actorId }) {
  await client.query(
    `UPDATE logistics.trip_stops
        SET stop_sequence = -stop_sequence,
            updated_at = now(), updated_by = $3
      WHERE installation_id = $1 AND trip_id = $2`,
    [installationId, tripId, actorId],
  );
  for (let index = 0; index < stopIds.length; index += 1) {
    await client.query(
      `UPDATE logistics.trip_stops
          SET stop_sequence = $4, updated_at = now(), updated_by = $5
        WHERE installation_id = $1 AND trip_id = $2 AND id = $3`,
      [installationId, tripId, stopIds[index], index + 1, actorId],
    );
  }
}

export async function insertTripEvent(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_events (
       id, installation_id, trip_id, event_type, idempotency_key,
       payload_hash, actor_id, request_id, source_app, reason, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
      values.metadata,
    ],
  );
  return result.rows[0];
}

export async function findOperationReplay(client, { installationId, idempotencyKey, forUpdate = false }) {
  const result = await client.query(
    `SELECT * FROM logistics.trip_operation_idempotency
      WHERE installation_id = $1 AND idempotency_key = $2
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function insertOperationReplay(client, values) {
  await client.query(
    `INSERT INTO logistics.trip_operation_idempotency (
       id, installation_id, operation_type, idempotency_key, payload_hash,
       trip_id, response_snapshot, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      values.id,
      values.installationId,
      values.operationType,
      values.idempotencyKey,
      values.payloadHash,
      values.tripId,
      values.responseSnapshot,
      values.actorId,
    ],
  );
}
