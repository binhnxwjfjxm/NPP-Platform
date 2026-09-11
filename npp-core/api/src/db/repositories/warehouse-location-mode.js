function scopeKey({ locationId, baseVariantId, lotId }) {
  return `${locationId ?? '<null>'}|${baseVariantId}|${lotId ?? '<null>'}`;
}

export async function getWarehouse(client, {
  installationId,
  warehouseId,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT id, installation_id, code, name, warehouse_type, is_active,
            location_management_mode, location_management_mode_version,
            location_management_configured_at, location_management_configured_by,
            updated_at, updated_by
       FROM shared.warehouses
      WHERE installation_id = $1 AND id = $2
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [installationId, warehouseId],
  );
  return result.rows?.[0] ?? null;
}

export async function getActiveLocation(client, {
  installationId,
  warehouseId,
  locationId,
}) {
  const result = await client.query(
    `SELECT id, code, name, location_type, is_active
       FROM shared.warehouse_locations
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND id = $3
        AND is_active = true`,
    [installationId, warehouseId, locationId],
  );
  return result.rows?.[0] ?? null;
}

export async function listWarehouseBalances(client, {
  installationId,
  warehouseId,
  lock = false,
}) {
  const result = await client.query(
    `SELECT balance.warehouse_id,
            balance.location_id,
            location.code AS location_code,
            location.name AS location_name,
            balance.base_variant_id,
            base.sku AS base_sku,
            base.unit_id AS source_unit_id,
            unit.code AS source_unit_code,
            balance.lot_id,
            lot.lot_code,
            lot.expiry_date,
            balance.on_hand_quantity,
            balance.reserved_quantity,
            balance.available_quantity,
            COALESCE(version.version, 0)::bigint AS scope_version
       FROM inventory.inventory_balances balance
       JOIN shared.product_variants base
         ON base.installation_id = balance.installation_id
        AND base.id = balance.base_variant_id
       JOIN shared.units_of_measure unit
         ON unit.installation_id = base.installation_id
        AND unit.id = base.unit_id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = balance.installation_id
        AND location.warehouse_id = balance.warehouse_id
        AND location.id = balance.location_id
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = balance.installation_id
        AND lot.id = balance.lot_id
       LEFT JOIN inventory.inventory_scope_versions version
         ON version.installation_id = balance.installation_id
        AND version.warehouse_id = balance.warehouse_id
        AND version.location_id IS NOT DISTINCT FROM balance.location_id
        AND version.base_variant_id = balance.base_variant_id
        AND version.lot_id IS NOT DISTINCT FROM balance.lot_id
      WHERE balance.installation_id = $1
        AND balance.warehouse_id = $2
        AND (balance.on_hand_quantity <> 0 OR balance.reserved_quantity <> 0)
      ORDER BY base.sku, lot.lot_code NULLS FIRST, location.code NULLS FIRST, balance.base_variant_id
      ${lock ? 'FOR UPDATE OF balance' : ''}`,
    [installationId, warehouseId],
  );
  return result.rows ?? [];
}

export async function loadScopeVersions(client, {
  installationId,
  warehouseId,
  scopes,
  lock = false,
}) {
  if (scopes.length === 0) return [];
  const serialized = JSON.stringify(scopes.map((scope) => ({
    scope_key: scopeKey(scope),
    location_id: scope.locationId,
    base_variant_id: scope.baseVariantId,
    lot_id: scope.lotId,
  })));

  if (lock) {
    await client.query(
      `WITH requested AS (
         SELECT scope.location_id, scope.base_variant_id, scope.lot_id
           FROM jsonb_to_recordset($3::jsonb)
                AS scope(scope_key text, location_id uuid, base_variant_id uuid, lot_id uuid)
       )
       INSERT INTO inventory.inventory_scope_versions (
         installation_id, warehouse_id, location_id, base_variant_id, lot_id, version, updated_at
       )
       SELECT DISTINCT $1::text, $2::uuid, requested.location_id,
              requested.base_variant_id, requested.lot_id, 0, now()
         FROM requested
       ON CONFLICT ON CONSTRAINT inventory_scope_versions_scope_unique DO NOTHING`,
      [installationId, warehouseId, serialized],
    );

    const locked = await client.query(
      `WITH requested AS (
         SELECT scope.scope_key, scope.location_id, scope.base_variant_id, scope.lot_id
           FROM jsonb_to_recordset($3::jsonb)
                AS scope(scope_key text, location_id uuid, base_variant_id uuid, lot_id uuid)
       )
       SELECT requested.scope_key, version.version::bigint AS version
         FROM requested
         JOIN inventory.inventory_scope_versions version
           ON version.installation_id = $1
          AND version.warehouse_id = $2
          AND version.location_id IS NOT DISTINCT FROM requested.location_id
          AND version.base_variant_id = requested.base_variant_id
          AND version.lot_id IS NOT DISTINCT FROM requested.lot_id
        ORDER BY requested.scope_key
        FOR UPDATE OF version`,
      [installationId, warehouseId, serialized],
    );
    return locked.rows ?? [];
  }

  const result = await client.query(
    `WITH requested AS (
       SELECT scope.scope_key, scope.location_id, scope.base_variant_id, scope.lot_id
         FROM jsonb_to_recordset($3::jsonb)
              AS scope(scope_key text, location_id uuid, base_variant_id uuid, lot_id uuid)
     )
     SELECT requested.scope_key,
            COALESCE(version.version, 0)::bigint AS version
       FROM requested
       LEFT JOIN inventory.inventory_scope_versions version
         ON version.installation_id = $1
        AND version.warehouse_id = $2
        AND version.location_id IS NOT DISTINCT FROM requested.location_id
        AND version.base_variant_id = requested.base_variant_id
        AND version.lot_id IS NOT DISTINCT FROM requested.lot_id
      ORDER BY requested.scope_key`,
    [installationId, warehouseId, serialized],
  );
  return result.rows ?? [];
}

