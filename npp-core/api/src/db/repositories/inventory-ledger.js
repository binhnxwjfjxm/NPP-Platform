export async function lockIdempotencyKey(client, { installationId, idempotencyKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`${installationId}:${idempotencyKey}`],
  );
}

export async function getMovementByIdempotencyKey(client, { installationId, idempotencyKey }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_movements
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows?.[0] ?? null;
}

export async function getMovementById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_movements
      WHERE installation_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function getReversalForMovement(client, { installationId, movementId }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_movements
      WHERE installation_id = $1 AND reversal_of_movement_id = $2`,
    [installationId, movementId],
  );
  return result.rows?.[0] ?? null;
}

export async function listMovementLines(client, { installationId, movementId }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_movement_lines
      WHERE installation_id = $1 AND movement_id = $2
      ORDER BY line_number`,
    [installationId, movementId],
  );
  return result.rows ?? [];
}

export async function resolvePostingVariant(client, { installationId, sourceVariantId }) {
  const result = await client.query(
    `SELECT source.id AS source_variant_id,
            source.sku AS source_sku,
            source.product_id,
            source.is_active AS source_variant_active,
            source.unit_id AS source_unit_id,
            source.conversion_to_base,
            unit.code AS source_unit_code,
            unit.allows_fractional,
            unit.is_active AS source_unit_active,
            base.id AS base_variant_id,
            base.sku AS base_sku,
            base.is_active AS base_variant_active
       FROM shared.product_variants source
       JOIN shared.units_of_measure unit
         ON unit.installation_id = source.installation_id
        AND unit.id = source.unit_id
       JOIN shared.product_variants base
         ON base.installation_id = source.installation_id
        AND base.product_id = source.product_id
        AND base.is_inventory_base = true
        AND base.is_active = true
      WHERE source.installation_id = $1
        AND source.id = $2
      LIMIT 1`,
    [installationId, sourceVariantId],
  );
  return result.rows?.[0] ?? null;
}

export async function resolveWarehouseLocation(client, { installationId, warehouseId, locationId }) {
  const result = await client.query(
    `SELECT warehouse.id AS warehouse_id,
            warehouse.is_active AS warehouse_active,
            location.id AS location_id,
            location.is_active AS location_active
       FROM shared.warehouses warehouse
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = warehouse.installation_id
        AND location.warehouse_id = warehouse.id
        AND location.id = $3
      WHERE warehouse.installation_id = $1
        AND warehouse.id = $2`,
    [installationId, warehouseId, locationId],
  );
  return result.rows?.[0] ?? null;
}

export async function lockInventoryBalanceScope(client, {
  installationId,
  warehouseId,
  locationId,
  baseVariantId,
  lotId = null,
}) {
  const scopeKey = [
    'inventory-balance:scope',
    installationId,
    warehouseId,
    locationId ?? '<null>',
    baseVariantId,
    lotId ?? '<null>',
  ].join(':');
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [scopeKey],
  );
  const result = await client.query(
    `SELECT on_hand_quantity, reserved_quantity, available_quantity
       FROM inventory.inventory_balances
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND location_id IS NOT DISTINCT FROM $3
        AND base_variant_id = $4
        AND lot_id IS NOT DISTINCT FROM $5
      FOR UPDATE`,
    [installationId, warehouseId, locationId, baseVariantId, lotId],
  );
  return result.rows?.[0] ?? null;
}

export async function insertMovement(client, movement) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_movements (
       id, installation_id, movement_type, source_domain, source_document_type,
       source_document_id, source_document_number, document_date, posted_at,
       posted_by, request_id, source_app, idempotency_key, payload_hash,
       reversal_of_movement_id, document_number, reason_code, reason_note, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     )
     RETURNING *`,
    [
      movement.id,
      movement.installationId,
      movement.movementType,
      movement.sourceDomain,
      movement.sourceDocumentType,
      movement.sourceDocumentId,
      movement.sourceDocumentNumber,
      movement.documentDate,
      movement.postedAt,
      movement.postedBy,
      movement.requestId,
      movement.sourceApp,
      movement.idempotencyKey,
      movement.payloadHash,
      movement.reversalOfMovementId,
      movement.documentNumber,
      movement.reasonCode,
      movement.reasonNote,
      movement.metadata,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertMovementLine(client, line) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_movement_lines (
       id, installation_id, movement_id, line_number, warehouse_id, location_id,
       source_variant_id, source_sku, source_unit_id, source_unit_code,
       source_quantity, conversion_to_base, base_variant_id, base_sku,
       direction, base_quantity_delta, lot_id, lot_code, expiry_date,
       source_line_reference, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     )
     RETURNING *`,
    [
      line.id,
      line.installationId,
      line.movementId,
      line.lineNumber,
      line.warehouseId,
      line.locationId,
      line.sourceVariantId,
      line.sourceSku,
      line.sourceUnitId,
      line.sourceUnitCode,
      line.sourceQuantity,
      line.conversionToBase,
      line.baseVariantId,
      line.baseSku,
      line.direction,
      line.baseQuantityDelta,
      line.lotId ?? null,
      line.lotCode ?? null,
      line.expiryDate ?? null,
      line.sourceLineReference,
      line.metadata,
    ],
  );
  return result.rows?.[0] ?? null;
}
