import { randomUUID } from 'node:crypto';
import * as productService from './product.js';
import * as pricingService from './pricing.js';
import * as stocktakeService from './inventory-stocktake.js';

const MAX_ROWS = 5000;
const DECIMAL_12 = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,12})?$/;

export const PRODUCT_FILE_COLUMNS = Object.freeze([
  'productCode', 'productName', 'catalogName', 'categoryCode', 'brandCode', 'description', 'notes',
  'productIsCatalogVisible', 'productIsOrderable', 'productIsActive',
  'sku', 'skuName', 'variantKind', 'isInventoryBase', 'isSellable', 'isCatalogVisible', 'isActive',
]);

export const PRICING_FILE_COLUMNS = Object.freeze([
  'priceListCode', 'priceListName', 'listType', 'currencyCode', 'sku', 'sourceKey', 'adjustmentType',
  'amountMinor', 'rateBps', 'minQuantity', 'maxQuantity', 'effectiveFrom', 'effectiveTo',
  'externalRuleCode', 'note', 'isActive',
]);

export const STOCKTAKE_FILE_COLUMNS = Object.freeze([
  'warehouseCode', 'locationCode', 'sku', 'lotCode', 'systemQuantity', 'actualCount',
]);

export const MOVEMENT_FILE_COLUMNS = Object.freeze([
  'postedAt', 'documentDate', 'movementType', 'sourceDomain', 'sourceDocumentType', 'sourceDocumentId',
  'sourceDocumentNumber', 'documentNumber', 'warehouseCode', 'locationCode', 'sku', 'lotCode',
  'quantityDelta', 'direction',
]);

function failure(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, details });
}

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function nullableText(value) {
  const normalized = text(value);
  return normalized || null;
}

function booleanValue(value, field) {
  if (typeof value === 'boolean') return Object.freeze({ ok: true, value });
  const normalized = text(value).toLowerCase();
  if (['true', '1', 'yes', 'y', 'có'].includes(normalized)) return Object.freeze({ ok: true, value: true });
  if (['false', '0', 'no', 'n', 'không'].includes(normalized)) return Object.freeze({ ok: true, value: false });
  return failure('INVALID_FILE_BOOLEAN', `${field} must be true or false`);
}

function rowsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows)) {
    return failure('INVALID_FILE_PAYLOAD', 'File operation payload must contain a rows array');
  }
  if (payload.rows.length < 1) return failure('EMPTY_FILE', 'File must contain at least one data row');
  if (payload.rows.length > MAX_ROWS) return failure('FILE_TOO_LARGE', `File cannot exceed ${MAX_ROWS} rows`);
  return Object.freeze({ ok: true, rows: payload.rows, format: text(payload.format || 'tabular').toLowerCase() });
}

async function insertHistory(client, requestContext, {
  direction,
  definitionKey,
  format,
  status,
  rowCount = null,
  failureCode = null,
  normalizedFilters = {},
  effectiveScopes = {},
  sourceAsOf = null,
}) {
  const jobId = randomUUID();
  await client.query(
    `INSERT INTO reporting.import_export_jobs (
       job_id, installation_id, direction, definition_key, definition_version, format, status,
       actor_id, employee_id, source_app, request_id, normalized_filters, effective_scopes,
       business_timezone, source_as_of, row_count, failure_code, requested_at, started_at, completed_at
     ) VALUES (
       $1, $2, $3, $4, 'phase-10.4-v1', $5, $6,
       $7, $8, $9, $10, $11::jsonb, $12::jsonb,
       'Asia/Ho_Chi_Minh', $13, $14, $15, $16, $16, $16
     )`,
    [
      jobId,
      requestContext.installationId,
      direction,
      definitionKey,
      format || 'tabular',
      status,
      requestContext.actorId,
      requestContext.employeeId ?? null,
      requestContext.sourceApp,
      requestContext.requestId,
      JSON.stringify(normalizedFilters ?? {}),
      JSON.stringify(effectiveScopes ?? {}),
      sourceAsOf,
      rowCount,
      failureCode,
      requestContext.receivedAt,
    ],
  );
  return jobId;
}

