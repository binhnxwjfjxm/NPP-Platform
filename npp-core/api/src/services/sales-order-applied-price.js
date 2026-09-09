import { createHash } from 'node:crypto';
import * as pricingService from './pricing.js';
import * as searchPricingService from './sales-order-search-pricing.js';
import * as historyRepository from '../db/repositories/sales-order-applied-price.js';
import * as commercialRepository from '../db/repositories/sales-order-commercial.js';
import * as salesOrderRepository from '../db/repositories/sales-order.js';
import { halfUp, parseScaledDecimal } from './sales-order-commercial.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRICE_SELECTION_MODES = new Set(['STANDARD', 'LAST_PURCHASE']);
const SCALE = 1_000_000n;
const MAX_PREVIEW_VARIANTS = 50;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

export function normalizePriceSelectionMode(value) {
  const normalized = String(value ?? 'STANDARD').trim().toUpperCase();
  return PRICE_SELECTION_MODES.has(normalized) ? normalized : null;
}

function confirmedAtText(value) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? String(value ?? '') : parsed.toISOString();
}

function historyFingerprint({ installationId, customerId, variantId, row }) {
  return createHash('sha256')
    .update(JSON.stringify([
      'sales-order-history-reference-v1',
      installationId,
      customerId,
      variantId,
      row.unit_id,
      row.source_sales_order_id,
      String(row.source_version_number),
      row.source_line_id,
      confirmedAtText(row.source_confirmed_at),
      String(row.unit_price_minor),
    ]))
    .digest('hex');
}

function historyResolution({ installationId, payload, row }) {
  const value = String(row.unit_price_minor);
  const fingerprint = historyFingerprint({
    installationId,
    customerId: payload.customerId,
    variantId: payload.variantId,
    row,
  });
  const quantity = parseScaledDecimal(payload.quantity ?? '1', {
    allowZero: false,
    maxWholeDigits: 14,
  });
  const lineTotalMinor = quantity === null
    ? value
    : halfUp(quantity * BigInt(value), SCALE).toString();
  const sourceConfirmedAt = confirmedAtText(row.source_confirmed_at);
  return Object.freeze({
    variant: Object.freeze({ id: payload.variantId, unitId: row.unit_id }),
    variantId: payload.variantId,
    currencyCode: payload.currencyCode ?? 'VND',
    quantity: String(payload.quantity ?? '1'),
    priceAt: payload.priceAt ?? new Date().toISOString(),
    channelId: payload.channelId ?? payload.salesChannelId ?? null,
    customerId: payload.customerId,
    customerGroupId: null,
    baseUnitPriceMinor: value,
    systemUnitPriceMinor: value,
    finalUnitPriceMinor: value,
    lineTotalMinor,
    priceSource: 'HISTORY_REFERENCE',
    resolutionFingerprint: fingerprint,
    steps: Object.freeze([
      Object.freeze({
        kind: 'HISTORY_REFERENCE',
        sourceSalesOrderId: row.source_sales_order_id,
        sourceSalesOrderNumber: row.source_sales_order_number ?? null,
        sourceVersionNumber: String(row.source_version_number),
        sourceLineId: row.source_line_id,
        sourceConfirmedAt,
        sourceUnitPriceMinor: value,
        afterUnitPriceMinor: value,
      }),
    ]),
  });
}

export async function resolveSalesOrderAppliedPrice(client, {
  installationId,
  payload,
}) {
  const priceSelectionMode = normalizePriceSelectionMode(payload?.priceSelectionMode);
  if (!priceSelectionMode) {
    return failure('INVALID_PRICE_SELECTION_MODE', 'Cách áp dụng giá không hợp lệ.');
  }
  if (priceSelectionMode === 'STANDARD') {
    return pricingService.resolvePrice(client, { installationId, payload });
  }

  const customerId = String(payload?.customerId ?? '').trim();
  if (!UUID_PATTERN.test(customerId)) {
    return failure(
      'LAST_PURCHASE_CUSTOMER_REQUIRED',
      'Giá lần mua trước chỉ dùng khi đã chọn khách hàng.',
    );
  }
  const variantId = String(payload?.variantId ?? '').trim();
  if (!UUID_PATTERN.test(variantId)) {
    return failure('VARIANT_NOT_FOUND', 'Hàng hóa không hợp lệ.');
  }

  const historyRows = await historyRepository.listLastPurchasePrices(client, {
    installationId,
    customerId,
    variantIds: [variantId],
  });
  const history = historyRows[0] ?? null;
  if (history) {
    return Object.freeze({
      ok: true,
      resolution: historyResolution({ installationId, payload: { ...payload, customerId, variantId }, row: history }),
    });
  }

  return pricingService.resolvePrice(client, {
    installationId,
    payload: { ...payload, customerId, variantId },
  });
}

