import { randomUUID } from 'node:crypto';

const HEADER_COLUMNS = `sr.id, sr.installation_id, sr.supplier_id,
  s.code AS supplier_code, s.name AS supplier_name,
  sr.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
  sr.status, sr.document_number, sr.document_number_allocation_id,
  sr.return_date, sr.note, sr.revision,
  sr.submitted_at, sr.submitted_by, sr.approved_at, sr.approved_by,
  sr.cancelled_at, sr.cancelled_by, sr.cancellation_reason,
  sr.posted_at, sr.posted_by, sr.reversed_at, sr.reversed_by, sr.reversal_reason,
  sr.inventory_movement_id, sr.inventory_reversal_movement_id,
  sr.created_at, sr.updated_at, sr.created_by, sr.updated_by`;

const LINE_COLUMNS = `srl.id, srl.installation_id, srl.supplier_return_id,
  srl.line_number,
  srl.source_goods_receipt_id, srl.source_goods_receipt_number, srl.source_goods_receipt_status,
  srl.source_goods_receipt_line_id, srl.source_goods_receipt_line_number,
  srl.source_purchase_order_id, srl.source_purchase_order_number, srl.source_purchase_order_line_id,
  srl.source_purchase_order_line_number, srl.source_supplier_id, srl.source_supplier_code,
  srl.source_supplier_name, srl.source_warehouse_id, srl.source_warehouse_code,
  srl.source_warehouse_name, srl.source_variant_id, srl.source_sku_snapshot,
  srl.source_item_name_snapshot, srl.source_unit_id, srl.source_unit_code_snapshot,
  srl.base_variant_id, srl.base_sku_snapshot, srl.conversion_to_base,
  srl.source_accepted_quantity, srl.return_quantity, srl.base_quantity,
  srl.reason_code, srl.reason_note, srl.location_id, srl.lot_id, srl.lot_code_snapshot,
  srl.manufactured_date, srl.expiry_date, srl.supplier_lot_reference, srl.note,
  srl.created_at, srl.updated_at, srl.created_by, srl.updated_by`;

