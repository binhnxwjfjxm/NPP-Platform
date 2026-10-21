import * as fulfillmentRepository from '../db/repositories/sales-fulfillment.js';
import { listWarehouseBusinessHoldSummary } from './inventory-business-holds.js';
import { parseHoldQuantity, reconcileDemandHold } from './sales-fulfillment-hold.js';

// Stock movements own physical quantity. This service promotes existing confirmed
// demand from waiting to held; it does not create inventory, allocations or sales lines.
export function inboundScopesFromMovementLines(lines) {
  const scopes = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const direction = String(line?.direction ?? '').toUpperCase();
    const quantity = parseHoldQuantity(line?.base_quantity_delta ?? line?.baseQuantityDelta);
    if (direction !== 'IN' || quantity === null || quantity <= 0n) continue;
    const warehouseId = line?.warehouse_id ?? line?.warehouseId;
    const baseVariantId = line?.base_variant_id ?? line?.baseVariantId;
    if (!warehouseId || !baseVariantId) continue;
    scopes.set(`${warehouseId}:${baseVariantId}`, { warehouseId, baseVariantId });
  }
  return [...scopes.values()].sort((a, b) =>
    a.warehouseId.localeCompare(b.warehouseId) ||
    a.baseVariantId.localeCompare(b.baseVariantId));
}

export async function replenishPendingHoldScopes(client, {
  installationId, actorId, scopes,
}) {
  const orderedScopes = [...new Map((scopes ?? []).map((scope) => [
    `${scope.warehouseId}:${scope.baseVariantId}`, scope,
  ])).values()].sort((a, b) =>
    a.warehouseId.localeCompare(b.warehouseId) ||
    a.baseVariantId.localeCompare(b.baseVariantId));

  let updatedLines = 0;
  for (const { warehouseId, baseVariantId } of orderedScopes) {
    await fulfillmentRepository.lockFulfillmentScope(client, {
      installationId, warehouseId, baseVariantId,
    });
    // Oldest confirmed demand first. Never take existing holds away from another order.
    const pending = await client.query(
      `SELECT demand.id
         FROM sales.sales_order_fulfillment_demands demand
         JOIN sales.sales_orders orders
           ON orders.installation_id = demand.installation_id
          AND orders.id = demand.sales_order_id
        WHERE demand.installation_id = $1
          AND demand.warehouse_id = $2
          AND demand.base_variant_id = $3
          AND demand.state = 'ACTIVE'
          AND orders.status = 'confirmed'
          AND demand.backordered_base_quantity > 0
          AND demand.picked_base_quantity = 0
          AND demand.packed_base_quantity = 0
          AND demand.issued_base_quantity = 0
        ORDER BY orders.confirmed_at ASC NULLS LAST,
                 orders.created_at ASC, demand.created_at ASC,
                 demand.line_number ASC, demand.id ASC`,
      [installationId, warehouseId, baseVariantId],
    );
    for (const item of pending.rows) {
      const balances = await listWarehouseBusinessHoldSummary(client, {
        installationId,
        warehouseIds: [warehouseId],
        warehouseId,
        baseVariantId,
      });
      const available = parseHoldQuantity(balances[0]?.availableBaseQuantity ?? '0');
      if (available === null) throw new Error('FULFILLMENT_REPLENISHMENT_AVAILABILITY_INVALID');
      if (available <= 0n) break;
      // Reuse the canonical guard and quantity reconciliation, under the same
      // transaction and warehouse/SKU advisory lock as Sales confirmation.
      const result = await reconcileDemandHold(client, {
        installationId, demandId: item.id, actorId,
      });
      if (!result.ok) throw new Error(`FULFILLMENT_REPLENISHMENT_FAILED:${result.code}`);
      updatedLines += 1;
    }
  }
  return Object.freeze({ updatedLines });
}

export async function replenishAfterPostedMovement(client, {
  installationId, actorId, lines,
}) {
  const scopes = inboundScopesFromMovementLines(lines);
  if (scopes.length === 0) return Object.freeze({ updatedLines: 0 });
  return replenishPendingHoldScopes(client, { installationId, actorId, scopes });
}
