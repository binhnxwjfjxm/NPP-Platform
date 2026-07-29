import { randomUUID } from 'node:crypto';

const HEADER_COLUMNS = `po.id, po.installation_id, po.document_number,
  po.document_number_allocation_id, po.supplier_id, s.code AS supplier_code,
  s.name AS supplier_name, po.warehouse_id, w.code AS warehouse_code,
  w.name AS warehouse_name, po.status, po.order_date, po.expected_date,
  po.supplier_reference, po.currency_code, po.note, po.subtotal,
  po.discount_total, po.tax_total, po.total, po.revision,
  po.submitted_at, po.submitted_by, po.approved_at, po.approved_by,
  po.cancelled_at, po.cancelled_by, po.cancellation_reason,
  po.created_at, po.updated_at, po.created_by, po.updated_by`;

const LINE_COLUMNS = `pol.id, pol.installation_id, pol.purchase_order_id,
  pol.line_number, pol.variant_id, pol.sku_snapshot,
  pol.item_name_snapshot, pol.unit_id, pol.unit_code_snapshot,
  pol.conversion_to_base, pol.ordered_quantity, pol.base_quantity,
  pol.unit_price, pol.discount_amount, pol.tax_amount, pol.line_total,
  pol.note, pol.created_at, pol.updated_at, pol.created_by, pol.updated_by`;

function normalizedWarehouseIds(warehouseIds) {
  return Array.isArray(warehouseIds)
    ? [...new Set(warehouseIds.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    : [];
}

function appendWarehouseScope(query, params, warehouseIds, column = 'po.warehouse_id') {
  const scoped = normalizedWarehouseIds(warehouseIds);
  if (scoped.length === 0) return { query: `${query} AND false`, params };
  params.push(scoped);
  return { query: `${query} AND ${column} = ANY($${params.length}::uuid[])`, params };
}

export async function listPurchaseOrders(client, {
  installationId,
  warehouseIds,
  status,
  supplierId,
  warehouseId,
  search,
  limit = 100,
  offset = 0,
}) {
  const params = [installationId];
  let query = `SELECT ${HEADER_COLUMNS},
      (SELECT count(*)::int FROM purchasing.purchase_order_lines pol
       WHERE pol.installation_id = po.installation_id AND pol.purchase_order_id = po.id) AS line_count
    FROM purchasing.purchase_orders po
    JOIN shared.suppliers s
      ON s.installation_id = po.installation_id AND s.id = po.supplier_id
    JOIN shared.warehouses w
      ON w.installation_id = po.installation_id AND w.id = po.warehouse_id
    WHERE po.installation_id = $1`;

  ({ query } = appendWarehouseScope(query, params, warehouseIds));
  if (status) {
    params.push(status);
    query += ` AND po.status = $${params.length}`;
  }
  if (supplierId) {
    params.push(supplierId);
    query += ` AND po.supplier_id = $${params.length}`;
  }
  if (warehouseId) {
    params.push(warehouseId);
    query += ` AND po.warehouse_id = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (
      COALESCE(po.document_number, '') ILIKE $${params.length}
      OR s.code ILIKE $${params.length}
      OR s.name ILIKE $${params.length}
      OR COALESCE(po.supplier_reference, '') ILIKE $${params.length}
    )`;
  }
  params.push(limit, offset);
  query += ` ORDER BY po.order_date DESC, po.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getPurchaseOrderLines(client, { installationId, purchaseOrderId }) {
  const result = await client.query(
    `SELECT ${LINE_COLUMNS}
     FROM purchasing.purchase_order_lines pol
     WHERE pol.installation_id = $1 AND pol.purchase_order_id = $2
     ORDER BY pol.line_number ASC`,
    [installationId, purchaseOrderId],
  );
  return result.rows;
}

export async function getPurchaseOrderById(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const params = [installationId, id];
  let query = `SELECT ${HEADER_COLUMNS}
    FROM purchasing.purchase_orders po
    JOIN shared.suppliers s
      ON s.installation_id = po.installation_id AND s.id = po.supplier_id
    JOIN shared.warehouses w
      ON w.installation_id = po.installation_id AND w.id = po.warehouse_id
    WHERE po.installation_id = $1 AND po.id = $2`;
  ({ query } = appendWarehouseScope(query, params, warehouseIds));
  if (forUpdate) query += ' FOR UPDATE OF po';
  const order = (await client.query(query, params)).rows[0] ?? null;
  if (!order) return null;
  return { ...order, lines: await getPurchaseOrderLines(client, { installationId, purchaseOrderId: id }) };
}

export async function getActiveSupplier(client, { installationId, id }) {
  const result = await client.query(
    `SELECT id, code, name, is_active
     FROM shared.suppliers
     WHERE installation_id = $1 AND id = $2 AND is_active = true`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getActiveWarehouse(client, { installationId, id }) {
  const result = await client.query(
    `SELECT id, code, name, is_active
     FROM shared.warehouses
     WHERE installation_id = $1 AND id = $2 AND is_active = true`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getPurchasableVariants(client, { installationId, ids }) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const result = await client.query(
    `SELECT pv.id, pv.sku, pv.name, pv.product_id, pv.unit_id,
            u.code AS unit_code, u.name AS unit_name,
            COALESCE(pv.conversion_to_base, 1::numeric) AS conversion_to_base
     FROM shared.product_variants pv
     JOIN shared.products p
       ON p.installation_id = pv.installation_id AND p.id = pv.product_id
     JOIN shared.units_of_measure u
       ON u.installation_id = pv.installation_id AND u.id = pv.unit_id
     WHERE pv.installation_id = $1
       AND pv.id = ANY($2::uuid[])
       AND pv.is_active = true
       AND pv.is_purchasable = true
       AND p.is_active = true
       AND u.is_active = true`,
    [installationId, ids],
  );
  return result.rows;
}

async function insertLines(client, {
  installationId,
  purchaseOrderId,
  lines,
  actorId,
}) {
  const now = new Date().toISOString();
  for (const line of lines) {
    await client.query(
      `INSERT INTO purchasing.purchase_order_lines
        (id, installation_id, purchase_order_id, line_number, variant_id,
         sku_snapshot, item_name_snapshot, unit_id, unit_code_snapshot,
         conversion_to_base, ordered_quantity, base_quantity, unit_price,
         discount_amount, tax_amount, line_total, note,
         created_at, updated_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$19,$19)`,
      [
        randomUUID(), installationId, purchaseOrderId, line.lineNumber,
        line.variantId, line.skuSnapshot, line.itemNameSnapshot, line.unitId,
        line.unitCodeSnapshot, line.conversionToBase, line.orderedQuantity,
        line.baseQuantity, line.unitPrice, line.discountAmount, line.taxAmount,
        line.lineTotal, line.note ?? null, now, actorId,
      ],
    );
  }
}

export async function insertPurchaseOrder(client, data) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO purchasing.purchase_orders
      (id, installation_id, supplier_id, warehouse_id, status,
       order_date, expected_date, supplier_reference, currency_code, note,
       subtotal, discount_total, tax_total, total, revision,
       created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$14,$15,$15)`,
    [
      id, data.installationId, data.supplierId, data.warehouseId,
      data.orderDate, data.expectedDate, data.supplierReference,
      data.currencyCode, data.note, data.subtotal, data.discountTotal,
      data.taxTotal, data.total, now, data.actorId,
    ],
  );
  await insertLines(client, {
    installationId: data.installationId,
    purchaseOrderId: id,
    lines: data.lines,
    actorId: data.actorId,
  });
  return getPurchaseOrderById(client, {
    installationId: data.installationId,
    id,
    warehouseIds: [data.warehouseId],
  });
}

export async function updatePurchaseOrderDraft(client, data) {
  const result = await client.query(
    `UPDATE purchasing.purchase_orders
     SET supplier_id = $1,
         warehouse_id = $2,
         order_date = $3,
         expected_date = $4,
         supplier_reference = $5,
         currency_code = $6,
         note = $7,
         subtotal = $8,
         discount_total = $9,
         tax_total = $10,
         total = $11,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $12
     WHERE installation_id = $13 AND id = $14
       AND status = 'draft' AND revision = $15
     RETURNING id, revision`,
    [
      data.supplierId, data.warehouseId, data.orderDate, data.expectedDate,
      data.supplierReference, data.currencyCode, data.note, data.subtotal,
      data.discountTotal, data.taxTotal, data.total, data.actorId,
      data.installationId, data.id, data.expectedRevision,
    ],
  );
  if (!result.rows[0]) return null;
  await client.query(
    'DELETE FROM purchasing.purchase_order_lines WHERE installation_id = $1 AND purchase_order_id = $2',
    [data.installationId, data.id],
  );
  await insertLines(client, {
    installationId: data.installationId,
    purchaseOrderId: data.id,
    lines: data.lines,
    actorId: data.actorId,
  });
  return getPurchaseOrderById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [data.warehouseId],
  });
}

