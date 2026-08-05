import { randomUUID } from 'node:crypto';

export async function listCustomerReturnCredits(client, {
  installationId,
  warehouseIds,
  customerId = null,
  warehouseId = null,
  status = null,
  currencyCode = null,
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
            origin.customer_return_id,
            customer_return.return_number,
            customer_return.received_at AS customer_return_received_at
       FROM accounting.receivable_documents document
       JOIN shared.customers customer
         ON customer.installation_id = document.installation_id
        AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = document.installation_id
        AND warehouse.id = document.warehouse_id
       JOIN (
         SELECT installation_id, adjustment_receivable_document_id,
                min(customer_return_id) AS customer_return_id
           FROM accounting.customer_return_adjustment_lines
          GROUP BY installation_id, adjustment_receivable_document_id
       ) origin
         ON origin.installation_id = document.installation_id
        AND origin.adjustment_receivable_document_id = document.id
       JOIN sales.customer_returns customer_return
         ON customer_return.installation_id = origin.installation_id
        AND customer_return.id = origin.customer_return_id
      WHERE document.installation_id = $1
        AND document.document_type = 'CUSTOMER_RETURN_CREDIT'
        AND document.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR document.customer_id = $3::uuid)
        AND ($4::uuid IS NULL OR document.warehouse_id = $4::uuid)
        AND ($5::text IS NULL OR document.status = $5)
        AND ($6::text IS NULL OR document.currency_code = $6)
        AND (
          $7::text IS NULL
          OR document.source_document_number ILIKE '%' || $7 || '%'
          OR customer.code ILIKE '%' || $7 || '%'
          OR customer.name ILIKE '%' || $7 || '%'
        )
      ORDER BY document.source_document_date DESC, document.created_at DESC, document.id
      LIMIT $8 OFFSET $9`,
    [installationId, warehouseIds, customerId, warehouseId, status, currencyCode, search, limit, offset],
  );
  return result.rows ?? [];
}

export async function getCustomerReturnCreditById(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT document.*,
            customer.code AS customer_code,
            customer.name AS customer_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            origin.customer_return_id,
            customer_return.return_number,
            customer_return.received_at AS customer_return_received_at
       FROM accounting.receivable_documents document
       JOIN shared.customers customer
         ON customer.installation_id = document.installation_id
        AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = document.installation_id
        AND warehouse.id = document.warehouse_id
       JOIN (
         SELECT installation_id, adjustment_receivable_document_id,
                min(customer_return_id) AS customer_return_id
           FROM accounting.customer_return_adjustment_lines
          GROUP BY installation_id, adjustment_receivable_document_id
       ) origin
         ON origin.installation_id = document.installation_id
        AND origin.adjustment_receivable_document_id = document.id
       JOIN sales.customer_returns customer_return
         ON customer_return.installation_id = origin.installation_id
        AND customer_return.id = origin.customer_return_id
      WHERE document.installation_id = $1
        AND document.id = $2::uuid
        AND document.document_type = 'CUSTOMER_RETURN_CREDIT'
        AND document.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF document' : ''}`,
    [installationId, id, warehouseIds],
  );
  const document = result.rows?.[0];
  if (!document) return null;
  const [lines, ledger, allocations, refunds] = await Promise.all([
    client.query(
      `SELECT line.*,
              source_document.source_document_number AS source_document_number,
              source_document.document_type AS source_document_type,
              source_line.sku_snapshot AS sku,
              source_line.item_name_snapshot AS item_name,
              source_line.unit_code_snapshot AS unit_code
         FROM accounting.customer_return_adjustment_lines line
         JOIN accounting.receivable_documents source_document
           ON source_document.installation_id = line.installation_id
          AND source_document.id = line.source_receivable_document_id
         JOIN accounting.receivable_document_lines source_line
           ON source_line.installation_id = line.installation_id
          AND source_line.id = line.source_receivable_line_id
        WHERE line.installation_id = $1
          AND line.adjustment_receivable_document_id = $2::uuid
        ORDER BY line.line_number, line.id`,
      [installationId, id],
    ),
    client.query(
      `SELECT * FROM accounting.receivable_ledger_entries
        WHERE installation_id = $1 AND receivable_document_id = $2::uuid
        ORDER BY occurred_at, id`,
      [installationId, id],
    ),
    listAllocationsForDocument(client, { installationId, documentId: id, warehouseIds }),
    client.query(
      `SELECT refund.*,
              refund_document.source_document_number AS refund_number,
              refund_document.status AS refund_status,
              reversal.id AS reversal_id,
              reversal.reason AS reversal_reason,
              reversal.reversed_at
         FROM accounting.customer_refunds refund
         JOIN accounting.receivable_documents refund_document
           ON refund_document.installation_id = refund.installation_id
          AND refund_document.id = refund.receivable_document_id
         LEFT JOIN accounting.customer_refund_reversals reversal
           ON reversal.installation_id = refund.installation_id
          AND reversal.refund_id = refund.id
        WHERE refund.installation_id = $1
          AND refund.source_credit_document_id = $2::uuid
        ORDER BY refund.posted_at, refund.id`,
      [installationId, id],
    ),
  ]);
  return {
    ...document,
    adjustment_lines: lines.rows ?? [],
    ledger_entries: ledger.rows ?? [],
    allocations,
    refunds: refunds.rows ?? [],
  };
}

