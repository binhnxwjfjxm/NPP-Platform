export * from './payable-core.js';

export async function getPayableDocumentById(client, {
  installationId,
  id,
  warehouseIds,
  forUpdate = false,
}) {
  const headerResult = await client.query(
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
        AND pd.id = $2::uuid
        AND pd.warehouse_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF pd' : ''}`,
    [installationId, id, warehouseIds],
  );
  const header = headerResult.rows?.[0];
  if (!header) return null;

  const [lineResult, ledgerResult, allocationResult] = await Promise.all([
    client.query(
      `SELECT * FROM accounting.payable_document_lines
        WHERE installation_id=$1 AND payable_document_id=$2::uuid
        ORDER BY line_number`,
      [installationId, id],
    ),
    client.query(
      `SELECT * FROM accounting.payable_ledger_entries
        WHERE installation_id=$1 AND payable_document_id=$2::uuid
        ORDER BY occurred_at,id`,
      [installationId, id],
    ),
    client.query(
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
           ON source.installation_id=allocation.installation_id AND source.id=allocation.source_payable_document_id
         JOIN accounting.payable_documents target
           ON target.installation_id=allocation.installation_id AND target.id=allocation.target_payable_document_id
         LEFT JOIN accounting.payable_allocation_reversals reversal
           ON reversal.installation_id=allocation.installation_id AND reversal.allocation_id=allocation.id
        WHERE allocation.installation_id=$1
          AND (allocation.source_payable_document_id=$2::uuid OR allocation.target_payable_document_id=$2::uuid)
        ORDER BY allocation.allocation_date,allocation.created_at,allocation.id`,
      [installationId, id],
    ),
  ]);

  return {
    ...header,
    lines: lineResult.rows ?? [],
    ledger_entries: ledgerResult.rows ?? [],
    allocations: allocationResult.rows ?? [],
  };
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
           ON document.installation_id=entry.installation_id
          AND document.id=entry.payable_document_id
        WHERE document.installation_id=$1
          AND document.warehouse_id=ANY($2::uuid[])
        GROUP BY document.installation_id,document.supplier_id,entry.currency_code
     )
     SELECT balance.installation_id,
            balance.supplier_id,
            supplier.code AS supplier_code,
            supplier.name AS supplier_name,
            balance.currency_code,
            balance.balance,
            balance.updated_at,
            COALESCE(open_docs.open_amount,0)::numeric(20,6) AS open_amount,
            COALESCE(open_docs.overdue_amount,0)::numeric(20,6) AS overdue_amount,
            COALESCE(open_docs.open_document_count,0)::bigint AS open_document_count
       FROM scoped_balances balance
       JOIN shared.suppliers supplier
         ON supplier.installation_id=balance.installation_id AND supplier.id=balance.supplier_id
       LEFT JOIN LATERAL (
         SELECT sum(CASE WHEN pd.direction='DEBIT' THEN pd.remaining_amount ELSE -pd.remaining_amount END) AS open_amount,
                sum(CASE WHEN pd.direction='DEBIT' AND pd.due_date<current_date THEN pd.remaining_amount ELSE 0 END) AS overdue_amount,
                count(*) FILTER (WHERE pd.direction='DEBIT') AS open_document_count
           FROM accounting.payable_documents pd
          WHERE pd.installation_id=balance.installation_id
            AND pd.supplier_id=balance.supplier_id
            AND pd.currency_code=balance.currency_code
            AND pd.warehouse_id=ANY($2::uuid[])
            AND pd.status IN ('open','partially_allocated')
       ) open_docs ON true
      WHERE ($3::uuid IS NULL OR balance.supplier_id=$3::uuid)
        AND (
          $4::text IS NULL
          OR supplier.code ILIKE '%'||$4||'%'
          OR supplier.name ILIKE '%'||$4||'%'
        )
      ORDER BY supplier.code,balance.currency_code
      LIMIT $5 OFFSET $6`,
    [installationId, warehouseIds, supplierId, search, limit, offset],
  );
  return result.rows ?? [];
}
