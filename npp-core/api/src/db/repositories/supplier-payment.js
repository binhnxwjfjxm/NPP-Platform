import { randomUUID } from 'node:crypto';

export async function getSupplierAndWarehouse(client, { installationId, supplierId, warehouseId }) {
  const result = await client.query(
    `SELECT supplier.id AS supplier_id,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            supplier.is_active AS supplier_active,
            warehouse.id AS warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            warehouse.is_active AS warehouse_active
       FROM shared.suppliers supplier
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = supplier.installation_id
      WHERE supplier.installation_id = $1
        AND supplier.id = $2::uuid
        AND warehouse.id = $3::uuid`,
    [installationId, supplierId, warehouseId],
  );
  return result.rows?.[0] ?? null;
}

export async function insertSupplierPayment(client, input) {
  const result = await client.query(
    `INSERT INTO accounting.payable_documents (
       id,installation_id,supplier_id,warehouse_id,direction,document_type,
       source_domain,source_document_type,source_document_id,source_document_number,
       source_document_date,currency_code,payment_method_snapshot,payment_term_days_snapshot,
       due_date,original_amount,allocated_amount,remaining_amount,status,source_revision,
       posting_origin,posted_at,posted_by,revision,created_at,updated_at,created_by,updated_by,
       document_number_allocation_id,external_reference,note
     ) VALUES (
       $1,$2,$3,$4,'CREDIT','SUPPLIER_PAYMENT','ACCOUNTING','SUPPLIER_PAYMENT',$1,$5,
       $6,$7,$8,0,$6,$9,0,$9,'open',1,'runtime',$10,$11,1,$10,$10,$11,$11,$12,$13,$14
     ) RETURNING *`,
    [
      input.id, input.installationId, input.supplierId, input.warehouseId,
      input.documentNumber, input.paymentDate, input.currencyCode, input.paymentMethod,
      input.amount, input.postedAt, input.actorId, input.documentNumberAllocationId,
      input.externalReference, input.note,
    ],
  );
  return result.rows[0];
}

export async function listSupplierPayments(client, {
  installationId, warehouseIds, supplierId = null, warehouseId = null,
  status = null, currencyCode = null, search = null, limit = 100, offset = 0,
}) {
  const result = await client.query(
    `SELECT document.*,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM accounting.payable_documents document
       JOIN shared.suppliers supplier
         ON supplier.installation_id=document.installation_id AND supplier.id=document.supplier_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id=document.installation_id AND warehouse.id=document.warehouse_id
      WHERE document.installation_id=$1
        AND document.document_type='SUPPLIER_PAYMENT'
        AND document.warehouse_id=ANY($2::uuid[])
        AND ($3::uuid IS NULL OR document.supplier_id=$3::uuid)
        AND ($4::uuid IS NULL OR document.warehouse_id=$4::uuid)
        AND ($5::text IS NULL OR document.status=$5)
        AND ($6::text IS NULL OR document.currency_code=$6)
        AND (
          $7::text IS NULL
          OR document.source_document_number ILIKE '%'||$7||'%'
          OR COALESCE(document.external_reference,'') ILIKE '%'||$7||'%'
          OR supplier.code ILIKE '%'||$7||'%'
          OR supplier.name ILIKE '%'||$7||'%'
        )
      ORDER BY document.source_document_date DESC,document.created_at DESC,document.id
      LIMIT $8 OFFSET $9`,
    [installationId, warehouseIds, supplierId, warehouseId, status, currencyCode, search, limit, offset],
  );
  return result.rows ?? [];
}

export async function getSupplierPaymentById(client, {
  installationId, id, warehouseIds, forUpdate = false,
}) {
  const result = await client.query(
    `SELECT document.*,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM accounting.payable_documents document
       JOIN shared.suppliers supplier
         ON supplier.installation_id=document.installation_id AND supplier.id=document.supplier_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id=document.installation_id AND warehouse.id=document.warehouse_id
      WHERE document.installation_id=$1
        AND document.id=$2::uuid
        AND document.document_type='SUPPLIER_PAYMENT'
        AND document.warehouse_id=ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF document' : ''}`,
    [installationId, id, warehouseIds],
  );
  const document = result.rows?.[0];
  if (!document) return null;
  const [ledger, allocations] = await Promise.all([
    client.query(
      `SELECT * FROM accounting.payable_ledger_entries
        WHERE installation_id=$1 AND payable_document_id=$2::uuid
        ORDER BY occurred_at,id`,
      [installationId, id],
    ),
    listAllocationsForDocument(client, { installationId, documentId: id }),
  ]);
  return { ...document, ledger_entries: ledger.rows ?? [], allocations };
}

