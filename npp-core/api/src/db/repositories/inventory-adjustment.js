export async function listReasons(client) {
  const result = await client.query(
    `SELECT code, document_kind, adjustment_direction, label, description, sort_order
       FROM inventory.inventory_adjustment_reasons
      WHERE is_active = true
      ORDER BY sort_order, code`,
  );
  return result.rows ?? [];
}

export async function getReason(client, { code }) {
  const result = await client.query(
    `SELECT code, document_kind, adjustment_direction, label, description, is_active
       FROM inventory.inventory_adjustment_reasons
      WHERE code = $1`,
    [code],
  );
  return result.rows?.[0] ?? null;
}

export async function listAdjustments(client, {
  installationId,
  warehouseIds,
  status,
  documentKind,
  limit,
  offset,
}) {
  const values = [installationId, warehouseIds];
  const filters = [
    'a.installation_id = $1',
    'a.warehouse_id = ANY($2::uuid[])',
  ];
  if (status) {
    values.push(status);
    filters.push(`a.status = $${values.length}`);
  }
  if (documentKind) {
    values.push(documentKind);
    filters.push(`a.document_kind = $${values.length}`);
  }
  values.push(limit, offset);
  const result = await client.query(
    `SELECT a.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            reason.label AS reason_label,
            (SELECT count(*) FROM inventory.inventory_adjustment_lines line
              WHERE line.installation_id = a.installation_id
                AND line.adjustment_id = a.id) AS line_count
       FROM inventory.inventory_adjustments a
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = a.installation_id
        AND warehouse.id = a.warehouse_id
       JOIN inventory.inventory_adjustment_reasons reason
         ON reason.code = a.reason_code
      WHERE ${filters.join(' AND ')}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows ?? [];
}

export async function getAdjustment(client, {
  installationId,
  adjustmentId,
  warehouseIds,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT a.*,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            reason.label AS reason_label
       FROM inventory.inventory_adjustments a
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = a.installation_id
        AND warehouse.id = a.warehouse_id
       JOIN inventory.inventory_adjustment_reasons reason
         ON reason.code = a.reason_code
      WHERE a.installation_id = $1
        AND a.id = $2
        AND a.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [installationId, adjustmentId, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function listLines(client, { installationId, adjustmentId, forUpdate = false }) {
  const result = await client.query(
    `SELECT line.*,
            source_location.code AS source_location_code,
            source_location.name AS source_location_name,
            source_location.location_type AS source_location_type,
            destination_location.code AS destination_location_code,
            destination_location.name AS destination_location_name,
            destination_location.location_type AS destination_location_type
       FROM inventory.inventory_adjustment_lines line
       JOIN shared.warehouse_locations source_location
         ON source_location.installation_id = line.installation_id
        AND source_location.warehouse_id = line.warehouse_id
        AND source_location.id = line.source_location_id
       LEFT JOIN shared.warehouse_locations destination_location
         ON destination_location.installation_id = line.installation_id
        AND destination_location.warehouse_id = line.warehouse_id
        AND destination_location.id = line.destination_location_id
      WHERE line.installation_id = $1
        AND line.adjustment_id = $2
      ORDER BY line.line_number
      ${forUpdate ? 'FOR UPDATE OF line' : ''}`,
    [installationId, adjustmentId],
  );
  return result.rows ?? [];
}

export async function listPostedScopes(client, { installationId, adjustmentId }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.inventory_adjustment_posted_scopes
      WHERE installation_id = $1
        AND adjustment_id = $2
      ORDER BY adjustment_line_id, scope_side`,
    [installationId, adjustmentId],
  );
  return result.rows ?? [];
}

export async function loadWarehouse(client, { installationId, warehouseId }) {
  const result = await client.query(
    `SELECT id, code, name, warehouse_type, is_active
       FROM shared.warehouses
      WHERE installation_id = $1 AND id = $2`,
    [installationId, warehouseId],
  );
  return result.rows?.[0] ?? null;
}

export async function loadCorrectionSource(client, { installationId, adjustmentId }) {
  const result = await client.query(
    `SELECT id, warehouse_id, status
       FROM inventory.inventory_adjustments
      WHERE installation_id = $1 AND id = $2`,
    [installationId, adjustmentId],
  );
  return result.rows?.[0] ?? null;
}

