import { randomUUID } from 'node:crypto';

const ORDER_COLUMNS = `so.id, so.installation_id, so.order_number, so.order_number_allocation_id,
  so.status, so.current_version_number, so.source_type, so.source_id, so.source_outlet_id,
  so.customer_id, c.code AS customer_code, c.name AS customer_name,
  so.customer_mode, so.walk_in_display_name, so.walk_in_phone,
  so.customer_address_id, so.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
  so.delivery_mode, so.collection_policy, so.fulfillment_status,
  CASE
    WHEN so.delivery_status IN ('returned', 'cancelled') THEN so.delivery_status
    WHEN so.delivery_mode = 'PICKUP' THEN 'not_required'
    ELSE COALESCE((
      SELECT CASE
        WHEN expected.expected_base_quantity > 0
         AND delivery.delivered_base_quantity >= expected.expected_base_quantity THEN 'delivered'
        WHEN delivery.delivered_base_quantity > 0 THEN 'partially_delivered'
        WHEN delivery.has_rescheduled THEN 'rescheduled'
        WHEN delivery.has_failed THEN 'failed'
        WHEN delivery.has_dispatched THEN 'dispatched'
        WHEN delivery.has_ready_to_dispatch THEN 'ready_to_dispatch'
        ELSE so.delivery_status
      END
      FROM (
        SELECT COALESCE(sum(line.base_quantity), 0)::numeric(30,12) AS expected_base_quantity
          FROM sales.sales_order_versions version
          JOIN sales.sales_order_version_lines line
            ON line.installation_id = version.installation_id
           AND line.sales_order_version_id = version.id
         WHERE version.installation_id = so.installation_id
           AND version.sales_order_id = so.id
           AND version.version_number = so.current_version_number
      ) expected
      CROSS JOIN (
        SELECT COALESCE(sum(
                 CASE WHEN attempt.result IN ('delivered_full', 'delivered_partial')
                   THEN attempt_line.delivered_base_quantity
                   ELSE 0::numeric
                 END
               ), 0)::numeric(30,12) AS delivered_base_quantity,
               COALESCE(bool_or(attempt.result = 'rescheduled'), false) AS has_rescheduled,
               COALESCE(bool_or(attempt.result = 'failed'), false) AS has_failed,
               COALESCE(bool_or(dispatch_item.id IS NOT NULL), false) AS has_dispatched,
               COALESCE(bool_or(delivery_order.status = 'ready_to_dispatch'), false) AS has_ready_to_dispatch
          FROM sales.delivery_orders delivery_order
          LEFT JOIN logistics.delivery_attempts attempt
            ON attempt.installation_id = delivery_order.installation_id
           AND attempt.delivery_order_id = delivery_order.id
          LEFT JOIN logistics.delivery_attempt_lines attempt_line
            ON attempt_line.installation_id = attempt.installation_id
           AND attempt_line.attempt_id = attempt.id
          LEFT JOIN logistics.trip_dispatch_items dispatch_item
            ON dispatch_item.installation_id = delivery_order.installation_id
           AND dispatch_item.delivery_order_id = delivery_order.id
         WHERE delivery_order.installation_id = so.installation_id
           AND delivery_order.sales_order_id = so.id
           AND delivery_order.status <> 'cancelled'
      ) delivery
    ), so.delivery_status)
  END AS delivery_status,
  so.settlement_status,
  COALESCE((
    SELECT sum(receivable.remaining_amount)::numeric(20,6)
      FROM accounting.receivable_documents receivable
     WHERE receivable.installation_id = so.installation_id
       AND receivable.sales_order_id = so.id
       AND receivable.direction = 'DEBIT'
       AND receivable.status <> 'reversed'
  ), 0)::numeric(20,6) AS receivable_remaining_amount,
  so.currency_code, so.requested_delivery_date, so.note, so.revision,
  so.confirmed_at, so.confirmed_by, so.cancelled_at, so.cancelled_by, so.cancellation_reason,
  so.created_at, so.updated_at, so.created_by, so.updated_by`;

