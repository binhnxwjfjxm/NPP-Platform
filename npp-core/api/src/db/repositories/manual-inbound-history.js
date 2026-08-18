export async function searchManualInboundDocuments(client, {
  installationId,
  warehouseIds,
  inboundType = null,
  referenceNumber = null,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT document.id,
            document.inbound_type,
            document.warehouse_id,
            warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name,
            to_char(document.document_date, 'YYYY-MM-DD') AS document_date,
            document.reference_number,
            document.note,
            document.created_at,
            reversal.id AS reversal_movement_id,
            to_char(reversal.document_date, 'YYYY-MM-DD') AS reversal_document_date,
            reversal.reason_note AS reversal_reason_note
       FROM inventory.manual_inbound_documents document
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = document.installation_id
        AND warehouse.id = document.warehouse_id
       LEFT JOIN inventory.inventory_movements reversal
         ON reversal.installation_id = document.installation_id
        AND reversal.reversal_of_movement_id = document.movement_id
      WHERE document.installation_id = $1
        AND document.warehouse_id = ANY($2::uuid[])
        AND ($3::text IS NULL OR document.inbound_type = $3)
        AND ($4::text IS NULL OR document.reference_number ILIKE '%' || $4 || '%')
      ORDER BY document.document_date DESC, document.created_at DESC, document.id DESC
      LIMIT $5 OFFSET $6`,
    [installationId, warehouseIds, inboundType, referenceNumber, limit, offset],
  );
  return result.rows ?? [];
}
