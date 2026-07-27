import { randomUUID } from 'node:crypto';

const CHANNEL_COLUMNS = 'id, installation_id, code, name, description, is_active, created_at, updated_at, created_by, updated_by';
const LIST_COLUMNS = `pl.id, pl.installation_id, pl.code, pl.name, pl.list_type, pl.currency_code,
  pl.channel_id, pl.customer_group_id, pl.customer_id, pl.priority, pl.stacking_mode,
  pl.stop_processing, pl.effective_from, pl.effective_to, pl.description, pl.is_active,
  pl.created_at, pl.updated_at, pl.created_by, pl.updated_by,
  sc.code AS channel_code, sc.name AS channel_name,
  cg.code AS customer_group_code, cg.name AS customer_group_name,
  c.code AS customer_code, c.name AS customer_name`;
const ITEM_COLUMNS = `pi.id, pi.installation_id, pi.price_list_id, pi.variant_id, pi.adjustment_type,
  pi.amount_minor, pi.rate_bps, pi.min_quantity, pi.max_quantity,
  pi.effective_from, pi.effective_to, pi.source_kind, pi.source_key, pi.external_rule_code,
  pi.note, pi.source_metadata, pi.is_active, pi.created_at, pi.updated_at, pi.created_by, pi.updated_by,
  pv.sku, pv.name AS variant_name, pv.product_id, p.code AS product_code, p.name AS product_name`;

function nowMilliseconds() {
  return new Date().toISOString();
}

export async function listSalesChannels(client, { installationId, search, active, limit = 200, offset = 0 }) {
  const params = [installationId];
  let query = `SELECT ${CHANNEL_COLUMNS} FROM shared.sales_channels WHERE installation_id = $1`;
  if (active !== undefined) {
    params.push(Boolean(active));
    query += ` AND is_active = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (code ILIKE $${params.length} OR name ILIKE $${params.length})`;
  }
  params.push(limit, offset);
  query += ` ORDER BY code LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getSalesChannelById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${CHANNEL_COLUMNS} FROM shared.sales_channels
     WHERE installation_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getSalesChannelByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${CHANNEL_COLUMNS} FROM shared.sales_channels WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );
  return result.rows[0] ?? null;
}

export async function insertSalesChannel(client, { installationId, code, name, description, isActive, createdBy }) {
  const id = randomUUID();
  const now = nowMilliseconds();
  const result = await client.query(
    `INSERT INTO shared.sales_channels
      (id, installation_id, code, name, description, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $8)
     ON CONFLICT DO NOTHING
     RETURNING ${CHANNEL_COLUMNS}`,
    [id, installationId, code, name, description, Boolean(isActive), now, createdBy],
  );
  return result.rows[0] ?? null;
}

export async function updateSalesChannel(client, { installationId, id, name, description, isActive, expectedUpdatedAt, updatedBy }) {
  const result = await client.query(
    `UPDATE shared.sales_channels
     SET name = $1, description = $2, is_active = $3,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $4
     WHERE installation_id = $5 AND id = $6
       AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $7::timestamptz)
     RETURNING ${CHANNEL_COLUMNS}`,
    [name, description, Boolean(isActive), updatedBy, installationId, id, expectedUpdatedAt],
  );
  return result.rows[0] ?? null;
}

export async function countActivePriceListsForChannel(client, { installationId, channelId }) {
  const result = await client.query(
    `SELECT count(*)::int AS count FROM shared.price_lists
     WHERE installation_id = $1 AND channel_id = $2 AND is_active = true`,
    [installationId, channelId],
  );
  return result.rows[0]?.count ?? 0;
}

function listJoin() {
  return `FROM shared.price_lists pl
    LEFT JOIN shared.sales_channels sc ON sc.installation_id = pl.installation_id AND sc.id = pl.channel_id
    LEFT JOIN shared.customer_groups cg ON cg.installation_id = pl.installation_id AND cg.id = pl.customer_group_id
    LEFT JOIN shared.customers c ON c.installation_id = pl.installation_id AND c.id = pl.customer_id`;
}

export async function listPriceLists(client, { installationId, search, active, listType, currencyCode, limit = 300, offset = 0 }) {
  const params = [installationId];
  let query = `SELECT ${LIST_COLUMNS} ${listJoin()} WHERE pl.installation_id = $1`;
  if (active !== undefined) {
    params.push(Boolean(active));
    query += ` AND pl.is_active = $${params.length}`;
  }
  if (listType) {
    params.push(listType);
    query += ` AND pl.list_type = $${params.length}`;
  }
  if (currencyCode) {
    params.push(currencyCode);
    query += ` AND pl.currency_code = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (pl.code ILIKE $${params.length} OR pl.name ILIKE $${params.length})`;
  }
  params.push(limit, offset);
  query += ` ORDER BY pl.priority DESC, pl.code LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getPriceListById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${LIST_COLUMNS} ${listJoin()}
     WHERE pl.installation_id = $1 AND pl.id = $2${forUpdate ? ' FOR UPDATE OF pl' : ''}`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getPriceListByCode(client, { installationId, code, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${LIST_COLUMNS} ${listJoin()}
     WHERE pl.installation_id = $1 AND pl.code = $2${forUpdate ? ' FOR UPDATE OF pl' : ''}`,
    [installationId, code],
  );
  return result.rows[0] ?? null;
}

