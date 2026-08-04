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
            count(DISTINCT assignment.id) FILTER (WHERE assignment.unassigned_at IS NULL)::bigint AS assignment_count
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
                  'assignedAt', assignment.assigned_at
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
      WHERE stop.installation_id = $1
        AND stop.trip_id = $2
      GROUP BY stop.id
      ORDER BY stop.stop_sequence, stop.id`,
    [installationId, tripId],
  );
  return result.rows;
}
