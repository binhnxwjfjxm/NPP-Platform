function toLocalDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, 10);
}

function presentInventoryBalance(row) {
  if (!row) return row;
  return {
    ...row,
    expiry_date: toLocalDateOnly(row.expiry_date),
    projected_through: row.projected_through instanceof Date ? row.projected_through.toISOString() : row.projected_through,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function presentInventoryMovementHistory(row) {
  if (!row) return row;
  return {
    ...row,
    document_date: toLocalDateOnly(row.document_date),
    posted_at: row.posted_at instanceof Date ? row.posted_at.toISOString() : row.posted_at,
    line_count: Number(row.line_count ?? 0),
  };
}

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
    `SELECT balance.installation_id,
            balance.warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            balance.location_id,
            location.code AS location_code,
            location.name AS location_name,
            balance.base_variant_id,
            base.sku AS base_sku,
            base.name AS base_variant_name,
            base.product_id,
            product.code AS product_code,
            product.name AS product_name,
            base.unit_id AS base_unit_id,
            base.conversion_to_base AS base_conversion_to_base,
            base_unit.code AS base_unit_code,
            base_unit.name AS base_unit_name,
            base_unit.symbol AS base_unit_symbol,
            package_variant.package_variant_id,
            package_variant.package_sku,
            package_variant.package_variant_name,
            package_variant.package_unit_id,
            package_variant.package_unit_code,
            package_variant.package_unit_name,
            package_variant.package_unit_symbol,
            package_variant.package_conversion_to_base,
            balance.lot_id,
            lot.lot_code,
            lot.expiry_date,
            balance.on_hand_quantity,
            balance.reserved_quantity,
            balance.available_quantity,
            balance.projected_through,
            balance.updated_at
       FROM inventory.inventory_balances balance
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = balance.installation_id
        AND warehouse.id = balance.warehouse_id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = balance.installation_id
        AND location.warehouse_id = balance.warehouse_id
        AND location.id = balance.location_id
       JOIN shared.product_variants base
         ON base.installation_id = balance.installation_id
        AND base.id = balance.base_variant_id
       JOIN shared.products product
         ON product.installation_id = base.installation_id
        AND product.id = base.product_id
       LEFT JOIN shared.units_of_measure base_unit
         ON base_unit.installation_id = base.installation_id
        AND base_unit.id = base.unit_id
       LEFT JOIN LATERAL (
         SELECT packaging.id AS package_variant_id,
                packaging.sku AS package_sku,
                packaging.name AS package_variant_name,
                packaging.unit_id AS package_unit_id,
                package_unit.code AS package_unit_code,
                package_unit.name AS package_unit_name,
                package_unit.symbol AS package_unit_symbol,
                packaging.conversion_to_base AS package_conversion_to_base
           FROM shared.product_variants packaging
           JOIN shared.units_of_measure package_unit
             ON package_unit.installation_id = packaging.installation_id
            AND package_unit.id = packaging.unit_id
          WHERE packaging.installation_id = base.installation_id
            AND packaging.product_id = base.product_id
            AND packaging.id <> base.id
            AND packaging.is_active = true
            AND packaging.conversion_to_base IS NOT NULL
            AND packaging.conversion_to_base > 1
          ORDER BY CASE WHEN package_unit.unit_kind = 'PACKAGE' THEN 0 ELSE 1 END,
                   packaging.conversion_to_base DESC,
                   packaging.sku ASC
          LIMIT 1
       ) package_variant ON true
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = balance.installation_id
        AND lot.id = balance.lot_id
      WHERE balance.installation_id = $1
        AND balance.warehouse_id = $2
        AND balance.location_id IS NOT DISTINCT FROM $3::uuid
        AND balance.base_variant_id = $4
        AND balance.lot_id IS NOT DISTINCT FROM $5::uuid`,
    [installationId, warehouseId, locationId, baseVariantId, lotId],
  );
  return presentInventoryBalance(result.rows?.[0] ?? null);
}