export async function getRunByIdempotencyKey(client, {
  installationId,
  idempotencyKey,
}) {
  const result = await client.query(
    `SELECT *
       FROM inventory.warehouse_location_mode_runs
      WHERE installation_id = $1 AND idempotency_key = $2`,
    [installationId, idempotencyKey],
  );
  return result.rows?.[0] ?? null;
}

export async function getRun(client, {
  installationId,
  runId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT *
       FROM inventory.warehouse_location_mode_runs
      WHERE installation_id = $1
        AND id = $2
        AND warehouse_id = ANY($3::uuid[])`,
    [installationId, runId, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function listRuns(client, {
  installationId,
  warehouseId,
  warehouseIds,
  limit,
  offset,
}) {
  const values = [installationId, warehouseIds];
  const filters = [
    'installation_id = $1',
    'warehouse_id = ANY($2::uuid[])',
  ];
  if (warehouseId) {
    values.push(warehouseId);
    filters.push(`warehouse_id = $${values.length}`);
  }
  values.push(limit, offset);
  const result = await client.query(
    `SELECT *
       FROM inventory.warehouse_location_mode_runs
      WHERE ${filters.join(' AND ')}
      ORDER BY completed_at DESC, id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows ?? [];
}

export async function listRunLines(client, {
  installationId,
  runId,
}) {
  const result = await client.query(
    `SELECT *
       FROM inventory.warehouse_location_mode_run_lines
      WHERE installation_id = $1 AND run_id = $2
      ORDER BY line_number`,
    [installationId, runId],
  );
  return result.rows ?? [];
}

export async function updateWarehouseMode(client, {
  installationId,
  warehouseId,
  targetMode,
  expectedModeVersion,
  actorId,
}) {
  const result = await client.query(
    `UPDATE shared.warehouses
        SET location_management_mode = $3,
            location_management_mode_version = location_management_mode_version + 1,
            location_management_configured_at = now(),
            location_management_configured_by = $5,
            updated_at = now(),
            updated_by = $5
      WHERE installation_id = $1
        AND id = $2
        AND location_management_mode_version = $4::bigint
      RETURNING id, installation_id, code, name, warehouse_type, is_active,
                location_management_mode, location_management_mode_version,
                location_management_configured_at, location_management_configured_by,
                updated_at, updated_by`,
    [installationId, warehouseId, targetMode, expectedModeVersion, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function insertRun(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.warehouse_location_mode_runs (
       id, installation_id, warehouse_id, warehouse_code_snapshot, warehouse_name_snapshot,
       from_mode, target_mode, destination_location_id,
       destination_location_code_snapshot, destination_location_name_snapshot,
       preview_hash, payload_hash, idempotency_key, issue_movement_id, receipt_movement_id,
       affected_sku_count, affected_scope_count, total_base_quantity,
       completed_at, completed_by, request_id, source_app, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
       $19,$20,$21,$22,$23
     ) RETURNING *`,
    [
      input.id,
      input.installationId,
      input.warehouseId,
      input.warehouseCode,
      input.warehouseName,
      input.fromMode,
      input.targetMode,
      input.destinationLocationId,
      input.destinationLocationCode,
      input.destinationLocationName,
      input.previewHash,
      input.payloadHash,
      input.idempotencyKey,
      input.issueMovementId,
      input.receiptMovementId,
      input.affectedSkuCount,
      input.affectedScopeCount,
      input.totalBaseQuantity,
      input.completedAt,
      input.completedBy,
      input.requestId,
      input.sourceApp,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertRunLine(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.warehouse_location_mode_run_lines (
       id, installation_id, run_id, line_number, warehouse_id,
       base_variant_id, base_sku_snapshot, lot_id, lot_code_snapshot,
       source_location_id, source_location_code_snapshot, source_location_name_snapshot,
       destination_location_id, destination_location_code_snapshot, destination_location_name_snapshot,
       base_quantity, source_scope_version, destination_scope_version,
       issue_movement_line_id, receipt_movement_line_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     ) RETURNING *`,
    [
      input.id,
      input.installationId,
      input.runId,
      input.lineNumber,
      input.warehouseId,
      input.baseVariantId,
      input.baseSku,
      input.lotId,
      input.lotCode,
      input.sourceLocationId,
      input.sourceLocationCode,
      input.sourceLocationName,
      input.destinationLocationId,
      input.destinationLocationCode,
      input.destinationLocationName,
      input.baseQuantity,
      input.sourceScopeVersion,
      input.destinationScopeVersion,
      input.issueMovementLineId,
      input.receiptMovementLineId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export const warehouseLocationModeRepositoryInternals = Object.freeze({ scopeKey });
