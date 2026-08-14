import { randomUUID } from 'node:crypto';

const HEADER_COLUMNS = `gr.id, gr.installation_id, gr.purchase_order_id,
  gr.warehouse_id, gr.status, gr.document_number, gr.document_number_allocation_id,
  gr.receipt_date, gr.supplier_delivery_reference, gr.note, gr.revision,
  gr.posted_at, gr.posted_by, gr.reversed_at, gr.reversed_by, gr.reversal_reason,
  gr.inventory_movement_id, gr.inventory_reversal_movement_id,
  gr.created_at, gr.updated_at, gr.created_by, gr.updated_by,
  po.document_number AS purchase_order_number,
  po.status AS purchase_order_status,
  s.code AS supplier_code,
  s.name AS supplier_name,
  w.code AS warehouse_code,
  w.name AS warehouse_name`;

const LINE_COLUMNS = `grl.id, grl.installation_id, grl.goods_receipt_id,
  grl.purchase_order_line_id, grl.warehouse_id, grl.line_number,
  grl.variant_id, grl.sku_snapshot, grl.item_name_snapshot,
  grl.unit_id, grl.unit_code_snapshot, grl.conversion_to_base,
  grl.ordered_quantity, grl.received_quantity_before, grl.remaining_quantity_before,
  grl.received_quantity, grl.accepted_quantity, grl.rejected_quantity,
  grl.shortage_closed_quantity, grl.finalize_line, grl.quality_reason_code,
  grl.quality_note, grl.base_quantity, grl.remaining_quantity_after,
  grl.location_id, grl.lot_id, grl.lot_code_snapshot, grl.manufactured_date,
  grl.expiry_date, grl.supplier_lot_reference, grl.note,
  grl.created_at, grl.updated_at, grl.created_by, grl.updated_by,
  pol.line_number AS purchase_order_line_number,
  tracking_base_variant.id AS tracking_base_variant_id,
  tracking_policy.lot_tracking_mode,
  tracking_policy.expiry_tracking_mode,
  tracking_policy.location_required`;

