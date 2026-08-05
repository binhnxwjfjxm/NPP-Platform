export async function setReceivableWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.receivable_write_context', 'receivable_service', true)",
  );
}

export async function lockReceivableSource(client, {
  installationId,
  sourceDocumentType,
  sourceDocumentId,
}) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`receivable:${installationId}:${sourceDocumentType}:${sourceDocumentId}`],
  );
}

export async function getReceivableDocumentBySource(client, {
  installationId,
  sourceDocumentType,
  sourceDocumentId,
}) {
  const result = await client.query(
    `SELECT id
       FROM accounting.receivable_documents
      WHERE installation_id = $1
        AND source_document_type = $2
        AND source_document_id = $3::uuid`,
    [installationId, sourceDocumentType, sourceDocumentId],
  );
  return result.rows[0] ?? null;
}

export async function getDeliveryAttemptSource(client, { installationId, attemptId }) {
  const headerResult = await client.query(
    `SELECT attempt.id,
            attempt.result,
            attempt.attempted_at AS occurred_at,
            attempt.request_id,
            delivery_order.id AS delivery_order_id,
            delivery_order.delivery_order_number,
            delivery_order.sales_order_id,
            delivery_order.sales_order_version_id,
            delivery_order.customer_id,
            delivery_order.customer_address_id,
            delivery_order.warehouse_id,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            delivery_order.warehouse_code_snapshot,
            delivery_order.warehouse_name_snapshot,
            delivery_order.collection_policy,
            sales_version.currency_code,
            sales_order.revision AS source_revision
       FROM logistics.delivery_attempts attempt
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = attempt.installation_id
        AND delivery_order.id = attempt.delivery_order_id
       JOIN sales.sales_orders sales_order
         ON sales_order.installation_id = delivery_order.installation_id
        AND sales_order.id = delivery_order.sales_order_id
       JOIN sales.sales_order_versions sales_version
         ON sales_version.installation_id = delivery_order.installation_id
        AND sales_version.id = delivery_order.sales_order_version_id
      WHERE attempt.installation_id = $1
        AND attempt.id = $2::uuid
        AND attempt.result IN ('delivered_full', 'delivered_partial')
      FOR SHARE OF attempt, delivery_order, sales_order, sales_version`,
    [installationId, attemptId],
  );
  const header = headerResult.rows[0];
  if (!header) return null;

  const lineResult = await client.query(
    `SELECT attempt_line.id AS delivery_attempt_line_id,
            attempt_line.inventory_issue_line_id,
            attempt_line.delivery_order_line_id,
            attempt_line.delivered_base_quantity AS accepted_base_quantity,
            delivery_line.sales_order_line_id,
            sales_line.base_quantity AS sales_line_base_quantity,
            sales_line.sku_snapshot,
            sales_line.item_name_snapshot,
            sales_line.unit_code_snapshot,
            sales_line.line_subtotal,
            sales_line.discount_amount,
            sales_line.tax_amount,
            sales_line.line_total,
            delivery_line.line_number
       FROM logistics.delivery_attempt_lines attempt_line
       JOIN sales.delivery_order_inventory_issue_lines issue_line
         ON issue_line.installation_id = attempt_line.installation_id
        AND issue_line.id = attempt_line.inventory_issue_line_id
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = attempt_line.installation_id
        AND delivery_line.id = attempt_line.delivery_order_line_id
       JOIN sales.sales_order_version_lines sales_line
         ON sales_line.installation_id = delivery_line.installation_id
        AND sales_line.id = delivery_line.sales_order_line_id
      WHERE attempt_line.installation_id = $1
        AND attempt_line.attempt_id = $2::uuid
        AND attempt_line.delivered_base_quantity > 0
      ORDER BY delivery_line.line_number, attempt_line.id`,
    [installationId, attemptId],
  );
  return { ...header, lines: lineResult.rows };
}

