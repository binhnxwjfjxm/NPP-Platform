async function withWriteContext(client, setting, value, operation) {
  const previousResult = await client.query('SELECT current_setting($1, true) AS value', [setting]);
  const previous = previousResult.rows?.[0]?.value ?? '';
  await client.query('SELECT set_config($1, $2, true)', [setting, value]);
  try {
    return await operation();
  } finally {
    await client.query('SELECT set_config($1, $2, true)', [setting, previous]);
  }
}

export async function lockReservationCommand(client, { installationId, key }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`inventory-reservation-command:${installationId}:${key}`],
  );
}

export async function lockReservationSource(client, { installationId, sourceKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`inventory-reservation-source:${installationId}:${sourceKey}`],
  );
}

export async function getReservationEventByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_reservation_events
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows?.[0] ?? null;
}

export async function getReservationBySourceKey(client, { installationId, sourceKey }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_reservations
      WHERE installation_id = $1 AND source_key = $2`,
    [installationId, sourceKey],
  );
  return result.rows?.[0] ?? null;
}

export async function getReservationById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_reservations
      WHERE installation_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function lockBalanceScope(client, {
  installationId,
  warehouseId,
  locationId = null,
  baseVariantId,
  lotId = null,
}) {
  const result = await client.query(
    `SELECT installation_id, warehouse_id, location_id, base_variant_id, lot_id,
            on_hand_quantity, reserved_quantity, available_quantity
       FROM inventory.inventory_balances
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND location_id IS NOT DISTINCT FROM $3::uuid
        AND base_variant_id = $4
        AND lot_id IS NOT DISTINCT FROM $5::uuid
      FOR UPDATE`,
    [installationId, warehouseId, locationId, baseVariantId, lotId],
  );
  return result.rows?.[0] ?? null;
}

export async function changeReservedQuantity(client, {
  installationId,
  warehouseId,
  locationId = null,
  baseVariantId,
  lotId = null,
  delta,
}) {
  return withWriteContext(client, 'npp.inventory_balance_write_context', 'reservation', async () => {
    const result = await client.query(
      `UPDATE inventory.inventory_balances
          SET reserved_quantity = reserved_quantity + $6::numeric,
              updated_at = now()
        WHERE installation_id = $1
          AND warehouse_id = $2
          AND location_id IS NOT DISTINCT FROM $3::uuid
          AND base_variant_id = $4
          AND lot_id IS NOT DISTINCT FROM $5::uuid
          AND reserved_quantity + $6::numeric >= 0
          AND on_hand_quantity - (reserved_quantity + $6::numeric) >= 0
        RETURNING installation_id, warehouse_id, location_id, base_variant_id, lot_id,
                  on_hand_quantity, reserved_quantity, available_quantity, updated_at`,
      [installationId, warehouseId, locationId, baseVariantId, lotId, delta],
    );
    return result.rows?.[0] ?? null;
  });
}

export async function insertReservation(client, reservation) {
  return withWriteContext(client, 'npp.inventory_reservation_write_context', 'reservation', async () => {
    const result = await client.query(
      `INSERT INTO inventory.inventory_reservations (
         id, installation_id, source_key, source_domain, source_document_type,
         source_document_id, source_line_reference, warehouse_id, location_id,
         source_variant_id, source_sku, source_unit_id, source_unit_code,
         source_quantity, conversion_to_base, base_variant_id, base_sku, lot_id,
         base_quantity, held_quantity, state, expires_at, create_payload_hash,
         metadata, created_at, created_by, updated_at, updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19,$19,'ACTIVE',$20,$21,$22,$23,$24,$23,$24
       ) RETURNING *`,
      [
        reservation.id,
        reservation.installationId,
        reservation.sourceKey,
        reservation.sourceDomain,
        reservation.sourceDocumentType,
        reservation.sourceDocumentId,
        reservation.sourceLineReference,
        reservation.warehouseId,
        reservation.locationId,
        reservation.sourceVariantId,
        reservation.sourceSku,
        reservation.sourceUnitId,
        reservation.sourceUnitCode,
        reservation.sourceQuantity,
        reservation.conversionToBase,
        reservation.baseVariantId,
        reservation.baseSku,
        reservation.lotId,
        reservation.baseQuantity,
        reservation.expiresAt,
        reservation.createPayloadHash,
        reservation.metadata,
        reservation.occurredAt,
        reservation.actorId,
      ],
    );
    return result.rows?.[0] ?? null;
  });
}

export async function transitionReservation(client, {
  installationId,
  reservationId,
  toState,
  occurredAt,
  actorId,
}) {
  return withWriteContext(client, 'npp.inventory_reservation_write_context', 'reservation', async () => {
    const result = await client.query(
      `UPDATE inventory.inventory_reservations
          SET state = $3,
              held_quantity = 0,
              terminal_at = $4,
              terminal_by = $5,
              updated_at = $4,
              updated_by = $5,
              version = version + 1
        WHERE installation_id = $1 AND id = $2 AND state = 'ACTIVE'
        RETURNING *`,
      [installationId, reservationId, toState, occurredAt, actorId],
    );
    return result.rows?.[0] ?? null;
  });
}

export async function insertReservationEvent(client, event) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_reservation_events (
       id, installation_id, reservation_id, event_type, from_state, to_state,
       base_quantity, idempotency_key, payload_hash, reason_code, reason_note,
       result_snapshot, metadata, occurred_at, occurred_by, request_id, source_app
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      event.id,
      event.installationId,
      event.reservationId,
      event.eventType,
      event.fromState,
      event.toState,
      event.baseQuantity,
      event.idempotencyKey,
      event.payloadHash,
      event.reasonCode,
      event.reasonNote,
      event.resultSnapshot,
      event.metadata,
      event.occurredAt,
      event.occurredBy,
      event.requestId,
      event.sourceApp,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function reconcileReservationHolds(client, { installationId }) {
  const result = await client.query(
    `WITH active AS (
       SELECT installation_id, warehouse_id, location_id, base_variant_id, lot_id,
              sum(held_quantity)::numeric(30,12) AS active_held_quantity,
              count(*)::bigint AS active_reservation_count
         FROM inventory.inventory_reservations
        WHERE installation_id = $1 AND state = 'ACTIVE'
        GROUP BY installation_id, warehouse_id, location_id, base_variant_id, lot_id
     ), projected AS (
       SELECT installation_id, warehouse_id, location_id, base_variant_id, lot_id,
              reserved_quantity
         FROM inventory.inventory_balances
        WHERE installation_id = $1
     )
     SELECT COALESCE(active.installation_id, projected.installation_id) AS installation_id,
            COALESCE(active.warehouse_id, projected.warehouse_id) AS warehouse_id,
            COALESCE(active.location_id, projected.location_id) AS location_id,
            COALESCE(active.base_variant_id, projected.base_variant_id) AS base_variant_id,
            COALESCE(active.lot_id, projected.lot_id) AS lot_id,
            COALESCE(active.active_held_quantity, 0::numeric)::numeric(30,12) AS active_held_quantity,
            COALESCE(projected.reserved_quantity, 0::numeric)::numeric(30,12) AS projected_reserved_quantity,
            (COALESCE(active.active_held_quantity, 0::numeric)
              - COALESCE(projected.reserved_quantity, 0::numeric))::numeric(30,12) AS difference,
            COALESCE(active.active_reservation_count, 0)::bigint AS active_reservation_count
       FROM active
       FULL OUTER JOIN projected
         ON active.installation_id = projected.installation_id
        AND active.warehouse_id = projected.warehouse_id
        AND active.location_id IS NOT DISTINCT FROM projected.location_id
        AND active.base_variant_id = projected.base_variant_id
        AND active.lot_id IS NOT DISTINCT FROM projected.lot_id
      ORDER BY warehouse_id, location_id NULLS FIRST, base_variant_id, lot_id NULLS FIRST`,
    [installationId],
  );
  return result.rows ?? [];
}