export async function loadLineSnapshots(client, {
  installationId,
  warehouseId,
  lines,
}) {
  const result = await client.query(
    `WITH requested AS (
       SELECT item.ordinality::integer AS line_number,
              input.source_location_id,
              input.destination_location_id,
              input.source_variant_id,
              input.source_quantity,
              input.lot_id
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS item(value, ordinality)
         CROSS JOIN LATERAL jsonb_to_record(item.value)
              AS input(
                source_location_id uuid,
                destination_location_id uuid,
                source_variant_id uuid,
                source_quantity numeric(20,6),
                lot_id uuid
              )
     )
     SELECT requested.line_number,
            $2::uuid AS warehouse_id,
            requested.source_location_id,
            source_location.code AS source_location_code,
            source_location.name AS source_location_name,
            source_location.location_type AS source_location_type,
            requested.destination_location_id,
            destination_location.code AS destination_location_code,
            destination_location.name AS destination_location_name,
            destination_location.location_type AS destination_location_type,
            requested.source_variant_id,
            source.sku AS source_sku,
            source.unit_id AS source_unit_id,
            unit.code AS source_unit_code,
            source.conversion_to_base,
            base.id AS base_variant_id,
            base.sku AS base_sku,
            requested.source_quantity,
            (requested.source_quantity * source.conversion_to_base)::numeric(30,12) AS base_quantity,
            requested.lot_id,
            lot.lot_code,
            lot.expiry_date,
            COALESCE(source_version.version, 0)::bigint AS source_snapshot_scope_version,
            CASE WHEN requested.destination_location_id IS NULL THEN NULL
                 ELSE COALESCE(destination_version.version, 0)::bigint END AS destination_snapshot_scope_version
       FROM requested
       JOIN shared.warehouse_locations source_location
         ON source_location.installation_id = $1
        AND source_location.warehouse_id = $2
        AND source_location.id = requested.source_location_id
        AND source_location.is_active = true
       LEFT JOIN shared.warehouse_locations destination_location
         ON destination_location.installation_id = $1
        AND destination_location.warehouse_id = $2
        AND destination_location.id = requested.destination_location_id
        AND destination_location.is_active = true
       JOIN shared.product_variants source
         ON source.installation_id = $1
        AND source.id = requested.source_variant_id
        AND source.is_active = true
       JOIN shared.units_of_measure unit
         ON unit.installation_id = source.installation_id
        AND unit.id = source.unit_id
        AND unit.is_active = true
       JOIN shared.product_variants base
         ON base.installation_id = source.installation_id
        AND base.product_id = source.product_id
        AND base.is_inventory_base = true
        AND base.is_active = true
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = $1
        AND policy.base_variant_id = base.id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = $1
        AND lot.id = requested.lot_id
        AND lot.base_variant_id = base.id
       LEFT JOIN inventory.inventory_scope_versions source_version
         ON source_version.installation_id = $1
        AND source_version.warehouse_id = $2
        AND source_version.location_id = requested.source_location_id
        AND source_version.base_variant_id = base.id
        AND source_version.lot_id IS NOT DISTINCT FROM requested.lot_id
       LEFT JOIN inventory.inventory_scope_versions destination_version
         ON destination_version.installation_id = $1
        AND destination_version.warehouse_id = $2
        AND destination_version.location_id = requested.destination_location_id
        AND destination_version.base_variant_id = base.id
        AND destination_version.lot_id IS NOT DISTINCT FROM requested.lot_id
      WHERE (requested.destination_location_id IS NULL OR destination_location.id IS NOT NULL)
        AND (requested.lot_id IS NULL OR lot.id IS NOT NULL)
        AND (COALESCE(policy.lot_tracking_mode, 'NONE') = 'NONE' OR requested.lot_id IS NOT NULL)
        AND (COALESCE(policy.expiry_tracking_mode, 'NONE') <> 'REQUIRED' OR lot.expiry_date IS NOT NULL)
      ORDER BY requested.line_number`,
    [installationId, warehouseId, JSON.stringify(lines)],
  );
  return result.rows ?? [];
}