export async function insertPriceList(client, data) {
  const id = randomUUID();
  const now = nowMilliseconds();
  const result = await client.query(
    `INSERT INTO shared.price_lists
      (id, installation_id, code, name, list_type, currency_code, channel_id, customer_group_id,
       customer_id, priority, stacking_mode, stop_processing, effective_from, effective_to,
       description, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18,$18)
     ON CONFLICT DO NOTHING RETURNING id`,
    [id, data.installationId, data.code, data.name, data.listType, data.currencyCode,
      data.channelId, data.customerGroupId, data.customerId, data.priority, data.stackingMode,
      data.stopProcessing, data.effectiveFrom, data.effectiveTo, data.description,
      data.isActive, now, data.createdBy],
  );
  return result.rows[0] ? getPriceListById(client, { installationId: data.installationId, id }) : null;
}

export async function updatePriceList(client, data) {
  const result = await client.query(
    `UPDATE shared.price_lists
     SET name = $1, channel_id = $2, customer_group_id = $3, customer_id = $4,
         priority = $5, stacking_mode = $6, stop_processing = $7,
         effective_from = $8, effective_to = $9, description = $10, is_active = $11,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $12
     WHERE installation_id = $13 AND id = $14
       AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $15::timestamptz)
     RETURNING id`,
    [data.name, data.channelId, data.customerGroupId, data.customerId, data.priority,
      data.stackingMode, data.stopProcessing, data.effectiveFrom, data.effectiveTo,
      data.description, data.isActive, data.updatedBy, data.installationId, data.id,
      data.expectedUpdatedAt],
  );
  return result.rows[0] ? getPriceListById(client, { installationId: data.installationId, id: data.id }) : null;
}

export async function listPriceListItems(client, { installationId, priceListId, variantId, active, limit = 500, offset = 0 }) {
  const params = [installationId, priceListId];
  let query = `SELECT ${ITEM_COLUMNS}
    FROM shared.price_list_items pi
    JOIN shared.product_variants pv ON pv.installation_id = pi.installation_id AND pv.id = pi.variant_id
    JOIN shared.products p ON p.installation_id = pv.installation_id AND p.id = pv.product_id
    WHERE pi.installation_id = $1 AND pi.price_list_id = $2`;
  if (variantId) {
    params.push(variantId);
    query += ` AND pi.variant_id = $${params.length}`;
  }
  if (active !== undefined) {
    params.push(Boolean(active));
    query += ` AND pi.is_active = $${params.length}`;
  }
  params.push(limit, offset);
  query += ` ORDER BY p.code, pv.sku, pi.min_quantity, pi.created_at LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getPriceListItemById(client, { installationId, priceListId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${ITEM_COLUMNS}
     FROM shared.price_list_items pi
     JOIN shared.product_variants pv ON pv.installation_id = pi.installation_id AND pv.id = pi.variant_id
     JOIN shared.products p ON p.installation_id = pv.installation_id AND p.id = pv.product_id
     WHERE pi.installation_id = $1 AND pi.price_list_id = $2 AND pi.id = $3${forUpdate ? ' FOR UPDATE OF pi' : ''}`,
    [installationId, priceListId, id],
  );
  return result.rows[0] ?? null;
}

