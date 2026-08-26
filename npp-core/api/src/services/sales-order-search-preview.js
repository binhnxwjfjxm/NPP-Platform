import * as legacy from './sales-order-entry-legacy.js';
import * as pricingService from './pricing.js';
import * as commercialRepository from '../db/repositories/sales-order-commercial.js';
import * as salesOrderRepository from '../db/repositories/sales-order.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import * as previewRepository from '../db/repositories/sales-order-search-preview.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function scopedWarehouseIds(requestContext) {
  return new Set(Array.isArray(requestContext?.scopes?.warehouseIds)
    ? requestContext.scopes.warehouseIds.filter((id) => UUID_PATTERN.test(String(id ?? '')))
    : []);
}

function normalizePricingAt(value, fallback) {
  const raw = String(value ?? fallback ?? '').trim();
  const parsed = new Date(raw);
  return raw && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

function pricePreview(result) {
  if (!result?.ok) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      unitPriceMinor: null,
      message: 'Chưa tính được giá',
    });
  }
  if (result.resolution?.resolutionStatus === 'MANUAL_PRICE_REQUIRED') {
    return Object.freeze({
      status: 'MISSING',
      unitPriceMinor: null,
      message: 'Chưa có giá',
    });
  }
  const unitPriceMinor = result.resolution?.systemUnitPriceMinor
    ?? result.resolution?.finalUnitPriceMinor
    ?? null;
  return Object.freeze({
    status: unitPriceMinor === null ? 'UNAVAILABLE' : 'RESOLVED',
    unitPriceMinor: unitPriceMinor === null ? null : String(unitPriceMinor),
    message: unitPriceMinor === null ? 'Chưa tính được giá' : null,
  });
}

function inventoryPreview(row) {
  if (!row) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      onHandQuantity: null,
      availableQuantity: null,
      unitCode: null,
    });
  }
  if (row.is_inventory_managed === false) {
    return Object.freeze({
      status: 'NOT_MANAGED',
      onHandQuantity: null,
      availableQuantity: null,
      unitCode: null,
    });
  }
  if (row.is_inventory_managed !== true || Number(row.base_variant_count) !== 1 || !row.base_variant_id) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      onHandQuantity: null,
      availableQuantity: null,
      unitCode: row.base_unit_code ?? null,
    });
  }
  return Object.freeze({
    status: 'TRACKED',
    onHandQuantity: String(row.on_hand_quantity ?? '0'),
    availableQuantity: String(row.available_quantity ?? '0'),
    unitCode: row.base_unit_code ?? null,
  });
}

function pickDefaultWarehouseId(warehouses, requestContext) {
  const scoped = scopedWarehouseIds(requestContext);
  if (scoped.size === 0) return null;
  const active = (Array.isArray(warehouses) ? warehouses : [])
    .filter((warehouse) => warehouse?.is_active === true && scoped.has(warehouse.id));
  if (active.length === 0) return null;
  if (active.length === 1) return active[0].id;
  const branchIds = Array.isArray(requestContext?.scopes?.branchIds)
    ? requestContext.scopes.branchIds.filter(Boolean)
    : [];
  const branchCandidates = branchIds.length === 1
    ? active.filter((warehouse) => warehouse.branch_id === branchIds[0])
    : [];
  const candidates = branchCandidates.length ? branchCandidates : active;
  return candidates.find((warehouse) => warehouse.warehouse_type === 'main')?.id
    ?? candidates[0]?.id
    ?? null;
}

export async function resolveDefaultWarehouseId(client, { requestContext }) {
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: true,
    limit: 10000,
    offset: 0,
  });
  return pickDefaultWarehouseId(warehouses, requestContext);
}

export async function searchSalesOrderSkuOptions(client, {
  requestContext,
  search,
  warehouseId,
  salesChannelId,
  customerId = null,
  pricingAt,
  limit = 20,
  offset = 0,
}) {
  const normalizedWarehouseId = String(warehouseId ?? '').trim();
  const normalizedChannelId = String(salesChannelId ?? '').trim();
  const normalizedCustomerId = String(customerId ?? '').trim() || null;
  const normalizedPricingAt = normalizePricingAt(pricingAt, requestContext.receivedAt);
  if (!UUID_PATTERN.test(normalizedWarehouseId)
    || !UUID_PATTERN.test(normalizedChannelId)
    || !normalizedPricingAt) {
    return failure(
      'SALES_ORDER_SEARCH_CONTEXT_REQUIRED',
      'Hãy chọn kho và kênh bán trước khi tìm hàng',
    );
  }
  const scoped = scopedWarehouseIds(requestContext);
  if (!scoped.has(normalizedWarehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Kho đã chọn nằm ngoài phạm vi được cấp');
  }
  const [warehouse, channel] = await Promise.all([
    warehouseRepository.getWarehouseByIdForInstallation(client, {
      id: normalizedWarehouseId,
      installationId: requestContext.installationId,
    }),
    commercialRepository.getActiveSalesChannel(client, {
      installationId: requestContext.installationId,
      id: normalizedChannelId,
    }),
  ]);
  if (!warehouse || warehouse.is_active !== true) {
    return failure('WAREHOUSE_NOT_FOUND', 'Kho đã chọn không còn hoạt động');
  }
  if (!channel) return failure('SALES_CHANNEL_NOT_FOUND', 'Kênh bán không còn hoạt động');
  if (normalizedCustomerId) {
    if (!UUID_PATTERN.test(normalizedCustomerId)) {
      return failure('CUSTOMER_NOT_FOUND', 'Khách hàng không hợp lệ');
    }
    const customer = await salesOrderRepository.getActiveCustomer(client, {
      installationId: requestContext.installationId,
      id: normalizedCustomerId,
    });
    if (!customer?.is_active) return failure('CUSTOMER_NOT_FOUND', 'Khách hàng không còn hoạt động');
  }

  const base = await legacy.searchSalesOrderSkuOptions(client, {
    requestContext,
    search,
    limit,
    offset,
  });
  if (!base.ok || base.skuOptions.length === 0) return base;

  const inventoryRows = await previewRepository.listSalesOrderSkuInventoryPreviews(client, {
    installationId: requestContext.installationId,
    warehouseId: normalizedWarehouseId,
    variantIds: base.skuOptions.map((option) => option.id),
  });
  const inventoryByVariantId = new Map(inventoryRows.map((row) => [row.sales_variant_id, row]));
  const enriched = await Promise.all(base.skuOptions.map(async (option) => {
    const pricing = await pricingService.resolvePrice(client, {
      installationId: requestContext.installationId,
      payload: {
        variantId: option.id,
        quantity: '1',
        currencyCode: 'VND',
        priceAt: normalizedPricingAt,
        channelId: normalizedChannelId,
        ...(normalizedCustomerId ? { customerId: normalizedCustomerId } : {}),
        allowMissingBasePrice: true,
      },
    });
    return Object.freeze({
      ...option,
      pricePreview: pricePreview(pricing),
      inventoryPreview: inventoryPreview(inventoryByVariantId.get(option.id)),
    });
  }));
  return Object.freeze({ ok: true, skuOptions: Object.freeze(enriched) });
}

export const salesOrderSearchPreviewInternals = Object.freeze({
  inventoryPreview,
  normalizePricingAt,
  pickDefaultWarehouseId,
  pricePreview,
});
