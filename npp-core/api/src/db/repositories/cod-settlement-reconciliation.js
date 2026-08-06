export async function getHandoverByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM accounting.cod_cash_handovers
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function insertHandover(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.cod_cash_handovers (
       id, installation_id, warehouse_id, trip_id, driver_profile_id,
       expected_total, handed_over_total, unattributed_excess_amount,
       difference_amount, reason, note, handed_over_at,
       idempotency_key, payload_hash, actor_id, request_id, source_app, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$15)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.warehouseId,
      values.tripId,
      values.driverProfileId,
      values.expectedTotal,
      values.handedOverTotal,
      values.unattributedExcessAmount,
      values.differenceAmount,
      values.reason,
      values.note,
      values.handedOverAt,
      values.idempotencyKey,
      values.payloadHash,
      values.actorId,
      values.requestId,
      values.sourceApp,
    ],
  );
  return result.rows[0];
}

export async function insertHandoverLine(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.cod_cash_handover_lines (
       id, installation_id, handover_id, collection_id,
       expected_amount, handed_over_amount, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      values.id,
      values.installationId,
      values.handoverId,
      values.collectionId,
      values.expectedAmount,
      values.handedOverAmount,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function listHandovers(client, {
  installationId,
  warehouseIds,
  status,
  limit,
  offset,
}) {
  const result = await client.query(
    `SELECT projection.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            trip.trip_number,
            driver.code AS driver_code,
            driver.name AS driver_name,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', line.id,
                'collectionId', line.collection_id,
                'expectedAmount', line.expected_amount::text,
                'handedOverAmount', line.handed_over_amount::text,
                'customerId', collection.customer_id,
                'customerCode', delivery_order.customer_code_snapshot,
                'customerName', delivery_order.customer_name_snapshot,
                'deliveryOrderId', delivery_order.id,
                'deliveryOrderNumber', delivery_order.delivery_order_number,
                'paymentDocumentId', collection.payment_document_id
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
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = projection.installation_id
        AND warehouse.id = projection.warehouse_id
       JOIN logistics.delivery_trips trip
         ON trip.installation_id = projection.installation_id
        AND trip.id = projection.trip_id
       JOIN logistics.driver_profiles driver
         ON driver.installation_id = projection.installation_id
        AND driver.id = projection.driver_profile_id
      WHERE projection.installation_id = $1
        AND projection.warehouse_id = ANY($2::uuid[])
        AND ($3::text IS NULL OR projection.projection_status = $3)
      ORDER BY projection.handed_over_at DESC, projection.id DESC
      LIMIT $4 OFFSET $5`,
    [installationId, warehouseIds, status, limit, offset],
  );
  return result.rows;
}

export async function getHandover(client, {
  installationId,
  handoverId,
  warehouseIds,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT projection.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            trip.trip_number,
            driver.code AS driver_code,
            driver.name AS driver_name,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', line.id,
                'collectionId', line.collection_id,
                'expectedAmount', line.expected_amount::text,
                'handedOverAmount', line.handed_over_amount::text,
                'customerId', collection.customer_id,
                'customerCode', delivery_order.customer_code_snapshot,
                'customerName', delivery_order.customer_name_snapshot,
                'deliveryOrderId', delivery_order.id,
                'deliveryOrderNumber', delivery_order.delivery_order_number,
                'paymentDocumentId', collection.payment_document_id
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
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = projection.installation_id
        AND warehouse.id = projection.warehouse_id
       JOIN logistics.delivery_trips trip
         ON trip.installation_id = projection.installation_id
        AND trip.id = projection.trip_id
       JOIN logistics.driver_profiles driver
         ON driver.installation_id = projection.installation_id
        AND driver.id = projection.driver_profile_id
      WHERE projection.installation_id = $1
        AND projection.id = $2
        AND projection.warehouse_id = ANY($3::uuid[])
        `,
    [installationId, handoverId, warehouseIds],
  );
  return result.rows[0] ?? null;
}

export async function getAcceptanceByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT * FROM accounting.cod_cash_acceptances
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export async function insertAcceptance(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.cod_cash_acceptances (
       id, installation_id, handover_id, accepted_amount, difference_amount,
       reconciliation_status, reason, note, accepted_at,
       idempotency_key, payload_hash, actor_id, request_id, source_app, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$12)
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.handoverId,
      values.acceptedAmount,
      values.differenceAmount,
      values.reconciliationStatus,
      values.reason,
      values.note,
      values.acceptedAt,
      values.idempotencyKey,
      values.payloadHash,
      values.actorId,
      values.requestId,
      values.sourceApp,
    ],
  );
  return result.rows[0];
}

export async function countActiveHandoverLinesForCollection(client, { installationId, collectionId }) {
  const result = await client.query(
    `SELECT count(*)::bigint AS count
       FROM accounting.cod_cash_handover_lines line
       JOIN accounting.cod_cash_handovers handover
         ON handover.installation_id = line.installation_id
        AND handover.id = line.handover_id
       LEFT JOIN accounting.cod_cash_handover_reversals reversal
         ON reversal.installation_id = handover.installation_id
        AND reversal.handover_id = handover.id
      WHERE line.installation_id = $1
        AND line.collection_id = $2
        AND reversal.id IS NULL`,
    [installationId, collectionId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function insertCollectionReversal(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.cod_collection_reversals (
       id, installation_id, collection_id, reason, actor_id, request_id,
       source_app, reversed_at, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
    [values.id, values.installationId, values.collectionId, values.reason,
      values.actorId, values.requestId, values.sourceApp, values.reversedAt,
      JSON.stringify(values.metadata ?? {})],
  );
  return result.rows[0];
}

export async function insertHandoverReversal(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.cod_cash_handover_reversals (
       id, installation_id, handover_id, reason, actor_id, request_id,
       source_app, reversed_at, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
    [values.id, values.installationId, values.handoverId, values.reason,
      values.actorId, values.requestId, values.sourceApp, values.reversedAt,
      JSON.stringify(values.metadata ?? {})],
  );
  return result.rows[0];
}

export async function insertAcceptanceReversal(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.cod_cash_acceptance_reversals (
       id, installation_id, acceptance_id, reason, actor_id, request_id,
       source_app, reversed_at, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
    [values.id, values.installationId, values.acceptanceId, values.reason,
      values.actorId, values.requestId, values.sourceApp, values.reversedAt,
      JSON.stringify(values.metadata ?? {})],
  );
  return result.rows[0];
}

export async function getCollectionForReversal(client, {
  installationId,
  collectionId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT collection.*,
            reversal.id AS reversal_id,
            payment.source_document_number AS payment_document_number
       FROM accounting.cod_collections collection
       LEFT JOIN accounting.cod_collection_reversals reversal
         ON reversal.installation_id = collection.installation_id
        AND reversal.collection_id = collection.id
       LEFT JOIN accounting.receivable_documents payment
         ON payment.installation_id = collection.installation_id
        AND payment.id = collection.payment_document_id
      WHERE collection.installation_id = $1
        AND collection.id = $2
        AND collection.warehouse_id = ANY($3::uuid[])
      FOR UPDATE OF collection`,
    [installationId, collectionId, warehouseIds],
  );
  return result.rows[0] ?? null;
}

export async function getAcceptanceForReversal(client, {
  installationId,
  acceptanceId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT acceptance.*,
            acceptance_reversal.id AS reversal_id,
            handover.warehouse_id,
            handover.trip_id,
            handover_reversal.id AS handover_reversal_id
       FROM accounting.cod_cash_acceptances acceptance
       JOIN accounting.cod_cash_handovers handover
         ON handover.installation_id = acceptance.installation_id
        AND handover.id = acceptance.handover_id
       LEFT JOIN accounting.cod_cash_acceptance_reversals acceptance_reversal
         ON acceptance_reversal.installation_id = acceptance.installation_id
        AND acceptance_reversal.acceptance_id = acceptance.id
       LEFT JOIN accounting.cod_cash_handover_reversals handover_reversal
         ON handover_reversal.installation_id = handover.installation_id
        AND handover_reversal.handover_id = handover.id
      WHERE acceptance.installation_id = $1
        AND acceptance.id = $2
        AND handover.warehouse_id = ANY($3::uuid[])
      FOR UPDATE OF acceptance, handover`,
    [installationId, acceptanceId, warehouseIds],
  );
  return result.rows[0] ?? null;
}
