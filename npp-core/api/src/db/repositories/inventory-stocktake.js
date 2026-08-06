export async function listStocktakes(client, {
  installationId,
  warehouseIds,
  status,
  limit,
  offset,
}) {
  const values = [installationId, warehouseIds];
  const filters = [
    's.installation_id = $1',
    's.warehouse_id = ANY($2::uuid[])',
  ];
  if (status) {
    values.push(status);
    filters.push(`s.status = $${values.length}`);
  }
  values.push(limit, offset);
  const result = await client.query(
    `SELECT s.*,
            w.code AS warehouse_code,
            w.name AS warehouse_name,
            (SELECT count(*) FROM inventory.stocktake_lines l
              WHERE l.installation_id = s.installation_id
                AND l.stocktake_id = s.id
                AND l.round_number = s.current_round) AS line_count
       FROM inventory.stocktakes s
       JOIN shared.warehouses w
         ON w.installation_id = s.installation_id
        AND w.id = s.warehouse_id
      WHERE ${filters.join(' AND ')}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows ?? [];
}

export async function getStocktake(client, {
  installationId,
  stocktakeId,
  warehouseIds,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT s.*,
            w.code AS warehouse_code,
            w.name AS warehouse_name
       FROM inventory.stocktakes s
       JOIN shared.warehouses w
         ON w.installation_id = s.installation_id
        AND w.id = s.warehouse_id
      WHERE s.installation_id = $1
        AND s.id = $2
        AND s.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF s' : ''}`,
    [installationId, stocktakeId, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function listStocktakeRounds(client, { installationId, stocktakeId }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.stocktake_rounds
      WHERE installation_id = $1
        AND stocktake_id = $2
      ORDER BY round_number`,
    [installationId, stocktakeId],
  );
  return result.rows ?? [];
}

export async function listStocktakeLines(client, {
  installationId,
  stocktakeId,
  roundNumber,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT l.*,
            location.code AS location_code,
            location.name AS location_name
       FROM inventory.stocktake_lines l
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = l.installation_id
        AND location.warehouse_id = l.warehouse_id
        AND location.id = l.location_id
      WHERE l.installation_id = $1
        AND l.stocktake_id = $2
        AND l.round_number = $3
      ORDER BY l.line_number
      ${forUpdate ? 'FOR UPDATE OF l' : ''}`,
    [installationId, stocktakeId, roundNumber],
  );
  return result.rows ?? [];
}

export async function loadWarehouse(client, { installationId, warehouseId }) {
  const result = await client.query(
    `SELECT id, code, name, is_active, warehouse_type
       FROM shared.warehouses
      WHERE installation_id = $1 AND id = $2`,
    [installationId, warehouseId],
  );
  return result.rows?.[0] ?? null;
}

export async function loadScopeSnapshots(client, {
  installationId,
  warehouseId,
  scopes,
}) {
  const result = await client.query(
    `WITH requested AS (
       SELECT row_number() OVER ()::integer AS line_number,
              scope.location_id,
              scope.base_variant_id,
              scope.lot_id
         FROM jsonb_to_recordset($3::jsonb)
              AS scope(location_id uuid, base_variant_id uuid, lot_id uuid)
     )
     SELECT requested.line_number,
            $2::uuid AS warehouse_id,
            requested.location_id,
            requested.base_variant_id,
            requested.lot_id,
            base.id AS source_variant_id,
            base.sku AS source_sku,
            base.unit_id AS source_unit_id,
            unit.code AS source_unit_code,
            1::numeric(20,6) AS conversion_to_base,
            base.id AS base_variant_id,
            base.sku AS base_sku,
            lot.lot_code,
            lot.expiry_date,
            COALESCE(balance.on_hand_quantity, 0)::numeric(30,12) AS expected_base_quantity,
            COALESCE(version.version, 0)::bigint AS snapshot_scope_version,
            location.code AS location_code,
            location.name AS location_name
       FROM requested
       JOIN shared.product_variants base
         ON base.installation_id = $1
        AND base.id = requested.base_variant_id
        AND base.is_inventory_base = true
        AND base.is_active = true
       JOIN shared.units_of_measure unit
         ON unit.installation_id = base.installation_id
        AND unit.id = base.unit_id
        AND unit.is_active = true
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = $1
        AND location.warehouse_id = $2
        AND location.id = requested.location_id
        AND location.is_active = true
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = $1
        AND lot.id = requested.lot_id
        AND lot.base_variant_id = requested.base_variant_id
       LEFT JOIN inventory.inventory_balances balance
         ON balance.installation_id = $1
        AND balance.warehouse_id = $2
        AND balance.location_id IS NOT DISTINCT FROM requested.location_id
        AND balance.base_variant_id = requested.base_variant_id
        AND balance.lot_id IS NOT DISTINCT FROM requested.lot_id
       LEFT JOIN inventory.inventory_scope_versions version
         ON version.installation_id = $1
        AND version.warehouse_id = $2
        AND version.location_id IS NOT DISTINCT FROM requested.location_id
        AND version.base_variant_id = requested.base_variant_id
        AND version.lot_id IS NOT DISTINCT FROM requested.lot_id
      WHERE (requested.location_id IS NULL OR location.id IS NOT NULL)
        AND (requested.lot_id IS NULL OR lot.id IS NOT NULL)
      ORDER BY requested.line_number`,
    [installationId, warehouseId, JSON.stringify(scopes)],
  );
  return result.rows ?? [];
}

export async function insertStocktake(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.stocktakes (
       id, installation_id, stocktake_number, warehouse_id, status,
       current_round, revision, note, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,'draft',1,1,$5,$6,$6)
     RETURNING *`,
    [
      input.id,
      input.installationId,
      input.stocktakeNumber,
      input.warehouseId,
      input.note,
      input.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertRound(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.stocktake_rounds (
       id, installation_id, stocktake_id, round_number, status, reason, created_by
     ) VALUES ($1,$2,$3,$4,'open',$5,$6)
     RETURNING *`,
    [
      input.id,
      input.installationId,
      input.stocktakeId,
      input.roundNumber,
      input.reason,
      input.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertLine(client, input) {
  const result = await client.query(
    `INSERT INTO inventory.stocktake_lines (
       id, installation_id, stocktake_id, round_id, round_number, line_number,
       warehouse_id, location_id, source_variant_id, source_sku,
       source_unit_id, source_unit_code, conversion_to_base,
       base_variant_id, base_sku, lot_id, lot_code, expiry_date,
       expected_base_quantity, snapshot_scope_version
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     )
     RETURNING *`,
    [
      input.id, input.installationId, input.stocktakeId, input.roundId,
      input.roundNumber, input.lineNumber, input.warehouseId, input.locationId,
      input.sourceVariantId, input.sourceSku, input.sourceUnitId,
      input.sourceUnitCode, input.conversionToBase, input.baseVariantId,
      input.baseSku, input.lotId, input.lotCode, input.expiryDate,
      input.expectedBaseQuantity, input.snapshotScopeVersion,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function updateCountedLines(client, {
  installationId,
  stocktakeId,
  roundNumber,
  counts,
  actorId,
}) {
  const result = await client.query(
    `WITH input AS (
       SELECT item.id, item.counted_quantity
         FROM jsonb_to_recordset($4::jsonb)
              AS item(id uuid, counted_quantity numeric(30,12))
     )
     UPDATE inventory.stocktake_lines line
        SET counted_base_quantity = input.counted_quantity,
            counted_at = now(),
            counted_by = $5
       FROM input
      WHERE line.installation_id = $1
        AND line.stocktake_id = $2
        AND line.round_number = $3
        AND line.id = input.id
      RETURNING line.id`,
    [installationId, stocktakeId, roundNumber, JSON.stringify(counts), actorId],
  );
  return result.rows ?? [];
}

export async function markCounted(client, input) {
  await client.query(
    `UPDATE inventory.stocktake_rounds
        SET status = 'counted', counted_at = now(), counted_by = $4
      WHERE installation_id = $1 AND stocktake_id = $2 AND round_number = $3`,
    [input.installationId, input.stocktakeId, input.roundNumber, input.actorId],
  );
  const result = await client.query(
    `UPDATE inventory.stocktakes
        SET status = 'counted', revision = revision + 1,
            updated_at = now(), updated_by = $3
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [input.installationId, input.stocktakeId, input.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function currentScopeVersions(client, {
  installationId,
  warehouseId,
  lines,
  lock = false,
}) {
  const serialized = JSON.stringify(lines);
  if (lock) {
    await client.query(
      `WITH requested AS (
         SELECT scope.location_id,
                scope.base_variant_id,
                scope.lot_id
           FROM jsonb_to_recordset($3::jsonb)
                AS scope(line_id uuid, location_id uuid, base_variant_id uuid, lot_id uuid)
       )
       INSERT INTO inventory.inventory_scope_versions (
         installation_id, warehouse_id, location_id, base_variant_id, lot_id, version, updated_at
       )
       SELECT $1, $2, requested.location_id, requested.base_variant_id, requested.lot_id, 0, now()
         FROM requested
       ON CONFLICT ON CONSTRAINT inventory_scope_versions_scope_unique DO NOTHING`,
      [installationId, warehouseId, serialized],
    );
  }
  const result = await client.query(
    `WITH requested AS (
       SELECT scope.line_id,
              scope.location_id,
              scope.base_variant_id,
              scope.lot_id
         FROM jsonb_to_recordset($3::jsonb)
              AS scope(line_id uuid, location_id uuid, base_variant_id uuid, lot_id uuid)
     )
     SELECT requested.line_id,
            version.version::bigint AS version,
            COALESCE(balance.on_hand_quantity, 0)::numeric(30,12) AS current_on_hand,
            COALESCE(balance.reserved_quantity, 0)::numeric(30,12) AS reserved_quantity
       FROM requested
       JOIN inventory.inventory_scope_versions version
         ON version.installation_id = $1
        AND version.warehouse_id = $2
        AND version.location_id IS NOT DISTINCT FROM requested.location_id
        AND version.base_variant_id = requested.base_variant_id
        AND version.lot_id IS NOT DISTINCT FROM requested.lot_id
       LEFT JOIN inventory.inventory_balances balance
         ON balance.installation_id = $1
        AND balance.warehouse_id = $2
        AND balance.location_id IS NOT DISTINCT FROM requested.location_id
        AND balance.base_variant_id = requested.base_variant_id
        AND balance.lot_id IS NOT DISTINCT FROM requested.lot_id
      ORDER BY requested.location_id NULLS FIRST, requested.base_variant_id, requested.lot_id NULLS FIRST
      ${lock ? 'FOR UPDATE OF version' : ''}`,
    [installationId, warehouseId, serialized],
  );
  return result.rows ?? [];
}


export async function transitionSubmitted(client, input) {
  await client.query(
    `UPDATE inventory.stocktake_rounds
        SET status = 'submitted', submitted_at = now(), submitted_by = $4
      WHERE installation_id = $1 AND stocktake_id = $2 AND round_number = $3`,
    [input.installationId, input.stocktakeId, input.roundNumber, input.actorId],
  );
  const result = await client.query(
    `UPDATE inventory.stocktakes
        SET status = 'submitted', revision = revision + 1,
            submitted_at = now(), submitted_by = $3,
            approved_at = NULL, approved_by = NULL,
            updated_at = now(), updated_by = $3
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [input.installationId, input.stocktakeId, input.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function transitionApproved(client, input) {
  await client.query(
    `UPDATE inventory.stocktake_rounds
        SET status = 'approved', approved_at = now(), approved_by = $4
      WHERE installation_id = $1 AND stocktake_id = $2 AND round_number = $3`,
    [input.installationId, input.stocktakeId, input.roundNumber, input.actorId],
  );
  const result = await client.query(
    `UPDATE inventory.stocktakes
        SET status = 'approved', revision = revision + 1,
            approved_at = now(), approved_by = $3,
            updated_at = now(), updated_by = $3
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [input.installationId, input.stocktakeId, input.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function markRecountRequired(client, input) {
  await client.query(
    `UPDATE inventory.stocktake_rounds
        SET status = 'recount_required', reason = $4
      WHERE installation_id = $1 AND stocktake_id = $2 AND round_number = $3`,
    [input.installationId, input.stocktakeId, input.roundNumber, input.reason],
  );
  const result = await client.query(
    `UPDATE inventory.stocktakes
        SET status = 'recount_required', current_round = $3,
            revision = revision + 1, submitted_at = NULL, submitted_by = NULL,
            approved_at = NULL, approved_by = NULL,
            updated_at = now(), updated_by = $4
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [input.installationId, input.stocktakeId, input.nextRound, input.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function markPosted(client, {
  installationId,
  stocktakeId,
  actorId,
  movementId,
  lineVersions,
}) {
  if (lineVersions.length > 0) {
    await client.query(
      "SELECT set_config('npp.stocktake_write_context', 'posting', true)",
    );
    await client.query(
      `WITH input AS (
         SELECT item.id, item.final_delta, item.posted_scope_version
           FROM jsonb_to_recordset($3::jsonb)
                AS item(id uuid, final_delta numeric(30,12), posted_scope_version bigint)
       )
       UPDATE inventory.stocktake_lines line
          SET final_delta = input.final_delta,
              posted_scope_version = input.posted_scope_version
         FROM input
        WHERE line.installation_id = $1
          AND line.stocktake_id = $2
          AND line.id = input.id`,
      [installationId, stocktakeId, JSON.stringify(lineVersions)],
    );
    await client.query(
      "SELECT set_config('npp.stocktake_write_context', '', true)",
    );
  }
  await client.query(
    `UPDATE inventory.stocktake_rounds
        SET status = 'posted'
      WHERE installation_id = $1
        AND stocktake_id = $2
        AND round_number = (
          SELECT current_round FROM inventory.stocktakes
           WHERE installation_id = $1 AND id = $2
        )`,
    [installationId, stocktakeId],
  );
  const result = await client.query(
    `UPDATE inventory.stocktakes
        SET status = 'posted', revision = revision + 1,
            inventory_movement_id = $3,
            posted_at = now(), posted_by = $4,
            updated_at = now(), updated_by = $4
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [installationId, stocktakeId, movementId, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function markCancelled(client, input) {
  const result = await client.query(
    `UPDATE inventory.stocktakes
        SET status = 'cancelled', revision = revision + 1,
            cancelled_at = now(), cancelled_by = $3, cancel_reason = $4,
            updated_at = now(), updated_by = $3
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [input.installationId, input.stocktakeId, input.actorId, input.reason],
  );
  return result.rows?.[0] ?? null;
}

export async function markReversed(client, input) {
  const result = await client.query(
    `UPDATE inventory.stocktakes
        SET status = 'reversed', revision = revision + 1,
            reversal_movement_id = $3, reversed_at = now(),
            reversed_by = $4, reversal_reason = $5,
            updated_at = now(), updated_by = $4
      WHERE installation_id = $1 AND id = $2
      RETURNING *`,
    [input.installationId, input.stocktakeId, input.reversalMovementId, input.actorId, input.reason],
  );
  return result.rows?.[0] ?? null;
}