export async function getPriceListItemBySourceKey(client, { installationId, sourceKey, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${ITEM_COLUMNS}
     FROM shared.price_list_items pi
     JOIN shared.product_variants pv ON pv.installation_id = pi.installation_id AND pv.id = pi.variant_id
     JOIN shared.products p ON p.installation_id = pv.installation_id AND p.id = pv.product_id
     WHERE pi.installation_id = $1 AND pi.source_key = $2${forUpdate ? ' FOR UPDATE OF pi' : ''}`,
    [installationId, sourceKey],
  );
  return result.rows[0] ?? null;
}

export async function insertPriceListItem(client, data) {
  const id = randomUUID();
  const now = nowMilliseconds();
  const result = await client.query(
    `INSERT INTO shared.price_list_items
      (id, installation_id, price_list_id, variant_id, adjustment_type, amount_minor, rate_bps,
       min_quantity, max_quantity, effective_from, effective_to, source_kind, source_key,
       external_rule_code, note, source_metadata, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$19,$19)
     ON CONFLICT DO NOTHING RETURNING id`,
    [id, data.installationId, data.priceListId, data.variantId, data.adjustmentType,
      data.amountMinor, data.rateBps, data.minQuantity, data.maxQuantity,
      data.effectiveFrom, data.effectiveTo, data.sourceKind, data.sourceKey,
      data.externalRuleCode, data.note, data.sourceMetadata ?? {}, data.isActive, now, data.createdBy],
  );
  return result.rows[0]
    ? getPriceListItemById(client, { installationId: data.installationId, priceListId: data.priceListId, id })
    : null;
}

export async function updatePriceListItem(client, data) {
  const result = await client.query(
    `UPDATE shared.price_list_items
     SET amount_minor = $1, rate_bps = $2, min_quantity = $3, max_quantity = $4,
         effective_from = $5, effective_to = $6, source_kind = $7,
         external_rule_code = $8, note = $9, source_metadata = $10,
         is_active = $11,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $12
     WHERE installation_id = $13 AND price_list_id = $14 AND id = $15
       AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $16::timestamptz)
     RETURNING id`,
    [data.amountMinor, data.rateBps, data.minQuantity, data.maxQuantity,
      data.effectiveFrom, data.effectiveTo, data.sourceKind, data.externalRuleCode,
      data.note, data.sourceMetadata ?? {}, data.isActive, data.updatedBy,
      data.installationId, data.priceListId, data.id, data.expectedUpdatedAt],
  );
  return result.rows[0]
    ? getPriceListItemById(client, { installationId: data.installationId, priceListId: data.priceListId, id: data.id })
    : null;
}

export async function getVariantForPricing(client, { installationId, variantId }) {
  const result = await client.query(
    `SELECT pv.id, pv.product_id, pv.sku, pv.name, pv.is_active, pv.is_sellable,
            pv.unit_id, pv.conversion_to_base, p.code AS product_code, p.name AS product_name
     FROM shared.product_variants pv
     JOIN shared.products p ON p.installation_id = pv.installation_id AND p.id = pv.product_id
     WHERE pv.installation_id = $1 AND pv.id = $2`,
    [installationId, variantId],
  );
  return result.rows[0] ?? null;
}

export async function getVariantBySkuForPricing(client, { installationId, sku }) {
  const result = await client.query(
    `SELECT pv.id, pv.product_id, pv.sku, pv.name, pv.is_active, pv.is_sellable,
            pv.unit_id, pv.conversion_to_base, p.code AS product_code, p.name AS product_name
     FROM shared.product_variants pv
     JOIN shared.products p ON p.installation_id = pv.installation_id AND p.id = pv.product_id
     WHERE pv.installation_id = $1 AND pv.sku = $2`,
    [installationId, sku],
  );
  return result.rows[0] ?? null;
}

export async function getCustomerForPricing(client, { installationId, customerId }) {
  const result = await client.query(
    `SELECT id, code, name, group_id, is_active FROM shared.customers
     WHERE installation_id = $1 AND id = $2`,
    [installationId, customerId],
  );
  return result.rows[0] ?? null;
}

export async function getCustomerGroupForPricing(client, { installationId, customerGroupId }) {
  const result = await client.query(
    `SELECT id, code, name, is_active FROM shared.customer_groups
     WHERE installation_id = $1 AND id = $2`,
    [installationId, customerGroupId],
  );
  return result.rows[0] ?? null;
}

export async function getResolutionCandidates(client, {
  installationId,
  variantId,
  currencyCode,
  priceAt,
  quantity,
  channelId,
  customerGroupId,
  customerId,
}) {
  const result = await client.query(
    `SELECT
       pi.id AS item_id, pi.adjustment_type, pi.amount_minor, pi.rate_bps,
       pi.min_quantity, pi.max_quantity, pi.source_kind, pi.source_key, pi.external_rule_code,
       pl.id AS price_list_id, pl.code AS price_list_code, pl.name AS price_list_name,
       pl.list_type, pl.priority, pl.stacking_mode, pl.stop_processing,
       pl.channel_id, pl.customer_group_id, pl.customer_id
     FROM shared.price_list_items pi
     JOIN shared.price_lists pl
       ON pl.installation_id = pi.installation_id AND pl.id = pi.price_list_id
     WHERE pi.installation_id = $1
       AND pi.variant_id = $2
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
    [installationId, variantId, currencyCode, priceAt, quantity,
      channelId ?? null, customerGroupId ?? null, customerId ?? null],
  );
  return result.rows;
}
