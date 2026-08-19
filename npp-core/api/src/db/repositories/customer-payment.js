import { randomUUID } from 'node:crypto';
import * as employeeRepository from './employee.js';

function paymentLinksJoin(scopeParameter) {
  return `LEFT JOIN LATERAL (
    SELECT COALESCE(
             array_agg(link.target_document_number ORDER BY link.target_document_number),
             ARRAY[]::text[]
           ) AS related_document_numbers,
           COALESCE(
             array_agg(link.sales_order_number ORDER BY link.sales_order_number)
               FILTER (WHERE link.sales_order_number IS NOT NULL),
             ARRAY[]::text[]
           ) AS related_sales_order_numbers,
           count(*) FILTER (WHERE link.is_active)::integer AS related_receivable_count,
           COALESCE(
             sum(link.remaining_amount) FILTER (WHERE link.is_active),
             0
           )::numeric(20,6) AS related_remaining_amount
      FROM (
        SELECT target.id,
               target.source_document_number AS target_document_number,
               target.remaining_amount,
               sales_order.order_number AS sales_order_number,
               bool_or(reversal.id IS NULL) AS is_active
          FROM accounting.receivable_allocations allocation
          JOIN accounting.receivable_documents target
            ON target.installation_id = allocation.installation_id
           AND target.id = allocation.target_receivable_document_id
          LEFT JOIN accounting.receivable_allocation_reversals reversal
            ON reversal.installation_id = allocation.installation_id
           AND reversal.allocation_id = allocation.id
          LEFT JOIN sales.sales_orders sales_order
            ON sales_order.installation_id = target.installation_id
           AND sales_order.id = target.sales_order_id
         WHERE allocation.installation_id = document.installation_id
           AND allocation.source_receivable_document_id = document.id
           AND target.warehouse_id = ANY(${scopeParameter}::uuid[])
         GROUP BY target.id,
                  target.source_document_number,
                  target.remaining_amount,
                  sales_order.order_number
      ) link
  ) payment_link ON true`;
}

export async function setReceivableWriteContext(client) {
  await client.query(
    "SELECT set_config('npp.receivable_write_context', 'receivable_service', true)",
  );
}

export async function getCustomerAndWarehouse(client, { installationId, customerId, warehouseId }) {
  const result = await client.query(
    `SELECT customer.id AS customer_id,
            customer.code AS customer_code,
            customer.name AS customer_name,
            customer.is_active AS customer_active,
            warehouse.id AS warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            warehouse.is_active AS warehouse_active
       FROM shared.customers customer
       JOIN shared.warehouses warehouse ON warehouse.installation_id = customer.installation_id
      WHERE customer.installation_id = $1
        AND customer.id = $2::uuid
        AND warehouse.id = $3::uuid`,
    [installationId, customerId, warehouseId],
  );
  return result.rows?.[0] ?? null;
}

export async function getActiveRemittingEmployee(client, { installationId, employeeId }) {
  const employee = await employeeRepository.getEmployeeByIdForInstallationForShare(client, {
    installationId,
    id: employeeId,
  });
  return employee?.is_active ? employee : null;
}

export async function listActiveRemittingEmployees(client, { installationId, limit = 1000 }) {
  return employeeRepository.listEmployeesForInstallation(client, {
    installationId,
    active: true,
    limit,
    offset: 0,
  });
}

export async function insertCustomerPayment(client, input) {
  const result = await client.query(
    `INSERT INTO accounting.receivable_documents (
       id, installation_id, customer_id, customer_address_id, warehouse_id,
       sales_order_id, sales_order_version_id, delivery_order_id, direction,
       document_type, source_document_type, source_document_id,
       source_document_number, source_document_date, customer_code_snapshot,
       customer_name_snapshot, warehouse_code_snapshot, warehouse_name_snapshot,
       collection_policy, currency_code, original_amount, allocated_amount,
       remaining_amount, status, source_revision, posting_origin, posted_at,
       posted_by, revision, created_at, updated_at, created_by, updated_by,
       document_number_allocation_id, payment_method, external_reference, note,
       remitting_employee_id, remitting_employee_code_snapshot,
       remitting_employee_name_snapshot
     ) VALUES (
       $1,$2,$3,NULL,$4,NULL,NULL,NULL,'CREDIT','CUSTOMER_PAYMENT',
       'CUSTOMER_PAYMENT',$1,$5,$6,$7,$8,$9,$10,NULL,$11,$12,0,$12,
       'open',1,'runtime',$13,$14,1,$13,$13,$14,$14,$15,$16,$17,$18,
       $19,$20,$21
     ) RETURNING *`,
    [input.id,input.installationId,input.customerId,input.warehouseId,input.documentNumber,input.paymentDate,
      input.customerCodeSnapshot,input.customerNameSnapshot,input.warehouseCodeSnapshot,input.warehouseNameSnapshot,
      input.currencyCode,input.amount,input.postedAt,input.actorId,input.documentNumberAllocationId,input.paymentMethod,
      input.externalReference,input.note,input.remittingEmployeeId,input.remittingEmployeeCodeSnapshot,
      input.remittingEmployeeNameSnapshot],
  );
  return result.rows[0];
}

