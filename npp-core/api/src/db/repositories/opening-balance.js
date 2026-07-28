export async function lockOpeningBalanceSourceKey(client, { installationId, sourceKey }) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`opening-balance:${installationId}:${sourceKey}`],
  );
}
export async function getOpeningBalanceImportBySourceKey(client, { installationId, sourceKey }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.opening_balance_imports
      WHERE installation_id = $1
        AND source_key = $2`,
    [installationId, sourceKey],
  );
  return result.rows?.[0] ?? null;
}

export async function getOpeningBalanceImportById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.opening_balance_imports
      WHERE installation_id = $1
        AND id = $2`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function listOpeningBalanceImports(client, {
  installationId,
  limit = 100,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT *
       FROM inventory.opening_balance_imports
      WHERE installation_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [installationId, limit, offset],
  );
  return result.rows ?? [];
}

export async function listOpeningBalanceImportRows(client, { installationId, importId }) {
  const result = await client.query(
    `SELECT *
       FROM inventory.opening_balance_import_rows
      WHERE installation_id = $1
        AND import_id = $2
      ORDER BY line_number ASC, id ASC`,
    [installationId, importId],
  );
  return result.rows ?? [];
}

export async function insertOpeningBalanceImport(client, header) {
  const result = await client.query(
    `INSERT INTO inventory.opening_balance_imports (
       id,
       installation_id,
       source_key,
       source_filename,
       content_checksum,
       payload_hash,
       status,
       document_date,
       movement_id,
       row_count,
       source_quantity_total,
       base_quantity_total,
       created_at,
       created_by,
       request_id,
       metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
     )
     RETURNING *`,
    [
      header.id,
      header.installationId,
      header.sourceKey,
      header.sourceFilename ?? null,
      header.contentChecksum,
      header.payloadHash,
      header.status,
      header.documentDate,
      header.movementId ?? null,
      header.rowCount,
      header.sourceQuantityTotal,
      header.baseQuantityTotal,
      header.createdAt,
      header.createdBy,
      header.requestId,
      header.metadata ?? {},
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertOpeningBalanceImportRows(client, rows) {
  const inserted = [];
  for (const row of rows) {
    const result = await client.query(
      `INSERT INTO inventory.opening_balance_import_rows (
         id,
         installation_id,
         import_id,
         line_number,
         warehouse_id,
         location_id,
         source_variant_id,
         source_sku,
         source_unit_id,
         source_unit_code,
         source_quantity,
         conversion_to_base,
         base_variant_id,
         base_sku,
         base_quantity,
         lot_id,
         lot_code,
         expiry_date,
         source_line_reference,
         metadata
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
       )
       RETURNING *`,
      [
        row.id,
        row.installationId,
        row.importId,
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
        row.sourceLineReference ?? null,
        row.metadata ?? {},
      ],
    );
    inserted.push(result.rows?.[0] ?? null);
  }
  return inserted;
}