export async function listInventoryBalances(client, {
  installationId,
  warehouseId = null,
  baseVariantId = null,
  lotId = null,
  limit = 500,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT balance.installation_id,
            balance.warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            balance.location_id,
            location.code AS location_code,
            location.name AS location_name,
            balance.base_variant_id,
            base.sku AS base_sku,
            base.name AS base_variant_name,
            base.product_id,
            product.code AS product_code,
            product.name AS product_name,
            base.unit_id AS base_unit_id,
            base.conversion_to_base AS base_conversion_to_base,
            base_unit.code AS base_unit_code,
            base_unit.name AS base_unit_name,
            base_unit.symbol AS base_unit_symbol,
            package_variant.package_variant_id,
            package_variant.package_sku,
            package_variant.package_variant_name,
            package_variant.package_unit_id,
            package_variant.package_unit_code,
            package_variant.package_unit_name,
            package_variant.package_unit_symbol,
            package_variant.package_conversion_to_base,
            balance.lot_id,
            lot.lot_code,
            lot.expiry_date,
            balance.on_hand_quantity,
            balance.reserved_quantity,
            balance.available_quantity,
            balance.projected_through,
            balance.updated_at
       FROM inventory.inventory_balances balance
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = balance.installation_id
        AND warehouse.id = balance.warehouse_id
       LEFT JOIN shared.warehouse_locations location
         ON location.installation_id = balance.installation_id
        AND location.warehouse_id = balance.warehouse_id
        AND location.id = balance.location_id
       JOIN shared.product_variants base
         ON base.installation_id = balance.installation_id
        AND base.id = balance.base_variant_id
       JOIN shared.products product
         ON product.installation_id = base.installation_id
        AND product.id = base.product_id
       LEFT JOIN shared.units_of_measure base_unit
         ON base_unit.installation_id = base.installation_id
        AND base_unit.id = base.unit_id
       LEFT JOIN LATERAL (
         SELECT packaging.id AS package_variant_id,
                packaging.sku AS package_sku,
                packaging.name AS package_variant_name,
                packaging.unit_id AS package_unit_id,
                package_unit.code AS package_unit_code,
                package_unit.name AS package_unit_name,
                package_unit.symbol AS package_unit_symbol,
                packaging.conversion_to_base AS package_conversion_to_base
           FROM shared.product_variants packaging
           JOIN shared.units_of_measure package_unit
             ON package_unit.installation_id = packaging.installation_id
            AND package_unit.id = packaging.unit_id
          WHERE packaging.installation_id = base.installation_id
            AND packaging.product_id = base.product_id
            AND packaging.id <> base.id
            AND packaging.is_active = true
            AND packaging.conversion_to_base IS NOT NULL
            AND packaging.conversion_to_base > 1
          ORDER BY CASE WHEN package_unit.unit_kind = 'PACKAGE' THEN 0 ELSE 1 END,
                   packaging.conversion_to_base DESC,
                   packaging.sku ASC
          LIMIT 1
       ) package_variant ON true
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = balance.installation_id
        AND lot.id = balance.lot_id
      WHERE balance.installation_id = $1
        AND ($2::uuid IS NULL OR balance.warehouse_id = $2)
        AND ($3::uuid IS NULL OR balance.base_variant_id = $3)
        AND ($4::uuid IS NULL OR balance.lot_id IS NOT DISTINCT FROM $4)
      ORDER BY balance.warehouse_id, balance.location_id NULLS FIRST, balance.base_variant_id, balance.lot_id NULLS FIRST
      LIMIT $5 OFFSET $6`,
    [installationId, warehouseId, baseVariantId, lotId, limit, offset],
  );
  return (result.rows ?? []).map(presentInventoryBalance);
}

export async function reconcileInventoryBalances(client, { installationId }) {
  const result = await client.query(
    `WITH ledger AS (
       SELECT line.installation_id,
              line.warehouse_id,
              line.location_id,
              line.base_variant_id,
              line.lot_id,
              sum(line.base_quantity_delta)::numeric(30,12) AS ledger_quantity,
              count(DISTINCT line.movement_id)::bigint AS movement_count,
              max(movement.posted_at) AS latest_movement_at
         FROM inventory.inventory_movement_lines line
         JOIN inventory.inventory_movements movement
           ON movement.installation_id = line.installation_id
          AND movement.id = line.movement_id
        WHERE line.installation_id = $1
        GROUP BY line.installation_id,
                 line.warehouse_id,
                 line.location_id,
                 line.base_variant_id,
                 line.lot_id
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
            (
              COALESCE(ledger.ledger_quantity, 0::numeric)
              - COALESCE(projected.projected_quantity, 0::numeric)
            )::numeric(30,12) AS difference,
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
      `INSERT INTO inventory.inventory_balances (
         installation_id,
         warehouse_id,
         location_id,
         base_variant_id,
         lot_id,
         on_hand_quantity,
         reserved_quantity,
         projected_through,
         updated_at
       )
       SELECT line.installation_id,
              line.warehouse_id,
              line.location_id,
              line.base_variant_id,
              line.lot_id,
              sum(line.base_quantity_delta)::numeric(30,12),
              0::numeric(30,12),
              max(movement.posted_at),
              now()
         FROM inventory.inventory_movement_lines line
         JOIN inventory.inventory_movements movement
           ON movement.installation_id = line.installation_id
          AND movement.id = line.movement_id
        WHERE line.installation_id = $1
        GROUP BY line.installation_id,
                 line.warehouse_id,
                 line.location_id,
                 line.base_variant_id,
                 line.lot_id
       RETURNING installation_id, warehouse_id, location_id, base_variant_id, lot_id,
                 on_hand_quantity, reserved_quantity, available_quantity,
                 projected_through, updated_at`,
      [installationId],
    );
  return (inserted.rows ?? []).map(presentInventoryBalance);
  });
}