function mappedRow(row) {
  return row && typeof row === 'object' && !Array.isArray(row) ? row : null;
}

export async function exportProductRows(client, { requestContext, format = 'tabular' }) {
  const result = await client.query(
    `SELECT p.code AS product_code,
            p.name AS product_name,
            p.catalog_name,
            c.code AS category_code,
            b.code AS brand_code,
            p.description,
            p.notes,
            p.is_catalog_visible AS product_is_catalog_visible,
            p.is_orderable AS product_is_orderable,
            p.is_active AS product_is_active,
            pv.sku,
            pv.name AS sku_name,
            pv.variant_kind,
            pv.is_inventory_base,
            pv.is_sellable,
            pv.is_catalog_visible,
            pv.is_active
       FROM shared.products p
       LEFT JOIN shared.product_categories c
         ON c.installation_id = p.installation_id AND c.id = p.category_id
       LEFT JOIN shared.product_brands b
         ON b.installation_id = p.installation_id AND b.id = p.brand_id
       LEFT JOIN shared.product_variants pv
         ON pv.installation_id = p.installation_id AND pv.product_id = p.id
      WHERE p.installation_id = $1
      ORDER BY p.code ASC, pv.sku ASC NULLS LAST`,
    [requestContext.installationId],
  );
  const rows = (result.rows ?? []).map((row) => Object.freeze({
    productCode: row.product_code,
    productName: row.product_name,
    catalogName: row.catalog_name ?? '',
    categoryCode: row.category_code ?? '',
    brandCode: row.brand_code ?? '',
    description: row.description ?? '',
    notes: row.notes ?? '',
    productIsCatalogVisible: row.product_is_catalog_visible === true,
    productIsOrderable: row.product_is_orderable === true,
    productIsActive: row.product_is_active === true,
    sku: row.sku ?? '',
    skuName: row.sku_name ?? '',
    variantKind: row.variant_kind ?? '',
    isInventoryBase: row.sku ? row.is_inventory_base === true : '',
    isSellable: row.sku ? row.is_sellable === true : '',
    isCatalogVisible: row.sku ? row.is_catalog_visible === true : '',
    isActive: row.sku ? row.is_active === true : '',
  }));
  const jobId = await insertHistory(client, requestContext, {
    direction: 'EXPORT', definitionKey: 'products', format, status: 'completed', rowCount: rows.length,
  });
  return Object.freeze({ ok: true, jobId, columns: PRODUCT_FILE_COLUMNS, rows: Object.freeze(rows) });
}

async function productReferenceMaps(client, installationId, rows) {
  const categoryCodes = [...new Set(rows.map((row) => upper(row.categoryCode)).filter(Boolean))];
  const brandCodes = [...new Set(rows.map((row) => upper(row.brandCode)).filter(Boolean))];
  const [categories, brands] = await Promise.all([
    categoryCodes.length
      ? client.query('SELECT id, code FROM shared.product_categories WHERE installation_id = $1 AND code = ANY($2::text[])', [installationId, categoryCodes])
      : Promise.resolve({ rows: [] }),
    brandCodes.length
      ? client.query('SELECT id, code FROM shared.product_brands WHERE installation_id = $1 AND code = ANY($2::text[])', [installationId, brandCodes])
      : Promise.resolve({ rows: [] }),
  ]);
  return Object.freeze({
    categories: new Map((categories.rows ?? []).map((row) => [row.code, row.id])),
    brands: new Map((brands.rows ?? []).map((row) => [row.code, row.id])),
  });
}