export async function getPickupHandoverSource(client, { installationId, issueId }) {
  const headerResult = await client.query(
    `SELECT issue.id,
            issue.posted_at AS occurred_at,
            delivery_order.id AS delivery_order_id,
            delivery_order.delivery_order_number,
            delivery_order.sales_order_id,
            delivery_order.sales_order_version_id,
            delivery_order.customer_id,
            delivery_order.customer_address_id,
            delivery_order.warehouse_id,
            delivery_order.customer_code_snapshot,
            delivery_order.customer_name_snapshot,
            delivery_order.warehouse_code_snapshot,
            delivery_order.warehouse_name_snapshot,
            delivery_order.collection_policy,
            sales_version.currency_code,
            sales_order.revision AS source_revision
       FROM sales.delivery_order_inventory_issues issue
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = issue.installation_id
        AND delivery_order.id = issue.delivery_order_id
       JOIN sales.sales_orders sales_order
         ON sales_order.installation_id = delivery_order.installation_id
        AND sales_order.id = delivery_order.sales_order_id
       JOIN sales.sales_order_versions sales_version
         ON sales_version.installation_id = delivery_order.installation_id
        AND sales_version.id = delivery_order.sales_order_version_id
      WHERE issue.installation_id = $1
        AND issue.id = $2::uuid
        AND issue.issue_source_type = 'PICKUP_HANDOVER'
        AND issue.status = 'POSTED'
        AND delivery_order.status = 'handed_over'
      FOR SHARE OF issue, delivery_order, sales_order, sales_version`,
    [installationId, issueId],
  );
  const header = headerResult.rows[0];
  if (!header) return null;

  const lineResult = await client.query(
    `SELECT NULL::uuid AS delivery_attempt_line_id,
            issue_line.id AS inventory_issue_line_id,
            issue_line.delivery_order_line_id,
            issue_line.issued_base_quantity AS accepted_base_quantity,
            delivery_line.sales_order_line_id,
            sales_line.base_quantity AS sales_line_base_quantity,
            sales_line.sku_snapshot,
            sales_line.item_name_snapshot,
            sales_line.unit_code_snapshot,
            sales_line.line_subtotal,
            sales_line.discount_amount,
            sales_line.tax_amount,
            sales_line.line_total,
            delivery_line.line_number
       FROM sales.delivery_order_inventory_issue_lines issue_line
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = issue_line.installation_id
        AND delivery_line.id = issue_line.delivery_order_line_id
       JOIN sales.sales_order_version_lines sales_line
         ON sales_line.installation_id = delivery_line.installation_id
        AND sales_line.id = delivery_line.sales_order_line_id
      WHERE issue_line.installation_id = $1
        AND issue_line.issue_id = $2::uuid
        AND issue_line.issued_base_quantity > 0
      ORDER BY delivery_line.line_number, issue_line.id`,
    [installationId, issueId],
  );
  return { ...header, lines: lineResult.rows };
}

export async function lockSalesOrderLines(client, { installationId, salesOrderLineIds }) {
  if (!salesOrderLineIds.length) return;
  await client.query(
    `SELECT id
       FROM sales.sales_order_version_lines
      WHERE installation_id = $1
        AND id = ANY($2::uuid[])
      ORDER BY id
      FOR UPDATE`,
    [installationId, salesOrderLineIds],
  );
}

export async function getPreviouslyPostedLineTotals(client, {
  installationId,
  salesOrderLineIds,
}) {
  if (!salesOrderLineIds.length) return [];
  const result = await client.query(
    `SELECT line.sales_order_line_id,
            sum(line.accepted_base_quantity)::numeric(30,12) AS accepted_base_quantity,
            sum(line.gross_amount)::numeric(20,6) AS gross_amount,
            sum(line.discount_amount)::numeric(20,6) AS discount_amount,
            sum(line.tax_amount)::numeric(20,6) AS tax_amount,
            sum(line.line_amount)::numeric(20,6) AS line_amount
       FROM accounting.receivable_document_lines line
       JOIN accounting.receivable_documents document
         ON document.installation_id = line.installation_id
        AND document.id = line.receivable_document_id
      WHERE line.installation_id = $1
        AND line.sales_order_line_id = ANY($2::uuid[])
        AND document.status <> 'reversed'
      GROUP BY line.sales_order_line_id`,
    [installationId, salesOrderLineIds],
  );
  return result.rows;
}

