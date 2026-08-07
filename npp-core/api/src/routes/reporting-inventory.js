import {
  BUSINESS_TIMEZONE,
  mapRow,
  mapRows,
  reportingInternals,
} from './reporting-common.js';

const SLOW_DAYS_MIN = 30;
const SLOW_DAYS_MAX = 365;
const DEFAULT_SLOW_DAYS = 90;

export function normalizeSlowDays(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_SLOW_DAYS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < SLOW_DAYS_MIN || parsed > SLOW_DAYS_MAX) {
    return null;
  }
  return parsed;
}

function currentBusinessDate(receivedAt) {
  return reportingInternals.businessDateNow(new Date(receivedAt));
}

export async function inventoryReport(
  adapter,
  requestContext,
  filters,
  warehouseIds,
  slowDays = DEFAULT_SLOW_DAYS,
) {
  const currentDate = currentBusinessDate(requestContext.receivedAt);
  const params = [
    requestContext.installationId,
    warehouseIds,
    filters.from,
    filters.to,
    filters.warehouseId,
    currentDate,
    slowDays,
  ];

  const periodScope = `
    FROM inventory.inventory_movements movement
    JOIN inventory.inventory_movement_lines line
      ON line.installation_id = movement.installation_id
     AND line.movement_id = movement.id
    JOIN shared.warehouses warehouse
      ON warehouse.installation_id = line.installation_id
     AND warehouse.id = line.warehouse_id
    JOIN shared.product_variants variant
      ON variant.installation_id = line.installation_id
     AND variant.id = line.base_variant_id
    WHERE movement.installation_id = $1
      AND line.warehouse_id = ANY($2::uuid[])
      AND movement.document_date <= $4::date
      AND ($5::uuid IS NULL OR line.warehouse_id = $5::uuid)`;

  const currentStockCte = `
    WITH stock AS (
      SELECT
        balance.warehouse_id,
        balance.base_variant_id,
        sum(balance.on_hand_quantity) AS on_hand_quantity,
        sum(balance.reserved_quantity) AS reserved_quantity,
        sum(balance.available_quantity) AS available_quantity,
        max(balance.projected_through) AS projected_through
      FROM inventory.inventory_balances balance
      WHERE balance.installation_id = $1
        AND balance.warehouse_id = ANY($2::uuid[])
        AND ($5::uuid IS NULL OR balance.warehouse_id = $5::uuid)
      GROUP BY balance.warehouse_id, balance.base_variant_id
    ), cost AS (
      SELECT
        balance.warehouse_id,
        balance.base_variant_id,
        balance.currency_code,
        balance.quantity AS costing_quantity,
        balance.inventory_value,
        balance.average_unit_cost,
        balance.status AS costing_status,
        balance.anomaly_count,
        balance.updated_at AS costing_updated_at
      FROM inventory.inventory_cost_balances balance
      WHERE balance.installation_id = $1
        AND balance.warehouse_id = ANY($2::uuid[])
        AND ($5::uuid IS NULL OR balance.warehouse_id = $5::uuid)
    )`;

  const [
    periodFlow,
    movementTypes,
    currentSummary,
    warehouseSummary,
    currentPositions,
    slowMoving,
    expiryLots,
    exceptions,
    projectionState,
  ] = await Promise.all([
    adapter.query(
      `SELECT
         line.warehouse_id,
         warehouse.code AS warehouse_code,
         warehouse.name AS warehouse_name,
         line.base_variant_id AS variant_id,
         variant.sku,
         COALESCE(sum(line.base_quantity_delta) FILTER (
           WHERE movement.document_date < $3::date
         ), 0::numeric)::text AS opening_quantity,
         COALESCE(sum(line.base_quantity_delta) FILTER (
           WHERE movement.document_date BETWEEN $3::date AND $4::date
             AND line.direction = 'IN'
         ), 0::numeric)::text AS inbound_quantity,
         COALESCE(-sum(line.base_quantity_delta) FILTER (
           WHERE movement.document_date BETWEEN $3::date AND $4::date
             AND line.direction = 'OUT'
         ), 0::numeric)::text AS outbound_quantity,
         COALESCE(sum(line.base_quantity_delta), 0::numeric)::text AS closing_quantity,
         count(*) FILTER (
           WHERE movement.document_date BETWEEN $3::date AND $4::date
         )::text AS movement_line_count,
         max(movement.posted_at) FILTER (
           WHERE movement.document_date BETWEEN $3::date AND $4::date
         ) AS last_posted_at
       ${periodScope}
       GROUP BY line.warehouse_id, warehouse.code, warehouse.name,
                line.base_variant_id, variant.sku
       HAVING COALESCE(sum(line.base_quantity_delta), 0::numeric) <> 0
           OR count(*) FILTER (
             WHERE movement.document_date BETWEEN $3::date AND $4::date
           ) > 0
       ORDER BY greatest(
         abs(COALESCE(sum(line.base_quantity_delta) FILTER (
           WHERE movement.document_date BETWEEN $3::date AND $4::date AND line.direction = 'IN'
         ), 0::numeric)),
         abs(COALESCE(sum(line.base_quantity_delta) FILTER (
           WHERE movement.document_date BETWEEN $3::date AND $4::date AND line.direction = 'OUT'
         ), 0::numeric)),
         abs(COALESCE(sum(line.base_quantity_delta), 0::numeric))
       ) DESC,
       warehouse.code, variant.sku
       LIMIT 100`,
      params,
    ),
    adapter.query(
      `SELECT
         movement.movement_type,
         count(DISTINCT movement.id)::text AS movement_count,
         count(*)::text AS movement_line_count,
         count(DISTINCT line.base_variant_id)::text AS sku_count
       ${periodScope}
         AND movement.document_date >= $3::date
       GROUP BY movement.movement_type
       ORDER BY movement_count::bigint DESC, movement.movement_type`,
      params,
    ),
    adapter.query(
      `${currentStockCte}, lot_scopes AS (
         SELECT count(*)::text AS lot_scope_count
         FROM inventory.inventory_balances balance
         WHERE balance.installation_id = $1
           AND balance.warehouse_id = ANY($2::uuid[])
           AND ($5::uuid IS NULL OR balance.warehouse_id = $5::uuid)
           AND balance.lot_id IS NOT NULL
           AND balance.on_hand_quantity > 0
       )
       SELECT
         count(*) FILTER (WHERE stock.on_hand_quantity > 0)::text AS stock_position_count,
         count(DISTINCT stock.base_variant_id) FILTER (WHERE stock.on_hand_quantity > 0)::text AS stocked_sku_count,
         count(*) FILTER (WHERE stock.reserved_quantity > 0)::text AS reserved_position_count,
         COALESCE((SELECT lot_scope_count FROM lot_scopes), '0') AS lot_scope_count,
         COALESCE(sum(cost.inventory_value) FILTER (
           WHERE cost.costing_status = 'COSTED'
         ), 0::numeric)::text AS inventory_value_vnd,
         count(*) FILTER (
           WHERE cost.costing_status IS DISTINCT FROM 'COSTED'
              OR round(COALESCE(cost.costing_quantity, 0::numeric) - stock.on_hand_quantity, 12) <> 0
         )::text AS costing_exception_count
       FROM stock
       LEFT JOIN cost
         ON cost.warehouse_id = stock.warehouse_id
        AND cost.base_variant_id = stock.base_variant_id`,
      params,
    ),
    adapter.query(
      `${currentStockCte}
       SELECT
         stock.warehouse_id,
         warehouse.code AS warehouse_code,
         warehouse.name AS warehouse_name,
         count(*) FILTER (WHERE stock.on_hand_quantity > 0)::text AS stocked_sku_count,
         count(*) FILTER (WHERE stock.reserved_quantity > 0)::text AS reserved_sku_count,
         COALESCE(sum(cost.inventory_value) FILTER (
           WHERE cost.costing_status = 'COSTED'
         ), 0::numeric)::text AS inventory_value_vnd,
         count(*) FILTER (
           WHERE cost.costing_status IS DISTINCT FROM 'COSTED'
              OR round(COALESCE(cost.costing_quantity, 0::numeric) - stock.on_hand_quantity, 12) <> 0
         )::text AS costing_exception_count,
         max(stock.projected_through) AS quantity_projected_through,
         max(cost.costing_updated_at) AS costing_updated_at
       FROM stock
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = $1
        AND warehouse.id = stock.warehouse_id
       LEFT JOIN cost
         ON cost.warehouse_id = stock.warehouse_id
        AND cost.base_variant_id = stock.base_variant_id
       GROUP BY stock.warehouse_id, warehouse.code, warehouse.name
       ORDER BY warehouse.code`,
      params,
    ),
    adapter.query(
      `${currentStockCte}
       SELECT
         stock.warehouse_id,
         warehouse.code AS warehouse_code,
         warehouse.name AS warehouse_name,
         stock.base_variant_id AS variant_id,
         variant.sku,
         stock.on_hand_quantity::text,
         stock.reserved_quantity::text,
         stock.available_quantity::text,
         cost.costing_quantity::text,
         cost.currency_code,
         cost.inventory_value::text,
         cost.average_unit_cost::text,
         COALESCE(cost.costing_status, 'ANOMALY') AS costing_status,
         COALESCE(cost.anomaly_count, 0)::text AS anomaly_count,
         stock.projected_through
       FROM stock
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = $1
        AND warehouse.id = stock.warehouse_id
       JOIN shared.product_variants variant
         ON variant.installation_id = $1
        AND variant.id = stock.base_variant_id
       LEFT JOIN cost
         ON cost.warehouse_id = stock.warehouse_id
        AND cost.base_variant_id = stock.base_variant_id
       WHERE stock.on_hand_quantity <> 0 OR stock.reserved_quantity <> 0
       ORDER BY cost.inventory_value DESC NULLS LAST,
                abs(stock.available_quantity) DESC,
                warehouse.code,
                variant.sku
       LIMIT 100`,
      params,
    ),
    adapter.query(
      `${currentStockCte}, last_out AS (
         SELECT
           line.warehouse_id,
           line.base_variant_id,
           max(movement.document_date) AS last_out_date
         FROM inventory.inventory_movements movement
         JOIN inventory.inventory_movement_lines line
           ON line.installation_id = movement.installation_id
          AND line.movement_id = movement.id
         WHERE movement.installation_id = $1
           AND line.warehouse_id = ANY($2::uuid[])
           AND ($5::uuid IS NULL OR line.warehouse_id = $5::uuid)
           AND line.direction = 'OUT'
         GROUP BY line.warehouse_id, line.base_variant_id
       )
       SELECT
         stock.warehouse_id,
         warehouse.code AS warehouse_code,
         stock.base_variant_id AS variant_id,
         variant.sku,
         stock.on_hand_quantity::text,
         stock.reserved_quantity::text,
         stock.available_quantity::text,
         last_out.last_out_date::text,
         CASE
           WHEN last_out.last_out_date IS NULL THEN NULL
           ELSE ($6::date - last_out.last_out_date)::text
         END AS days_since_outbound,
         (last_out.last_out_date IS NULL) AS never_outbound,
         cost.inventory_value::text AS inventory_value_vnd
       FROM stock
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = $1
        AND warehouse.id = stock.warehouse_id
       JOIN shared.product_variants variant
         ON variant.installation_id = $1
        AND variant.id = stock.base_variant_id
       LEFT JOIN last_out
         ON last_out.warehouse_id = stock.warehouse_id
        AND last_out.base_variant_id = stock.base_variant_id
       LEFT JOIN cost
         ON cost.warehouse_id = stock.warehouse_id
        AND cost.base_variant_id = stock.base_variant_id
       WHERE stock.on_hand_quantity > 0
         AND (last_out.last_out_date IS NULL OR last_out.last_out_date < ($6::date - $7::int))
       ORDER BY cost.inventory_value DESC NULLS LAST,
                last_out.last_out_date ASC NULLS FIRST,
                warehouse.code,
                variant.sku
       LIMIT 100`,
      params,
    ),
    adapter.query(
      `SELECT
         balance.warehouse_id,
         warehouse.code AS warehouse_code,
         balance.base_variant_id AS variant_id,
         variant.sku,
         balance.lot_id,
         lot.lot_code,
         lot.manufactured_date::text,
         lot.expiry_date::text,
         sum(balance.on_hand_quantity)::text AS on_hand_quantity,
         sum(balance.reserved_quantity)::text AS reserved_quantity,
         sum(balance.available_quantity)::text AS available_quantity,
         CASE
           WHEN lot.manufactured_date IS NULL THEN NULL
           ELSE ($6::date - lot.manufactured_date)::text
         END AS manufactured_age_days,
         CASE
           WHEN lot.expiry_date IS NULL THEN NULL
           ELSE (lot.expiry_date - $6::date)::text
         END AS days_to_expiry,
         CASE
           WHEN lot.expiry_date IS NULL THEN 'NO_EXPIRY'
           WHEN lot.expiry_date < $6::date THEN 'EXPIRED'
           WHEN lot.expiry_date <= ($6::date + 30) THEN 'EXPIRING_30_DAYS'
           WHEN lot.expiry_date <= ($6::date + 90) THEN 'EXPIRING_90_DAYS'
           ELSE 'ACTIVE'
         END AS expiry_bucket
       FROM inventory.inventory_balances balance
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = balance.installation_id
        AND warehouse.id = balance.warehouse_id
       JOIN shared.product_variants variant
         ON variant.installation_id = balance.installation_id
        AND variant.id = balance.base_variant_id
       JOIN inventory.inventory_lots lot
         ON lot.installation_id = balance.installation_id
        AND lot.id = balance.lot_id
       WHERE balance.installation_id = $1
         AND balance.warehouse_id = ANY($2::uuid[])
         AND ($5::uuid IS NULL OR balance.warehouse_id = $5::uuid)
         AND balance.lot_id IS NOT NULL
         AND balance.on_hand_quantity > 0
       GROUP BY balance.warehouse_id, warehouse.code, balance.base_variant_id,
                variant.sku, balance.lot_id, lot.lot_code,
                lot.manufactured_date, lot.expiry_date
       ORDER BY lot.expiry_date ASC NULLS LAST, warehouse.code, variant.sku, lot.lot_code
       LIMIT 100`,
      params,
    ),
    adapter.query(
      `SELECT
         reconciliation.warehouse_id,
         reconciliation.warehouse_code,
         reconciliation.warehouse_name,
         reconciliation.base_variant_id AS variant_id,
         reconciliation.base_sku AS sku,
         reconciliation.ledger_quantity::text,
         reconciliation.costing_quantity::text,
         reconciliation.quantity_difference::text,
         reconciliation.inventory_value::text AS inventory_value_vnd,
         reconciliation.average_unit_cost::text,
         reconciliation.costing_status,
         reconciliation.anomaly_count::text,
         reconciliation.reconciliation_status
       FROM inventory.inventory_cost_reconciliation reconciliation
       WHERE reconciliation.installation_id = $1
         AND reconciliation.warehouse_id = ANY($2::uuid[])
         AND ($5::uuid IS NULL OR reconciliation.warehouse_id = $5::uuid)
         AND reconciliation.reconciliation_status <> 'OK'
       ORDER BY reconciliation.warehouse_code, reconciliation.base_sku
       LIMIT 100`,
      params,
    ),
    adapter.query(
      `WITH ledger AS (
         SELECT max(movement.posted_at) AS ledger_through
         FROM inventory.inventory_movements movement
         JOIN inventory.inventory_movement_lines line
           ON line.installation_id = movement.installation_id
          AND line.movement_id = movement.id
         WHERE movement.installation_id = $1
           AND line.warehouse_id = ANY($2::uuid[])
           AND ($5::uuid IS NULL OR line.warehouse_id = $5::uuid)
       ), quantity_projection AS (
         SELECT max(balance.projected_through) AS quantity_projected_through
         FROM inventory.inventory_balances balance
         WHERE balance.installation_id = $1
           AND balance.warehouse_id = ANY($2::uuid[])
           AND ($5::uuid IS NULL OR balance.warehouse_id = $5::uuid)
       ), costing AS (
         SELECT max(latest.completed_at) AS costing_projected_through
         FROM inventory.inventory_cost_latest_runs latest
         WHERE latest.installation_id = $1
       )
       SELECT
         ledger.ledger_through,
         quantity_projection.quantity_projected_through,
         costing.costing_projected_through,
         CASE
           WHEN ledger.ledger_through IS NULL THEN false
           WHEN quantity_projection.quantity_projected_through IS NULL THEN true
           ELSE quantity_projection.quantity_projected_through < ledger.ledger_through
         END AS quantity_projection_stale
       FROM ledger, quantity_projection, costing`,
      params,
    ),
  ]);

  return Object.freeze({
    family: 'inventory',
    generatedAt: requestContext.receivedAt,
    timezone: BUSINESS_TIMEZONE,
    currentDate,
    filters: Object.freeze({
      from: filters.from,
      to: filters.to,
      warehouseId: filters.warehouseId,
      slowDays,
    }),
    basis: Object.freeze({
      quantityTruth: 'inventory.inventory_movements + inventory.inventory_movement_lines (append-only)',
      currentAvailability: 'inventory.inventory_balances (rebuildable projector)',
      currentValue: 'inventory.inventory_cost_balances MWA_V1, VND (rebuildable projector)',
      lotAge: 'inventory.inventory_lots.manufactured_date when present; no guessed FIFO age for non-lot MWA stock',
      slowMoving: `current positive stock with no OUT movement in the last ${slowDays} business-calendar days`,
    }),
    summary: mapRow(currentSummary.rows?.[0] ?? {}),
    periodFlow: mapRows(periodFlow.rows),
    movementTypes: mapRows(movementTypes.rows),
    warehouseSummary: mapRows(warehouseSummary.rows),
    currentPositions: mapRows(currentPositions.rows),
    slowMoving: mapRows(slowMoving.rows),
    expiryLots: mapRows(expiryLots.rows),
    exceptions: mapRows(exceptions.rows),
    projectionState: mapRow(projectionState.rows?.[0] ?? {}),
  });
}

export const inventoryReportingInternals = Object.freeze({
  DEFAULT_SLOW_DAYS,
  SLOW_DAYS_MIN,
  SLOW_DAYS_MAX,
  normalizeSlowDays,
});