export async function importProductRows(client, { requestContext, payload }) {
  const parsed = rowsPayload(payload);
  if (!parsed.ok) return parsed;
  const rows = [];
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = mappedRow(parsed.rows[index]);
    if (!row) return failure('INVALID_FILE_ROW', `Row ${index + 1} is invalid`);
    const productCode = upper(row.productCode);
    const productName = text(row.productName);
    if (!productCode || !productName) return failure('INVALID_PRODUCT_FILE_ROW', `Row ${index + 1} requires productCode and productName`);
    const productIsCatalogVisible = booleanValue(row.productIsCatalogVisible, `rows[${index}].productIsCatalogVisible`);
    const productIsOrderable = booleanValue(row.productIsOrderable, `rows[${index}].productIsOrderable`);
    const productIsActive = booleanValue(row.productIsActive, `rows[${index}].productIsActive`);
    if (!productIsCatalogVisible.ok) return productIsCatalogVisible;
    if (!productIsOrderable.ok) return productIsOrderable;
    if (!productIsActive.ok) return productIsActive;
    const sku = upper(row.sku);
    let variant = null;
    if (sku) {
      const skuName = text(row.skuName);
      if (!skuName) return failure('INVALID_PRODUCT_FILE_ROW', `Row ${index + 1} requires skuName for SKU ${sku}`);
      const isInventoryBase = booleanValue(row.isInventoryBase, `rows[${index}].isInventoryBase`);
      const isSellable = booleanValue(row.isSellable, `rows[${index}].isSellable`);
      const isCatalogVisible = booleanValue(row.isCatalogVisible, `rows[${index}].isCatalogVisible`);
      const isActive = booleanValue(row.isActive, `rows[${index}].isActive`);
      if (!isInventoryBase.ok) return isInventoryBase;
      if (!isSellable.ok) return isSellable;
      if (!isCatalogVisible.ok) return isCatalogVisible;
      if (!isActive.ok) return isActive;
      variant = Object.freeze({
        sku,
        name: skuName,
        variantKind: upper(row.variantKind || 'BASE'),
        isInventoryBase: isInventoryBase.value,
        isSellable: isSellable.value,
        isCatalogVisible: isCatalogVisible.value,
        isActive: isActive.value,
      });
    }
    rows.push(Object.freeze({
      productCode,
      productName,
      catalogName: nullableText(row.catalogName),
      categoryCode: upper(row.categoryCode),
      brandCode: upper(row.brandCode),
      description: nullableText(row.description),
      notes: nullableText(row.notes),
      productIsCatalogVisible: productIsCatalogVisible.value,
      productIsOrderable: productIsOrderable.value,
      productIsActive: productIsActive.value,
      variant,
    }));
  }

  const refs = await productReferenceMaps(client, requestContext.installationId, rows);
  const grouped = new Map();
  for (const row of rows) {
    if (row.categoryCode && !refs.categories.has(row.categoryCode)) return failure('CATEGORY_NOT_FOUND', `Category ${row.categoryCode} not found`, 404);
    if (row.brandCode && !refs.brands.has(row.brandCode)) return failure('BRAND_NOT_FOUND', `Brand ${row.brandCode} not found`, 404);
    const existing = grouped.get(row.productCode);
    const identity = JSON.stringify([
      row.productName, row.catalogName, row.categoryCode, row.brandCode, row.description, row.notes,
      row.productIsCatalogVisible, row.productIsOrderable, row.productIsActive,
    ]);
    if (existing && existing.identity !== identity) {
      return failure('INCONSISTENT_PRODUCT_ROWS', `Rows for product ${row.productCode} must repeat the same product fields`);
    }
    if (!existing) grouped.set(row.productCode, { identity, row, variants: [] });
    if (row.variant) grouped.get(row.productCode).variants.push(row.variant);
  }

  const products = [...grouped.values()].map(({ row, variants }) => ({
    code: row.productCode,
    name: row.productName,
    catalogName: row.catalogName,
    categoryId: row.categoryCode ? refs.categories.get(row.categoryCode) : null,
    brandId: row.brandCode ? refs.brands.get(row.brandCode) : null,
    description: row.description,
    notes: row.notes,
    isCatalogVisible: row.productIsCatalogVisible,
    isOrderable: row.productIsOrderable,
    isActive: row.productIsActive,
    variants,
  }));
  const result = await productService.importProducts(client, {
    installationId: requestContext.installationId,
    payload: { products },
    createdBy: requestContext.actorId,
  });
  const status = result.ok ? 'completed' : 'failed';
  const jobId = await insertHistory(client, requestContext, {
    direction: 'IMPORT', definitionKey: 'products', format: parsed.format, status,
    rowCount: parsed.rows.length, failureCode: result.ok ? null : result.code,
  });
  return result.ok
    ? Object.freeze({ ok: true, jobId, import: result.import ?? { imported: result.imported, created: result.created, updated: result.updated } })
    : Object.freeze({ ...result, jobId, statusCode: result.statusCode ?? 400 });
}

