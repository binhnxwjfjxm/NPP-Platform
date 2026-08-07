import { failure, warehouseIds } from './inventory-costing-period-utils.js';

function mapDiscrepancy(row) {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku ?? null,
    inventoryMovementId: row.inventory_movement_id ?? null,
    inventoryMovementLineId: row.inventory_movement_line_id ?? null,
    costAdjustmentEventId: row.cost_adjustment_event_id ?? null,
    periodId: row.period_id ?? null,
    stableKey: row.stable_key,
    message: row.message,
    details: row.details ?? {},
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at ?? null,
  };
}

export async function listDiscrepancies(client, requestContext) {
  const scoped = warehouseIds(requestContext);
  if (!scoped.length) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  }
  const result = await client.query(
    `SELECT discrepancy.*,warehouse.code AS warehouse_code,variant.sku AS base_sku
       FROM inventory.inventory_cost_discrepancies discrepancy
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id=discrepancy.installation_id
        AND warehouse.id=discrepancy.warehouse_id
       JOIN shared.product_variants variant
         ON variant.installation_id=discrepancy.installation_id
        AND variant.id=discrepancy.base_variant_id
      WHERE discrepancy.installation_id=$1 AND discrepancy.warehouse_id=ANY($2::uuid[])
      ORDER BY (discrepancy.status='OPEN') DESC,discrepancy.last_seen_at DESC LIMIT 500`,
    [requestContext.installationId, scoped],
  );
  return { ok: true, discrepancies: (result.rows ?? []).map(mapDiscrepancy) };
}