export async function insertReceivableDocument(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.receivable_documents (
       id, installation_id, customer_id, customer_address_id, warehouse_id,
       sales_order_id, sales_order_version_id, delivery_order_id,
       direction, document_type, source_document_type, source_document_id,
       source_document_number, source_document_date,
       customer_code_snapshot, customer_name_snapshot,
       warehouse_code_snapshot, warehouse_name_snapshot,
       collection_policy, currency_code, original_amount, allocated_amount,
       remaining_amount, status, source_revision, posting_origin,
       posted_at, posted_by, created_at, updated_at, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,'DEBIT',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,0,$20,'open',$21,'runtime',$22,$23,$22,$22,$23,$23
     )
     RETURNING *`,
    [
      values.id,
      values.installationId,
      values.customerId,
      values.customerAddressId,
      values.warehouseId,
      values.salesOrderId,
      values.salesOrderVersionId,
      values.deliveryOrderId,
      values.documentType,
      values.sourceDocumentType,
      values.sourceDocumentId,
      values.sourceDocumentNumber,
      values.sourceDocumentDate,
      values.customerCodeSnapshot,
      values.customerNameSnapshot,
      values.warehouseCodeSnapshot,
      values.warehouseNameSnapshot,
      values.collectionPolicy,
      values.currencyCode,
      values.originalAmount,
      values.sourceRevision,
      values.postedAt,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function insertReceivableLine(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.receivable_document_lines (
       id, installation_id, receivable_document_id, line_number,
       sales_order_line_id, delivery_order_line_id, delivery_attempt_line_id,
       inventory_issue_line_id, accepted_base_quantity,
       sales_line_base_quantity_snapshot, sku_snapshot, item_name_snapshot,
       unit_code_snapshot, gross_amount, discount_amount, tax_amount,
       line_amount, created_at, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     ) RETURNING *`,
    [
      values.id,
      values.installationId,
      values.receivableDocumentId,
      values.lineNumber,
      values.salesOrderLineId,
      values.deliveryOrderLineId,
      values.deliveryAttemptLineId,
      values.inventoryIssueLineId,
      values.acceptedBaseQuantity,
      values.salesLineBaseQuantitySnapshot,
      values.skuSnapshot,
      values.itemNameSnapshot,
      values.unitCodeSnapshot,
      values.grossAmount,
      values.discountAmount,
      values.taxAmount,
      values.lineAmount,
      values.createdAt,
      values.actorId,
    ],
  );
  return result.rows[0];
}

export async function insertReceivableLedgerEntry(client, values) {
  const result = await client.query(
    `INSERT INTO accounting.receivable_ledger_entries (
       id, installation_id, receivable_document_id, customer_id,
       currency_code, entry_type, amount, source_document_type,
       source_document_id, source_document_number, source_revision,
       document_status_after, actor_id, request_id, source_app,
       occurred_at, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,'SALE_POST',$6,$7,$8,$9,$10,'open',$11,$12,$13,$14,$15::jsonb
     ) RETURNING *`,
    [
      values.id,
      values.installationId,
      values.receivableDocumentId,
      values.customerId,
      values.currencyCode,
      values.amount,
      values.sourceDocumentType,
      values.sourceDocumentId,
      values.sourceDocumentNumber,
      values.sourceRevision,
      values.actorId,
      values.requestId,
      values.sourceApp,
      values.occurredAt,
      JSON.stringify(values.metadata ?? {}),
    ],
  );
  return result.rows[0];
}

