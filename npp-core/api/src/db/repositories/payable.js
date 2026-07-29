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

  const [lineResult, ledgerResult] = await Promise.all([
    client.query(
      `SELECT *
         FROM accounting.payable_document_lines
        WHERE installation_id = $1
          AND payable_document_id = $2::uuid
        ORDER BY line_number`,
      [installationId, id],
    ),
    client.query(
      `SELECT *
         FROM accounting.payable_ledger_entries
        WHERE installation_id = $1
          AND payable_document_id = $2::uuid
        ORDER BY occurred_at, id`,
      [installationId, id],
    ),
  ]);

  return {
    ...header,
    lines: lineResult.rows ?? [],
    ledger_entries: ledgerResult.rows ?? [],
  };
}
