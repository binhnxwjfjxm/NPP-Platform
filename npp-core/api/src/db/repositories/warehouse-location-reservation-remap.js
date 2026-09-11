export async function loadActiveReservations(client, {
  installationId,
  warehouseId,
  lock = false,
}) {
  const reservationResult = await client.query(
    `SELECT *
       FROM inventory.inventory_reservations
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND state = 'ACTIVE'
      ORDER BY base_variant_id, lot_id NULLS FIRST, location_id NULLS FIRST, id
      ${lock ? 'FOR UPDATE' : ''}`,
    [installationId, warehouseId],
  );
  const reservations = reservationResult.rows ?? [];
  if (reservations.length === 0) return [];

  const ids = reservations.map((row) => row.id);
  const allocationResult = await client.query(
    `SELECT allocation.*,
            demand.issued_base_quantity,
            COALESCE(claim.claimed_base_quantity, 0)::numeric(30,12) AS claimed_base_quantity
       FROM sales.sales_order_fulfillment_allocations allocation
       JOIN sales.sales_order_fulfillment_demands demand
         ON demand.installation_id = allocation.installation_id
        AND demand.id = allocation.fulfillment_demand_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(line.delivery_base_quantity), 0)::numeric(30,12) AS claimed_base_quantity
           FROM sales.delivery_order_lines line
           JOIN sales.delivery_orders delivery_order
             ON delivery_order.installation_id = line.installation_id
            AND delivery_order.id = line.delivery_order_id
          WHERE line.installation_id = allocation.installation_id
            AND line.fulfillment_allocation_id = allocation.id
            AND delivery_order.status IN ('draft', 'ready_to_dispatch', 'dispatched', 'handed_over')
       ) claim ON true
      WHERE allocation.installation_id = $1
        AND allocation.inventory_reservation_id = ANY($2::uuid[])
      ORDER BY allocation.id
      ${lock ? 'FOR UPDATE OF allocation, demand' : ''}`,
    [installationId, ids],
  );
  const allocationByReservation = new Map(
    (allocationResult.rows ?? []).map((row) => [row.inventory_reservation_id, row]),
  );
  return reservations.map((reservation) => ({
    reservation,
    allocation: allocationByReservation.get(reservation.id) ?? null,
  }));
}

export async function lockReservationScope(client, {
  installationId,
  warehouseId,
  locationId,
  baseVariantId,
  lotId,
}) {
  const key = [
    'inventory-reservation:scope',
    installationId,
    warehouseId,
    locationId ?? '<null>',
    baseVariantId,
    lotId ?? '<null>',
  ].join(':');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

export async function releaseReservation(client, {
  installationId,
  reservationId,
  transitionedAt,
}) {
  await client.query(
    "SELECT set_config('npp.inventory_reservation_write_context', 'reservation_service', true)",
  );
  const result = await client.query(
    `UPDATE inventory.inventory_reservations
        SET state = 'RELEASED', transitioned_at = $3
      WHERE installation_id = $1
        AND id = $2
        AND state = 'ACTIVE'
      RETURNING *`,
    [installationId, reservationId, transitionedAt],
  );
  return result.rows?.[0] ?? null;
}

export async function insertReservationEvent(client, input) {
  await client.query(
    "SELECT set_config('npp.inventory_reservation_write_context', 'reservation_service', true)",
  );
  const result = await client.query(
    `INSERT INTO inventory.inventory_reservation_events (
       id, installation_id, reservation_id, transition, actor_id, request_id,
       source_app, payload_hash, occurred_at, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING *`,
    [
      input.id,
      input.installationId,
      input.reservationId,
      input.transition,
      input.actorId,
      input.requestId,
      input.sourceApp,
      input.payloadHash,
      input.occurredAt,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function releaseAllocation(client, {
  installationId,
  allocationId,
  actorId,
}) {
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_allocation_write_context', 'fulfillment_release_service', true)",
  );
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_release_service', true)",
  );
  const result = await client.query(
    `UPDATE sales.sales_order_fulfillment_allocations
        SET state = 'RELEASED', updated_at = now(), updated_by = $3
      WHERE installation_id = $1
        AND id = $2
        AND state = 'ACTIVE'
      RETURNING *`,
    [installationId, allocationId, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function insertAllocationEvent(client, input) {
  const result = await client.query(
    `INSERT INTO sales.sales_order_fulfillment_allocation_events (
       id, installation_id, allocation_id, event_type, quantity_delta,
       actor_id, request_id, source_app, idempotency_key, payload_hash,
       reason, metadata, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     RETURNING *`,
    [
      input.id,
      input.installationId,
      input.allocationId,
      input.eventType,
      input.quantity,
      input.actorId,
      input.requestId,
      input.sourceApp,
      input.idempotencyKey,
      input.payloadHash,
      input.reason,
      JSON.stringify(input.metadata ?? {}),
      input.occurredAt,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertReservation(client, input) {
  await client.query(
    "SELECT set_config('npp.inventory_reservation_write_context', 'reservation_service', true)",
  );
  const result = await client.query(
    `INSERT INTO inventory.inventory_reservations (
       id, installation_id, warehouse_id, location_id, base_variant_id, lot_id,
       quantity, state, source_domain, source_document_type, source_document_id,
       activated_at, transitioned_at, idempotency_key, payload_hash, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'ACTIVE','SALES','SALES_FULFILLMENT_ALLOCATION',$8,
       $9,$9,$10,$11,$12::jsonb
     ) RETURNING *`,
    [
      input.id,
      input.installationId,
      input.warehouseId,
      input.locationId,
      input.baseVariantId,
      input.lotId,
      input.quantity,
      input.allocationId,
      input.occurredAt,
      input.idempotencyKey,
      input.payloadHash,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertAllocation(client, input) {
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_allocation_write_context', 'fulfillment_allocation_service', true)",
  );
  await client.query(
    "SELECT set_config('npp.sales_fulfillment_write_context', 'fulfillment_service', true)",
  );
  const result = await client.query(
    `INSERT INTO sales.sales_order_fulfillment_allocations (
       id, installation_id, fulfillment_demand_id, sales_order_id,
       sales_order_version_id, sales_order_line_id, warehouse_id, location_id,
       base_variant_id, lot_id, inventory_reservation_id, allocation_sequence,
       allocation_policy, policy_rank, manual_override_reason,
       allocated_base_quantity, picked_base_quantity, packed_base_quantity,
       state, operation_idempotency_key, idempotency_key, payload_hash,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,0,
       'ACTIVE',$17,$18,$19,$20,$20
     ) RETURNING *`,
    [
      input.id,
      input.installationId,
      input.fulfillmentDemandId,
      input.salesOrderId,
      input.salesOrderVersionId,
      input.salesOrderLineId,
      input.warehouseId,
      input.locationId,
      input.baseVariantId,
      input.lotId,
      input.inventoryReservationId,
      input.allocationSequence,
      input.allocationPolicy,
      input.policyRank,
      input.manualOverrideReason,
      input.quantity,
      input.operationIdempotencyKey,
      input.idempotencyKey,
      input.payloadHash,
      input.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}
