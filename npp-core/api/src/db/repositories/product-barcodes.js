import { randomUUID } from 'node:crypto';

const BARCODE_COLUMNS = `id, installation_id, variant_id, barcode, normalized_barcode, barcode_type, is_primary, is_active, source_reference, source_metadata, created_at, updated_at, created_by, updated_by`;

export async function getBarcodeById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${BARCODE_COLUMNS}
     FROM shared.product_barcodes
     WHERE installation_id = $1 AND id = $2`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getBarcodeByIdForUpdate(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${BARCODE_COLUMNS}
     FROM shared.product_barcodes
     WHERE installation_id = $1 AND id = $2
     FOR UPDATE`,
    [installationId, id],
  );
  return result.rows[0] ?? null;
}

export async function getBarcodeByNormalizedValue(client, { installationId, normalizedBarcode }) {
  const result = await client.query(
    `SELECT ${BARCODE_COLUMNS}
     FROM shared.product_barcodes
     WHERE installation_id = $1 AND normalized_barcode = $2`,
    [installationId, normalizedBarcode],
  );
  return result.rows[0] ?? null;
}

export async function listBarcodesForVariant(client, { installationId, variantId }) {
  const result = await client.query(
    `SELECT ${BARCODE_COLUMNS}
     FROM shared.product_barcodes
     WHERE installation_id = $1 AND variant_id = $2
     ORDER BY is_primary DESC, normalized_barcode ASC`,
    [installationId, variantId],
  );
  return result.rows;
}

export async function insertBarcode(client, {
  installationId,
  variantId,
  barcode,
  normalizedBarcode,
  barcodeType,
  isPrimary,
  isActive = true,
  sourceReference,
  sourceMetadata,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.product_barcodes
      (id, installation_id, variant_id, barcode, normalized_barcode, barcode_type,
       is_primary, is_active, source_reference, source_metadata,
       created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT DO NOTHING
     RETURNING ${BARCODE_COLUMNS}`,
    [id, installationId, variantId, barcode, normalizedBarcode, barcodeType,
      Boolean(isPrimary), Boolean(isActive), sourceReference ?? null, sourceMetadata ?? {},
      now, now, createdBy, createdBy],
  );
  return result.rows[0] ?? null;
}

export async function updateBarcode(client, {
  installationId,
  id,
  barcodeType,
  isPrimary,
  isActive,
  sourceReference,
  sourceMetadata,
  expectedUpdatedAt,
  updatedBy,
}) {
  const result = await client.query(
    `UPDATE shared.product_barcodes
     SET barcode_type = $1,
         is_primary = $2,
         is_active = $3,
         source_reference = $4,
         source_metadata = $5,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $6
     WHERE installation_id = $7 AND id = $8 AND updated_at = $9
     RETURNING ${BARCODE_COLUMNS}`,
    [barcodeType, Boolean(isPrimary), Boolean(isActive), sourceReference ?? null, sourceMetadata ?? {}, updatedBy,
      installationId, id, expectedUpdatedAt],
  );
  return result.rows[0] ?? null;
}

export async function clearPrimaryBarcode(client, { installationId, variantId, excludeId, updatedBy }) {
  await client.query(
    `UPDATE shared.product_barcodes
     SET is_primary = false,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $1
     WHERE installation_id = $2 AND variant_id = $3 AND is_primary = true AND id <> $4`,
    [updatedBy, installationId, variantId, excludeId],
  );
}