export async function exportPricingRows(client, { requestContext, format = 'tabular' }) {
  const result = await client.query(
    `SELECT pl.code AS price_list_code, pl.name AS price_list_name, pl.list_type, pl.currency_code,
            pv.sku, pli.source_key, pli.adjustment_type, pli.amount_minor::text, pli.rate_bps,
            pli.min_quantity::text, pli.max_quantity::text, pli.effective_from, pli.effective_to,
            pli.external_rule_code, pli.note, pli.is_active
       FROM shared.price_list_items pli
       JOIN shared.price_lists pl ON pl.installation_id = pli.installation_id AND pl.id = pli.price_list_id
       JOIN shared.product_variants pv ON pv.installation_id = pli.installation_id AND pv.id = pli.variant_id
      WHERE pli.installation_id = $1
      ORDER BY pl.code ASC, pv.sku ASC, pli.source_key ASC NULLS LAST, pli.id ASC`,
    [requestContext.installationId],
  );
  const rows = (result.rows ?? []).map((row) => Object.freeze({
    priceListCode: row.price_list_code,
    priceListName: row.price_list_name,
    listType: row.list_type,
    currencyCode: row.currency_code,
    sku: row.sku,
    sourceKey: row.source_key ?? '',
    adjustmentType: row.adjustment_type,
    amountMinor: row.amount_minor ?? '',
    rateBps: row.rate_bps ?? '',
    minQuantity: row.min_quantity ?? '0',
    maxQuantity: row.max_quantity ?? '',
    effectiveFrom: row.effective_from ?? '',
    effectiveTo: row.effective_to ?? '',
    externalRuleCode: row.external_rule_code ?? '',
    note: row.note ?? '',
    isActive: row.is_active === true,
  }));
  const jobId = await insertHistory(client, requestContext, {
    direction: 'EXPORT', definitionKey: 'pricing-items', format, status: 'completed', rowCount: rows.length,
  });
  return Object.freeze({ ok: true, jobId, columns: PRICING_FILE_COLUMNS, rows: Object.freeze(rows) });
}

export async function importPricingRows(client, { requestContext, payload }) {
  const parsed = rowsPayload(payload);
  if (!parsed.ok) return parsed;
  const items = [];
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = mappedRow(parsed.rows[index]);
    if (!row) return failure('INVALID_FILE_ROW', `Row ${index + 1} is invalid`);
    const priceListCode = upper(row.priceListCode);
    const sku = upper(row.sku);
    const sourceKey = text(row.sourceKey);
    const adjustmentType = upper(row.adjustmentType);
    if (!priceListCode || !sku || !sourceKey || !adjustmentType) {
      return failure('INVALID_PRICING_FILE_ROW', `Row ${index + 1} requires priceListCode, sku, sourceKey and adjustmentType`);
    }
    const isActive = booleanValue(row.isActive, `rows[${index}].isActive`);
    if (!isActive.ok) return isActive;
    items.push({
      priceListCode,
      sku,
      sourceKey,
      adjustmentType,
      amountMinor: nullableText(row.amountMinor),
      rateBps: nullableText(row.rateBps),
      minQuantity: nullableText(row.minQuantity) ?? '0',
      maxQuantity: nullableText(row.maxQuantity),
      effectiveFrom: nullableText(row.effectiveFrom),
      effectiveTo: nullableText(row.effectiveTo),
      sourceKind: 'IMPORT',
      externalRuleCode: nullableText(row.externalRuleCode),
      note: nullableText(row.note),
      isActive: isActive.value,
    });
  }
  const result = await pricingService.importPricing(client, {
    installationId: requestContext.installationId,
    payload: { sourceBatchId: requestContext.requestId, items },
    createdBy: requestContext.actorId,
  });
  const jobId = await insertHistory(client, requestContext, {
    direction: 'IMPORT', definitionKey: 'pricing-items', format: parsed.format,
    status: result.ok ? 'completed' : 'failed', rowCount: parsed.rows.length,
    failureCode: result.ok ? null : result.code,
  });
  return result.ok
    ? Object.freeze({ ok: true, jobId, import: result.import })
    : Object.freeze({ ...result, jobId, statusCode: result.statusCode ?? 400 });
}

