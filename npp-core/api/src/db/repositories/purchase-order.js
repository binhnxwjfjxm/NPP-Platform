export * from './purchase-order-core.js';
import * as core from './purchase-order-core.js';

async function applyInventoryManagementPolicy(client, installationId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const productIds = [...new Set(rows.map((row) => row.product_id).filter(Boolean))];
  if (productIds.length === 0) return rows;
  const result = await client.query(
    `SELECT id, is_inventory_managed
     FROM shared.products
     WHERE installation_id = $1 AND id = ANY($2::uuid[])`,
    [installationId, productIds],
  );
  const managedByProduct = new Map(result.rows.map((row) => [row.id, row.is_inventory_managed === true]));
  return rows.map((row) => ({
    ...row,
    is_purchasable: row.is_purchasable === true && managedByProduct.get(row.product_id) === true,
  }));
}

export async function getPurchaseOrderVariantEligibility(client, input) {
  return applyInventoryManagementPolicy(
    client,
    input.installationId,
    await core.getPurchaseOrderVariantEligibility(client, input),
  );
}

export async function searchPurchaseOrderSkuOptions(client, input) {
  return applyInventoryManagementPolicy(
    client,
    input.installationId,
    await core.searchPurchaseOrderSkuOptions(client, input),
  );
}

export async function resolvePurchaseOrderSkuOptions(client, input) {
  return applyInventoryManagementPolicy(
    client,
    input.installationId,
    await core.resolvePurchaseOrderSkuOptions(client, input),
  );
}