function normalizedWarehouseIds(warehouseIds) {
  return Array.isArray(warehouseIds)
    ? [...new Set(warehouseIds.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    : [];
}

function appendWarehouseScope(query, params, warehouseIds, column = 'gr.warehouse_id') {
  const scoped = normalizedWarehouseIds(warehouseIds);
  if (scoped.length === 0) return { query: `${query} AND false`, params };
  params.push(scoped);
  return { query: `${query} AND ${column} = ANY($${params.length}::uuid[])`, params };
}

async function getReceiptSummary(client, { installationId, receiptId }) {
  const result = await client.query(
    `SELECT
       COUNT(*)::int AS line_count,
       COALESCE(SUM(grl.received_quantity), 0::numeric) AS received_quantity_total,
       COALESCE(SUM(grl.accepted_quantity), 0::numeric) AS accepted_quantity_total,
       COALESCE(SUM(grl.rejected_quantity), 0::numeric) AS rejected_quantity_total,
       COALESCE(SUM(grl.shortage_closed_quantity), 0::numeric) AS shortage_closed_quantity_total,
       COALESCE(SUM(grl.base_quantity), 0::numeric) AS base_quantity_total
     FROM purchasing.goods_receipt_lines grl
     WHERE grl.installation_id = $1 AND grl.goods_receipt_id = $2`,
    [installationId, receiptId],
  );
  return result.rows[0] ?? null;
}

export async function listGoodsReceipts(client, {
  installationId,
  warehouseIds,
  purchaseOrderId,
  status,
  search,
  limit = 100,
  offset = 0,
}) {
  const params = [installationId];
  let query = `SELECT ${HEADER_COLUMNS},
      COALESCE(summary.line_count, 0)::int AS line_count,
      COALESCE(summary.received_quantity_total, 0::numeric) AS received_quantity_total,
      COALESCE(summary.accepted_quantity_total, 0::numeric) AS accepted_quantity_total,
      COALESCE(summary.rejected_quantity_total, 0::numeric) AS rejected_quantity_total,
      COALESCE(summary.shortage_closed_quantity_total, 0::numeric) AS shortage_closed_quantity_total,
      COALESCE(summary.base_quantity_total, 0::numeric) AS base_quantity_total
    FROM purchasing.goods_receipts gr
    JOIN purchasing.purchase_orders po
      ON po.installation_id = gr.installation_id AND po.id = gr.purchase_order_id
    JOIN shared.suppliers s
      ON s.installation_id = po.installation_id AND s.id = po.supplier_id
    JOIN shared.warehouses w
      ON w.installation_id = gr.installation_id AND w.id = gr.warehouse_id
    LEFT JOIN (
      SELECT grl.goods_receipt_id,
             COUNT(*)::int AS line_count,
             COALESCE(SUM(grl.received_quantity), 0::numeric) AS received_quantity_total,
             COALESCE(SUM(grl.accepted_quantity), 0::numeric) AS accepted_quantity_total,
             COALESCE(SUM(grl.rejected_quantity), 0::numeric) AS rejected_quantity_total,
             COALESCE(SUM(grl.shortage_closed_quantity), 0::numeric) AS shortage_closed_quantity_total,
             COALESCE(SUM(grl.base_quantity), 0::numeric) AS base_quantity_total
      FROM purchasing.goods_receipt_lines grl
      WHERE grl.installation_id = $1
      GROUP BY grl.goods_receipt_id
    ) summary
      ON summary.goods_receipt_id = gr.id
    WHERE gr.installation_id = $1`;

  ({ query } = appendWarehouseScope(query, params, warehouseIds));
  if (purchaseOrderId) {
    params.push(purchaseOrderId);
    query += ` AND gr.purchase_order_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    query += ` AND gr.status = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (
      COALESCE(gr.document_number, '') ILIKE $${params.length}
      OR COALESCE(po.document_number, '') ILIKE $${params.length}
      OR s.code ILIKE $${params.length}
      OR s.name ILIKE $${params.length}
      OR COALESCE(gr.supplier_delivery_reference, '') ILIKE $${params.length}
    )`;
  }
  params.push(limit, offset);
  query += ` ORDER BY gr.receipt_date DESC, gr.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await client.query(query, params)).rows;
}

export async function getGoodsReceiptLines(client, { installationId, receiptId }) {
  const result = await client.query(
    `SELECT ${LINE_COLUMNS}
     FROM purchasing.goods_receipt_lines grl
     JOIN purchasing.purchase_order_lines pol
       ON pol.installation_id = grl.installation_id
      AND pol.id = grl.purchase_order_line_id
     JOIN shared.product_variants source_variant
       ON source_variant.installation_id = grl.installation_id
      AND source_variant.id = grl.variant_id
     LEFT JOIN shared.product_variants tracking_base_variant
       ON tracking_base_variant.installation_id = source_variant.installation_id
      AND tracking_base_variant.product_id = source_variant.product_id
      AND tracking_base_variant.is_inventory_base = true
      AND tracking_base_variant.is_active = true
     LEFT JOIN inventory.product_tracking_policies tracking_policy
       ON tracking_policy.installation_id = grl.installation_id
      AND tracking_policy.base_variant_id = tracking_base_variant.id
     WHERE grl.installation_id = $1 AND grl.goods_receipt_id = $2
     ORDER BY grl.line_number ASC`,
    [installationId, receiptId],
  );
  return result.rows;
}

export async function getGoodsReceiptById(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const params = [installationId, id];
  let query = `SELECT ${HEADER_COLUMNS}
    FROM purchasing.goods_receipts gr
    JOIN purchasing.purchase_orders po
      ON po.installation_id = gr.installation_id AND po.id = gr.purchase_order_id
    JOIN shared.suppliers s
      ON s.installation_id = po.installation_id AND s.id = po.supplier_id
    JOIN shared.warehouses w
      ON w.installation_id = gr.installation_id AND w.id = gr.warehouse_id
    WHERE gr.installation_id = $1 AND gr.id = $2`;
  ({ query } = appendWarehouseScope(query, params, warehouseIds));
  if (forUpdate) query += ' FOR UPDATE OF gr';
  const receipt = (await client.query(query, params)).rows[0] ?? null;
  if (!receipt) return null;
  const summary = await getReceiptSummary(client, { installationId, receiptId: id });
  return {
    ...receipt,
    line_count: summary?.line_count ?? 0,
    received_quantity_total: summary?.received_quantity_total ?? '0',
    accepted_quantity_total: summary?.accepted_quantity_total ?? '0',
    rejected_quantity_total: summary?.rejected_quantity_total ?? '0',
    shortage_closed_quantity_total: summary?.shortage_closed_quantity_total ?? '0',
    base_quantity_total: summary?.base_quantity_total ?? '0',
    lines: await getGoodsReceiptLines(client, { installationId, receiptId: id }),
  };
}

function lineParameters(line, actorId, now) {
  return [
    line.id,
    line.installationId,
    line.goodsReceiptId,
    line.purchaseOrderLineId,
    line.warehouseId,
    line.lineNumber,
    line.variantId,
    line.skuSnapshot,
    line.itemNameSnapshot,
    line.unitId,
    line.unitCodeSnapshot,
    line.conversionToBase,
    line.orderedQuantity,
    line.receivedQuantityBefore,
    line.remainingQuantityBefore,
    line.receivedQuantity,
    line.acceptedQuantity,
    line.rejectedQuantity,
    line.shortageClosedQuantity,
    line.finalizeLine,
    line.qualityReasonCode,
    line.qualityNote,
    line.baseQuantity,
    line.remainingQuantityAfter,
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

export async function insertGoodsReceiptDraft(client, data) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO purchasing.goods_receipts
      (id, installation_id, purchase_order_id, warehouse_id, status,
       receipt_date, supplier_delivery_reference, note, revision,
       created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,1,$8,$8,$9,$9)`,
    [
      id,
      data.installationId,
      data.purchaseOrderId,
      data.warehouseId,
      data.receiptDate,
      data.supplierDeliveryReference,
      data.note,
      now,
      data.actorId,
    ],
  );
  for (const line of data.lines) {
    await client.query(
      `INSERT INTO purchasing.goods_receipt_lines
       (id, installation_id, goods_receipt_id, purchase_order_line_id, warehouse_id,
         line_number, variant_id, sku_snapshot, item_name_snapshot, unit_id,
         unit_code_snapshot, conversion_to_base, ordered_quantity,
         received_quantity_before, remaining_quantity_before, received_quantity,
         accepted_quantity, rejected_quantity, shortage_closed_quantity, finalize_line,
         quality_reason_code, quality_note, base_quantity, remaining_quantity_after,
         location_id, lot_id, lot_code_snapshot, manufactured_date, expiry_date,
         supplier_lot_reference, note, created_at, updated_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$32,$33,$33)`,
      lineParameters({ ...line, goodsReceiptId: id }, data.actorId, now),
    );
  }
  return getGoodsReceiptById(client, {
    installationId: data.installationId,
    id,
    warehouseIds: [data.warehouseId],
  });
}

export async function replaceGoodsReceiptLines(client, data) {
  await client.query(
    'DELETE FROM purchasing.goods_receipt_lines WHERE installation_id = $1 AND goods_receipt_id = $2',
    [data.installationId, data.goodsReceiptId],
  );
  const now = new Date().toISOString();
  for (const line of data.lines) {
    await client.query(
      `INSERT INTO purchasing.goods_receipt_lines
       (id, installation_id, goods_receipt_id, purchase_order_line_id, warehouse_id,
         line_number, variant_id, sku_snapshot, item_name_snapshot, unit_id,
         unit_code_snapshot, conversion_to_base, ordered_quantity,
         received_quantity_before, remaining_quantity_before, received_quantity,
         accepted_quantity, rejected_quantity, shortage_closed_quantity, finalize_line,
         quality_reason_code, quality_note, base_quantity, remaining_quantity_after,
         location_id, lot_id, lot_code_snapshot, manufactured_date, expiry_date,
         supplier_lot_reference, note, created_at, updated_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$32,$33,$33)`,
      lineParameters({ ...line, goodsReceiptId: data.goodsReceiptId }, data.actorId, now),
    );
  }
  return getGoodsReceiptLines(client, { installationId: data.installationId, receiptId: data.goodsReceiptId });
}

export async function updateGoodsReceiptDraft(client, data) {
  const result = await client.query(
    `UPDATE purchasing.goods_receipts
     SET purchase_order_id = $1,
         warehouse_id = $2,
         receipt_date = $3,
         supplier_delivery_reference = $4,
         note = $5,
         revision = revision + 1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $6
     WHERE installation_id = $7 AND id = $8
       AND status = 'draft' AND revision = $9
     RETURNING id, warehouse_id`,
    [
      data.purchaseOrderId,
      data.warehouseId,
      data.receiptDate,
      data.supplierDeliveryReference,
      data.note,
      data.actorId,
      data.installationId,
      data.id,
      data.expectedRevision,
    ],
  );
  if (!result.rows[0]) return null;
  await replaceGoodsReceiptLines(client, {
    installationId: data.installationId,
    goodsReceiptId: data.id,
    lines: data.lines,
    actorId: data.actorId,
  });
  return getGoodsReceiptById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function postGoodsReceipt(client, data) {
  const result = await client.query(
    `UPDATE purchasing.goods_receipts
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
       AND status = 'draft' AND revision = $7
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
  return getGoodsReceiptById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}

export async function reverseGoodsReceipt(client, data) {
  const result = await client.query(
    `UPDATE purchasing.goods_receipts
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
  return getGoodsReceiptById(client, {
    installationId: data.installationId,
    id: data.id,
    warehouseIds: [result.rows[0].warehouse_id],
  });
}
