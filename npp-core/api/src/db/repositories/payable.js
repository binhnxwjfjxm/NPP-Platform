import { randomUUID } from 'node:crypto';

export async function getPayableDocumentBySource(client, {
  installationId,
  sourceDocumentType,
  sourceDocumentId,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT pd.*,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM accounting.payable_documents pd
       JOIN shared.suppliers supplier
         ON supplier.installation_id = pd.installation_id
        AND supplier.id = pd.supplier_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = pd.installation_id
        AND warehouse.id = pd.warehouse_id
      WHERE pd.installation_id = $1
        AND pd.source_document_type = $2
        AND pd.source_document_id = $3::uuid
      ${forUpdate ? 'FOR UPDATE OF pd' : ''}`,
    [installationId, sourceDocumentType, sourceDocumentId],
  );
  return result.rows?.[0] ?? null;
}

export async function getPayableDocumentById(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT pd.*,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            COALESCE((
              SELECT jsonb_agg(to_jsonb(line) ORDER BY line.line_number)
                FROM accounting.payable_document_lines line
               WHERE line.installation_id = pd.installation_id
                 AND line.payable_document_id = pd.id
            ), '[]'::jsonb) AS lines,
            COALESCE((
              SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.occurred_at, entry.id)
                FROM accounting.payable_ledger_entries entry
               WHERE entry.installation_id = pd.installation_id
                 AND entry.payable_document_id = pd.id
            ), '[]'::jsonb) AS ledger_entries
       FROM accounting.payable_documents pd
       JOIN shared.suppliers supplier
         ON supplier.installation_id = pd.installation_id
        AND supplier.id = pd.supplier_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = pd.installation_id
        AND warehouse.id = pd.warehouse_id
      WHERE pd.installation_id = $1
        AND pd.id = $2::uuid
        AND pd.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF pd' : ''}`,
    [installationId, id, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function listPayableDocuments(client, {
  installationId,
  warehouseIds,
  supplierId = null,
  warehouseId = null,
  status = null,
  direction = null,
  search = null,
  dueBefore = null,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT pd.*,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM accounting.payable_documents pd
       JOIN shared.suppliers supplier
         ON supplier.installation_id = pd.installation_id
        AND supplier.id = pd.supplier_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = pd.installation_id
        AND warehouse.id = pd.warehouse_id
      WHERE pd.installation_id = $1
        AND pd.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR pd.supplier_id = $3::uuid)
        AND ($4::uuid IS NULL OR pd.warehouse_id = $4::uuid)
        AND ($5::text IS NULL OR pd.status = $5::text)
        AND ($6::text IS NULL OR pd.direction = $6::text)
        AND ($7::date IS NULL OR pd.due_date <= $7::date)
        AND (
          $8::text IS NULL
          OR pd.source_document_number ILIKE '%' || $8 || '%'
          OR supplier.code ILIKE '%' || $8 || '%'
          OR supplier.name ILIKE '%' || $8 || '%'
        )
      ORDER BY pd.source_document_date DESC, pd.created_at DESC, pd.id
      LIMIT $9 OFFSET $10`,
    [installationId, warehouseIds, supplierId, warehouseId, status, direction, dueBefore, search, limit, offset],
  );
  return result.rows ?? [];
}

export async function listSupplierPayableBalances(client, {
  installationId,
  warehouseIds,
  supplierId = null,
  search = null,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `WITH scoped_balances AS (
       SELECT document.installation_id,
              document.supplier_id,
              entry.currency_code,
              sum(entry.amount)::numeric(20,6) AS balance,
              max(entry.occurred_at) AS updated_at
         FROM accounting.payable_ledger_entries entry
         JOIN accounting.payable_documents document
           ON document.installation_id = entry.installation_id
          AND document.id = entry.payable_document_id
        WHERE document.installation_id = $1
          AND document.warehouse_id = ANY($2::uuid[])
        GROUP BY document.installation_id, document.supplier_id, entry.currency_code
     )
     SELECT balance.installation_id,
            balance.supplier_id,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            balance.currency_code,
            balance.balance,
            balance.updated_at,
            COALESCE(open_docs.open_amount, 0)::numeric(20,6) AS open_amount,
            COALESCE(open_docs.overdue_amount, 0)::numeric(20,6) AS overdue_amount,
            COALESCE(open_docs.open_document_count, 0)::bigint AS open_document_count
       FROM scoped_balances balance
       JOIN shared.suppliers supplier
         ON supplier.installation_id = balance.installation_id
        AND supplier.id = balance.supplier_id
       LEFT JOIN LATERAL (
         SELECT sum(CASE WHEN pd.direction = 'DEBIT' THEN pd.remaining_amount ELSE -pd.remaining_amount END) AS open_amount,
                sum(CASE WHEN pd.due_date < current_date THEN
                      CASE WHEN pd.direction = 'DEBIT' THEN pd.remaining_amount ELSE -pd.remaining_amount END
                    ELSE 0 END) AS overdue_amount,
                count(*) AS open_document_count
           FROM accounting.payable_documents pd
          WHERE pd.installation_id = balance.installation_id
            AND pd.supplier_id = balance.supplier_id
            AND pd.currency_code = balance.currency_code
            AND pd.warehouse_id = ANY($2::uuid[])
            AND pd.status IN ('open', 'partially_allocated')
       ) open_docs ON true
      WHERE ($3::uuid IS NULL OR balance.supplier_id = $3::uuid)
        AND (
          $4::text IS NULL
          OR supplier.code ILIKE '%' || $4 || '%'
          OR supplier.name ILIKE '%' || $4 || '%'
        )
      ORDER BY supplier.code, balance.currency_code
      LIMIT $5 OFFSET $6`,
    [installationId, warehouseIds, supplierId, search, limit, offset],
  );
  return result.rows ?? [];
}

export async function getGoodsReceiptPayableSource(client, { installationId, goodsReceiptId }) {
  const headerResult = await client.query(
    `SELECT gr.id, gr.installation_id, gr.warehouse_id, gr.document_number,
            gr.receipt_date, gr.revision, gr.posted_at, gr.posted_by, gr.status,
            po.supplier_id, po.currency_code,
            COALESCE(term.payment_method, 'UNSPECIFIED') AS payment_method,
            COALESCE(term.term_days, 0) AS term_days
       FROM purchasing.goods_receipts gr
       JOIN purchasing.purchase_orders po
         ON po.installation_id = gr.installation_id
        AND po.id = gr.purchase_order_id
       LEFT JOIN LATERAL (
         SELECT spt.payment_method, COALESCE(spt.term_days, 0) AS term_days
           FROM shared.supplier_payment_terms spt
          WHERE spt.installation_id = gr.installation_id
            AND spt.supplier_id = po.supplier_id
            AND spt.is_active = true
            AND spt.is_primary = true
          ORDER BY spt.created_at, spt.id
          LIMIT 1
       ) term ON true
      WHERE gr.installation_id = $1
        AND gr.id = $2::uuid
        AND gr.status = 'posted'
      FOR SHARE OF gr, po`,
    [installationId, goodsReceiptId],
  );
  const header = headerResult.rows?.[0];
  if (!header) return null;
  const lineResult = await client.query(
    `SELECT grl.id AS source_goods_receipt_line_id,
            grl.purchase_order_line_id AS source_purchase_order_line_id,
            grl.line_number,
            grl.sku_snapshot,
            grl.item_name_snapshot,
            grl.unit_code_snapshot,
            grl.accepted_quantity AS quantity,
            pol.ordered_quantity,
            pol.unit_price,
            pol.discount_amount AS order_discount_amount,
            pol.tax_amount AS order_tax_amount
       FROM purchasing.goods_receipt_lines grl
       JOIN purchasing.purchase_order_lines pol
         ON pol.installation_id = grl.installation_id
        AND pol.id = grl.purchase_order_line_id
      WHERE grl.installation_id = $1
        AND grl.goods_receipt_id = $2::uuid
        AND grl.accepted_quantity > 0
      ORDER BY grl.line_number
      FOR SHARE OF grl, pol`,
    [installationId, goodsReceiptId],
  );
  return { ...header, lines: lineResult.rows ?? [] };
}

export async function getSupplierReturnPayableSource(client, { installationId, supplierReturnId }) {
  const headerResult = await client.query(
    `SELECT sr.id, sr.installation_id, sr.supplier_id, sr.warehouse_id,
            sr.document_number, sr.return_date, sr.revision,
            sr.posted_at, sr.posted_by, sr.status
       FROM purchasing.supplier_returns sr
      WHERE sr.installation_id = $1
        AND sr.id = $2::uuid
        AND sr.status = 'posted'
      FOR SHARE OF sr`,
    [installationId, supplierReturnId],
  );
  const header = headerResult.rows?.[0];
  if (!header) return null;
  const lineResult = await client.query(
    `SELECT srl.id AS source_supplier_return_line_id,
            srl.line_number,
            srl.source_goods_receipt_line_id,
            srl.source_purchase_order_line_id,
            srl.source_sku_snapshot AS sku_snapshot,
            srl.source_item_name_snapshot AS item_name_snapshot,
            srl.source_unit_code_snapshot AS unit_code_snapshot,
            srl.return_quantity AS quantity,
            debit_line.quantity AS source_quantity,
            debit_line.unit_price,
            debit_line.gross_amount AS source_gross_amount,
            debit_line.discount_amount AS source_discount_amount,
            debit_line.tax_amount AS source_tax_amount,
            debit_line.line_amount AS source_line_amount,
            debit_document.currency_code
       FROM purchasing.supplier_return_lines srl
       JOIN accounting.payable_document_lines debit_line
         ON debit_line.installation_id = srl.installation_id
        AND debit_line.source_goods_receipt_line_id = srl.source_goods_receipt_line_id
        AND debit_line.source_supplier_return_line_id IS NULL
       JOIN accounting.payable_documents debit_document
         ON debit_document.installation_id = debit_line.installation_id
        AND debit_document.id = debit_line.payable_document_id
        AND debit_document.direction = 'DEBIT'
      WHERE srl.installation_id = $1
        AND srl.supplier_return_id = $2::uuid
      ORDER BY srl.line_number
      FOR SHARE OF srl, debit_line, debit_document`,
    [installationId, supplierReturnId],
  );
  return { ...header, lines: lineResult.rows ?? [] };
}

export async function getActiveCreditTotals(client, { installationId, sourceGoodsReceiptLineIds }) {
  if (!sourceGoodsReceiptLineIds.length) return new Map();
  const result = await client.query(
    `SELECT line.source_goods_receipt_line_id,
            sum(line.quantity)::numeric(20,6) AS credited_quantity,
            sum(line.gross_amount)::numeric(20,6) AS credited_gross,
            sum(line.discount_amount)::numeric(20,6) AS credited_discount,
            sum(line.tax_amount)::numeric(20,6) AS credited_tax,
            sum(line.line_amount)::numeric(20,6) AS credited_total
       FROM accounting.payable_document_lines line
       JOIN accounting.payable_documents document
         ON document.installation_id = line.installation_id
        AND document.id = line.payable_document_id
      WHERE line.installation_id = $1
        AND line.source_goods_receipt_line_id = ANY($2::uuid[])
        AND line.source_supplier_return_line_id IS NOT NULL
        AND document.direction = 'CREDIT'
        AND document.status <> 'reversed'
      GROUP BY line.source_goods_receipt_line_id`,
    [installationId, sourceGoodsReceiptLineIds],
  );
  return new Map((result.rows ?? []).map((row) => [row.source_goods_receipt_line_id, row]));
}

export async function insertPayableDocument(client, input) {
  const id = input.id ?? randomUUID();
  const result = await client.query(
    `INSERT INTO accounting.payable_documents (
       id, installation_id, supplier_id, warehouse_id, direction, document_type,
       source_document_type, source_document_id, source_document_number,
       source_document_date, currency_code, payment_method_snapshot,
       payment_term_days_snapshot, due_date, original_amount, allocated_amount,
       remaining_amount, status, source_revision, posting_origin, posted_at,
       posted_by, created_at, updated_at, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,$15,'open',$16,'runtime',$17,$18,$17,$17,$18,$18
     )
     RETURNING *`,
    [
      id, input.installationId, input.supplierId, input.warehouseId,
      input.direction, input.documentType, input.sourceDocumentType,
      input.sourceDocumentId, input.sourceDocumentNumber, input.sourceDocumentDate,
      input.currencyCode, input.paymentMethodSnapshot, input.paymentTermDaysSnapshot,
      input.dueDate, input.originalAmount, input.sourceRevision,
      input.postedAt, input.actorId,
    ],
  );
  return result.rows[0];
}

export async function insertPayableDocumentLines(client, { installationId, payableDocumentId, lines, actorId, createdAt }) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO accounting.payable_document_lines (
         id, installation_id, payable_document_id, line_number,
         source_goods_receipt_line_id, source_supplier_return_line_id,
         source_purchase_order_line_id, sku_snapshot, item_name_snapshot,
         unit_code_snapshot, quantity, unit_price, gross_amount,
         discount_amount, tax_amount, line_amount, created_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        line.id ?? randomUUID(), installationId, payableDocumentId, line.lineNumber,
        line.sourceGoodsReceiptLineId, line.sourceSupplierReturnLineId ?? null,
        line.sourcePurchaseOrderLineId, line.skuSnapshot, line.itemNameSnapshot,
        line.unitCodeSnapshot, line.quantity, line.unitPrice, line.grossAmount,
        line.discountAmount, line.taxAmount, line.lineAmount, createdAt, actorId,
      ],
    );
  }
}

export async function insertPayableLedgerEntry(client, input) {
  const result = await client.query(
    `INSERT INTO accounting.payable_ledger_entries (
       id, installation_id, payable_document_id, supplier_id, currency_code,
       entry_type, amount, source_document_type, source_document_id,
       source_document_number, source_revision, document_status_after,
       actor_id, request_id, source_app, occurred_at, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      input.id ?? randomUUID(), input.installationId, input.payableDocumentId,
      input.supplierId, input.currencyCode, input.entryType, input.amount,
      input.sourceDocumentType, input.sourceDocumentId, input.sourceDocumentNumber,
      input.sourceRevision, input.documentStatusAfter, input.actorId,
      input.requestId, input.sourceApp, input.occurredAt, input.metadata ?? {},
    ],
  );
  return result.rows[0];
}

export async function reversePayableDocument(client, {
  installationId,
  id,
  actorId,
  reversedAt,
  reversalReason,
}) {
  const result = await client.query(
    `UPDATE accounting.payable_documents
        SET status = 'reversed',
            remaining_amount = 0,
            reversed_at = $4,
            reversed_by = $3,
            reversal_reason = $5,
            revision = revision + 1,
            updated_at = $4,
            updated_by = $3
      WHERE installation_id = $1
        AND id = $2::uuid
        AND status <> 'reversed'
      RETURNING *`,
    [installationId, id, actorId, reversedAt, reversalReason],
  );
  return result.rows?.[0] ?? null;
}