export async function insertAdjustment(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_adjustments (
       id, installation_id, adjustment_number, warehouse_id, document_kind,
       adjustment_direction, reason_code, reason_note, status, revision,
       correction_of_adjustment_id, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT',1,$9,$10,$10)
     RETURNING *`,
    [
      input.id,
      input.installationId,
      input.adjustmentNumber,
      input.warehouseId,
      input.documentKind,
      input.adjustmentDirection,
      input.reasonCode,
      input.reasonNote,
      input.correctionOfAdjustmentId,
      input.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertLine(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_adjustment_lines (
       id, installation_id, adjustment_id, line_number, warehouse_id,
       source_location_id, destination_location_id, source_variant_id,
       source_sku, source_unit_id, source_unit_code, source_quantity,
       conversion_to_base, base_variant_id, base_sku, base_quantity,
       lot_id, lot_code, expiry_date, source_snapshot_scope_version,
       destination_snapshot_scope_version, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
     ) RETURNING *`,
    [
      input.id,
      input.installationId,
      input.adjustmentId,
      input.lineNumber,
      input.warehouseId,
      input.sourceLocationId,
      input.destinationLocationId,
      input.sourceVariantId,
      input.sourceSku,
      input.sourceUnitId,
      input.sourceUnitCode,
      input.sourceQuantity,
      input.conversionToBase,
      input.baseVariantId,
      input.baseSku,
      input.baseQuantity,
      input.lotId,
      input.lotCode,
      input.expiryDate,
      input.sourceSnapshotScopeVersion,
      input.destinationSnapshotScopeVersion,
      input.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function currentScopeVersions(client, {
  installationId,
  warehouseId,
  scopes,
  lock = false,
}) {
  const serialized = JSON.stringify(scopes);
  if (lock && scopes.length > 0) {
    await client.query(
      `WITH requested AS (
         SELECT scope.location_id, scope.base_variant_id, scope.lot_id
           FROM jsonb_to_recordset($3::jsonb)
                AS scope(scope_key text, location_id uuid, base_variant_id uuid, lot_id uuid)
       )
       INSERT INTO inventory.inventory_scope_versions (
         installation_id, warehouse_id, location_id, base_variant_id, lot_id, version, updated_at
       )
       SELECT DISTINCT $1::text, $2::uuid, requested.location_id, requested.base_variant_id, requested.lot_id, 0, now()
         FROM requested
       ON CONFLICT ON CONSTRAINT inventory_scope_versions_scope_unique DO NOTHING`,
      [installationId, warehouseId, serialized],
    );
  }
  const result = await client.query(
    `WITH requested AS (
       SELECT scope.scope_key, scope.location_id, scope.base_variant_id, scope.lot_id
         FROM jsonb_to_recordset($3::jsonb)
              AS scope(scope_key text, location_id uuid, base_variant_id uuid, lot_id uuid)
     )
     SELECT requested.scope_key,
            version.version::bigint AS version,
            COALESCE(balance.on_hand_quantity, 0)::numeric(30,12) AS current_on_hand,
            COALESCE(balance.reserved_quantity, 0)::numeric(30,12) AS reserved_quantity,
            COALESCE(balance.available_quantity, 0)::numeric(30,12) AS available_quantity
       FROM requested
       JOIN inventory.inventory_scope_versions version
         ON version.installation_id = $1
        AND version.warehouse_id = $2
        AND version.location_id = requested.location_id
        AND version.base_variant_id = requested.base_variant_id
        AND version.lot_id IS NOT DISTINCT FROM requested.lot_id
       LEFT JOIN inventory.inventory_balances balance
         ON balance.installation_id = $1
        AND balance.warehouse_id = $2
        AND balance.location_id = requested.location_id
        AND balance.base_variant_id = requested.base_variant_id
        AND balance.lot_id IS NOT DISTINCT FROM requested.lot_id
      ORDER BY requested.scope_key
      ${lock ? 'FOR UPDATE OF version' : ''}`,
    [installationId, warehouseId, serialized],
  );
  return result.rows ?? [];
}

export async function markSubmitted(client, input) {
  const result = await client.query(
    `UPDATE inventory.inventory_adjustments
        SET status = 'SUBMITTED', revision = revision + 1,
            submitted_at = now(), submitted_by = $3,
            updated_at = now(), updated_by = $3
      WHERE installation_id = $1 AND id = $2 AND status = 'DRAFT'
      RETURNING *`,
    [input.installationId, input.adjustmentId, input.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function markApproved(client, input) {
  const result = await client.query(
    `UPDATE inventory.inventory_adjustments
        SET status = 'APPROVED', revision = revision + 1,
            approved_at = now(), approved_by = $3,
            updated_at = now(), updated_by = $3
      WHERE installation_id = $1 AND id = $2 AND status = 'SUBMITTED'
      RETURNING *`,
    [input.installationId, input.adjustmentId, input.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function markPosted(client, input) {
  const result = await client.query(
    `UPDATE inventory.inventory_adjustments
        SET status = 'POSTED', revision = revision + 1,
            inventory_movement_id = $3, posted_at = now(), posted_by = $4,
            updated_at = now(), updated_by = $4
      WHERE installation_id = $1 AND id = $2 AND status = 'APPROVED'
      RETURNING *`,
    [input.installationId, input.adjustmentId, input.movementId, input.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function markCancelled(client, input) {
  const result = await client.query(
    `UPDATE inventory.inventory_adjustments
        SET status = 'CANCELLED', revision = revision + 1,
            cancelled_at = now(), cancelled_by = $3, cancel_reason = $4,
            updated_at = now(), updated_by = $3
      WHERE installation_id = $1 AND id = $2 AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED')
      RETURNING *`,
    [input.installationId, input.adjustmentId, input.actorId, input.reason],
  );
  return result.rows?.[0] ?? null;
}

export async function markReversed(client, input) {
  const result = await client.query(
    `UPDATE inventory.inventory_adjustments
        SET status = 'REVERSED', revision = revision + 1,
            reversal_movement_id = $3, reversed_at = now(), reversed_by = $4,
            reversal_reason = $5, updated_at = now(), updated_by = $4
      WHERE installation_id = $1 AND id = $2 AND status = 'POSTED'
      RETURNING *`,
    [input.installationId, input.adjustmentId, input.reversalMovementId, input.actorId, input.reason],
  );
  return result.rows?.[0] ?? null;
}

export async function insertPostedScope(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.inventory_adjustment_posted_scopes (
       id, installation_id, adjustment_id, adjustment_line_id, scope_side,
       warehouse_id, location_id, base_variant_id, lot_id, posted_scope_version
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      input.id,
      input.installationId,
      input.adjustmentId,
      input.adjustmentLineId,
      input.scopeSide,
      input.warehouseId,
      input.locationId,
      input.baseVariantId,
      input.lotId,
      input.postedScopeVersion,
    ],
  );
  return result.rows?.[0] ?? null;
}
