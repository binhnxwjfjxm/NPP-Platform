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

// Every warehouse/SKU lock must be acquired before demand and order row locks.
// Reentrant advisory transaction locks are safe if a caller already holds them.
export async function lockWarehouseStockScopes(client, { installationId, scopes }) {
  const canonical = [...new Map((scopes ?? [])
    .filter((scope) => scope?.warehouseId && scope?.baseVariantId)
    .map((scope) => [`${scope.warehouseId}:${scope.baseVariantId}`, scope])).values()]
    .sort((a, b) => a.warehouseId.localeCompare(b.warehouseId)
      || a.baseVariantId.localeCompare(b.baseVariantId));
  for (const scope of canonical) {
    await fulfillmentRepository.lockFulfillmentScope(client, {
      installationId, warehouseId: scope.warehouseId, baseVariantId: scope.baseVariantId,
    });
  }
  return canonical;
}

export async function lockOrderStockScopes(client, {
  installationId, salesOrderId, versionNumber = null,
}) {
  const result = await client.query(
    `WITH active_scopes AS (
       SELECT warehouse_id, base_variant_id
         FROM sales.sales_order_fulfillment_demands
        WHERE installation_id = $1 AND sales_order_id = $2
          AND state = 'ACTIVE'
     ), requested_scopes AS (
       SELECT version.warehouse_id, base_variant.id AS base_variant_id
         FROM sales.sales_order_versions version
         JOIN sales.sales_order_version_lines line
           ON line.installation_id = version.installation_id
          AND line.sales_order_version_id = version.id
         JOIN shared.product_variants sales_variant
           ON sales_variant.installation_id = line.installation_id
          AND sales_variant.id = line.variant_id
         JOIN shared.products product
           ON product.installation_id = sales_variant.installation_id
          AND product.id = sales_variant.product_id
         JOIN shared.product_variants base_variant
           ON base_variant.installation_id = sales_variant.installation_id
          AND base_variant.product_id = sales_variant.product_id
          AND base_variant.is_inventory_base = true
          AND base_variant.is_active = true
        WHERE version.installation_id = $1
          AND version.sales_order_id = $2
          AND version.version_number = $3
          AND product.is_inventory_managed = true
     )
     SELECT warehouse_id, base_variant_id FROM active_scopes
     UNION
     SELECT warehouse_id, base_variant_id FROM requested_scopes`,
    [installationId, salesOrderId, versionNumber],
  );
  return lockWarehouseStockScopes(client, {
    installationId,
    scopes: result.rows.map((row) => ({
      warehouseId: row.warehouse_id, baseVariantId: row.base_variant_id,
    })),
  });
}

export async function lockAllocationStockScope(client, { installationId, allocationId }) {
  // Read the immutable warehouse/SKU without a row lock, then acquire the
  // canonical advisory lock before any allocation FOR UPDATE.
  const result = await client.query(
    `SELECT warehouse_id, base_variant_id
       FROM sales.sales_order_fulfillment_allocations
      WHERE installation_id = $1 AND id = $2`,
    [installationId, allocationId],
  );
  const scope = result.rows?.[0] ?? null;
  if (!scope) return null;
  await lockWarehouseStockScopes(client, {
    installationId,
    scopes: [{
      warehouseId: scope.warehouse_id,
      baseVariantId: scope.base_variant_id,
    }],
  });
  return scope;
}

export async function lockPostedStockScopes(client, { installationId, lines }) {
  return lockWarehouseStockScopes(client, {
    installationId,
    scopes: (lines ?? []).map((line) => ({
      warehouseId: line?.warehouse_id ?? line?.warehouseId,
      baseVariantId: line?.base_variant_id ?? line?.baseVariantId,
    })),
  });
}

export async function replenishPendingHoldScopes(client, {
  installationId, actorId, scopes,
}) {
  const orderedScopes = await lockWarehouseStockScopes(client, { installationId, scopes });

  let updatedLines = 0;
  for (const { warehouseId, baseVariantId } of orderedScopes) {
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