export async function getReceivableDocumentById(client, {
  installationId,
  id,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT document.*,
            customer.code AS customer_code,
            customer.name AS customer_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            sales_order.order_number AS sales_order_number,
            delivery_order.delivery_order_number,
            COALESCE((
              SELECT jsonb_agg(to_jsonb(line) ORDER BY line.line_number, line.id)
                FROM accounting.receivable_document_lines line
               WHERE line.installation_id = document.installation_id
                 AND line.receivable_document_id = document.id
            ), '[]'::jsonb) AS lines,
            COALESCE((
              SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.occurred_at, entry.id)
                FROM accounting.receivable_ledger_entries entry
               WHERE entry.installation_id = document.installation_id
                 AND entry.receivable_document_id = document.id
            ), '[]'::jsonb) AS ledger_entries
       FROM accounting.receivable_documents document
       JOIN shared.customers customer
         ON customer.installation_id = document.installation_id
        AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = document.installation_id
        AND warehouse.id = document.warehouse_id
       JOIN sales.sales_orders sales_order
         ON sales_order.installation_id = document.installation_id
        AND sales_order.id = document.sales_order_id
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = document.installation_id
        AND delivery_order.id = document.delivery_order_id
      WHERE document.installation_id = $1
        AND document.id = $2::uuid
        AND document.warehouse_id = ANY($3::uuid[])`,
    [installationId, id, warehouseIds],
  );
  return result.rows[0] ?? null;
}

export async function listReceivableDocuments(client, {
  installationId,
  warehouseIds,
  customerId = null,
  warehouseId = null,
  status = null,
  sourceDocumentType = null,
  search = null,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT document.*,
            customer.code AS customer_code,
            customer.name AS customer_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            sales_order.order_number AS sales_order_number,
            delivery_order.delivery_order_number
       FROM accounting.receivable_documents document
       JOIN shared.customers customer
         ON customer.installation_id = document.installation_id
        AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = document.installation_id
        AND warehouse.id = document.warehouse_id
       JOIN sales.sales_orders sales_order
         ON sales_order.installation_id = document.installation_id
        AND sales_order.id = document.sales_order_id
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = document.installation_id
        AND delivery_order.id = document.delivery_order_id
      WHERE document.installation_id = $1
        AND document.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR document.customer_id = $3::uuid)
        AND ($4::uuid IS NULL OR document.warehouse_id = $4::uuid)
        AND ($5::text IS NULL OR document.status = $5::text)
        AND ($6::text IS NULL OR document.source_document_type = $6::text)
        AND (
          $7::text IS NULL
          OR document.source_document_number ILIKE '%' || $7 || '%'
          OR customer.code ILIKE '%' || $7 || '%'
          OR customer.name ILIKE '%' || $7 || '%'
          OR sales_order.order_number ILIKE '%' || $7 || '%'
          OR delivery_order.delivery_order_number ILIKE '%' || $7 || '%'
        )
      ORDER BY document.source_document_date DESC, document.posted_at DESC, document.id
      LIMIT $8 OFFSET $9`,
    [
      installationId,
      warehouseIds,
      customerId,
      warehouseId,
      status,
      sourceDocumentType,
      search,
      limit,
      offset,
    ],
  );
  return result.rows;
}

export async function listCustomerReceivableBalances(client, {
  installationId,
  warehouseIds,
  customerId = null,
  search = null,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `WITH scoped AS (
       SELECT document.customer_id,
              entry.currency_code,
              sum(entry.amount)::numeric(20,6) AS balance,
              max(entry.occurred_at) AS updated_at
         FROM accounting.receivable_ledger_entries entry
         JOIN accounting.receivable_documents document
           ON document.installation_id = entry.installation_id
          AND document.id = entry.receivable_document_id
        WHERE document.installation_id = $1
          AND document.warehouse_id = ANY($2::uuid[])
        GROUP BY document.customer_id, entry.currency_code
     )
     SELECT scoped.customer_id,
            customer.code AS customer_code,
            customer.name AS customer_name,
            scoped.currency_code,
            scoped.balance,
            scoped.updated_at,
            COALESCE(open_docs.open_amount, 0)::numeric(20,6) AS open_amount,
            COALESCE(open_docs.open_document_count, 0)::bigint AS open_document_count
       FROM scoped
       JOIN shared.customers customer
         ON customer.installation_id = $1
        AND customer.id = scoped.customer_id
       LEFT JOIN LATERAL (
         SELECT sum(document.remaining_amount)::numeric(20,6) AS open_amount,
                count(*)::bigint AS open_document_count
           FROM accounting.receivable_documents document
          WHERE document.installation_id = $1
            AND document.customer_id = scoped.customer_id
            AND document.currency_code = scoped.currency_code
            AND document.warehouse_id = ANY($2::uuid[])
            AND document.status IN ('open', 'partially_allocated')
       ) open_docs ON true
      WHERE ($3::uuid IS NULL OR scoped.customer_id = $3::uuid)
        AND (
          $4::text IS NULL
          OR customer.code ILIKE '%' || $4 || '%'
          OR customer.name ILIKE '%' || $4 || '%'
        )
      ORDER BY customer.code, scoped.currency_code
      LIMIT $5 OFFSET $6`,
    [installationId, warehouseIds, customerId, search, limit, offset],
  );
  return result.rows;
}

export async function getStoredBalance(client, {
  installationId,
  customerId,
  currencyCode,
}) {
  const result = await client.query(
    `SELECT *
       FROM accounting.customer_receivable_balances
      WHERE installation_id = $1
        AND customer_id = $2::uuid
        AND currency_code = $3`,
    [installationId, customerId, currencyCode],
  );
  return result.rows[0] ?? null;
}