export async function exportStocktakeRows(client, { requestContext, warehouseId, format = 'tabular' }) {
  const warehouse = text(warehouseId);
  if (!warehouse) return failure('WAREHOUSE_REQUIRED', 'warehouseId is required');
  const allowed = requestContext.scopes?.warehouseIds ?? [];
  if (!allowed.includes(warehouse)) return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope', 403);
  const result = await client.query(
    `SELECT w.code AS warehouse_code, wl.code AS location_code, pv.sku, lot.lot_code,
            ib.on_hand_quantity::text AS system_quantity
       FROM inventory.inventory_balances ib
       JOIN shared.warehouses w ON w.installation_id = ib.installation_id AND w.id = ib.warehouse_id
       JOIN shared.product_variants pv ON pv.installation_id = ib.installation_id AND pv.id = ib.base_variant_id
       LEFT JOIN shared.warehouse_locations wl ON wl.installation_id = ib.installation_id AND wl.warehouse_id = ib.warehouse_id AND wl.id = ib.location_id
       LEFT JOIN inventory.inventory_lots lot ON lot.installation_id = ib.installation_id AND lot.id = ib.lot_id
      WHERE ib.installation_id = $1 AND ib.warehouse_id = $2::uuid
      ORDER BY wl.code ASC NULLS FIRST, pv.sku ASC, lot.normalized_lot_code ASC NULLS FIRST`,
    [requestContext.installationId, warehouse],
  );
  const rows = (result.rows ?? []).map((row) => Object.freeze({
    warehouseCode: row.warehouse_code,
    locationCode: row.location_code ?? '',
    sku: row.sku,
    lotCode: row.lot_code ?? '',
    systemQuantity: row.system_quantity,
    actualCount: '',
  }));
  const jobId = await insertHistory(client, requestContext, {
    direction: 'EXPORT', definitionKey: 'stocktake-count', format, status: 'completed', rowCount: rows.length,
    normalizedFilters: { warehouseId: warehouse }, effectiveScopes: { warehouseIds: [warehouse] },
  });
  return Object.freeze({ ok: true, jobId, columns: STOCKTAKE_FILE_COLUMNS, rows: Object.freeze(rows) });
}