export async function getAllocatableDocument(client, {
  installationId, id, warehouseIds, forUpdate = false,
}) {
  const result = await client.query(
    `SELECT document.*,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM accounting.payable_documents document
       JOIN shared.suppliers supplier
         ON supplier.installation_id=document.installation_id AND supplier.id=document.supplier_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id=document.installation_id AND warehouse.id=document.warehouse_id
      WHERE document.installation_id=$1
        AND document.id=$2::uuid
        AND document.warehouse_id=ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF document' : ''}`,
    [installationId, id, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function createAllocation(client, input) {
  const result = await client.query(
    `SELECT * FROM accounting.create_payable_allocation(
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

export async function reverseAllocation(client, input) {
  const result = await client.query(
    `SELECT * FROM accounting.reverse_payable_allocation(
       $1::uuid,$2::text,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::timestamptz,$9::jsonb
     )`,
    [
      input.id ?? randomUUID(), input.installationId, input.allocationId,
      input.reason, input.actorId, input.requestId, input.sourceApp,
      input.reversedAt, input.metadata ?? {},
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function getAllocationById(client, { installationId, id, warehouseIds, forUpdate = false }) {
  const result = await client.query(
    `SELECT allocation.*,
            reversal.id AS reversal_id,
            reversal.reason AS reversal_reason,
            reversal.reversed_at,
            source.source_document_number AS source_document_number,
            source.document_type AS source_document_type,
            source.supplier_id,
            source.warehouse_id,
            source.currency_code,
            target.source_document_number AS target_document_number,
            target.document_type AS target_document_type
       FROM accounting.payable_allocations allocation
       JOIN accounting.payable_documents source
         ON source.installation_id=allocation.installation_id
        AND source.id=allocation.source_payable_document_id
       JOIN accounting.payable_documents target
         ON target.installation_id=allocation.installation_id
        AND target.id=allocation.target_payable_document_id
       LEFT JOIN accounting.payable_allocation_reversals reversal
         ON reversal.installation_id=allocation.installation_id
        AND reversal.allocation_id=allocation.id
      WHERE allocation.installation_id=$1
        AND allocation.id=$2::uuid
        AND source.warehouse_id=ANY($3::uuid[])
        AND target.warehouse_id=ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF allocation' : ''}`,
    [installationId, id, warehouseIds],
  );
  return result.rows?.[0] ?? null;
}

export async function listAllocationsForDocument(client, { installationId, documentId }) {
  const result = await client.query(
    `SELECT allocation.*,
            reversal.id AS reversal_id,
            reversal.reason AS reversal_reason,
            reversal.reversed_at,
            source.source_document_number AS source_document_number,
            source.document_type AS source_document_type,
            target.source_document_number AS target_document_number,
            target.document_type AS target_document_type
       FROM accounting.payable_allocations allocation
       JOIN accounting.payable_documents source
         ON source.installation_id=allocation.installation_id
        AND source.id=allocation.source_payable_document_id
       JOIN accounting.payable_documents target
         ON target.installation_id=allocation.installation_id
        AND target.id=allocation.target_payable_document_id
       LEFT JOIN accounting.payable_allocation_reversals reversal
         ON reversal.installation_id=allocation.installation_id
        AND reversal.allocation_id=allocation.id
      WHERE allocation.installation_id=$1
        AND ($2::uuid IS NULL
             OR allocation.source_payable_document_id=$2::uuid
             OR allocation.target_payable_document_id=$2::uuid)
      ORDER BY allocation.allocation_date,allocation.created_at,allocation.id`,
    [installationId, documentId],
  );
  return result.rows ?? [];
}

export async function listOpenAllocationTargets(client, {
  installationId, warehouseIds, supplierId = null, warehouseId = null,
  currencyCode = null, limit = 1000,
}) {
  const result = await client.query(
    `SELECT document.*,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name
       FROM accounting.payable_documents document
       JOIN shared.suppliers supplier
         ON supplier.installation_id=document.installation_id AND supplier.id=document.supplier_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id=document.installation_id AND warehouse.id=document.warehouse_id
      WHERE document.installation_id=$1
        AND document.direction='DEBIT'
        AND document.document_type='GOODS_RECEIPT'
        AND document.status IN ('open','partially_allocated')
        AND document.remaining_amount>0
        AND document.warehouse_id=ANY($2::uuid[])
        AND ($3::uuid IS NULL OR document.supplier_id=$3::uuid)
        AND ($4::uuid IS NULL OR document.warehouse_id=$4::uuid)
        AND ($5::text IS NULL OR document.currency_code=$5)
      ORDER BY document.due_date,document.source_document_date,document.id
      LIMIT $6`,
    [installationId, warehouseIds, supplierId, warehouseId, currencyCode, limit],
  );
  return result.rows ?? [];
}
