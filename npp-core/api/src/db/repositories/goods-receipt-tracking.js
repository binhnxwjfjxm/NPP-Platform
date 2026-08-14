export async function listPurchaseOrderTrackingRequirements(client, { installationId, purchaseOrderId }) {
  const result = await client.query(
    `SELECT pol.id AS purchase_order_line_id,
            pol.line_number,
            pol.variant_id AS source_variant_id,
            pol.sku_snapshot,
            base.id AS base_variant_id,
            policy.lot_tracking_mode,
            policy.expiry_tracking_mode,
            policy.location_required
       FROM purchasing.purchase_order_lines pol
       JOIN shared.product_variants source
         ON source.installation_id = pol.installation_id
        AND source.id = pol.variant_id
       LEFT JOIN shared.product_variants base
         ON base.installation_id = source.installation_id
        AND base.product_id = source.product_id
        AND base.is_inventory_base = true
        AND base.is_active = true
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = pol.installation_id
        AND policy.base_variant_id = base.id
      WHERE pol.installation_id = $1
        AND pol.purchase_order_id = $2
      ORDER BY pol.line_number ASC`,
    [installationId, purchaseOrderId],
  );
  return result.rows ?? [];
}