function normalizedWarehouseIds(warehouseIds) {
  return Array.isArray(warehouseIds)
    ? [...new Set(warehouseIds.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    : [];
}

function appendWarehouseScope(query, params, warehouseIds, column = 'sr.warehouse_id') {
  const scoped = normalizedWarehouseIds(warehouseIds);
  if (scoped.length === 0) return { query: `${query} AND false`, params };
  params.push(scoped);
  return { query: `${query} AND ${column} = ANY($${params.length}::uuid[])`, params };
}

function lineParameters(line, actorId, now, supplierReturnId) {
  return [
    line.id ?? randomUUID(),
    line.installationId,
    supplierReturnId,
    line.lineNumber,
    line.sourceGoodsReceiptId,
    line.sourceGoodsReceiptNumber,
    line.sourceGoodsReceiptStatus,
    line.sourceGoodsReceiptLineId,
    line.sourceGoodsReceiptLineNumber,
    line.sourcePurchaseOrderId,
    line.sourcePurchaseOrderNumber,
    line.sourcePurchaseOrderLineId,
    line.sourcePurchaseOrderLineNumber,
    line.sourceSupplierId,
    line.sourceSupplierCode,
    line.sourceSupplierName,
    line.sourceWarehouseId,
    line.sourceWarehouseCode,
    line.sourceWarehouseName,
    line.sourceVariantId,
    line.sourceSkuSnapshot,
    line.sourceItemNameSnapshot,
    line.sourceUnitId,
    line.sourceUnitCodeSnapshot,
    line.baseVariantId,
    line.baseSkuSnapshot,
    line.conversionToBase,
    line.sourceAcceptedQuantity,
    line.returnQuantity,
    line.baseQuantity,
    line.reasonCode,
    line.reasonNote,
    line.locationId,
    line.lotId,
    line.lotCodeSnapshot,
    line.manufacturedDate,
    line.expiryDate,
    line.supplierLotReference,
    line.note,
    now,
    actorId,
  ];
}

async function getSummary(client, { installationId, returnId }) {
  const result = await client.query(
    `SELECT
       COUNT(*)::int AS line_count,
       COALESCE(SUM(srl.return_quantity), 0::numeric) AS return_quantity_total,
       COALESCE(SUM(srl.base_quantity), 0::numeric) AS base_quantity_total
     FROM purchasing.supplier_return_lines srl
     WHERE srl.installation_id = $1 AND srl.supplier_return_id = $2`,
    [installationId, returnId],
  );
  return result.rows[0] ?? null;
}

export async function listSupplierReturns(client, {
  installationId,
  warehouseIds,
  supplierId = null,
  status = null,
  search = null,
  limit = 100,
  offset = 0,
}) {
  const params = [installationId];
  let query = `SELECT ${HEADER_COLUMNS},
      COALESCE(summary.line_count, 0)::int AS line_count,
      COALESCE(summary.return_quantity_total, 0::numeric) AS return_quantity_total,
      COALESCE(summary.base_quantity_total, 0::numeric) AS base_quantity_total
    FROM purchasing.supplier_returns sr
    JOIN shared.suppliers s
      ON s.installation_id = sr.installation_id AND s.id = sr.supplier_id
    JOIN shared.warehouses w
      ON w.installation_id = sr.installation_id AND w.id = sr.warehouse_id
    LEFT JOIN (
      SELECT srl.supplier_return_id,
             COUNT(*)::int AS line_count,
             COALESCE(SUM(srl.return_quantity), 0::numeric) AS return_quantity_total,
             COALESCE(SUM(srl.base_quantity), 0::numeric) AS base_quantity_total
        FROM purchasing.supplier_return_lines srl
       WHERE srl.installation_id = $1
       GROUP BY srl.supplier_return_id
    ) summary
      ON summary.supplier_return_id = sr.id
    WHERE sr.installation_id = $1`;

  ({ query } = appendWarehouseScope(query, params, warehouseIds));
  if (supplierId) {
    params.push(supplierId);
    query += ` AND sr.supplier_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    query += ` AND sr.status = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (
      COALESCE(sr.document_number, '') ILIKE $${params.length}
      OR s.code ILIKE $${params.length}
      OR s.name ILIKE $${params.length}
      OR COALESCE(sr.note, '') ILIKE $${params.length}
    )`;
  }
  params.push(limit, offset);
  query += ` ORDER BY sr.return_date DESC, sr.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getSupplierReturnLines(client, { installationId, returnId }) {
  const result = await client.query(
    `SELECT ${LINE_COLUMNS},
      COALESCE(posted_summary.posted_return_quantity, 0::numeric) AS posted_return_quantity,
      GREATEST(
        srl.source_accepted_quantity - COALESCE(posted_summary.posted_return_quantity, 0::numeric),
        0::numeric
      ) AS returnable_quantity
     FROM purchasing.supplier_return_lines srl
     LEFT JOIN (
       SELECT line.source_goods_receipt_line_id,
              SUM(line.return_quantity)::numeric(20,6) AS posted_return_quantity
         FROM purchasing.supplier_return_lines line
         JOIN purchasing.supplier_returns sr
           ON sr.installation_id = line.installation_id
          AND sr.id = line.supplier_return_id
        WHERE line.installation_id = $1
          AND sr.status = 'posted'
        GROUP BY line.source_goods_receipt_line_id
     ) posted_summary
       ON posted_summary.source_goods_receipt_line_id = srl.source_goods_receipt_line_id
     WHERE srl.installation_id = $1 AND srl.supplier_return_id = $2
     ORDER BY srl.line_number ASC`,
    [installationId, returnId],
  );
  return result.rows;
}

export async function getSourceGoodsReceiptLines(client, { installationId, lineIds }) {
  if (!Array.isArray(lineIds) || lineIds.length === 0) return [];
  const result = await client.query(
    `SELECT
       gr.id AS source_goods_receipt_id,
       gr.document_number AS source_goods_receipt_number,
       gr.status AS source_goods_receipt_status,
       gr.purchase_order_id AS source_purchase_order_id,
       po.document_number AS source_purchase_order_number,
       gr.warehouse_id AS source_warehouse_id,
       w.code AS source_warehouse_code,
       w.name AS source_warehouse_name,
       po.supplier_id AS source_supplier_id,
       s.code AS source_supplier_code,
       s.name AS source_supplier_name,
       grl.id AS source_goods_receipt_line_id,
       grl.line_number AS source_goods_receipt_line_number,
       grl.purchase_order_line_id AS source_purchase_order_line_id,
       pol.line_number AS source_purchase_order_line_number,
       grl.variant_id AS source_variant_id,
       grl.sku_snapshot AS source_sku_snapshot,
       grl.item_name_snapshot AS source_item_name_snapshot,
       grl.unit_id AS source_unit_id,
       grl.unit_code_snapshot AS source_unit_code_snapshot,
       base_variant.id AS base_variant_id,
       base_variant.sku AS base_sku_snapshot,
       grl.conversion_to_base,
       grl.accepted_quantity AS source_accepted_quantity,
       grl.location_id,
       grl.lot_id,
       grl.lot_code_snapshot,
       grl.manufactured_date,
       grl.expiry_date,
       grl.supplier_lot_reference
     FROM purchasing.goods_receipt_lines grl
     JOIN purchasing.goods_receipts gr
       ON gr.installation_id = grl.installation_id AND gr.id = grl.goods_receipt_id
     JOIN purchasing.purchase_order_lines pol
       ON pol.installation_id = grl.installation_id AND pol.id = grl.purchase_order_line_id
     JOIN purchasing.purchase_orders po
       ON po.installation_id = gr.installation_id AND po.id = gr.purchase_order_id
     JOIN shared.product_variants source_variant
       ON source_variant.installation_id = grl.installation_id AND source_variant.id = grl.variant_id
     JOIN shared.product_variants base_variant
       ON base_variant.installation_id = source_variant.installation_id
      AND base_variant.product_id = source_variant.product_id
      AND base_variant.is_inventory_base = true
     JOIN shared.suppliers s
       ON s.installation_id = po.installation_id AND s.id = po.supplier_id
     JOIN shared.warehouses w
       ON w.installation_id = gr.installation_id AND w.id = gr.warehouse_id
     WHERE grl.installation_id = $1
       AND grl.id = ANY($2::uuid[])`,
    [installationId, lineIds],
  );
  return result.rows;
}

export async function getSupplierReturnById(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const params = [installationId, id];
  let query = `SELECT ${HEADER_COLUMNS}
    FROM purchasing.supplier_returns sr
    JOIN shared.suppliers s
      ON s.installation_id = sr.installation_id AND s.id = sr.supplier_id
    JOIN shared.warehouses w
      ON w.installation_id = sr.installation_id AND w.id = sr.warehouse_id
    WHERE sr.installation_id = $1 AND sr.id = $2`;
  ({ query } = appendWarehouseScope(query, params, warehouseIds));
  if (forUpdate) query += ' FOR UPDATE OF sr';
  const header = (await client.query(query, params)).rows[0] ?? null;
  if (!header) return null;
  const summary = await getSummary(client, { installationId, returnId: id });
  return {
    ...header,
    line_count: summary?.line_count ?? 0,
    return_quantity_total: summary?.return_quantity_total ?? '0',
    base_quantity_total: summary?.base_quantity_total ?? '0',
    lines: await getSupplierReturnLines(client, { installationId, returnId: id }),
  };
}

export async function getSourceGoodsReceiptLineById(client, { installationId, id }) {
  const rows = await getSourceGoodsReceiptLines(client, { installationId, lineIds: [id] });
  return rows[0] ?? null;
}

export async function insertSupplierReturnDraft(client, data) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO purchasing.supplier_returns
      (id, installation_id, supplier_id, warehouse_id, status,
       return_date, note, revision, created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'draft',$5,$6,1,$7,$7,$8,$8)`,
    [
      id,
      data.installationId,
      data.supplierId,
      data.warehouseId,
      data.returnDate,
      data.note,
      now,
      data.actorId,
    ],
  );
  for (const [index, line] of data.lines.entries()) {
    await client.query(
      `INSERT INTO purchasing.supplier_return_lines
       (id, installation_id, supplier_return_id, line_number,
        source_goods_receipt_id, source_goods_receipt_number, source_goods_receipt_status,
        source_goods_receipt_line_id, source_goods_receipt_line_number,
        source_purchase_order_id, source_purchase_order_number, source_purchase_order_line_id,
        source_purchase_order_line_number, source_supplier_id, source_supplier_code,
        source_supplier_name, source_warehouse_id, source_warehouse_code, source_warehouse_name,
        source_variant_id, source_sku_snapshot, source_item_name_snapshot, source_unit_id,
        source_unit_code_snapshot, base_variant_id, base_sku_snapshot, conversion_to_base,
        source_accepted_quantity, return_quantity, base_quantity, reason_code, reason_note,
        location_id, lot_id, lot_code_snapshot, manufactured_date, expiry_date,
        supplier_lot_reference, note, created_at, updated_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$40,$41,$41)` ,
      lineParameters({ ...line, installationId: data.installationId, lineNumber: index + 1 }, data.actorId, now, id),
    );
  }
  return getSupplierReturnById(client, {
    installationId: data.installationId,
    id,
    warehouseIds: [data.warehouseId],
  });
}

export async function replaceSupplierReturnLines(client, data) {
  await client.query(
    'DELETE FROM purchasing.supplier_return_lines WHERE installation_id = $1 AND supplier_return_id = $2',
    [data.installationId, data.supplierReturnId],
  );
  const now = new Date().toISOString();
  for (const [index, line] of data.lines.entries()) {
    await client.query(
      `INSERT INTO purchasing.supplier_return_lines
       (id, installation_id, supplier_return_id, line_number,
        source_goods_receipt_id, source_goods_receipt_number, source_goods_receipt_status,
        source_goods_receipt_line_id, source_goods_receipt_line_number,
        source_purchase_order_id, source_purchase_order_number, source_purchase_order_line_id,
        source_purchase_order_line_number, source_supplier_id, source_supplier_code,
        source_supplier_name, source_warehouse_id, source_warehouse_code, source_warehouse_name,
        source_variant_id, source_sku_snapshot, source_item_name_snapshot, source_unit_id,
        source_unit_code_snapshot, base_variant_id, base_sku_snapshot, conversion_to_base,
        source_accepted_quantity, return_quantity, base_quantity, reason_code, reason_note,
        location_id, lot_id, lot_code_snapshot, manufactured_date, expiry_date,
        supplier_lot_reference, note, created_at, updated_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$40,$41,$41)` ,
      lineParameters({ ...line, installationId: data.installationId, lineNumber: index + 1 }, data.actorId, now, data.supplierReturnId),
    );
  }
  return getSupplierReturnLines(client, { installationId: data.installationId, returnId: data.supplierReturnId });
}

export async function updateSupplierReturnDraft(client, data) {
  const result = await client.query(
    `UPDATE purchasing.supplier_returns
     SET supplier_id = $1,
         warehouse_id = $2,
         return_date = $3,
         note = $4,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $5
     WHERE installation_id = $6 AND id = $7
       AND status = 'draft' AND revision = $8
     RETURNING id, warehouse_id`,
    [
      data.supplierId,
      data.warehouseId,
      data.returnDate,
      data.note,
      data.actorId,
      data.installationId,
      data.id,
      data.expectedRevision,
    ],
  );
  if (!result.rows[0]) return null;
  await replaceSupplierReturnLines(client, {
    installationId: data.installationId,
    supplierReturnId: data.id,
    lines: data.lines,
    actorId: data.actorId,
  });
  return getSupplierReturnById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function submitSupplierReturn(client, data) {
  const result = await client.query(
    `UPDATE purchasing.supplier_returns
     SET status = 'pending_approval',
         submitted_at = clock_timestamp(),
         submitted_by = $1,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $1
     WHERE installation_id = $2 AND id = $3
       AND status = 'draft' AND revision = $4
     RETURNING id, warehouse_id`,
    [data.actorId, data.installationId, data.id, data.expectedRevision],
  );
  if (!result.rows[0]) return null;
  return getSupplierReturnById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function approveSupplierReturn(client, data) {
  const result = await client.query(
    `UPDATE purchasing.supplier_returns
     SET status = 'approved',
         approved_at = clock_timestamp(),
         approved_by = $1,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $1
     WHERE installation_id = $2 AND id = $3
       AND status = 'pending_approval' AND revision = $4
     RETURNING id, warehouse_id`,
    [data.actorId, data.installationId, data.id, data.expectedRevision],
  );
  if (!result.rows[0]) return null;
  return getSupplierReturnById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function cancelSupplierReturn(client, data) {
  const result = await client.query(
    `UPDATE purchasing.supplier_returns
     SET status = 'cancelled',
         cancelled_at = clock_timestamp(),
         cancelled_by = $1,
         cancellation_reason = $2,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $1
     WHERE installation_id = $3 AND id = $4
       AND status IN ('draft', 'pending_approval', 'approved') AND revision = $5
     RETURNING id, warehouse_id`,
    [data.actorId, data.cancellationReason, data.installationId, data.id, data.expectedRevision],
  );
  if (!result.rows[0]) return null;
  return getSupplierReturnById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function postSupplierReturn(client, data) {
  const result = await client.query(
    `UPDATE purchasing.supplier_returns
     SET status = 'posted',
         document_number = $1,
         document_number_allocation_id = $2,
         inventory_movement_id = $3,
         posted_at = clock_timestamp(),
         posted_by = $4,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $4
     WHERE installation_id = $5 AND id = $6
       AND status = 'approved' AND revision = $7
     RETURNING id, warehouse_id`,
    [
      data.documentNumber,
      data.documentNumberAllocationId,
      data.inventoryMovementId,
      data.actorId,
      data.installationId,
      data.id,
      data.expectedRevision,
    ],
  );
  if (!result.rows[0]) return null;
  return getSupplierReturnById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function reverseSupplierReturn(client, data) {
  const result = await client.query(
    `UPDATE purchasing.supplier_returns
     SET status = 'reversed',
         reversed_at = clock_timestamp(),
         reversed_by = $1,
         reversal_reason = $2,
         inventory_reversal_movement_id = $3,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $1
     WHERE installation_id = $4 AND id = $5
       AND status = 'posted' AND revision = $6
     RETURNING id, warehouse_id`,
    [
      data.actorId,
      data.reversalReason,
      data.inventoryReversalMovementId,
      data.installationId,
      data.id,
      data.expectedRevision,
    ],
  );
  if (!result.rows[0]) return null;
  return getSupplierReturnById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function hasBlockingSupplierReturnsForGoodsReceipt(client, { installationId, goodsReceiptId }) {
  const result = await client.query(
    `SELECT 1
       FROM purchasing.supplier_return_lines srl
       JOIN purchasing.supplier_returns sr
         ON sr.installation_id = srl.installation_id
        AND sr.id = srl.supplier_return_id
      WHERE srl.installation_id = $1
        AND srl.source_goods_receipt_id = $2
        AND sr.status IN ('pending_approval', 'approved', 'posted')
      LIMIT 1`,
    [installationId, goodsReceiptId],
  );
  return Boolean(result.rows[0]);
}
