export async function setCodWriteContext(client) {
  await client.query("SELECT set_config('npp.cod_write_context', 'cod_service', true)");
}

export async function lockCodKey(client, key) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

export async function getActiveDriverByEmployee(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT driver.id, driver.code, driver.name, driver.employee_id
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

export async function getDriverTrip(client, {
  installationId,
  tripId,
  driverProfileId,
  warehouseIds,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT trip.id,
            trip.trip_number,
            trip.warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            trip.primary_driver_id,
            driver.code AS driver_code,
            driver.name AS driver_name,
            trip.status,
            trip.dispatched_at
       FROM logistics.delivery_trips trip
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = trip.installation_id
        AND warehouse.id = trip.warehouse_id
       JOIN logistics.driver_profiles driver
         ON driver.installation_id = trip.installation_id
        AND driver.id = trip.primary_driver_id
      WHERE trip.installation_id = $1
        AND trip.id = $2
        AND trip.primary_driver_id = $3
        AND trip.status IN ('dispatched', 'closed')
        AND trip.warehouse_id = ANY($4::uuid[])
        ${forUpdate ? 'FOR UPDATE OF trip' : ''}`,
    [installationId, tripId, driverProfileId, warehouseIds],
  );
  return result.rows[0] ?? null;
}

export async function listDriverCustodyTripIds(client, {
  installationId,
  driverProfileId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT collection.trip_id,
            max(collection.collected_at) AS latest_collected_at
       FROM accounting.cod_collections collection
       JOIN accounting.cod_collection_custody custody
         ON custody.installation_id = collection.installation_id
        AND custody.collection_id = collection.id
       JOIN logistics.delivery_trips trip
         ON trip.installation_id = collection.installation_id
        AND trip.id = collection.trip_id
       LEFT JOIN accounting.cod_collection_reversals reversal
         ON reversal.installation_id = collection.installation_id
        AND reversal.collection_id = collection.id
      WHERE collection.installation_id = $1
        AND collection.driver_profile_id = $2
        AND collection.warehouse_id = ANY($3::uuid[])
        AND trip.primary_driver_id = $2
        AND trip.status IN ('dispatched', 'closed')
        AND collection.collection_method = 'CASH'
        AND reversal.id IS NULL
        AND custody.custody_remaining_amount > 0
      GROUP BY collection.trip_id
      ORDER BY max(collection.collected_at) DESC, collection.trip_id DESC`,
    [installationId, driverProfileId, warehouseIds],
  );
  return result.rows;
}

export async function getCollectionLineageForDriver(client, {
  installationId,
  tripId,
  assignmentId,
  driverProfileId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT trip.id AS trip_id,
            trip.trip_number,
            trip.warehouse_id,
            trip.primary_driver_id,
            assignment.id AS assignment_id,
            assignment.trip_stop_id,
            delivery_order.id AS delivery_order_id,
            delivery_order.delivery_order_number,
            delivery_order.customer_id,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            delivery_order.collection_policy,
            attempt.id AS delivery_attempt_id,
            attempt.result AS delivery_attempt_result,
            attempt.attempted_at,
            receivable.id AS receivable_document_id,
            receivable.source_document_number AS receivable_document_number,
            receivable.currency_code,
            receivable.remaining_amount,
            receivable.status AS receivable_status
       FROM logistics.delivery_trips trip
       JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = trip.installation_id
        AND assignment.trip_id = trip.id
        AND assignment.unassigned_at IS NULL
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = assignment.installation_id
        AND delivery_order.id = assignment.delivery_order_id
       JOIN logistics.delivery_attempts attempt
         ON attempt.installation_id = assignment.installation_id
        AND attempt.assignment_id = assignment.id
       JOIN accounting.receivable_documents receivable
         ON receivable.installation_id = attempt.installation_id
        AND receivable.source_document_type = 'DELIVERY_ATTEMPT'
        AND receivable.source_document_id = attempt.id
      WHERE trip.installation_id = $1
        AND trip.id = $2
        AND assignment.id = $3
        AND trip.primary_driver_id = $4
        AND trip.status = 'dispatched'
        AND trip.warehouse_id = ANY($5::uuid[])
      FOR UPDATE OF trip, assignment, attempt, receivable`,
    [installationId, tripId, assignmentId, driverProfileId, warehouseIds],
  );
  return result.rows[0] ?? null;
}

export async function getCollectionByAssignment(client, { installationId, assignmentId }) {
  const result = await client.query(
    `SELECT collection.*,
            reversal.id AS reversal_id,
            reversal.reason AS reversal_reason,
            reversal.reversed_at,
            custody.handed_over_amount,
            custody.custody_remaining_amount,
            payment.source_document_number AS payment_document_number
       FROM accounting.cod_collections collection
       LEFT JOIN accounting.cod_collection_reversals reversal
         ON reversal.installation_id = collection.installation_id
        AND reversal.collection_id = collection.id
       LEFT JOIN accounting.cod_collection_custody custody
         ON custody.installation_id = collection.installation_id
        AND custody.collection_id = collection.id
       LEFT JOIN accounting.receivable_documents payment
         ON payment.installation_id = collection.installation_id
        AND payment.id = collection.payment_document_id
      WHERE collection.installation_id = $1
        AND collection.assignment_id = $2`,
    [installationId, assignmentId],
  );
  return result.rows[0] ?? null;
}

export async function getCollectionByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM accounting.cod_collections
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function insertCollection(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.cod_collections (
       id, installation_id, warehouse_id, trip_id, trip_stop_id, assignment_id,
       delivery_attempt_id, delivery_order_id, customer_id,
       source_receivable_document_id, payment_document_id,
       collection_method, collection_status, currency_code,
       expected_amount, received_amount, external_reference, reason_code,
       promised_by, due_at, note, collected_at, driver_profile_id,
       idempotency_key, payload_hash, actor_id, request_id, source_app, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$27
     ) RETURNING *`,
    [
      values.id,
      values.installationId,
      values.warehouseId,
      values.tripId,
      values.tripStopId,
      values.assignmentId,
      values.deliveryAttemptId,
      values.deliveryOrderId,
      values.customerId,
      values.sourceReceivableDocumentId,
      values.paymentDocumentId,
      values.collectionMethod,
      values.collectionStatus,
      values.currencyCode,
      values.expectedAmount,
      values.receivedAmount,
      values.externalReference,
      values.reasonCode,
      values.promisedBy,
      values.dueAt,
      values.note,
      values.collectedAt,
      values.driverProfileId,
      values.idempotencyKey,
      values.payloadHash,
      values.actorId,
      values.requestId,
      values.sourceApp,
    ],
  );
  return result.rows[0];
}

export async function listDriverCodAssignments(client, {
  installationId,
  tripId,
  driverProfileId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT assignment.id AS assignment_id,
            assignment.trip_stop_id,
            stop.stop_sequence,
            delivery_order.id AS delivery_order_id,
            delivery_order.delivery_order_number,
            delivery_order.customer_id,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            delivery_order.collection_policy,
            attempt.id AS delivery_attempt_id,
            attempt.result AS delivery_attempt_result,
            receivable.id AS receivable_document_id,
            receivable.source_document_number AS receivable_document_number,
            receivable.currency_code,
            receivable.remaining_amount AS current_receivable_remaining_amount,
            collection.id AS collection_id,
            collection.collection_method,
            collection.collection_status,
            collection.expected_amount,
            collection.received_amount,
            collection.external_reference,
            collection.reason_code,
            collection.promised_by,
            collection.due_at,
            collection.note,
            collection.collected_at,
            collection.payment_document_id,
            payment.source_document_number AS payment_document_number,
            collection_reversal.id AS collection_reversal_id,
            collection_reversal.reason AS collection_reversal_reason,
            collection_reversal.reversed_at AS collection_reversed_at,
            custody.handed_over_amount,
            custody.custody_remaining_amount
       FROM logistics.delivery_trips trip
       JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = trip.installation_id
        AND assignment.trip_id = trip.id
        AND assignment.unassigned_at IS NULL
       JOIN logistics.trip_stops stop
         ON stop.installation_id = assignment.installation_id
        AND stop.id = assignment.trip_stop_id
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = assignment.installation_id
        AND delivery_order.id = assignment.delivery_order_id
       LEFT JOIN logistics.delivery_attempts attempt
         ON attempt.installation_id = assignment.installation_id
        AND attempt.assignment_id = assignment.id
       LEFT JOIN accounting.receivable_documents receivable
         ON receivable.installation_id = attempt.installation_id
        AND receivable.source_document_type = 'DELIVERY_ATTEMPT'
        AND receivable.source_document_id = attempt.id
       LEFT JOIN accounting.cod_collections collection
         ON collection.installation_id = assignment.installation_id
        AND collection.assignment_id = assignment.id
       LEFT JOIN accounting.cod_collection_reversals collection_reversal
         ON collection_reversal.installation_id = collection.installation_id
        AND collection_reversal.collection_id = collection.id
       LEFT JOIN accounting.cod_collection_custody custody
         ON custody.installation_id = collection.installation_id
        AND custody.collection_id = collection.id
       LEFT JOIN accounting.receivable_documents payment
         ON payment.installation_id = collection.installation_id
        AND payment.id = collection.payment_document_id
      WHERE trip.installation_id = $1
        AND trip.id = $2
        AND trip.primary_driver_id = $3
        AND trip.status IN ('dispatched', 'closed')
        AND trip.warehouse_id = ANY($4::uuid[])
      ORDER BY stop.stop_sequence, assignment.assigned_at, assignment.id`,
    [installationId, tripId, driverProfileId, warehouseIds],
  );
  return result.rows;
}

export async function listDriverHandovers(client, {
  installationId,
  tripId,
  driverProfileId,
}) {
  const result = await client.query(
    `SELECT projection.*,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', line.id,
                'collectionId', line.collection_id,
                'expectedAmount', line.expected_amount::text,
                'handedOverAmount', line.handed_over_amount::text,
                'customerCode', delivery_order.customer_code_snapshot,
                'customerName', delivery_order.customer_name_snapshot,
                'deliveryOrderNumber', delivery_order.delivery_order_number
              ) ORDER BY delivery_order.delivery_order_number, line.id)
                FROM accounting.cod_cash_handover_lines line
                JOIN accounting.cod_collections collection
                  ON collection.installation_id = line.installation_id
                 AND collection.id = line.collection_id
                JOIN sales.delivery_orders delivery_order
                  ON delivery_order.installation_id = collection.installation_id
                 AND delivery_order.id = collection.delivery_order_id
               WHERE line.installation_id = projection.installation_id
                 AND line.handover_id = projection.id
            ), '[]'::jsonb) AS lines
       FROM accounting.cod_handover_projection projection
      WHERE projection.installation_id = $1
        AND projection.trip_id = $2
        AND projection.driver_profile_id = $3
      ORDER BY projection.handed_over_at DESC, projection.id DESC`,
    [installationId, tripId, driverProfileId],
  );
  return result.rows;
}

export async function getCashCollectionsForHandover(client, {
  installationId,
  tripId,
  driverProfileId,
  collectionIds,
}) {
  const result = await client.query(
    `SELECT collection.*,
            custody.handed_over_amount,
            custody.custody_remaining_amount,
            reversal.id AS reversal_id
       FROM accounting.cod_collections collection
       JOIN accounting.cod_collection_custody custody
         ON custody.installation_id = collection.installation_id
        AND custody.collection_id = collection.id
       LEFT JOIN accounting.cod_collection_reversals reversal
         ON reversal.installation_id = collection.installation_id
        AND reversal.collection_id = collection.id
      WHERE collection.installation_id = $1
        AND collection.trip_id = $2
        AND collection.driver_profile_id = $3
        AND collection.collection_method = 'CASH'
        AND collection.id = ANY($4::uuid[])
      ORDER BY collection.id
      FOR UPDATE OF collection`,
    [installationId, tripId, driverProfileId, collectionIds],
  );
  return result.rows;
}