const VERSION_COLUMNS = `sov.id, sov.installation_id, sov.sales_order_id, sov.version_number,
  sov.version_status, sov.customer_id, sov.customer_code_snapshot, sov.customer_name_snapshot,
  sov.customer_mode_snapshot, sov.walk_in_display_name_snapshot, sov.walk_in_phone_snapshot,
  sov.customer_address_id, sov.customer_address_snapshot, sov.warehouse_id,
  sov.warehouse_code_snapshot, sov.warehouse_name_snapshot, sov.delivery_mode,
  sov.source_type, sov.source_id, sov.source_outlet_id, sov.collection_policy,
  sov.currency_code, sov.requested_delivery_date, sov.note, sov.subtotal,
  sov.discount_total, sov.tax_total, sov.total, sov.amendment_reason,
  sov.based_on_version_number, sov.price_override_reason, sov.revision,
  sov.created_at, sov.created_by, sov.updated_at, sov.updated_by,
  sov.confirmed_at, sov.confirmed_by`;

const LINE_COLUMNS = `sovl.id, sovl.installation_id, sovl.sales_order_version_id,
  sovl.line_number, sovl.variant_id, sovl.sku_snapshot, sovl.item_name_snapshot,
  sovl.unit_id, sovl.unit_code_snapshot, sovl.conversion_to_base,
  sovl.ordered_quantity, sovl.base_quantity, sovl.unit_weight_kg, sovl.line_weight_kg,
  sovl.price_list_id, sovl.price_rule_id,
  sovl.price_source, sovl.unit_price, sovl.discount_mode, sovl.discount_value,
  sovl.discount_amount, sovl.tax_mode, sovl.tax_rate, sovl.tax_amount,
  sovl.line_subtotal, sovl.line_total, sovl.note,
  sovl.created_at, sovl.created_by, sovl.updated_at, sovl.updated_by`;

const SKU_OPTION_COLUMNS = `pv.id, pv.product_id, pv.sku, pv.name,
  pv.is_active AS variant_is_active, pv.is_sellable,
  pv.unit_id, pv.conversion_to_base,
  p.code AS product_code, p.name AS product_name,
  p.is_active AS product_is_active, p.is_orderable AS product_is_orderable,
  u.code AS unit_code, u.name AS unit_name,
  u.allows_fractional, u.is_active AS unit_is_active,
  primary_barcode.barcode`;

