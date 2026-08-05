export async function setProofOfDeliveryWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.logistics_write_context', 'proof_of_delivery_service', true)",
  );
}

export async function lockProofOfDeliveryKey(client, {
  installationId,
  attemptId,
  idempotencyKey,
}) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`proof-of-delivery:${installationId}:${attemptId}:${idempotencyKey}`],
  );
}

export async function getAttemptForDriver(client, {
  installationId,
  tripId,
  assignmentId,
  attemptId,
  driverProfileId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT attempt.id AS delivery_attempt_id,
            attempt.trip_id,
            attempt.trip_stop_id,
            attempt.assignment_id,
            attempt.delivery_order_id,
            attempt.driver_profile_id,
            attempt.result,
            attempt.attempted_at,
            trip.trip_number,
            trip.status AS trip_status,
            trip.warehouse_id,
            assignment.unassigned_at
       FROM logistics.delivery_attempts attempt
       JOIN logistics.delivery_trips trip
         ON trip.installation_id = attempt.installation_id
        AND trip.id = attempt.trip_id
       JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = attempt.installation_id
        AND assignment.id = attempt.assignment_id
      WHERE attempt.installation_id = $1
        AND attempt.trip_id = $2
        AND attempt.assignment_id = $3
        AND attempt.id = $4
        AND attempt.driver_profile_id = $5
        AND trip.primary_driver_id = $5
        AND trip.warehouse_id = ANY($6::uuid[])
        AND trip.status IN ('dispatched', 'closed')
        AND assignment.unassigned_at IS NULL
      FOR UPDATE OF attempt, trip, assignment`,
    [installationId, tripId, assignmentId, attemptId, driverProfileId, warehouseIds],
  );
  return result.rows[0] ?? null;
}

export async function getAttemptForDispatcher(client, {
  installationId,
  tripId,
  attemptId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT attempt.id AS delivery_attempt_id,
            attempt.trip_id,
            attempt.trip_stop_id,
            attempt.assignment_id,
            attempt.delivery_order_id,
            attempt.driver_profile_id,
            attempt.result,
            attempt.attempted_at,
            trip.trip_number,
            trip.status AS trip_status,
            trip.warehouse_id,
            assignment.unassigned_at
       FROM logistics.delivery_attempts attempt
       JOIN logistics.delivery_trips trip
         ON trip.installation_id = attempt.installation_id
        AND trip.id = attempt.trip_id
       JOIN logistics.trip_order_assignments assignment
         ON assignment.installation_id = attempt.installation_id
        AND assignment.id = attempt.assignment_id
      WHERE attempt.installation_id = $1
        AND attempt.trip_id = $2
        AND attempt.id = $3
        AND trip.warehouse_id = ANY($4::uuid[])
        AND assignment.unassigned_at IS NULL`,
    [installationId, tripId, attemptId, warehouseIds],
  );
  return result.rows[0] ?? null;
}

export async function getProofByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM logistics.delivery_attempt_proofs
      WHERE installation_id = $1
        AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function listProofs(client, { installationId, attemptId }) {
  const result = await client.query(
    `SELECT *
       FROM logistics.delivery_attempt_proofs
      WHERE installation_id = $1
        AND delivery_attempt_id = $2
      ORDER BY captured_at, created_at, id`,
    [installationId, attemptId],
  );
  return result.rows;
}

export async function insertProof(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.delivery_attempt_proofs (
       id, installation_id, delivery_attempt_id, trip_id, trip_stop_id,
       assignment_id, delivery_order_id, driver_profile_id, pod_type,
       object_key, original_filename, content_type, byte_size, checksum_sha256,
       receiver_name, confirmation_reference, note, captured_at,
       idempotency_key, payload_hash, actor_id, request_id, source_app, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
       $19,$20,$21,$22,$23,$21
     )
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.deliveryAttemptId,
      values.tripId,
      values.tripStopId,
      values.assignmentId,
      values.deliveryOrderId,
      values.driverProfileId,
      values.podType,
      values.objectKey,
      values.originalFilename,
      values.contentType,
      values.byteSize,
      values.checksumSha256,
      values.receiverName,
      values.confirmationReference,
      values.note,
      values.capturedAt,
      values.idempotencyKey,
      values.payloadHash,
      values.actorId,
      values.requestId,
      values.sourceApp,
    ],
  );
  return result.rows[0];
}

export async function insertProofTripEvent(client, values) {
  const result = await client.query(
    `INSERT INTO logistics.trip_events (
       id, installation_id, trip_id, event_type, idempotency_key,
       payload_hash, actor_id, request_id, source_app, reason,
       metadata, occurred_at
     ) VALUES ($1,$2,$3,'POD_ATTACHED',$4,$5,$6,$7,$8,NULL,$9::jsonb,$10)
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
      JSON.stringify(values.metadata ?? {}),
      values.occurredAt,
    ],
  );
  return result.rows[0];
}