export async function submitPurchaseOrder(client, data) {
  const result = await client.query(
    `UPDATE purchasing.purchase_orders
     SET status = 'pending_approval', submitted_at = clock_timestamp(),
         submitted_by = $1, revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $1
     WHERE installation_id = $2 AND id = $3
       AND status = 'draft' AND revision = $4
     RETURNING id, warehouse_id`,
    [data.actorId, data.installationId, data.id, data.expectedRevision],
  );
  if (!result.rows[0]) return null;
  return getPurchaseOrderById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function approvePurchaseOrder(client, data) {
  const result = await client.query(
    `UPDATE purchasing.purchase_orders
     SET status = 'approved', document_number = $1,
         document_number_allocation_id = $2, approved_at = clock_timestamp(),
         approved_by = $3, revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $3
     WHERE installation_id = $4 AND id = $5
       AND status = 'pending_approval' AND revision = $6
     RETURNING id, warehouse_id`,
    [
      data.documentNumber, data.documentNumberAllocationId, data.actorId,
      data.installationId, data.id, data.expectedRevision,
    ],
  );
  if (!result.rows[0]) return null;
  return getPurchaseOrderById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function cancelPurchaseOrder(client, data) {
  const result = await client.query(
    `UPDATE purchasing.purchase_orders
     SET status = 'cancelled', cancelled_at = clock_timestamp(),
         cancelled_by = $1, cancellation_reason = $2,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $1
     WHERE installation_id = $3 AND id = $4
       AND status = ANY($5::text[]) AND revision = $6
     RETURNING id, warehouse_id`,
    [
      data.actorId, data.reason, data.installationId, data.id,
      ['draft', 'pending_approval', 'approved'], data.expectedRevision,
    ],
  );
  if (!result.rows[0]) return null;
  return getPurchaseOrderById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}
