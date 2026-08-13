export async function listFulfillmentOrderTotals(client, {
  installationId,
  salesOrderVersionIds,
}) {
  const versionIds = [...new Set(
    (Array.isArray(salesOrderVersionIds) ? salesOrderVersionIds : [])
      .filter((value) => typeof value === 'string' && value.length > 0),
  )];
  if (versionIds.length === 0) return [];

  const result = await client.query(
    `SELECT
       version.id AS sales_order_version_id,
       version.subtotal::text AS order_subtotal,
       version.discount_total::text AS order_discount_total,
       version.tax_total::text AS order_tax_total,
       version.total::text AS order_total,
       version.sales_channel_code_snapshot,
       version.sales_channel_name_snapshot
      FROM sales.sales_order_versions version
     WHERE version.installation_id = $1
       AND version.id = ANY($2::uuid[])`,
    [installationId, versionIds],
  );
  return result.rows;
}
