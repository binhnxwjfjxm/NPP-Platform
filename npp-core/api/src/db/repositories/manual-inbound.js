export async function insertManualInboundDocument(client, document) {
  const result = await client.query(
    `INSERT INTO inventory.manual_inbound_documents (
       id, installation_id, inbound_type, warehouse_id, document_date,
       reference_number, note, movement_id, created_at, created_by, request_id, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      document.id,
      document.installationId,
      document.inboundType,
      document.warehouseId,
      document.documentDate,
      document.referenceNumber ?? null,
      document.note ?? null,
      document.movementId,
      document.createdAt,
      document.createdBy,
      document.requestId,
      document.metadata ?? {},
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertManualInboundDocumentLines(client, rows) {
  const inserted = [];
  for (const row of rows) {
    const result = await client.query(
      `INSERT INTO inventory.manual_inbound_document_lines (
         id, installation_id, document_id, line_number, warehouse_id, location_id,
         source_variant_id, source_sku, source_unit_id, source_unit_code,
         source_quantity, conversion_to_base, base_variant_id, base_sku, base_quantity,
         lot_id, lot_code, expiry_date, entered_unit_cost, currency_code,
         source_line_reference, metadata
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
       ) RETURNING *`,
      [
        row.id,
        row.installationId,
        row.documentId,
        row.lineNumber,
        row.warehouseId,
        row.locationId ?? null,
        row.sourceVariantId,
        row.sourceSku,
        row.sourceUnitId,
        row.sourceUnitCode,
        row.sourceQuantity,
        row.conversionToBase,
        row.baseVariantId,
        row.baseSku,
        row.baseQuantity,
        row.lotId ?? null,
        row.lotCode ?? null,
        row.expiryDate ?? null,
        row.enteredUnitCost ?? null,
        row.currencyCode ?? null,
        row.sourceLineReference ?? null,
        row.metadata ?? {},
      ],
    );
    inserted.push(result.rows?.[0] ?? null);
  }
  return inserted;
}

export async function getManualInboundDocumentById(client, { installationId, id, forUpdate = false }) {
  const lock = forUpdate ? ' FOR UPDATE OF document' : '';
  const result = await client.query(
    `SELECT document.*,
            reversal.id AS reversal_movement_id,
            reversal.document_date AS reversal_document_date,
            reversal.reason_code AS reversal_reason_code,
            reversal.reason_note AS reversal_reason_note
       FROM inventory.manual_inbound_documents document
       LEFT JOIN inventory.inventory_movements reversal
         ON reversal.installation_id = document.installation_id
        AND reversal.reversal_of_movement_id = document.movement_id
      WHERE document.installation_id = $1
        AND document.id = $2${lock}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function getManualInboundDocumentByMovementId(client, { installationId, movementId }) {
  const result = await client.query(
    `SELECT document.*,
            reversal.id AS reversal_movement_id,
            reversal.document_date AS reversal_document_date,
            reversal.reason_code AS reversal_reason_code,
            reversal.reason_note AS reversal_reason_note
       FROM inventory.manual_inbound_documents document
       LEFT JOIN inventory.inventory_movements reversal
         ON reversal.installation_id = document.installation_id
        AND reversal.reversal_of_movement_id = document.movement_id
      WHERE document.installation_id = $1
        AND document.movement_id = $2`,
    [installationId, movementId],
  );
  return result.rows?.[0] ?? null;
}

export async function listManualInboundDocumentLines(client, { installationId, documentId }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.manual_inbound_document_lines
      WHERE installation_id = $1
        AND document_id = $2
      ORDER BY line_number ASC, id ASC`,
    [installationId, documentId],
  );
  return result.rows ?? [];
}

export async function listManualInboundDocuments(client, {
  installationId,
  warehouseIds,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT document.*,
            reversal.id AS reversal_movement_id,
            reversal.document_date AS reversal_document_date,
            reversal.reason_code AS reversal_reason_code,
            reversal.reason_note AS reversal_reason_note
       FROM inventory.manual_inbound_documents document
       LEFT JOIN inventory.inventory_movements reversal
         ON reversal.installation_id = document.installation_id
        AND reversal.reversal_of_movement_id = document.movement_id
      WHERE document.installation_id = $1
        AND document.warehouse_id = ANY($2::uuid[])
      ORDER BY document.document_date DESC, document.created_at DESC, document.id DESC
      LIMIT $3 OFFSET $4`,
    [installationId, warehouseIds, limit, offset],
  );
  return result.rows ?? [];
}
