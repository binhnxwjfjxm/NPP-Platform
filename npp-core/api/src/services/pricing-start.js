export function selectPricingStart(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const base = rows.find(
    (candidate) => candidate.list_type === 'BASE' && candidate.adjustment_type === 'FIXED_PRICE',
  );
  if (base) return Object.freeze({ candidate: base, source: 'BASE' });

  const scopedFixed = rows.find((candidate) => candidate.list_type === 'CUSTOMER' && candidate.adjustment_type === 'FIXED_PRICE')
    ?? rows.find((candidate) => candidate.list_type === 'CUSTOMER_GROUP' && candidate.adjustment_type === 'FIXED_PRICE')
    ?? rows.find((candidate) => candidate.list_type === 'CHANNEL' && candidate.adjustment_type === 'FIXED_PRICE');
  if (!scopedFixed) return Object.freeze({ candidate: Object.freeze({ item_id: null, amount_minor: '0', price_list_id: null, price_list_code: null }), source: 'ZERO_BASE' });
  const source = scopedFixed.list_type === 'CHANNEL' ? 'CHANNEL_FIXED_FALLBACK' : 'SCOPED_FIXED_FALLBACK';
  return Object.freeze({ candidate: scopedFixed, source });
}

export function pricingStartStep(start) {
  const candidate = start.candidate;
  if (start.source === 'ZERO_BASE') return { kind: 'BASE', reason: 'MISSING_BASE_ZERO', beforeUnitPriceMinor: null, afterUnitPriceMinor: '0' };
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
