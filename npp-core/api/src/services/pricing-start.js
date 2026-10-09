export function selectPricingStart(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const base = rows.find(
    (candidate) => candidate.list_type === 'BASE' && candidate.adjustment_type === 'FIXED_PRICE',
  );
  if (base) return Object.freeze({ candidate: base, source: 'BASE' });

  const channelFixed = rows.find(
    (candidate) => candidate.list_type === 'CHANNEL' && candidate.adjustment_type === 'FIXED_PRICE',
  );
  if (!channelFixed) return null;
  return Object.freeze({ candidate: channelFixed, source: 'CHANNEL_FIXED_FALLBACK' });
}

export function pricingStartStep(start) {
  const candidate = start.candidate;
  if (start.source === 'CHANNEL_FIXED_FALLBACK') {
    return {
      kind: 'RULE',
      reason: 'CHANNEL_FIXED_FALLBACK',
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
