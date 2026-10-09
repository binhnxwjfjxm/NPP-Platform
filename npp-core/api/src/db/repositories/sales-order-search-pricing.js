export async function listSalesOrderSearchPriceCandidates(client, {
  installationId,
  variantIds,
  currencyCode,
  priceAt,
  quantity,
  channelId,
  customerGroupId,
  customerId,
}) {
  const ids = [...new Set(Array.isArray(variantIds) ? variantIds : [])];
  if (ids.length === 0) return [];
  const result = await client.query(
    `SELECT
       pi.variant_id,
       pi.id AS item_id, pi.adjustment_type, pi.amount_minor, pi.rate_bps,
       pi.min_quantity, pi.max_quantity, pi.source_kind, pi.source_key, pi.external_rule_code,
       pl.id AS price_list_id, pl.code AS price_list_code, pl.name AS price_list_name,
       pl.list_type, pl.priority, pl.stacking_mode, pl.stop_processing,
       pl.channel_id, pl.customer_group_id, pl.customer_id
     FROM shared.price_list_items pi
     JOIN shared.price_lists pl
       ON pl.installation_id = pi.installation_id AND pl.id = pi.price_list_id
     WHERE pi.installation_id = $1
       AND pi.variant_id = ANY($2::uuid[])
       AND pl.currency_code = $3
       AND pl.is_active = true
       AND pi.is_active = true
       AND (pl.effective_from IS NULL OR pl.effective_from <= $4)
       AND (pl.effective_to IS NULL OR pl.effective_to > $4)
       AND (pi.effective_from IS NULL OR pi.effective_from <= $4)
       AND (pi.effective_to IS NULL OR pi.effective_to > $4)
       AND pi.min_quantity <= $5
       AND (pi.max_quantity IS NULL OR pi.max_quantity >= $5)
       AND (
         pl.list_type = 'BASE'
         OR (
           (pl.channel_id IS NULL OR pl.channel_id = $6)
           AND (pl.customer_group_id IS NULL OR pl.customer_group_id = $7)
           AND (pl.customer_id IS NULL OR pl.customer_id = $8)
         )
       )
     ORDER BY
       pi.variant_id,
       pl.priority DESC,
       CASE pl.list_type
         WHEN 'CUSTOM' THEN 6
         WHEN 'CUSTOMER' THEN 5
         WHEN 'PROMOTION' THEN 4
         WHEN 'CUSTOMER_GROUP' THEN 3
         WHEN 'CHANNEL' THEN 2
         WHEN 'BASE' THEN 1
         ELSE 0
       END DESC,
       COALESCE(pi.effective_from, pl.effective_from) DESC NULLS LAST,
       pi.created_at DESC,
       pi.id`,
    [
      installationId,
      ids,
      currencyCode,
      priceAt,
      quantity,
      channelId ?? null,
      customerGroupId ?? null,
      customerId ?? null,
    ],
  );
  return result.rows;
}
