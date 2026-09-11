import { createHash } from 'node:crypto';
import * as searchPricingService from './sales-order-search-pricing.js';
import * as historyRepository from '../db/repositories/sales-order-applied-price.js';
import * as commercialRepository from '../db/repositories/sales-order-commercial.js';
import * as salesOrderRepository from '../db/repositories/sales-order.js';
import {
  canonicalPricingFingerprint,
  formatScaledDecimal,
  halfUp,
  parseScaledDecimal,
} from './sales-order-commercial.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
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

function applyAdjustment(current, candidate) {
  const type = candidate.adjustment_type;
  const amount = candidate.amount_minor === null || candidate.amount_minor === undefined
    ? null
    : BigInt(String(candidate.amount_minor));
  const rate = candidate.rate_bps === null || candidate.rate_bps === undefined
    ? null
    : BigInt(String(candidate.rate_bps));
  if (type === 'FIXED_PRICE') return amount;
  if (type === 'AMOUNT_DISCOUNT') return current > amount ? current - amount : 0n;
  if (type === 'AMOUNT_MARKUP') return current + amount;
  const delta = halfUp(current * rate, 10_000n);
  if (type === 'PERCENT_DISCOUNT') return current > delta ? current - delta : 0n;
  return current + delta;
}

async function resolveStandardAppliedPrice(client, { installationId, payload }) {
  const variantId = String(payload?.variantId ?? '').trim();
  if (!UUID_PATTERN.test(variantId)) {
    return failure('INVALID_VARIANT_ID', 'variantId must be a valid UUID');
  }
  const quantityScaled = parseScaledDecimal(payload?.quantity ?? '1', {
    allowZero: false,
    maxWholeDigits: 14,
  });
  if (quantityScaled === null) {
    return failure('INVALID_QUANTITY', 'quantity must be greater than zero');
  }
  const quantity = formatScaledDecimal(quantityScaled);
  const currencyCode = String(payload?.currencyCode ?? 'VND').trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currencyCode)) {
    return failure('INVALID_CURRENCY', 'currencyCode is invalid');
  }
  const parsedPriceAt = new Date(payload?.priceAt ?? new Date());
  if (Number.isNaN(parsedPriceAt.getTime())) {
    return failure('INVALID_DATE_TIME', 'priceAt must be a valid date-time');
  }
  const priceAt = parsedPriceAt.toISOString();
  const channelId = String(payload?.channelId ?? '').trim() || null;
  const customerGroupId = String(payload?.customerGroupId ?? '').trim() || null;
  const customerId = String(payload?.customerId ?? '').trim() || null;
  for (const [field, value] of [
    ['channelId', channelId],
    ['customerGroupId', customerGroupId],
    ['customerId', customerId],
  ]) {
    if (value && !UUID_PATTERN.test(value)) {
      return failure('INVALID_SCOPE_ID', `${field} must be a valid UUID`);
    }
  }

  const context = await historyRepository.getStandardPriceResolutionContext(client, {
    installationId,
    variantId,
    currencyCode,
    priceAt,
    quantity,
    channelId,
    customerGroupId,
    customerId,
  });
  const variant = context?.variant ?? null;
  if (!variant) return failure('VARIANT_NOT_FOUND', 'Product variant not found');
  if (!variant.is_active || !variant.is_sellable) {
    return failure('VARIANT_NOT_PRICEABLE', 'Product variant must be active and sellable');
  }
  if (!variant.unit_id || !variant.conversion_to_base) {
    return failure('VARIANT_UNIT_MISSING', 'Product variant requires unit and conversion metadata');
  }
  if (channelId && (!context?.channel || context.channel.is_active !== true)) {
    return failure('CHANNEL_NOT_FOUND', 'Active sales channel not found');
  }

  let effectiveCustomerGroupId = customerGroupId;
  if (customerId) {
    const customer = context?.customer ?? null;
    if (!customer || customer.is_active !== true) {
      return failure('CUSTOMER_NOT_FOUND', 'Active customer not found');
    }
    if (customerGroupId && customer.group_id !== customerGroupId) {
      return failure('CUSTOMER_GROUP_MISMATCH', 'Customer does not belong to the selected group');
    }
    effectiveCustomerGroupId = customer.group_id ?? customerGroupId;
  } else if (customerGroupId) {
    const group = context?.customer_group ?? null;
    if (!group || group.is_active !== true) {
      return failure('CUSTOMER_GROUP_NOT_FOUND', 'Active customer group not found');
    }
  }

  const candidates = Array.isArray(context?.candidates) ? context.candidates : [];
  const base = candidates.find(
    (candidate) => candidate.list_type === 'BASE' && candidate.adjustment_type === 'FIXED_PRICE',
  );
  if (!base) {
    return failure('BASE_PRICE_NOT_FOUND', 'No active base price is available for this SKU and currency');
  }

  let current = BigInt(String(base.amount_minor));
  const steps = [{
    kind: 'BASE',
    priceListId: base.price_list_id,
    priceListCode: base.price_list_code,
    itemId: base.item_id,
    adjustmentType: base.adjustment_type,
    beforeUnitPriceMinor: null,
    afterUnitPriceMinor: current.toString(),
  }];
  let exclusiveApplied = false;
  for (const candidate of candidates) {
    if (candidate.item_id === base.item_id || candidate.list_type === 'BASE') continue;
    if (candidate.stacking_mode === 'EXCLUSIVE' && exclusiveApplied) {
      steps.push({
        kind: 'SKIPPED',
        reason: 'LOWER_PRIORITY_EXCLUSIVE',
        priceListId: candidate.price_list_id,
        priceListCode: candidate.price_list_code,
        itemId: candidate.item_id,
      });
      continue;
    }
    const before = current;
    current = applyAdjustment(current, candidate);
    steps.push({
      kind: 'RULE',
      priceListId: candidate.price_list_id,
      priceListCode: candidate.price_list_code,
      priceListType: candidate.list_type,
      itemId: candidate.item_id,
      adjustmentType: candidate.adjustment_type,
      amountMinor: candidate.amount_minor,
      rateBps: candidate.rate_bps,
      beforeUnitPriceMinor: before.toString(),
      afterUnitPriceMinor: current.toString(),
      priority: candidate.priority,
      stackingMode: candidate.stacking_mode,
      sourceKind: candidate.source_kind,
      sourceKey: candidate.source_key,
      externalRuleCode: candidate.external_rule_code,
    });
    if (candidate.stacking_mode === 'EXCLUSIVE') exclusiveApplied = true;
    if (candidate.stop_processing) break;
  }

  const systemResolution = {
    variant,
    currencyCode,
    quantity,
    priceAt,
    channelId,
    customerGroupId: effectiveCustomerGroupId,
    customerId,
    baseUnitPriceMinor: String(base.amount_minor),
    finalUnitPriceMinor: current.toString(),
    lineTotalMinor: halfUp(quantityScaled * current, SCALE).toString(),
    steps,
    systemUnitPriceMinor: current.toString(),
  };
  return Object.freeze({
    ok: true,
    resolution: Object.freeze({
      ...systemResolution,
      resolutionFingerprint: canonicalPricingFingerprint(systemResolution),
    }),
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
    return resolveStandardAppliedPrice(client, { installationId, payload });
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

  return resolveStandardAppliedPrice(client, {
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
  applyAdjustment,
  resolveStandardAppliedPrice,
});
