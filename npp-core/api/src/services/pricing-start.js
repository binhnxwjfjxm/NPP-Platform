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
  return {
    kind: 'BASE',
    ...(start.source === 'CHANNEL_FIXED_FALLBACK' ? { reason: 'CHANNEL_FIXED_FALLBACK' } : {}),
    priceListId: candidate.price_list_id,
    priceListCode: candidate.price_list_code,
    ...(start.source === 'CHANNEL_FIXED_FALLBACK' ? { priceListType: candidate.list_type } : {}),
    itemId: candidate.item_id,
    adjustmentType: candidate.adjustment_type,
    beforeUnitPriceMinor: null,
    afterUnitPriceMinor: String(candidate.amount_minor),
  };
}