export async function importStocktakeRows(client, { requestContext, payload }) {
  const parsed = rowsPayload(payload);
  if (!parsed.ok) return parsed;
  const normalized = [];
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = mappedRow(parsed.rows[index]);
    if (!row) return failure('INVALID_FILE_ROW', `Row ${index + 1} is invalid`);
    const warehouseCode = upper(row.warehouseCode);
    const locationCode = upper(row.locationCode);
    const sku = upper(row.sku);
    const lotCode = upper(row.lotCode);
    const actualCount = text(row.actualCount);
    if (!warehouseCode || !sku || !DECIMAL_12.test(actualCount)) {
      return failure('INVALID_STOCKTAKE_FILE_ROW', `Row ${index + 1} requires warehouseCode, sku and a non-negative actualCount with at most 12 decimals`);
    }
    normalized.push(Object.freeze({ warehouseCode, locationCode, sku, lotCode, actualCount }));
  }
  const warehouseCodes = [...new Set(normalized.map((row) => row.warehouseCode))];
  if (warehouseCodes.length !== 1) return failure('MULTIPLE_STOCKTAKE_WAREHOUSES', 'One stocktake file may contain only one warehouse');
  const warehouseResult = await client.query(
    'SELECT id, code FROM shared.warehouses WHERE installation_id = $1 AND code = $2 AND is_active = true',
    [requestContext.installationId, warehouseCodes[0]],
  );
  const warehouse = warehouseResult.rows?.[0];
  if (!warehouse) return failure('WAREHOUSE_NOT_FOUND', `Warehouse ${warehouseCodes[0]} not found`, 404);
  const allowed = requestContext.scopes?.warehouseIds ?? [];
  if (!allowed.includes(warehouse.id)) return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope', 403);

  const skuList = [...new Set(normalized.map((row) => row.sku))];
  const locationCodes = [...new Set(normalized.map((row) => row.locationCode).filter(Boolean))];
  const [variants, locations] = await Promise.all([
    client.query(
      `SELECT id, sku FROM shared.product_variants
        WHERE installation_id = $1 AND sku = ANY($2::text[]) AND is_inventory_base = true AND is_active = true`,
      [requestContext.installationId, skuList],
    ),
    locationCodes.length
      ? client.query(
        `SELECT id, code FROM shared.warehouse_locations
          WHERE installation_id = $1 AND warehouse_id = $2 AND code = ANY($3::text[]) AND is_active = true`,
        [requestContext.installationId, warehouse.id, locationCodes],
      )
      : Promise.resolve({ rows: [] }),
  ]);
  const variantMap = new Map((variants.rows ?? []).map((row) => [row.sku, row.id]));
  const locationMap = new Map((locations.rows ?? []).map((row) => [row.code, row.id]));
  for (const row of normalized) {
    if (!variantMap.has(row.sku)) return failure('SKU_NOT_FOUND', `Inventory-base SKU ${row.sku} not found`, 404);
    if (row.locationCode && !locationMap.has(row.locationCode)) return failure('LOCATION_NOT_FOUND', `Location ${row.locationCode} not found`, 404);
  }
  const lotPairs = normalized.filter((row) => row.lotCode).map((row) => ({ variantId: variantMap.get(row.sku), lotCode: row.lotCode }));
  let lotRows = [];
  if (lotPairs.length) {
    const lotResult = await client.query(
      `SELECT id, base_variant_id, normalized_lot_code
         FROM inventory.inventory_lots
        WHERE installation_id = $1
          AND base_variant_id = ANY($2::uuid[])
          AND normalized_lot_code = ANY($3::text[])`,
      [requestContext.installationId, [...new Set(lotPairs.map((row) => row.variantId))], [...new Set(lotPairs.map((row) => row.lotCode))]],
    );
    lotRows = lotResult.rows ?? [];
  }
  const lotMap = new Map(lotRows.map((row) => [`${row.base_variant_id}:${row.normalized_lot_code}`, row.id]));
  const scopes = [];
  const countsByScope = new Map();
  for (const row of normalized) {
    const variantId = variantMap.get(row.sku);
    const locationId = row.locationCode ? locationMap.get(row.locationCode) : null;
    const lotId = row.lotCode ? lotMap.get(`${variantId}:${row.lotCode}`) : null;
    if (row.lotCode && !lotId) return failure('LOT_NOT_FOUND', `Lot ${row.lotCode} for SKU ${row.sku} not found`, 404);
    const key = `${locationId ?? ''}:${variantId}:${lotId ?? ''}`;
    if (countsByScope.has(key)) return failure('DUPLICATE_STOCKTAKE_SCOPE', `Duplicate stocktake scope for SKU ${row.sku}`);
    scopes.push({ locationId, baseVariantId: variantId, lotId });
    countsByScope.set(key, row.actualCount);
  }
  const created = await stocktakeService.createStocktake(client, {
    requestContext,
    payload: { warehouseId: warehouse.id, note: `Imported from file ${requestContext.requestId}`, scopes },
  });
  if (!created.ok) {
    const jobId = await insertHistory(client, requestContext, {
      direction: 'IMPORT', definitionKey: 'stocktake-count', format: parsed.format, status: 'failed',
      rowCount: parsed.rows.length, failureCode: created.code,
      normalizedFilters: { warehouseCode: warehouse.code }, effectiveScopes: { warehouseIds: [warehouse.id] },
    });
    return Object.freeze({ ...created, jobId, statusCode: created.statusCode ?? 400 });
  }
  const counts = created.stocktake.lines.map((line) => {
    const key = `${line.locationId ?? ''}:${line.baseVariantId}:${line.lotId ?? ''}`;
    return { lineId: line.id, countedBaseQuantity: countsByScope.get(key) };
  });
  const counted = await stocktakeService.countStocktake(client, {
    requestContext,
    stocktakeId: created.stocktake.id,
    payload: { expectedRevision: created.stocktake.revision, counts },
  });
  const jobId = await insertHistory(client, requestContext, {
    direction: 'IMPORT', definitionKey: 'stocktake-count', format: parsed.format,
    status: counted.ok ? 'completed' : 'failed', rowCount: parsed.rows.length,
    failureCode: counted.ok ? null : counted.code,
    normalizedFilters: { warehouseCode: warehouse.code }, effectiveScopes: { warehouseIds: [warehouse.id] },
  });
  return counted.ok
    ? Object.freeze({ ok: true, jobId, stocktake: counted.stocktake })
    : Object.freeze({ ...counted, jobId, statusCode: counted.statusCode ?? 400 });
}