export async function resolveSalesOrderAppliedPricePreview(client, {
  installationId,
  payload,
}) {
  const channelId = String(payload?.salesChannelId ?? payload?.channelId ?? '').trim();
  if (!UUID_PATTERN.test(channelId)) {
    return failure('SALES_CHANNEL_REQUIRED', 'Hãy chọn giá áp dụng trước khi tính giá.');
  }
  const channel = await commercialRepository.getActiveSalesChannel(client, {
    installationId,
    id: channelId,
  });
  if (!channel) return failure('SALES_CHANNEL_NOT_FOUND', 'Lựa chọn giá không còn hoạt động.');

  const mode = normalizePriceSelectionMode(payload?.priceSelectionMode);
  if (!mode) return failure('INVALID_PRICE_SELECTION_MODE', 'Cách áp dụng giá không hợp lệ.');
  const customerId = String(payload?.customerId ?? '').trim() || null;
  if (customerId) {
    if (!UUID_PATTERN.test(customerId)) return failure('CUSTOMER_NOT_FOUND', 'Khách hàng không hợp lệ.');
    const customer = await salesOrderRepository.getActiveCustomer(client, { installationId, id: customerId });
    if (!customer?.is_active) return failure('CUSTOMER_NOT_FOUND', 'Khách hàng không còn hoạt động.');
  }
  if (mode === 'LAST_PURCHASE' && !customerId) {
    return failure('LAST_PURCHASE_CUSTOMER_REQUIRED', 'Giá lần mua trước chỉ dùng khi đã chọn khách hàng.');
  }

  return resolveSalesOrderAppliedPrice(client, {
    installationId,
    payload: {
      ...payload,
      channelId,
      salesChannelId: channelId,
      customerId,
      priceSelectionMode: mode,
    },
  });
}

export async function resolveSalesOrderAppliedPricePreviews(client, {
  installationId,
  variantIds,
  priceAt,
  channelId,
  customerGroupId = null,
  customerId = null,
  priceSelectionMode = 'STANDARD',
}) {
  const ids = [...new Set(
    (Array.isArray(variantIds) ? variantIds : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean),
  )];
  if (ids.length === 0) return new Map();
  if (ids.length > MAX_PREVIEW_VARIANTS || ids.some((id) => !UUID_PATTERN.test(id))) {
    throw new Error('invalid_sales_order_applied_price_preview_variant_ids');
  }
  const mode = normalizePriceSelectionMode(priceSelectionMode);
  if (!mode) throw new Error('invalid_sales_order_price_selection_mode');
  if (mode === 'STANDARD') {
    return searchPricingService.resolveSalesOrderSearchPrices(client, {
      installationId,
      variantIds: ids,
      priceAt,
      channelId,
      customerGroupId,
      customerId,
    });
  }
  if (!UUID_PATTERN.test(String(customerId ?? ''))) {
    throw new Error('last_purchase_customer_required');
  }

  const historyRows = await historyRepository.listLastPurchasePrices(client, {
    installationId,
    customerId,
    variantIds: ids,
  });
  const historyByVariantId = new Map(historyRows.map((row) => [String(row.variant_id), row]));
  const fallbackIds = ids.filter((id) => !historyByVariantId.has(id));
  const fallback = fallbackIds.length > 0
    ? await searchPricingService.resolveSalesOrderSearchPrices(client, {
        installationId,
        variantIds: fallbackIds,
        priceAt,
        channelId,
        customerGroupId,
        customerId,
      })
    : new Map();

  return new Map(ids.map((variantId) => {
    const history = historyByVariantId.get(variantId);
    if (!history) return [variantId, fallback.get(variantId)];
    return [variantId, Object.freeze({
      ok: true,
      resolution: historyResolution({
        installationId,
        payload: {
          variantId,
          quantity: '1',
          currencyCode: 'VND',
          priceAt,
          channelId,
          salesChannelId: channelId,
          customerId,
          priceSelectionMode: mode,
        },
        row: history,
      }),
    })];
  }));
}

export const salesOrderAppliedPriceInternals = Object.freeze({
  confirmedAtText,
  historyFingerprint,
  historyResolution,
});