function scopeIds(warehouseIds) {
  return Array.isArray(warehouseIds)
    ? [...new Set(warehouseIds.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    : [];
}

function appendWarehouseScope(query, params, warehouseIds, column = 'so.warehouse_id') {
  const scoped = scopeIds(warehouseIds);
  if (scoped.length === 0) return { query: `${query} AND false`, params };
  params.push(scoped);
  return { query: `${query} AND ${column} = ANY($${params.length}::uuid[])`, params };
}

function nowIso() {
  return new Date().toISOString();
}

export async function listSalesOrders(client, {
  installationId, warehouseIds, status, customerId, warehouseId, search, limit = 100, offset = 0,
}) {
  const params = [installationId];
  let query = `SELECT ${ORDER_COLUMNS}
    FROM sales.sales_orders so
    JOIN shared.customers c ON c.installation_id = so.installation_id AND c.id = so.customer_id
    JOIN shared.warehouses w ON w.installation_id = so.installation_id AND w.id = so.warehouse_id
    WHERE so.installation_id = $1`;
  ({ query } = appendWarehouseScope(query, params, warehouseIds));
  if (status) {
    params.push(status);
    query += ` AND so.status = $${params.length}`;
  }
  if (customerId) {
    params.push(customerId);
    query += ` AND so.customer_id = $${params.length}`;
  }
  if (warehouseId) {
    params.push(warehouseId);
    query += ` AND so.warehouse_id = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (COALESCE(so.order_number, '') ILIKE $${params.length}
      OR c.code ILIKE $${params.length} OR c.name ILIKE $${params.length}
      OR COALESCE(so.walk_in_display_name, '') ILIKE $${params.length}
      OR COALESCE(so.walk_in_phone, '') ILIKE $${params.length}
      OR COALESCE(so.source_id, '') ILIKE $${params.length})`;
  }
  params.push(limit, offset);
  query += ` ORDER BY so.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getSalesOrderById(client, {
  installationId, id, warehouseIds, forUpdate = false,
}) {
  const params = [installationId, id];
  let query = `SELECT ${ORDER_COLUMNS}
    FROM sales.sales_orders so
    JOIN shared.customers c ON c.installation_id = so.installation_id AND c.id = so.customer_id
    JOIN shared.warehouses w ON w.installation_id = so.installation_id AND w.id = so.warehouse_id
    WHERE so.installation_id = $1 AND so.id = $2`;
  ({ query } = appendWarehouseScope(query, params, warehouseIds));
  if (forUpdate) query += ' FOR UPDATE OF so';
  return (await client.query(query, params)).rows[0] ?? null;
}

export async function getSalesOrderBySource(client, { installationId, sourceType, sourceId }) {
  if (!sourceId) return null;
  const result = await client.query(
    `SELECT ${ORDER_COLUMNS}
     FROM sales.sales_orders so
     JOIN shared.customers c ON c.installation_id = so.installation_id AND c.id = so.customer_id
     JOIN shared.warehouses w ON w.installation_id = so.installation_id AND w.id = so.warehouse_id
     WHERE so.installation_id = $1 AND so.source_type = $2 AND so.source_id = $3`,
    [installationId, sourceType, sourceId],
  );
  return result.rows[0] ?? null;
}

export async function getSalesOrderVersions(client, { installationId, salesOrderId }) {
  return (await client.query(
    `SELECT ${VERSION_COLUMNS}
     FROM sales.sales_order_versions sov
     WHERE sov.installation_id = $1 AND sov.sales_order_id = $2
     ORDER BY sov.version_number DESC`,
    [installationId, salesOrderId],
  )).rows;
}

export async function getSalesOrderVersion(client, {
  installationId, salesOrderId, versionNumber, forUpdate = false,
}) {
  const result = await client.query(
    `SELECT ${VERSION_COLUMNS}
     FROM sales.sales_order_versions sov
     WHERE sov.installation_id = $1 AND sov.sales_order_id = $2 AND sov.version_number = $3
     ${forUpdate ? 'FOR UPDATE OF sov' : ''}`,
    [installationId, salesOrderId, versionNumber],
  );
  return result.rows[0] ?? null;
}

export async function getSalesOrderVersionLines(client, { installationId, versionId }) {
  return (await client.query(
    `SELECT ${LINE_COLUMNS}
     FROM sales.sales_order_version_lines sovl
     WHERE sovl.installation_id = $1 AND sovl.sales_order_version_id = $2
     ORDER BY sovl.line_number`,
    [installationId, versionId],
  )).rows;
}

export async function getActiveCustomer(client, { installationId, id }) {
  return (await client.query(
    `SELECT id, code, name, group_id, payment_terms_days, credit_limit, is_active
     FROM shared.customers WHERE installation_id = $1 AND id = $2`,
    [installationId, id],
  )).rows[0] ?? null;
}

export async function getSalesOrderSettings(client, { installationId }) {
  return (await client.query(
    `SELECT settings.installation_id, settings.walk_in_customer_id,
            settings.default_tax_mode, settings.default_tax_rate,
            customer.id AS customer_id, customer.code AS customer_code,
            customer.name AS customer_name, customer.group_id AS customer_group_id,
            customer.payment_terms_days, customer.credit_limit,
            customer.is_active AS customer_is_active
     FROM shared.sales_order_settings settings
     LEFT JOIN shared.customers customer
       ON customer.installation_id = settings.installation_id
      AND customer.id = settings.walk_in_customer_id
     WHERE settings.installation_id = $1`,
    [installationId],
  )).rows[0] ?? null;
}

export async function ensureWalkInCustomer(client, { installationId, actorId }) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`sales-order-settings:${installationId}`],
  );

  let settings = await getSalesOrderSettings(client, { installationId });
  if (!settings) {
    const now = nowIso();
    await client.query(
      `INSERT INTO shared.sales_order_settings (
         installation_id, walk_in_customer_id, default_tax_mode, default_tax_rate,
         created_at, updated_at, created_by, updated_by
       ) VALUES ($1,NULL,'EXCLUSIVE',0,$2,$2,$3,$3)
       ON CONFLICT (installation_id) DO NOTHING`,
      [installationId, now, actorId],
    );
    settings = await getSalesOrderSettings(client, { installationId });
  }

  if (settings?.walk_in_customer_id) {
    if (!settings.customer_id || settings.customer_is_active !== true) return null;
    return {
      id: settings.customer_id,
      code: settings.customer_code,
      name: settings.customer_name,
      group_id: settings.customer_group_id,
      payment_terms_days: settings.payment_terms_days,
      credit_limit: settings.credit_limit,
      is_active: settings.customer_is_active,
    };
  }

  const customerId = randomUUID();
  const customerCode = `WALKIN_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const now = nowIso();
  const customer = (await client.query(
    `INSERT INTO shared.customers (
       id, installation_id, code, name, group_id, responsible_employee_id,
       phone, email, tax_code, payment_terms_days, credit_limit, notes,
       is_active, created_at, updated_at, created_by, updated_by
     ) VALUES (
       $1,$2,$3,'Khách vãng lai',NULL,NULL,NULL,NULL,NULL,0,0,
       'Khách hệ thống được cấu hình cho đơn bán trực tiếp nhận tại kho.',true,$4,$4,$5,$5
     ) RETURNING id, code, name, group_id, payment_terms_days, credit_limit, is_active`,
    [customerId, installationId, customerCode, now, actorId],
  )).rows[0] ?? null;
  if (!customer) return null;

  const configured = await client.query(
    `UPDATE shared.sales_order_settings
     SET walk_in_customer_id=$1, updated_at=$2, updated_by=$3
     WHERE installation_id=$4 AND walk_in_customer_id IS NULL
     RETURNING walk_in_customer_id`,
    [customer.id, now, actorId, installationId],
  );
  if (!configured.rows[0]) return null;
  return customer;
}

export async function isConfiguredWalkInCustomer(client, { installationId, customerId }) {
  const row = (await client.query(
    `SELECT settings.walk_in_customer_id,
            customer.is_active AS customer_is_active
     FROM shared.sales_order_settings settings
     LEFT JOIN shared.customers customer
       ON customer.installation_id = settings.installation_id
      AND customer.id = settings.walk_in_customer_id
     WHERE settings.installation_id=$1`,
    [installationId],
  )).rows[0] ?? null;
  return Boolean(row?.walk_in_customer_id === customerId && row?.customer_is_active === true);
}

export async function getCustomerAddress(client, { installationId, id }) {
  return (await client.query(
    `SELECT id, customer_id, label, recipient_name, phone, address_line1, address_line2,
            ward, district, province, postal_code, country_code, is_default, is_active
     FROM shared.customer_addresses WHERE installation_id = $1 AND id = $2`,
    [installationId, id],
  )).rows[0] ?? null;
}

export async function getActiveWarehouse(client, { installationId, id }) {
  return (await client.query(
    `SELECT id, code, name, is_active FROM shared.warehouses
     WHERE installation_id = $1 AND id = $2`,
    [installationId, id],
  )).rows[0] ?? null;
}

export async function getSalesVariant(client, { installationId, id }) {
  return (await client.query(
    `SELECT pv.id, pv.product_id, pv.sku, pv.name, pv.is_active, pv.is_sellable,
            pv.unit_id, pv.conversion_to_base, pv.weight_value, pv.weight_uom_code,
            p.code AS product_code,
            p.name AS product_name, p.is_active AS product_is_active,
            p.is_orderable AS product_is_orderable,
            u.code AS unit_code, u.name AS unit_name, u.is_active AS unit_is_active,
            u.allows_fractional
     FROM shared.product_variants pv
     JOIN shared.products p ON p.installation_id = pv.installation_id AND p.id = pv.product_id
     LEFT JOIN shared.units_of_measure u ON u.installation_id = pv.installation_id AND u.id = pv.unit_id
     WHERE pv.installation_id = $1 AND pv.id = $2`,
    [installationId, id],
  )).rows[0] ?? null;
}

export async function searchSalesOrderSkuOptions(client, {
  installationId, search, categoryId = null, retailSearch = false, limit = 20, offset = 0,
}) {
  const term = String(search ?? '').trim();
  const pattern = `%${term}%`;
  const normalized = term.toUpperCase();
  const result = await client.query(
    `SELECT ${SKU_OPTION_COLUMNS}
     FROM shared.product_variants pv
     JOIN shared.products p
       ON p.installation_id = pv.installation_id AND p.id = pv.product_id
     LEFT JOIN shared.units_of_measure u
       ON u.installation_id = pv.installation_id AND u.id = pv.unit_id
     LEFT JOIN LATERAL (
       SELECT pb.barcode
       FROM shared.product_barcodes pb
       WHERE pb.installation_id = pv.installation_id
         AND pb.variant_id = pv.id
         AND pb.is_active = true
       ORDER BY pb.is_primary DESC, pb.created_at ASC, pb.id ASC
       LIMIT 1
     ) primary_barcode ON true
     WHERE pv.installation_id = $1
       AND p.is_active = true
       AND p.is_orderable = true
       AND pv.is_active = true
       AND pv.is_sellable = true
       AND pv.unit_id IS NOT NULL
       AND u.is_active = true
       AND pv.conversion_to_base IS NOT NULL
       AND pv.conversion_to_base > 0
       AND ($4::uuid IS NULL OR p.category_id = $4::uuid)
       AND (
         $2 = ''
         OR pv.sku ILIKE $3
         OR pv.name ILIKE $3
         OR p.code ILIKE $3
         OR p.name ILIKE $3
         OR EXISTS (
           SELECT 1
           FROM shared.product_barcodes matching_barcode
           WHERE matching_barcode.installation_id = pv.installation_id
             AND matching_barcode.variant_id = pv.id
             AND matching_barcode.is_active = true
             AND matching_barcode.normalized_barcode ILIKE upper($3)
         )
       )
     ORDER BY
       CASE
         WHEN upper(pv.sku) = $2 THEN 0
         WHEN upper(p.code) = $2 THEN 1
         WHEN EXISTS (
           SELECT 1
           FROM shared.product_barcodes exact_barcode
           WHERE exact_barcode.installation_id = pv.installation_id
             AND exact_barcode.variant_id = pv.id
             AND exact_barcode.is_active = true
             AND exact_barcode.normalized_barcode = $2
         ) THEN 2
         WHEN $5::boolean AND upper(pv.sku) LIKE $2 || '%' THEN 3
         WHEN $5::boolean AND upper(p.code) LIKE $2 || '%' THEN 4
         ELSE 3
       END,
       p.code ASC,
       pv.sku ASC,
       pv.id ASC
     LIMIT $6 OFFSET $7`,
    [installationId, normalized, pattern, categoryId, retailSearch, limit, offset],
  );
  return result.rows;
}

export async function insertSalesOrder(client, data) {
  const id = randomUUID();
  const now = nowIso();
  const result = await client.query(
    `INSERT INTO sales.sales_orders (
       id, installation_id, status, current_version_number, source_type, source_id,
       source_outlet_id, customer_id, customer_mode, walk_in_display_name, walk_in_phone,
       customer_address_id, warehouse_id, delivery_mode,
       collection_policy, fulfillment_status, delivery_status, settlement_status,
       currency_code, requested_delivery_date, note, created_at, updated_at, created_by, updated_by
     ) VALUES (
       $1,$2,'draft',1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'unallocated',$14,'not_due',$15,$16,$17,$18,$18,$19,$19
     ) ON CONFLICT DO NOTHING RETURNING id`,
    [id, data.installationId, data.sourceType, data.sourceId, data.sourceOutletId,
      data.customerId, data.customerMode, data.walkInDisplayName, data.walkInPhone,
      data.customerAddressId, data.warehouseId, data.deliveryMode,
      data.collectionPolicy, data.deliveryMode === 'PICKUP' ? 'not_required' : 'pending',
      data.currencyCode, data.requestedDeliveryDate, data.note, now, data.actorId],
  );
  return result.rows[0]?.id ?? null;
}

export async function insertSalesOrderVersion(client, data) {
  const id = randomUUID();
  const now = nowIso();
  const result = await client.query(
    `INSERT INTO sales.sales_order_versions (
       id, installation_id, sales_order_id, version_number, version_status,
       customer_id, customer_code_snapshot, customer_name_snapshot,
       customer_mode_snapshot, walk_in_display_name_snapshot, walk_in_phone_snapshot,
       customer_address_id, customer_address_snapshot, warehouse_id,
       warehouse_code_snapshot, warehouse_name_snapshot, delivery_mode,
       source_type, source_id, source_outlet_id, collection_policy, currency_code,
       requested_delivery_date, note, subtotal, discount_total, tax_total, total,
       amendment_reason, based_on_version_number, price_override_reason,
       created_at, created_by, updated_at, updated_by
     ) VALUES (
       $1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
       $24,$25,$26,$27,$28,$29,$30,$31,$32,$31,$32
     ) RETURNING id`,
    [id, data.installationId, data.salesOrderId, data.versionNumber,
      data.customerId, data.customerCode, data.customerName, data.customerMode,
      data.walkInDisplayName, data.walkInPhone,
      data.customerAddressId, data.customerAddressSnapshot, data.warehouseId,
      data.warehouseCode, data.warehouseName, data.deliveryMode, data.sourceType,
      data.sourceId, data.sourceOutletId, data.collectionPolicy, data.currencyCode,
      data.requestedDeliveryDate, data.note, data.subtotal, data.discountTotal,
      data.taxTotal, data.total, data.amendmentReason, data.basedOnVersionNumber,
      data.priceOverrideReason, now, data.actorId],
  );
  return result.rows[0]?.id ?? null;
}

export async function insertSalesOrderVersionLines(client, {
  installationId, versionId, lines, actorId,
}) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO sales.sales_order_version_lines (
         id, installation_id, sales_order_version_id, line_number, variant_id,
         sku_snapshot, item_name_snapshot, unit_id, unit_code_snapshot,
         conversion_to_base, ordered_quantity, base_quantity, unit_weight_kg, line_weight_kg,
         price_list_id, price_rule_id, price_source, unit_price, discount_mode, discount_value,
         discount_amount, tax_mode, tax_rate, tax_amount, line_subtotal, line_total,
         note, created_by, updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$28
       )`,
      [randomUUID(), installationId, versionId, line.lineNumber, line.variantId,
        line.sku, line.itemName, line.unitId, line.unitCode, line.conversionToBase,
        line.quantity, line.baseQuantity, line.unitWeightKg, line.lineWeightKg,
        line.priceListId, line.priceRuleId, line.priceSource, line.unitPrice,
        line.discountMode, line.discountValue, line.discountAmount, line.taxMode,
        line.taxRate, line.taxAmount, line.lineSubtotal, line.lineTotal, line.note, actorId],
    );
  }
}

export async function replaceDraftVersion(client, data) {
  const now = nowIso();
  const result = await client.query(
    `UPDATE sales.sales_order_versions
     SET customer_id=$1, customer_code_snapshot=$2, customer_name_snapshot=$3,
         customer_mode_snapshot=$4, walk_in_display_name_snapshot=$5, walk_in_phone_snapshot=$6,
         customer_address_id=$7, customer_address_snapshot=$8, warehouse_id=$9,
         warehouse_code_snapshot=$10, warehouse_name_snapshot=$11, delivery_mode=$12,
         collection_policy=$13, currency_code=$14, requested_delivery_date=$15,
         note=$16, subtotal=$17, discount_total=$18, tax_total=$19, total=$20,
         price_override_reason=$21, revision=revision+1, updated_at=$22, updated_by=$23
     WHERE installation_id=$24 AND sales_order_id=$25 AND version_number=$26
       AND version_status='draft' AND revision=$27
     RETURNING id`,
    [data.customerId, data.customerCode, data.customerName, data.customerMode,
      data.walkInDisplayName, data.walkInPhone,
      data.customerAddressId, data.customerAddressSnapshot, data.warehouseId,
      data.warehouseCode, data.warehouseName, data.deliveryMode,
      data.collectionPolicy, data.currencyCode, data.requestedDeliveryDate,
      data.note, data.subtotal, data.discountTotal, data.taxTotal, data.total,
      data.priceOverrideReason, now, data.actorId,
      data.installationId, data.salesOrderId, data.versionNumber, data.expectedRevision],
  );
  if (!result.rows[0]) return null;
  await client.query(
    `DELETE FROM sales.sales_order_version_lines
     WHERE installation_id=$1 AND sales_order_version_id=$2`,
    [data.installationId, result.rows[0].id],
  );
  await insertSalesOrderVersionLines(client, {
    installationId: data.installationId,
    versionId: result.rows[0].id,
    lines: data.lines,
    actorId: data.actorId,
  });
  if (Number(data.versionNumber) === 1) {
    await client.query(
      `UPDATE sales.sales_orders SET customer_id=$1, customer_mode=$2,
         walk_in_display_name=$3, walk_in_phone=$4, customer_address_id=$5,
         warehouse_id=$6, delivery_mode=$7, collection_policy=$8, currency_code=$9,
         requested_delivery_date=$10, note=$11, delivery_status=$12,
         revision=revision+1, updated_at=$13, updated_by=$14
       WHERE installation_id=$15 AND id=$16 AND status='draft'`,
      [data.customerId, data.customerMode, data.walkInDisplayName, data.walkInPhone,
        data.customerAddressId, data.warehouseId, data.deliveryMode,
        data.collectionPolicy, data.currencyCode, data.requestedDeliveryDate, data.note,
        data.deliveryMode === 'PICKUP' ? 'not_required' : 'pending', now, data.actorId,
        data.installationId, data.salesOrderId],
    );
  }
  return result.rows[0].id;
}

export async function confirmSalesOrderVersion(client, data) {
  const now = nowIso();
  if (data.previousVersionNumber) {
    await client.query(
      `UPDATE sales.sales_order_versions SET version_status='superseded', updated_at=$1, updated_by=$2
       WHERE installation_id=$3 AND sales_order_id=$4 AND version_number=$5 AND version_status='confirmed'`,
      [now, data.actorId, data.installationId, data.salesOrderId, data.previousVersionNumber],
    );
  }
  const version = await client.query(
    `UPDATE sales.sales_order_versions
     SET version_status='confirmed', confirmed_at=$1, confirmed_by=$2,
         revision=revision+1, updated_at=$1, updated_by=$2
     WHERE installation_id=$3 AND sales_order_id=$4 AND version_number=$5 AND version_status='draft'
     RETURNING id`,
    [now, data.actorId, data.installationId, data.salesOrderId, data.versionNumber],
  );
  if (!version.rows[0]) return null;
  const order = await client.query(
    `UPDATE sales.sales_orders so
     SET order_number=COALESCE(so.order_number,$1),
         order_number_allocation_id=COALESCE(so.order_number_allocation_id,$2),
         status='confirmed', current_version_number=$3,
         customer_id=confirmed_version.customer_id,
         customer_mode=confirmed_version.customer_mode_snapshot,
         walk_in_display_name=confirmed_version.walk_in_display_name_snapshot,
         walk_in_phone=confirmed_version.walk_in_phone_snapshot,
         customer_address_id=confirmed_version.customer_address_id,
         warehouse_id=confirmed_version.warehouse_id,
         delivery_mode=confirmed_version.delivery_mode,
         collection_policy=confirmed_version.collection_policy,
         currency_code=confirmed_version.currency_code,
         requested_delivery_date=confirmed_version.requested_delivery_date,
         note=confirmed_version.note,
         delivery_status=CASE
           WHEN so.delivery_status IN ('pending','not_required')
             THEN CASE WHEN confirmed_version.delivery_mode='PICKUP' THEN 'not_required' ELSE 'pending' END
           ELSE so.delivery_status
         END,
         confirmed_at=COALESCE(so.confirmed_at,$4), confirmed_by=COALESCE(so.confirmed_by,$5),
         revision=so.revision+1, updated_at=$4, updated_by=$5
     FROM sales.sales_order_versions confirmed_version
     WHERE so.installation_id=$6 AND so.id=$7 AND so.status IN ('draft','confirmed')
       AND confirmed_version.installation_id=so.installation_id
       AND confirmed_version.sales_order_id=so.id
       AND confirmed_version.version_number=$3
       AND confirmed_version.version_status='confirmed'
     RETURNING so.id`,
    [data.orderNumber, data.allocationId, data.versionNumber, now, data.actorId,
      data.installationId, data.salesOrderId],
  );
  return order.rows[0]?.id ?? null;
}

export async function cancelSalesOrder(client, data) {
  const now = nowIso();
  const result = await client.query(
    `UPDATE sales.sales_orders
     SET status='cancelled', fulfillment_status='cancelled', delivery_status='cancelled',
         cancelled_at=$1, cancelled_by=$2, cancellation_reason=$3,
         revision=revision+1, updated_at=$1, updated_by=$2
     WHERE installation_id=$4 AND id=$5 AND status IN ('draft','confirmed')
     RETURNING id`,
    [now, data.actorId, data.reason, data.installationId, data.salesOrderId],
  );
  if (!result.rows[0]) return null;
  await client.query(
    `UPDATE sales.sales_order_versions SET version_status='cancelled', updated_at=$1, updated_by=$2
     WHERE installation_id=$3 AND sales_order_id=$4 AND version_status='draft'`,
    [now, data.actorId, data.installationId, data.salesOrderId],
  );
  return result.rows[0].id;
}

export async function closeSalesOrderAfterExecution(client, data) {
  const now = nowIso();
  const result = await client.query(
    `UPDATE sales.sales_orders
        SET status='closed', revision=revision+1, updated_at=$1, updated_by=$2
      WHERE installation_id=$3 AND id=$4 AND status='confirmed'
      RETURNING id`,
    [now, data.actorId, data.installationId, data.salesOrderId],
  );
  return result.rows[0]?.id ?? null;
}

export async function hasBlockingExecutionFacts(client, { installationId, salesOrderId }) {
  const knownRelations = [
    ['sales.delivery_orders', 'sales_order_id'],
    ['sales.fulfillments', 'sales_order_id'],
    ['accounting.receivables', 'sales_order_id'],
  ];
  for (const [relation, column] of knownRelations) {
    const exists = (await client.query('SELECT to_regclass($1) AS relation', [relation])).rows[0]?.relation;
    if (!exists) continue;
    const result = await client.query(
      `SELECT EXISTS (SELECT 1 FROM ${relation} WHERE installation_id=$1 AND ${column}=$2) AS blocked`,
      [installationId, salesOrderId],
    );
    if (result.rows[0]?.blocked) return true;
  }
  return false;
}