export async function insertCustomerPaymentLedgerEntry(client, input) {
  const result = await client.query(
    `INSERT INTO accounting.receivable_ledger_entries (
       id, installation_id, receivable_document_id, customer_id,
       currency_code, entry_type, amount, source_document_type,
       source_document_id, source_document_number, source_revision,
       document_status_after, actor_id, request_id, source_app,
       occurred_at, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'CUSTOMER_PAYMENT',$3,$8,$9,$10,
       $11,$12,$13,$14,$15::jsonb
     ) RETURNING *`,
    [input.id ?? randomUUID(),input.installationId,input.paymentId,input.customerId,input.currencyCode,input.entryType,
      input.amount,input.documentNumber,input.sourceRevision,input.documentStatusAfter,input.actorId,input.requestId,
      input.sourceApp,input.occurredAt,JSON.stringify(input.metadata ?? {})],
  );
  return result.rows[0];
}

export async function listCustomerPayments(client, { installationId, warehouseIds, customerId = null, warehouseId = null, status = null, currencyCode = null, search = null, limit = 100, offset = 0 }) {
  const result = await client.query(
    `SELECT document.*, customer.code AS customer_code, customer.name AS customer_name,
            warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
            payment_link.related_document_numbers,
            payment_link.related_sales_order_numbers,
            payment_link.related_receivable_count,
            payment_link.related_remaining_amount
       FROM accounting.receivable_documents document
       JOIN shared.customers customer ON customer.installation_id = document.installation_id AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse ON warehouse.installation_id = document.installation_id AND warehouse.id = document.warehouse_id
       ${paymentLinksJoin('$2')}
      WHERE document.installation_id = $1
        AND document.document_type = 'CUSTOMER_PAYMENT'
        AND document.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR document.customer_id = $3::uuid)
        AND ($4::uuid IS NULL OR document.warehouse_id = $4::uuid)
        AND ($5::text IS NULL OR document.status = $5)
        AND ($6::text IS NULL OR document.currency_code = $6)
        AND ($7::text IS NULL OR document.source_document_number ILIKE '%' || $7 || '%'
          OR COALESCE(document.external_reference, '') ILIKE '%' || $7 || '%'
          OR customer.code ILIKE '%' || $7 || '%' OR customer.name ILIKE '%' || $7 || '%')
      ORDER BY document.source_document_date DESC, document.created_at DESC, document.id
      LIMIT $8 OFFSET $9`,
    [installationId,warehouseIds,customerId,warehouseId,status,currencyCode,search,limit,offset],
  );
  return result.rows ?? [];
}

export async function getCustomerPaymentById(client, { installationId, id, warehouseIds, forUpdate = false }) {
  const result = await client.query(
    `SELECT document.*, customer.code AS customer_code, customer.name AS customer_name,
            warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
            payment_link.related_document_numbers,
            payment_link.related_sales_order_numbers,
            payment_link.related_receivable_count,
            payment_link.related_remaining_amount
       FROM accounting.receivable_documents document
       JOIN shared.customers customer ON customer.installation_id = document.installation_id AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse ON warehouse.installation_id = document.installation_id AND warehouse.id = document.warehouse_id
       ${paymentLinksJoin('$3')}
      WHERE document.installation_id = $1 AND document.id = $2::uuid
        AND document.document_type = 'CUSTOMER_PAYMENT' AND document.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF document' : ''}`,
    [installationId,id,warehouseIds],
  );
  const document = result.rows?.[0];
  if (!document) return null;
  const [ledger, allocations] = await Promise.all([
    client.query(`SELECT * FROM accounting.receivable_ledger_entries WHERE installation_id = $1 AND receivable_document_id = $2::uuid ORDER BY occurred_at, id`, [installationId,id]),
    listAllocationsForDocument(client, { installationId, documentId: id, warehouseIds }),
  ]);
  return { ...document, ledger_entries: ledger.rows ?? [], allocations };
}

