import * as repository from '../db/repositories/sales-order-sku-search.js';
import * as productMetadataRepository from '../db/repositories/sales-order-product-metadata.js';
import * as salesOrderRepository from '../db/repositories/sales-order.js';
import { evaluateSalesOrderSkuEligibility } from './sales-order-entry-legacy.js';

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function taxSettings(settings) {
  const mode = new Set(['EXCLUSIVE', 'INCLUSIVE']).has(String(settings?.default_tax_mode ?? '').toUpperCase())
    ? String(settings.default_tax_mode).toUpperCase()
    : 'EXCLUSIVE';
  const rate = String(settings?.default_tax_rate ?? '0');
  return Object.freeze({ taxMode: mode, taxRate: rate });
}

function mapSkuOption(row, defaults, metadata = null) {
  return Object.freeze({
    id: row.id,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    categoryId: metadata?.category_id ?? null,
    categoryCode: metadata?.category_code ?? null,
    categoryName: metadata?.category_name ?? null,
    parentCategoryId: metadata?.parent_category_id ?? null,
    parentCategoryCode: metadata?.parent_category_code ?? null,
    parentCategoryName: metadata?.parent_category_name ?? null,
    brandId: metadata?.brand_id ?? null,
    brandCode: metadata?.brand_code ?? null,
    brandName: metadata?.brand_name ?? null,
    sku: row.sku,
    variantName: row.name,
    barcode: row.barcode ?? null,
    unitId: row.unit_id ?? null,
    unitCode: row.unit_code ?? null,
    unitName: row.unit_name ?? null,
    conversionToBase: row.conversion_to_base === null || row.conversion_to_base === undefined
      ? null
      : String(row.conversion_to_base),
    allowsFractional: row.allows_fractional === undefined ? null : row.allows_fractional,
    defaultTaxMode: defaults.taxMode,
    defaultTaxRate: defaults.taxRate,
    eligibility: evaluateSalesOrderSkuEligibility(row),
  });
}

function poolSnapshot(client) {
  const count = (value) => Number.isInteger(value) && value >= 0 ? value : 0;
  return {
    poolTotal: count(client?.totalCount),
    poolIdle: count(client?.idleCount),
    poolWaiting: count(client?.waitingCount),
  };
}

export async function searchSalesOrderSkuOptions(client, {
  requestContext,
  search,
  categoryId = null,
  limit = 20,
  offset = 0,
}) {
  const term = String(search ?? '').trim();
  if (term.length > 256) return failure('INVALID_SEARCH', 'Từ khóa tìm hàng không được vượt quá 256 ký tự');
  const startedAt = Date.now();
  const initialStartedAt = Date.now();
  const [rows, settings] = await Promise.all([
    repository.searchSalesOrderSkuOptions(client, {
      installationId: requestContext.installationId,
      search: term,
      categoryId,
      limit: Math.max(1, Math.min(50, Number(limit) || 20)),
      offset: Math.max(0, Number(offset) || 0),
    }),
    salesOrderRepository.getSalesOrderSettings(client, {
      installationId: requestContext.installationId,
    }),
  ]);
  const initialMs = Date.now() - initialStartedAt;
  const metadataStartedAt = Date.now();
  const metadataRows = await productMetadataRepository.listSalesOrderProductMetadata(client, {
    installationId: requestContext.installationId,
    productIds: rows.map((row) => row.product_id),
  });
  const metadataMs = Date.now() - metadataStartedAt;
  const metadataByProductId = new Map(metadataRows.map((row) => [row.product_id, row]));
  const defaults = taxSettings(settings);
  const skuOptions = Object.freeze(rows.map((row) => mapSkuOption(
    row,
    defaults,
    metadataByProductId.get(row.product_id) ?? null,
  )));
  console.info(JSON.stringify({
    event: 'sales_order_sku_search_latency',
    durationMs: Date.now() - startedAt,
    initialMs,
    metadataMs,
    termLength: term.length,
    resultCount: skuOptions.length,
    ...poolSnapshot(client),
  }));
  return Object.freeze({ ok: true, skuOptions });
}

export const salesOrderSkuSearchServiceInternals = Object.freeze({
  mapSkuOption,
  taxSettings,
});