export async function listMovementRows(client, { requestContext, filters = {}, format = 'tabular', recordExport = false }) {
  const limit = Number(filters.limit ?? 500);
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) return failure('INVALID_LIMIT', 'limit must be between 1 and 2000');
  const sku = upper(filters.sku);
  const warehouseId = text(filters.warehouseId);
  if (warehouseId && !(requestContext.scopes?.warehouseIds ?? []).includes(warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope', 403);
  }
  const allowedWarehouseIds = requestContext.scopes?.warehouseIds ?? [];
  if (!allowedWarehouseIds.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', 403);
  const result = await client.query(
    `SELECT m.posted_at, m.document_date, m.movement_type, m.source_domain,
            m.source_document_type, m.source_document_id, m.source_document_number, m.document_number,
            w.code AS warehouse_code, wl.code AS location_code, l.base_sku AS sku, lot.lot_code,
            l.base_quantity_delta::text AS quantity_delta, l.direction
       FROM inventory.inventory_movement_lines l
       JOIN inventory.inventory_movements m ON m.installation_id = l.installation_id AND m.id = l.movement_id
       JOIN shared.warehouses w ON w.installation_id = l.installation_id AND w.id = l.warehouse_id
       LEFT JOIN shared.warehouse_locations wl ON wl.installation_id = l.installation_id AND wl.warehouse_id = l.warehouse_id AND wl.id = l.location_id
       LEFT JOIN inventory.inventory_lots lot ON lot.installation_id = l.installation_id AND lot.id = l.lot_id
      WHERE l.installation_id = $1
        AND l.warehouse_id = ANY($2::uuid[])
        AND ($3::uuid IS NULL OR l.warehouse_id = $3::uuid)
        AND ($4::text = '' OR l.base_sku = $4::text)
      ORDER BY m.posted_at DESC, m.id DESC, l.line_number ASC
      LIMIT $5`,
    [requestContext.installationId, allowedWarehouseIds, warehouseId || null, sku, limit],
  );
  const rows = (result.rows ?? []).map((row) => Object.freeze({
    postedAt: row.posted_at,
    documentDate: row.document_date,
    movementType: row.movement_type,
    sourceDomain: row.source_domain,
    sourceDocumentType: row.source_document_type ?? '',
    sourceDocumentId: row.source_document_id ?? '',
    sourceDocumentNumber: row.source_document_number ?? '',
    documentNumber: row.document_number ?? '',
    warehouseCode: row.warehouse_code,
    locationCode: row.location_code ?? '',
    sku: row.sku,
    lotCode: row.lot_code ?? '',
    quantityDelta: row.quantity_delta,
    direction: row.direction,
  }));
  let jobId = null;
  if (recordExport) {
    jobId = await insertHistory(client, requestContext, {
      direction: 'EXPORT', definitionKey: 'inventory-movements', format, status: 'completed', rowCount: rows.length,
      normalizedFilters: { sku: sku || null, warehouseId: warehouseId || null, limit },
      effectiveScopes: { warehouseIds: allowedWarehouseIds },
    });
  }
  return Object.freeze({ ok: true, jobId, columns: MOVEMENT_FILE_COLUMNS, rows: Object.freeze(rows) });
}

export async function buildQuotationRows(client, { requestContext, payload }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.skus)) {
    return failure('INVALID_QUOTATION_PAYLOAD', 'Quotation payload must contain a skus array');
  }
  const skus = [...new Set(payload.skus.map(upper).filter(Boolean))];
  if (!skus.length || skus.length > 1000) return failure('INVALID_QUOTATION_SKUS', 'Quotation requires between 1 and 1000 SKUs');
  const variants = await client.query(
    `SELECT pv.id, pv.sku, pv.name, p.name AS product_name
       FROM shared.product_variants pv
       JOIN shared.products p ON p.installation_id = pv.installation_id AND p.id = pv.product_id
      WHERE pv.installation_id = $1 AND pv.sku = ANY($2::text[])
      ORDER BY pv.sku ASC`,
    [requestContext.installationId, skus],
  );
  const bySku = new Map((variants.rows ?? []).map((row) => [row.sku, row]));
  for (const sku of skus) if (!bySku.has(sku)) return failure('VARIANT_NOT_FOUND', `SKU ${sku} not found`, 404);
  const rows = [];
  for (const sku of skus) {
    const variant = bySku.get(sku);
    const resolution = await pricingService.resolvePrice(client, {
      installationId: requestContext.installationId,
      payload: {
        variantId: variant.id,
        quantity: text(payload.quantity || '1'),
        currencyCode: upper(payload.currencyCode || 'VND'),
        priceAt: payload.priceAt || requestContext.receivedAt,
        channelId: nullableText(payload.channelId),
        customerGroupId: nullableText(payload.customerGroupId),
        customerId: nullableText(payload.customerId),
      },
    });
    if (!resolution.ok) return Object.freeze({ ...resolution, statusCode: resolution.statusCode ?? 400 });
    rows.push(Object.freeze({
      sku,
      productName: variant.product_name,
      skuName: variant.name,
      quantity: resolution.resolution.quantity,
      currencyCode: resolution.resolution.currencyCode,
      unitPriceMinor: resolution.resolution.finalUnitPriceMinor,
      lineTotalMinor: resolution.resolution.lineTotalMinor,
      priceListCode: resolution.resolution.steps?.find((step) => step.kind === 'BASE')?.priceListCode ?? '',
    }));
  }
  const jobId = await insertHistory(client, requestContext, {
    direction: 'EXPORT', definitionKey: 'sales-quotation', format: text(payload.format || 'tabular').toLowerCase(),
    status: 'completed', rowCount: rows.length,
    normalizedFilters: {
      channelId: nullableText(payload.channelId), customerGroupId: nullableText(payload.customerGroupId),
      customerId: nullableText(payload.customerId), currencyCode: upper(payload.currencyCode || 'VND'),
    },
  });
  return Object.freeze({
    ok: true,
    jobId,
    columns: Object.freeze(['sku', 'productName', 'skuName', 'quantity', 'currencyCode', 'unitPriceMinor', 'lineTotalMinor', 'priceListCode']),
    rows: Object.freeze(rows),
  });
}
