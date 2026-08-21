const POLICY_COLUMNS = `p.id, p.code, p.name, p.is_inventory_managed, p.updated_at`;

export async function listProductInventoryPolicies(client, { installationId }) {
  const result = await client.query(
    `SELECT ${POLICY_COLUMNS}
     FROM shared.products p
     WHERE p.installation_id = $1
     ORDER BY p.code ASC`,
    [installationId],
  );
  return result.rows;
}

export async function getProductInventoryPolicy(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${POLICY_COLUMNS}
     FROM shared.products p
     WHERE p.installation_id = $1 AND p.id = $2`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getProductInventoryPolicyForUpdate(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${POLICY_COLUMNS}
     FROM shared.products p
     WHERE p.installation_id = $1 AND p.id = $2
     FOR UPDATE`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getProductInventoryPolicyBlockers(client, { installationId, productId }) {
  const balanceResult = await client.query(
    `SELECT COALESCE(SUM(abs(balance.on_hand_quantity)), 0::numeric) AS on_hand_quantity,
            COALESCE(SUM(balance.reserved_quantity), 0::numeric) AS reserved_quantity
     FROM inventory.inventory_balances balance
     JOIN shared.product_variants variant
       ON variant.installation_id = balance.installation_id
      AND variant.id = balance.base_variant_id
     WHERE balance.installation_id = $1
       AND variant.product_id = $2`,
    [installationId, productId],
  );
  const demandResult = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM sales.sales_order_fulfillment_demands demand
     JOIN shared.product_variants variant
       ON variant.installation_id = demand.installation_id
      AND variant.id = demand.base_variant_id
     WHERE demand.installation_id = $1
       AND variant.product_id = $2
       AND demand.state = 'ACTIVE'`,
    [installationId, productId],
  );
  const purchaseResult = await client.query(
    `SELECT COUNT(DISTINCT purchase_order.id)::int AS count
     FROM purchasing.purchase_orders purchase_order
     JOIN purchasing.purchase_order_lines line
       ON line.installation_id = purchase_order.installation_id
      AND line.purchase_order_id = purchase_order.id
     JOIN shared.product_variants variant
       ON variant.installation_id = line.installation_id
      AND variant.id = line.variant_id
     WHERE purchase_order.installation_id = $1
       AND variant.product_id = $2
       AND purchase_order.status IN ('draft', 'pending_approval', 'approved', 'partially_received')`,
    [installationId, productId],
  );
  const balance = balanceResult.rows[0] ?? {};
  return Object.freeze({
    onHandQuantity: String(balance.on_hand_quantity ?? '0'),
    reservedQuantity: String(balance.reserved_quantity ?? '0'),
    activeFulfillmentDemandCount: Number(demandResult.rows[0]?.count ?? 0),
    openPurchaseOrderCount: Number(purchaseResult.rows[0]?.count ?? 0),
  });
}

export async function countActiveInventoryBaseVariants(client, { installationId, productId }) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM shared.product_variants
     WHERE installation_id = $1
       AND product_id = $2
       AND is_active = true
       AND is_inventory_base = true`,
    [installationId, productId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function updateProductInventoryPolicy(client, {
  installationId,
  id,
  isInventoryManaged,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.products
     SET is_inventory_managed = $1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $2
     WHERE installation_id = $3
       AND id = $4
       AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $5::timestamptz)
     RETURNING id`,
    [isInventoryManaged, updatedBy, installationId, id, expectedUpdatedAt],
  );
  if (!result.rows[0]) return null;
  return getProductInventoryPolicy(client, { installationId, id });
}
