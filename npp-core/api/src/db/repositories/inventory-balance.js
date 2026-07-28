async function withBalanceWriteContext(client, context, operation) {
  const previousResult = await client.query(
    "SELECT current_setting('npp.inventory_balance_write_context', true) AS value",
  );
  const previous = previousResult.rows?.[0]?.value ?? '';
  await client.query(
    "SELECT set_config('npp.inventory_balance_write_context', $1, true)",
    [context],
  );
  try {
    return await operation();
  } finally {
    await client.query(
      "SELECT set_config('npp.inventory_balance_write_context', $1, true)",
      [previous],
    );
  }
}

export async function lockBalanceRebuild(client, { installationId }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`inventory-balance-rebuild:${installationId}`],
  );
}

export async function listInventoryWarehouseIds(client, { installationId }) {
  const result = await client.query(
    `SELECT DISTINCT scope.warehouse_id
       FROM (
         SELECT line.warehouse_id
           FROM inventory.inventory_movement_lines line
          WHERE line.installation_id = $1
         UNION
         SELECT balance.warehouse_id
           FROM inventory.inventory_balances balance
          WHERE balance.installation_id = $1
         UNION
         SELECT reservation.warehouse_id
           FROM inventory.inventory_reservations reservation
          WHERE reservation.installation_id = $1
       ) scope
      ORDER BY scope.warehouse_id`,
    [installationId],
  );
  return (result.rows ?? []).map((row) => row.warehouse_id);
}

export async function getInventoryBalance(client, {
  installationId,
  warehouseId,
  locationId = null,
  baseVariantId,
  lotId = null,
}) {
  const result = await client.query(
    `SELECT installation_id, warehouse_id, location_id, base_variant_id, lot_id,
            on_hand_quantity, reserved_quantity, available_quantity,
            projected_through, updated_at
       FROM inventory.inventory_balances
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND location_id IS NOT DISTINCT FROM $3::uuid
        AND base_variant_id = $4
        AND lot_id IS NOT DISTINCT FROM $5::uuid`,
    [installationId, warehouseId, locationId, baseVariantId, lotId],
  );
  return result.rows?.[0] ?? null;
}

