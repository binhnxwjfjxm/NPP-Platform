// The repository supplies only active, in-scope, effective, quantity-matching candidates
// in descending price-list priority. Keep one canonical starting-price decision for
// the pricing API, sales order commit and the batched SKU preview.
const DIRECT_PRICE_LIST_TYPES = new Set([
  'CUSTOM', 'CUSTOMER', 'CUSTOMER_GROUP', 'PROMOTION', 'CHANNEL',
]);

export function selectPricingStart(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const base = rows.find(
    (candidate) => candidate.list_type === 'BASE' && candidate.adjustment_type === 'FIXED_PRICE',
  );
  if (base) return Object.freeze({ candidate: base, source: 'BASE' });

  const fixed = rows.find((candidate) => DIRECT_PRICE_LIST_TYPES.has(candidate.list_type)
    && candidate.adjustment_type === 'FIXED_PRICE'
    && candidate.amount_minor !== null
    && candidate.amount_minor !== undefined);
  if (!fixed) return null;
  return Object.freeze({
    candidate: fixed,
    source: fixed.list_type === 'CHANNEL' ? 'CHANNEL_FIXED_FALLBACK' : 'SCOPED_FIXED_FALLBACK',
  });
}

// A lower-priority fixed amount must not replace the chosen direct starting price.
// Percentage/amount adjustments still follow the existing stacking/stop rules.
export function isCompetingFallbackFixedPrice(start, candidate) {
  return start?.source !== 'BASE'
    && candidate?.item_id !== start?.candidate?.item_id
    && DIRECT_PRICE_LIST_TYPES.has(candidate?.list_type)
    && candidate?.adjustment_type === 'FIXED_PRICE';
}

export function pricingStartStep(start) {
  const candidate = start.candidate;
  if (start.source === 'CHANNEL_FIXED_FALLBACK' || start.source === 'SCOPED_FIXED_FALLBACK') {
    return {
      kind: 'RULE',
      reason: start.source,
      priceListId: candidate.price_list_id,
      priceListCode: candidate.price_list_code,
      priceListType: candidate.list_type,
      itemId: candidate.item_id,
      adjustmentType: candidate.adjustment_type,
      amountMinor: candidate.amount_minor,
      rateBps: candidate.rate_bps,
      beforeUnitPriceMinor: null,
      afterUnitPriceMinor: String(candidate.amount_minor),
      priority: candidate.priority,
      stackingMode: candidate.stacking_mode,
      sourceKind: candidate.source_kind,
      sourceKey: candidate.source_key,
      externalRuleCode: candidate.external_rule_code,
    };
  }
  return {
    kind: 'BASE',
    priceListId: candidate.price_list_id,
    priceListCode: candidate.price_list_code,
    itemId: candidate.item_id,
    adjustmentType: candidate.adjustment_type,
    beforeUnitPriceMinor: null,
    afterUnitPriceMinor: String(candidate.amount_minor),
  };
}