export async function getAllocatableDocument(client, { installationId, id, warehouseIds, forUpdate = false }) {
  const result = await client.query(
    `SELECT document.*, customer.code AS customer_code, customer.name AS customer_name,
            warehouse.code AS warehouse_code, warehouse.name AS warehouse_name
       FROM accounting.receivable_documents document
       JOIN shared.customers customer ON customer.installation_id = document.installation_id AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse ON warehouse.installation_id = document.installation_id AND warehouse.id = document.warehouse_id
      WHERE document.installation_id = $1 AND document.id = $2::uuid AND document.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF document' : ''}`,
    [installationId,id,warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function listOpenAllocationTargets(client, { installationId, warehouseIds, customerId = null, warehouseId = null, currencyCode = null, limit = 1000 }) {
  const result = await client.query(
    `SELECT document.*, customer.code AS customer_code, customer.name AS customer_name,
            warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
            sales_order.order_number AS sales_order_number, delivery_order.delivery_order_number
       FROM accounting.receivable_documents document
       JOIN shared.customers customer ON customer.installation_id = document.installation_id AND customer.id = document.customer_id
       JOIN shared.warehouses warehouse ON warehouse.installation_id = document.installation_id AND warehouse.id = document.warehouse_id
       JOIN sales.sales_orders sales_order ON sales_order.installation_id = document.installation_id AND sales_order.id = document.sales_order_id
       LEFT JOIN sales.delivery_orders delivery_order ON delivery_order.installation_id = document.installation_id AND delivery_order.id = document.delivery_order_id
      WHERE document.installation_id = $1
        AND document.direction = 'DEBIT'
        AND document.document_type IN ('SALE_DELIVERY', 'SALE_PICKUP')
        AND document.status IN ('open', 'partially_allocated')
        AND document.remaining_amount > 0
        AND document.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR document.customer_id = $3::uuid)
        AND ($4::uuid IS NULL OR document.warehouse_id = $4::uuid)
        AND ($5::text IS NULL OR document.currency_code = $5)
      ORDER BY document.source_document_date, document.posted_at, document.id LIMIT $6`,
    [installationId,warehouseIds,customerId,warehouseId,currencyCode,limit],
  );
  return result.rows ?? [];
}

export async function createAllocation(client, input) {
  const result = await client.query(
    `SELECT * FROM accounting.create_receivable_allocation($1::uuid,$2::text,$3::uuid,$4::uuid,$5::numeric,$6::date,$7::text,$8::text,$9::text,$10::jsonb)`,
    [input.id ?? randomUUID(),input.installationId,input.sourceDocumentId,input.targetDocumentId,input.amount,input.allocationDate,input.actorId,input.requestId,input.sourceApp,input.metadata ?? {}],
  );
  return result.rows?.[0] ?? null;
}

export async function reverseAllocation(client, input) {
  const result = await client.query(
    `SELECT * FROM accounting.reverse_receivable_allocation($1::uuid,$2::text,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::timestamptz,$9::jsonb)`,
    [input.id ?? randomUUID(),input.installationId,input.allocationId,input.reason,input.actorId,input.requestId,input.sourceApp,input.reversedAt,input.metadata ?? {}],
  );
  return result.rows?.[0] ?? null;
}

export async function reverseCustomerPayment(client, input) {
  const result = await client.query(
    `SELECT * FROM accounting.reverse_customer_payment($1::text,$2::uuid,$3::text,$4::timestamptz,$5::text)`,
    [input.installationId,input.paymentId,input.actorId,input.reversedAt,input.reason],
  );
  return result.rows?.[0] ?? null;
}

export async function getAllocationById(client, { installationId, id, warehouseIds, forUpdate = false }) {
  const result = await client.query(
    `SELECT allocation.*, reversal.id AS reversal_id, reversal.reason AS reversal_reason, reversal.reversed_at,
            source.source_document_number AS source_document_number, source.document_type AS source_document_type,
            source.customer_id, source.warehouse_id AS source_warehouse_id, source.currency_code,
            target.source_document_number AS target_document_number, target.document_type AS target_document_type,
            target.warehouse_id AS target_warehouse_id, target.sales_order_id, target.delivery_order_id
       FROM accounting.receivable_allocations allocation
       JOIN accounting.receivable_documents source ON source.installation_id = allocation.installation_id AND source.id = allocation.source_receivable_document_id
       JOIN accounting.receivable_documents target ON target.installation_id = allocation.installation_id AND target.id = allocation.target_receivable_document_id
       LEFT JOIN accounting.receivable_allocation_reversals reversal ON reversal.installation_id = allocation.installation_id AND reversal.allocation_id = allocation.id
      WHERE allocation.installation_id = $1 AND allocation.id = $2::uuid
        AND source.warehouse_id = ANY($3::uuid[]) AND target.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF allocation' : ''}`,
    [installationId,id,warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function listAllocationsForDocument(client, { installationId, documentId, warehouseIds }) {
  const result = await client.query(
    `SELECT allocation.*, reversal.id AS reversal_id, reversal.reason AS reversal_reason, reversal.reversed_at,
            source.source_document_number AS source_document_number, source.document_type AS source_document_type,
            source.warehouse_id AS source_warehouse_id,
            target.source_document_number AS target_document_number, target.document_type AS target_document_type,
            target.warehouse_id AS target_warehouse_id, target.sales_order_id, target.delivery_order_id
       FROM accounting.receivable_allocations allocation
       JOIN accounting.receivable_documents source ON source.installation_id = allocation.installation_id AND source.id = allocation.source_receivable_document_id
       JOIN accounting.receivable_documents target ON target.installation_id = allocation.installation_id AND target.id = allocation.target_receivable_document_id
       LEFT JOIN accounting.receivable_allocation_reversals reversal ON reversal.installation_id = allocation.installation_id AND reversal.allocation_id = allocation.id
      WHERE allocation.installation_id = $1
        AND (allocation.source_receivable_document_id = $2::uuid OR allocation.target_receivable_document_id = $2::uuid)
        AND source.warehouse_id = ANY($3::uuid[]) AND target.warehouse_id = ANY($3::uuid[])
      ORDER BY allocation.allocation_date, allocation.created_at, allocation.id`,
    [installationId,documentId,warehouseIds],
  );
  return result.rows ?? [];
}