export async function listInventoryMovementDrillDown(client, {
  installationId,
  warehouseId,
  locationId = null,
  baseVariantId,
  lotId = null,
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
            line.lot_id,
            line.lot_code,
            line.expiry_date,
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
        AND ($5::uuid IS NULL OR line.lot_id IS NOT DISTINCT FROM $5)
      ORDER BY movement.posted_at DESC, movement.id DESC, line.line_number
      LIMIT $6 OFFSET $7`,
    [installationId, warehouseId, locationId, baseVariantId, lotId, limit, offset],
  );
  return (result.rows ?? []).map((row) => ({
    ...row,
    document_date: toLocalDateOnly(row.document_date),
    posted_at: row.posted_at instanceof Date ? row.posted_at.toISOString() : row.posted_at,
    expiry_date: toLocalDateOnly(row.expiry_date),
  }));
}

export async function listInventoryMovementHistory(client, {
  installationId,
  warehouseId,
  locationId = null,
  baseVariantId,
  lotId = null,
  scopeMode = 'exact',
  limit = 51,
  offset = 0,
}) {
  const result = await client.query(
    `WITH movement_history AS (
       SELECT movement.id AS movement_id,
              movement.movement_type,
              movement.source_domain,
              movement.source_document_type,
              movement.source_document_id,
              movement.source_document_number,
              movement.document_number,
              movement.document_date,
              movement.posted_at,
              movement.posted_by,
              movement.reason_code,
              movement.reason_note,
              movement.reversal_of_movement_id,
              line.warehouse_id,
              warehouse.code AS warehouse_code,
              warehouse.name AS warehouse_name,
              line.base_variant_id,
              max(line.base_sku) AS base_sku,
              sum(line.base_quantity_delta)::numeric(30,12) AS base_quantity_delta,
              count(*)::int AS line_count,
              max(actor_employee.full_name) AS posted_by_name,
              string_agg(
                DISTINCT COALESCE(location.code, 'Không vị trí'),
                ', ' ORDER BY COALESCE(location.code, 'Không vị trí')
              ) AS location_summary,
              string_agg(
                DISTINCT COALESCE(line.lot_code, 'Không lô'),
                ', ' ORDER BY COALESCE(line.lot_code, 'Không lô')
              ) AS lot_summary
         FROM inventory.inventory_movement_lines line
         JOIN inventory.inventory_movements movement
           ON movement.installation_id = line.installation_id
          AND movement.id = line.movement_id
         JOIN shared.warehouses warehouse
           ON warehouse.installation_id = line.installation_id
          AND warehouse.id = line.warehouse_id
         LEFT JOIN shared.warehouse_locations location
           ON location.installation_id = line.installation_id
          AND location.warehouse_id = line.warehouse_id
          AND location.id = line.location_id
         LEFT JOIN shared.users actor_user
           ON actor_user.installation_id = movement.installation_id
          AND ('user:' || actor_user.id::text) = movement.posted_by
         LEFT JOIN shared.employees actor_employee
           ON actor_employee.installation_id = actor_user.installation_id
          AND actor_employee.id = actor_user.employee_id
        WHERE line.installation_id = $1
          AND line.warehouse_id = $2
          AND line.base_variant_id = $3
          AND (
            $6::text = 'warehouse'
            OR (
              line.location_id IS NOT DISTINCT FROM $4::uuid
              AND line.lot_id IS NOT DISTINCT FROM $5::uuid
            )
          )
        GROUP BY movement.id,
                 movement.movement_type,
                 movement.source_domain,
                 movement.source_document_type,
                 movement.source_document_id,
                 movement.source_document_number,
                 movement.document_number,
                 movement.document_date,
                 movement.posted_at,
                 movement.posted_by,
                 movement.reason_code,
                 movement.reason_note,
                 movement.reversal_of_movement_id,
                 line.warehouse_id,
                 warehouse.code,
                 warehouse.name,
                 line.base_variant_id
     ), sequenced AS (
       SELECT history.*,
              sum(history.base_quantity_delta) OVER (
                ORDER BY history.posted_at ASC, history.movement_id ASC
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              )::numeric(30,12) AS stock_after
         FROM movement_history history
     )
     SELECT *
       FROM sequenced
      ORDER BY posted_at DESC, movement_id DESC
      LIMIT $7 OFFSET $8`,
    [installationId, warehouseId, baseVariantId, locationId, lotId, scopeMode, limit, offset],
  );
  return (result.rows ?? []).map(presentInventoryMovementHistory);
}
