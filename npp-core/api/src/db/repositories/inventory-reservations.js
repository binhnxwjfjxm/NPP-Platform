// Repository for inventory reservations and events (P4.3).
// All operations are fail-closed and require exact permission context.

export async function lockIdempotencyKey(client, { installationId, idempotencyKey }) {
  // Advisory lock on idempotency key to prevent concurrent duplicate creates
  const lockId = Buffer.from(`${installationId}:${idempotencyKey}`).toString('hex').slice(0, 16);
  const lockValue = BigInt(`0x${lockId}`) % 4294967296n; // pg_advisory_lock accepts 32-bit integer
  await client.query('SELECT pg_advisory_lock($1)', [lockValue]);
}

export async function getReservationByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM inventory.inventory_reservations
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function getReservationById(client, { installationId, id, forUpdate = false }) {
  const query = forUpdate
    ? `SELECT * FROM inventory.inventory_reservations
        WHERE installation_id = $1 AND id = $2 FOR UPDATE`
    : `SELECT * FROM inventory.inventory_reservations
        WHERE installation_id = $1 AND id = $2`;
  const result = await client.query(query, [installationId, id]);
  return result.rows[0] ?? null;
}

export async function resolveReservationBalance(client, {
  installationId,
  warehouseId,
  locationId,
  baseVariantId,
  lotId,
}) {
  const result = await client.query(
    `SELECT
       installation_id,
       warehouse_id,
       location_id,
       base_variant_id,
       lot_id,
       on_hand_quantity,
       reserved_quantity,
       available_quantity
      FROM inventory.inventory_balances
     WHERE installation_id = $1
       AND warehouse_id = $2
       AND location_id IS NOT DISTINCT FROM $3
       AND base_variant_id = $4
       AND lot_id IS NOT DISTINCT FROM $5`,
    [installationId, warehouseId, locationId, baseVariantId, lotId],
  );
  return result.rows[0] ?? null;
}

export async function resolveWarehouseLocation(client, { installationId, warehouseId, locationId }) {
  const query = locationId
    ? `SELECT
         w.id as warehouse_id,
         w.is_active as warehouse_active,
         l.id as location_id,
         l.is_active as location_active
        FROM shared.warehouses w
        LEFT JOIN shared.warehouse_locations l
          ON l.installation_id = w.installation_id
         AND l.warehouse_id = w.id
         AND l.id = $3
       WHERE w.installation_id = $1 AND w.id = $2`
    : `SELECT
         w.id as warehouse_id,
         w.is_active as warehouse_active,
         NULL::uuid as location_id,
         NULL as location_active
        FROM shared.warehouses w
       WHERE w.installation_id = $1 AND w.id = $2`;
  const result = await client.query(query, [installationId, warehouseId, locationId].filter((v) => v !== undefined));
  return result.rows[0] ?? null;
}

export async function resolveVariant(client, { installationId, baseVariantId }) {
  const result = await client.query(
    `SELECT
       id,
       installation_id,
       sku,
       is_active
      FROM shared.product_variants
     WHERE installation_id = $1 AND id = $2`,
    [installationId, baseVariantId],
  );
  return result.rows[0] ?? null;
}

export async function insertReservation(client, reservation) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_reservations (
      id,
      installation_id,
      warehouse_id,
      location_id,
      base_variant_id,
      lot_id,
      quantity,
      state,
      source_domain,
      source_document_type,
      source_document_id,
      activated_at,
      transitioned_at,
      idempotency_key,
      payload_hash,
      metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *`,
    [
      reservation.id,
      reservation.installationId,
      reservation.warehouseId,
      reservation.locationId ?? null,
      reservation.baseVariantId,
      reservation.lotId ?? null,
      reservation.quantity,
      reservation.state,
      reservation.sourceDomain,
      reservation.sourceDocumentType ?? null,
      reservation.sourceDocumentId ?? null,
      reservation.activatedAt,
      reservation.transitionedAt,
      reservation.idempotencyKey,
      reservation.payloadHash,
      reservation.metadata,
    ],
  );
  return result.rows[0];
}

export async function insertReservationEvent(client, event) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_reservation_events (
      id,
      installation_id,
      reservation_id,
      transition,
      actor_id,
      request_id,
      source_app,
      payload_hash,
      occurred_at,
      metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *`,
    [
      event.id,
      event.installationId,
      event.reservationId,
      event.transition,
      event.actorId,
      event.requestId,
      event.sourceApp,
      event.payloadHash,
      event.occurredAt,
      event.metadata,
    ],
  );
  return result.rows[0];
}

export async function updateReservationState(client, { installationId, id, state, transitionedAt }) {
  const result = await client.query(
    `UPDATE inventory.inventory_reservations
      SET state = $3, transitioned_at = $4
     WHERE installation_id = $1 AND id = $2
     RETURNING *`,
    [installationId, id, state, transitionedAt],
  );
  return result.rows[0] ?? null;
}

export async function listReservationEvents(client, { installationId, reservationId }) {
  const result = await client.query(
    `SELECT *
      FROM inventory.inventory_reservation_events
     WHERE installation_id = $1 AND reservation_id = $2
     ORDER BY occurred_at ASC, id ASC`,
    [installationId, reservationId],
  );
  return result.rows;
}

export async function countActiveReservationsForBalance(client, {
  installationId,
  warehouseId,
  locationId,
  baseVariantId,
  lotId,
}) {
  const result = await client.query(
    `SELECT SUM(quantity)::text as total_reserved
      FROM inventory.inventory_reservations
     WHERE installation_id = $1
       AND warehouse_id = $2
       AND location_id IS NOT DISTINCT FROM $3
       AND base_variant_id = $4
       AND lot_id IS NOT DISTINCT FROM $5
       AND state = 'ACTIVE'`,
    [installationId, warehouseId, locationId, baseVariantId, lotId],
  );
  const row = result.rows[0];
  return row?.total_reserved ? BigInt(row.total_reserved) : 0n;
}