export async function listInventoryBalances(client, {
  installationId,
  warehouseId = null,
  baseVariantId = null,
  limit = 500,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT installation_id, warehouse_id, location_id, base_variant_id, lot_id,
            on_hand_quantity, reserved_quantity, available_quantity,
            projected_through, updated_at
       FROM inventory.inventory_balances
      WHERE installation_id = $1
        AND ($2::uuid IS NULL OR warehouse_id = $2)
        AND ($3::uuid IS NULL OR base_variant_id = $3)
      ORDER BY warehouse_id, location_id NULLS FIRST, base_variant_id, lot_id NULLS FIRST
      LIMIT $4 OFFSET $5`,
    [installationId, warehouseId, baseVariantId, limit, offset],
  );
  return result.rows ?? [];
}

export async function reconcileInventoryBalances(client, { installationId }) {
  const result = await client.query(
    `WITH ledger AS (
       SELECT line.installation_id,
              line.warehouse_id,
              line.location_id,
              line.base_variant_id,
              NULL::uuid AS lot_id,
              sum(line.base_quantity_delta)::numeric(30,12) AS ledger_quantity,
              count(DISTINCT line.movement_id)::bigint AS movement_count,
              max(movement.posted_at) AS latest_movement_at
         FROM inventory.inventory_movement_lines line
         JOIN inventory.inventory_movements movement
           ON movement.installation_id = line.installation_id
          AND movement.id = line.movement_id
        WHERE line.installation_id = $1
        GROUP BY line.installation_id, line.warehouse_id, line.location_id, line.base_variant_id
     ), projected AS (
       SELECT balance.installation_id,
              balance.warehouse_id,
              balance.location_id,
              balance.base_variant_id,
              balance.lot_id,
              balance.on_hand_quantity AS projected_quantity,
              balance.projected_through
         FROM inventory.inventory_balances balance
        WHERE balance.installation_id = $1
     )
     SELECT COALESCE(ledger.installation_id, projected.installation_id) AS installation_id,
            COALESCE(ledger.warehouse_id, projected.warehouse_id) AS warehouse_id,
            COALESCE(ledger.location_id, projected.location_id) AS location_id,
            COALESCE(ledger.base_variant_id, projected.base_variant_id) AS base_variant_id,
            COALESCE(ledger.lot_id, projected.lot_id) AS lot_id,
            COALESCE(ledger.ledger_quantity, 0::numeric)::numeric(30,12) AS ledger_quantity,
            COALESCE(projected.projected_quantity, 0::numeric)::numeric(30,12) AS projected_quantity,
            (COALESCE(ledger.ledger_quantity, 0::numeric)
              - COALESCE(projected.projected_quantity, 0::numeric))::numeric(30,12) AS difference,
            COALESCE(ledger.movement_count, 0)::bigint AS movement_count,
            ledger.latest_movement_at,
            projected.projected_through
       FROM ledger
       FULL OUTER JOIN projected
         ON ledger.installation_id = projected.installation_id
        AND ledger.warehouse_id = projected.warehouse_id
        AND ledger.location_id IS NOT DISTINCT FROM projected.location_id
        AND ledger.base_variant_id = projected.base_variant_id
        AND ledger.lot_id IS NOT DISTINCT FROM projected.lot_id
      ORDER BY warehouse_id, location_id NULLS FIRST, base_variant_id, lot_id NULLS FIRST`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function rebuildInventoryBalances(client, { installationId }) {
  return withBalanceWriteContext(client, 'rebuild', async () => {
    await client.query(
      'DELETE FROM inventory.inventory_balances WHERE installation_id = $1',
      [installationId],
    );
    const inserted = await client.query(
      `WITH ledger AS (
         SELECT line.installation_id,
                line.warehouse_id,
                line.location_id,
                line.base_variant_id,
                NULL::uuid AS lot_id,
                sum(line.base_quantity_delta)::numeric(30,12) AS on_hand_quantity,
                max(movement.posted_at) AS projected_through
           FROM inventory.inventory_movement_lines line
           JOIN inventory.inventory_movements movement
             ON movement.installation_id = line.installation_id
            AND movement.id = line.movement_id
          WHERE line.installation_id = $1
          GROUP BY line.installation_id, line.warehouse_id, line.location_id, line.base_variant_id
       ), active_reservations AS (
         SELECT reservation.installation_id,
                reservation.warehouse_id,
                reservation.location_id,
                reservation.base_variant_id,
                reservation.lot_id,
                sum(reservation.held_quantity)::numeric(30,12) AS reserved_quantity
           FROM inventory.inventory_reservations reservation
          WHERE reservation.installation_id = $1
            AND reservation.state = 'ACTIVE'
          GROUP BY reservation.installation_id,
                   reservation.warehouse_id,
                   reservation.location_id,
                   reservation.base_variant_id,
                   reservation.lot_id
       ), rebuilt AS (
         SELECT COALESCE(ledger.installation_id, active_reservations.installation_id) AS installation_id,
                COALESCE(ledger.warehouse_id, active_reservations.warehouse_id) AS warehouse_id,
                COALESCE(ledger.location_id, active_reservations.location_id) AS location_id,
                COALESCE(ledger.base_variant_id, active_reservations.base_variant_id) AS base_variant_id,
                COALESCE(ledger.lot_id, active_reservations.lot_id) AS lot_id,
                COALESCE(ledger.on_hand_quantity, 0::numeric)::numeric(30,12) AS on_hand_quantity,
                COALESCE(active_reservations.reserved_quantity, 0::numeric)::numeric(30,12) AS reserved_quantity,
                ledger.projected_through
           FROM ledger
           FULL OUTER JOIN active_reservations
             ON ledger.installation_id = active_reservations.installation_id
            AND ledger.warehouse_id = active_reservations.warehouse_id
            AND ledger.location_id IS NOT DISTINCT FROM active_reservations.location_id
            AND ledger.base_variant_id = active_reservations.base_variant_id
            AND ledger.lot_id IS NOT DISTINCT FROM active_reservations.lot_id
       )
       INSERT INTO inventory.inventory_balances (
         installation_id, warehouse_id, location_id, base_variant_id, lot_id,
         on_hand_quantity, reserved_quantity, projected_through, updated_at
       )
       SELECT installation_id, warehouse_id, location_id, base_variant_id, lot_id,
              on_hand_quantity, reserved_quantity, projected_through, now()
         FROM rebuilt
       RETURNING installation_id, warehouse_id, location_id, base_variant_id, lot_id,
                 on_hand_quantity, reserved_quantity, available_quantity,
                 projected_through, updated_at`,
      [installationId],
    );
    return inserted.rows ?? [];
  });
}

export async function listInventoryMovementDrillDown(client, {
  installationId,
  warehouseId,
  locationId = null,
  baseVariantId,
  limit = 500,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT movement.id AS movement_id,
            movement.movement_type,
            movement.source_domain,
            movement.source_document_type,
            movement.source_document_id,
            movement.source_document_number,
            movement.document_number,
            movement.document_date,
            movement.posted_at,
            movement.posted_by,
            movement.reversal_of_movement_id,
            line.id AS line_id,
            line.line_number,
            line.warehouse_id,
            line.location_id,
            line.source_variant_id,
            line.source_sku,
            line.source_unit_id,
            line.source_unit_code,
            line.source_quantity,
            line.conversion_to_base,
            line.base_variant_id,
            line.base_sku,
            line.direction,
            line.base_quantity_delta,
            line.source_line_reference,
            line.metadata
       FROM inventory.inventory_movement_lines line
       JOIN inventory.inventory_movements movement
         ON movement.installation_id = line.installation_id
        AND movement.id = line.movement_id
      WHERE line.installation_id = $1
        AND line.warehouse_id = $2
        AND line.location_id IS NOT DISTINCT FROM $3::uuid
        AND line.base_variant_id = $4
      ORDER BY movement.posted_at DESC, movement.id DESC, line.line_number
      LIMIT $5 OFFSET $6`,
    [installationId, warehouseId, locationId, baseVariantId, limit, offset],
  );
  return result.rows ?? [];
}
