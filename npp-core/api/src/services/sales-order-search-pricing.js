import * as repository from '../db/repositories/sales-order-search-pricing.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PREVIEW_VARIANTS = 50;

function halfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function applyAdjustment(current, candidate) {
  const type = candidate.adjustment_type;
  const amount = candidate.amount_minor === null ? null : BigInt(candidate.amount_minor);
  const rate = candidate.rate_bps === null ? null : BigInt(candidate.rate_bps);
  if (type === 'FIXED_PRICE') return amount;
  if (type === 'AMOUNT_DISCOUNT') return current > amount ? current - amount : 0n;
  if (type === 'AMOUNT_MARKUP') return current + amount;
  const delta = halfUp(current * rate, 10_000n);
  if (type === 'PERCENT_DISCOUNT') return current > delta ? current - delta : 0n;
  return current + delta;
}

function resolveCandidatePrice(candidates) {
  const base = candidates.find(
    (row) => row.list_type === 'BASE' && row.adjustment_type === 'FIXED_PRICE',
  );
  if (!base) {
    return Object.freeze({
      ok: true,
      resolution: Object.freeze({
        resolutionStatus: 'MANUAL_PRICE_REQUIRED',
        code: 'BASE_PRICE_NOT_FOUND',
        message: 'Chưa có giá Công Ty. Nhập giá bán theo quyền được cấp để tiếp tục.',
      }),
    });
  }

  let current = BigInt(base.amount_minor);
  let exclusiveApplied = false;
  for (const candidate of candidates) {
    if (candidate.item_id === base.item_id || candidate.list_type === 'BASE') continue;
    if (candidate.stacking_mode === 'EXCLUSIVE' && exclusiveApplied) continue;
    current = applyAdjustment(current, candidate);
    if (candidate.stacking_mode === 'EXCLUSIVE') exclusiveApplied = true;
    if (candidate.stop_processing) break;
  }

  const value = current.toString();
  return Object.freeze({
    ok: true,
    resolution: Object.freeze({
      systemUnitPriceMinor: value,
      finalUnitPriceMinor: value,
    }),
  });
}

export async function resolveSalesOrderSearchPrices(client, {
  installationId,
  variantIds,
  priceAt,
  channelId,
  customerGroupId = null,
  customerId = null,
}) {
  const ids = [...new Set(Array.isArray(variantIds) ? variantIds.map((id) => String(id ?? '').trim()) : [])];
  if (ids.length === 0) return new Map();
  if (ids.length > MAX_PREVIEW_VARIANTS || ids.some((id) => !UUID_PATTERN.test(id))) {
    throw new Error('invalid_sales_order_search_price_variant_ids');
  }
  const normalizedPriceAt = new Date(priceAt);
  if (Number.isNaN(normalizedPriceAt.getTime())) {
    throw new Error('invalid_sales_order_search_price_at');
  }

  const rows = await repository.listSalesOrderSearchPriceCandidates(client, {
    installationId,
    variantIds: ids,
    currencyCode: 'VND',
    priceAt: normalizedPriceAt.toISOString(),
    quantity: '1',
    channelId,
    customerGroupId,
    customerId,
  });
  const candidatesByVariantId = new Map(ids.map((id) => [id, []]));
  for (const row of rows) {
    const candidates = candidatesByVariantId.get(String(row.variant_id));
    if (candidates) candidates.push(row);
  }

  return new Map(ids.map((id) => [id, resolveCandidatePrice(candidatesByVariantId.get(id) ?? [])]));
}

export const salesOrderSearchPricingInternals = Object.freeze({
  applyAdjustment,
  resolveCandidatePrice,
});
