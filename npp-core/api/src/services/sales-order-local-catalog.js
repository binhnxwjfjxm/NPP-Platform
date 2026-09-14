import * as repository from '../db/repositories/sales-order-local-catalog.js';

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function normalizeCursor(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function mapUpsert(row) {
  const barcodes = Array.isArray(row.barcodes)
    ? row.barcodes.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  return Object.freeze({
    id: row.id,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    sku: row.sku,
    variantName: row.variant_name,
    barcode: barcodes[0] ?? null,
    barcodes: Object.freeze(barcodes),
    unitId: row.unit_id ?? null,
    unitCode: row.unit_code ?? null,
    unitName: row.unit_name ?? null,
    conversionToBase: row.conversion_to_base === null || row.conversion_to_base === undefined
      ? null
      : String(row.conversion_to_base),
    allowsFractional: row.allows_fractional === undefined ? null : row.allows_fractional,
  });
}

export async function getSalesOrderLocalCatalog(client, {
  installationId,
  since = null,
}) {
  const cursor = normalizeCursor(since);
  if (cursor === undefined) {
    return failure('INVALID_CATALOG_CURSOR', 'Mốc cập nhật danh mục hàng hóa không hợp lệ');
  }

  const snapshot = await repository.readSalesOrderLocalCatalogChanges(client, {
    installationId,
    since: cursor,
  });
  const upserts = [];
  const removeIds = [];
  for (const row of snapshot.rows) {
    if (row.eligible === true) upserts.push(mapUpsert(row));
    else if (cursor) removeIds.push(row.id);
  }

  return Object.freeze({
    ok: true,
    catalog: Object.freeze({
      cursor: new Date(snapshot.cursor).toISOString(),
      full: cursor === null,
      upserts: Object.freeze(upserts),
      removeIds: Object.freeze([...new Set(removeIds)]),
    }),
  });
}

export const salesOrderLocalCatalogInternals = Object.freeze({
  mapUpsert,
  normalizeCursor,
});
