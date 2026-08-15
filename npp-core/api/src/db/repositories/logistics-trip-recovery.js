import { randomUUID } from 'node:crypto';

export async function setTripRecoveryWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.logistics_write_context', 'trip_recovery_service', true)",
  );
}

export async function lockRecoveryKey(client, { installationId, tripId, idempotencyKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`logistics-trip-recovery:${installationId}:${tripId}:${idempotencyKey}`],
  );
}

export async function getTripForUpdate(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT trip.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM logistics.delivery_trips trip
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = trip.installation_id
        AND warehouse.id = trip.warehouse_id
      WHERE trip.installation_id = $1
        AND trip.id = $2
      FOR UPDATE OF trip`,
    [installationId, tripId],
  );
  return result.rows[0] ?? null;
}

export async function getTripEventByKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM logistics.trip_events
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function hasDeliveryAttempts(client, { installationId, tripId }) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM logistics.delivery_attempts
        WHERE installation_id = $1 AND trip_id = $2
     ) AS present`,
    [installationId, tripId],
  );
  return Boolean(result.rows[0]?.present);
}

export async function markTripRecovered(client, {
  installationId,
  tripId,
  reason,
  idempotencyKey,
  payloadHash,
  actorId,
  occurredAt,
}) {
  const result = await client.query(
    `UPDATE logistics.delivery_trips
        SET status = 'recovered',
            recovery_reason = $3,
            recovery_idempotency_key = $4,
            recovery_payload_hash = $5,
            recovered_at = $6,
            recovered_by = $7,
            revision = revision + 1,
            updated_at = $6,
            updated_by = $7
      WHERE installation_id = $1
        AND id = $2
        AND status = 'dispatched'
      RETURNING *`,
    [installationId, tripId, reason, idempotencyKey, payloadHash, occurredAt, actorId],
  );
  return result.rows[0] ?? null;
}

export async function getAssignmentForRecovery(client, { installationId, tripId, assignmentId }) {
  const result = await client.query(
    `SELECT assignment.*,
            trip.status AS trip_status,
            trip.warehouse_id,
            dispatch_item.delivery_order_id,
            dispatch_item.inventory_issue_id,
            issue.status AS inventory_issue_status
       FROM logistics.trip_order_assignments assignment
       JOIN logistics.delivery_trips trip
         ON trip.installation_id = assignment.installation_id
        AND trip.id = assignment.trip_id
       JOIN logistics.trip_dispatch_items dispatch_item
         ON dispatch_item.installation_id = assignment.installation_id
        AND dispatch_item.assignment_id = assignment.id
       JOIN sales.delivery_order_inventory_issues issue
         ON issue.installation_id = dispatch_item.installation_id
        AND issue.id = dispatch_item.inventory_issue_id
      WHERE assignment.installation_id = $1
        AND assignment.trip_id = $2
        AND assignment.id = $3
      FOR UPDATE OF assignment, trip, issue`,
    [installationId, tripId, assignmentId],
  );
  return result.rows[0] ?? null;
}

export async function recoveryUnassign(client, {
  installationId,
  tripId,
  assignmentId,
  reason,
  actorId,
  occurredAt,
}) {
  const result = await client.query(
    `UPDATE logistics.trip_order_assignments
        SET unassigned_at = $4,
            unassigned_by = $5,
            unassignment_reason = $6
      WHERE installation_id = $1
        AND trip_id = $2
        AND id = $3
        AND unassigned_at IS NULL
      RETURNING *`,
    [installationId, tripId, assignmentId, occurredAt, actorId, reason],
  );
  return result.rows[0] ?? null;
}

export async function insertRecoveryEvent(client, data) {
  const result = await client.query(
    `INSERT INTO logistics.trip_events (
       id, installation_id, trip_id, event_type, idempotency_key,
       payload_hash, actor_id, request_id, source_app, reason, metadata, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     RETURNING *`,
    [
      randomUUID(),
      data.installationId,
      data.tripId,
      data.eventType,
      data.idempotencyKey,
      data.payloadHash,
      data.actorId,
      data.requestId,
      data.sourceApp,
      data.reason,
      JSON.stringify(data.metadata ?? {}),
      data.occurredAt,
    ],
  );
  return result.rows[0] ?? null;
}