export async function getCreditOrPaymentById(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT document.*,
            customer.code AS customer_code,
            customer.name AS customer_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM accounting.receivable_documents document
       JOIN shared.customers customer
         ON customer.installation_id = document.installation_id
        AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = document.installation_id
        AND warehouse.id = document.warehouse_id
      WHERE document.installation_id = $1
        AND document.id = $2::uuid
        AND document.direction = 'CREDIT'
        AND document.document_type IN ('CUSTOMER_PAYMENT', 'CUSTOMER_RETURN_CREDIT')
        AND document.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF document' : ''}`,
    [installationId, id, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function getAllocatableDocument(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT document.*,
            customer.code AS customer_code,
            customer.name AS customer_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM accounting.receivable_documents document
       JOIN shared.customers customer
         ON customer.installation_id = document.installation_id
        AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = document.installation_id
        AND warehouse.id = document.warehouse_id
      WHERE document.installation_id = $1
        AND document.id = $2::uuid
        AND document.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF document' : ''}`,
    [installationId, id, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function createCreditAllocation(client, input) {
  const result = await client.query(
    `SELECT * FROM accounting.create_credit_allocation(
       $1::uuid,$2::text,$3::uuid,$4::uuid,$5::numeric,$6::date,
       $7::text,$8::text,$9::text,$10::jsonb
     )`,
    [
      input.id ?? randomUUID(), input.installationId, input.sourceDocumentId,
      input.targetDocumentId, input.amount, input.allocationDate, input.actorId,
      input.requestId, input.sourceApp, input.metadata ?? {},
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function createCustomerRefund(client, input) {
  const result = await client.query(
    `SELECT * FROM accounting.create_customer_refund(
       $1::uuid,$2::text,$3::uuid,$4::text,$5::uuid,$6::numeric,$7::text,
       $8::text,$9::text,$10::text,$11::text,$12::text,$13::text,$14::text,
       $15::text,$16::timestamptz,$17::jsonb
     )`,
    [
      input.id, input.installationId, input.sourceCreditDocumentId,
      input.documentNumber, input.documentNumberAllocationId, input.amount,
      input.refundMethod, input.destinationReference, input.externalReference,
      input.reason, input.idempotencyKey, input.payloadHash, input.actorId,
      input.requestId, input.sourceApp, input.postedAt, input.metadata ?? {},
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function reverseCustomerRefund(client, input) {
  const result = await client.query(
    `SELECT * FROM accounting.reverse_customer_refund(
       $1::uuid,$2::text,$3::uuid,$4::text,$5::text,$6::text,$7::text,
       $8::timestamptz,$9::jsonb
     )`,
    [
      input.id ?? randomUUID(), input.installationId, input.refundId, input.reason,
      input.actorId, input.requestId, input.sourceApp, input.reversedAt,
      input.metadata ?? {},
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function reverseCustomerReturnCredit(client, input) {
  const result = await client.query(
    `SELECT * FROM accounting.reverse_customer_return_credit(
       $1::uuid,$2::text,$3::uuid,$4::text,$5::text,$6::text,$7::text,
       $8::timestamptz,$9::jsonb
     )`,
    [
      input.id ?? randomUUID(), input.installationId, input.creditDocumentId,
      input.reason, input.actorId, input.requestId, input.sourceApp,
      input.reversedAt, input.metadata ?? {},
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function getCustomerRefundById(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT refund.*,
            refund_document.source_document_number AS refund_number,
            refund_document.status AS refund_status,
            refund_document.revision AS refund_revision,
            source_credit.source_document_number AS source_credit_number,
            source_credit.document_type AS source_credit_type,
            customer.code AS customer_code,
            customer.name AS customer_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            reversal.id AS reversal_id,
            reversal.reason AS reversal_reason,
            reversal.reversed_at
       FROM accounting.customer_refunds refund
       JOIN accounting.receivable_documents refund_document
         ON refund_document.installation_id = refund.installation_id
        AND refund_document.id = refund.receivable_document_id
       JOIN accounting.receivable_documents source_credit
         ON source_credit.installation_id = refund.installation_id
        AND source_credit.id = refund.source_credit_document_id
       JOIN shared.customers customer
         ON customer.installation_id = refund.installation_id
        AND customer.id = refund.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = refund.installation_id
        AND warehouse.id = refund.warehouse_id
       LEFT JOIN accounting.customer_refund_reversals reversal
         ON reversal.installation_id = refund.installation_id
        AND reversal.refund_id = refund.id
      WHERE refund.installation_id = $1
        AND refund.id = $2::uuid
        AND refund.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF refund' : ''}`,
    [installationId, id, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function listAllocationsForDocument(client, {
  installationId,
  documentId,
  warehouseIds,
}) {
  const result = await client.query(
    `SELECT allocation.*,
            reversal.id AS reversal_id,
            reversal.reason AS reversal_reason,
            reversal.reversed_at,
            source.source_document_number AS source_document_number,
            source.document_type AS source_document_type,
            source.warehouse_id AS source_warehouse_id,
            target.source_document_number AS target_document_number,
            target.document_type AS target_document_type,
            target.warehouse_id AS target_warehouse_id,
            target.sales_order_id,
            target.delivery_order_id
       FROM accounting.receivable_allocations allocation
       JOIN accounting.receivable_documents source
         ON source.installation_id = allocation.installation_id
        AND source.id = allocation.source_receivable_document_id
       JOIN accounting.receivable_documents target
         ON target.installation_id = allocation.installation_id
        AND target.id = allocation.target_receivable_document_id
       LEFT JOIN accounting.receivable_allocation_reversals reversal
         ON reversal.installation_id = allocation.installation_id
        AND reversal.allocation_id = allocation.id
      WHERE allocation.installation_id = $1
        AND (
          allocation.source_receivable_document_id = $2::uuid
          OR allocation.target_receivable_document_id = $2::uuid
        )
        AND source.warehouse_id = ANY($3::uuid[])
        AND target.warehouse_id = ANY($3::uuid[])
      ORDER BY allocation.allocation_date, allocation.created_at, allocation.id`,
    [installationId, documentId, warehouseIds],
  );
  return result.rows ?? [];
}
