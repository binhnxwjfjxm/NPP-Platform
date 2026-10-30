export type CurrentPriceRule = {
  isActive: boolean;
  listIsActive: boolean;
  adjustmentType: string;
  amountMinor: string;
  minQuantity: string;
  maxQuantity: string;
  effectiveFrom: string;
  effectiveTo: string;
  listEffectiveFrom: string;
  listEffectiveTo: string;
};

export type CurrentPriceSummary =
  | { kind: 'NONE' }
  | { kind: 'FIXED'; amountMinor: string }
  | { kind: 'CONDITIONAL' }
  | { kind: 'MULTIPLE' };

export function decimalKey(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  return normalized.includes('.') ? normalized.replace(/0+$/, '').replace(/\.$/, '') || '0' : normalized;
}

// Same inclusive-start, exclusive-end interval as the Công Ty pricing resolver.
function effectiveAt(from: string, to: string, at: number) {
  const start = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const end = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  return !Number.isNaN(start) && !Number.isNaN(end) && start <= at && at < end;
}

export function summarizeCurrentPriceRules(rules: readonly CurrentPriceRule[], at: number): CurrentPriceSummary {
  if (!Number.isFinite(at)) return { kind: 'NONE' };
  const current = rules.filter((rule) => rule.isActive
    && rule.listIsActive
    && effectiveAt(rule.listEffectiveFrom, rule.listEffectiveTo, at)
    && effectiveAt(rule.effectiveFrom, rule.effectiveTo, at));
  if (current.length === 0) return { kind: 'NONE' };
  // Distinguish valid tiers/adjustments from competing simultaneous rules.
  // Never choose a single price when more than one rule can affect a SKU.
  if (current.length > 1) {
    const overlapsQuantity = (a: CurrentPriceRule, b: CurrentPriceRule) => {
      const startA = Number(a.minQuantity || '0');
      const startB = Number(b.minQuantity || '0');
      const endA = a.maxQuantity ? Number(a.maxQuantity) : Infinity;
      const endB = b.maxQuantity ? Number(b.maxQuantity) : Infinity;
      if ([startA, startB, endA, endB].some(Number.isNaN)) return true;
      return startA <= endB && startB <= endA;
    };
    for (let i = 0; i < current.length; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        if (current[i].adjustmentType === current[j].adjustmentType
          && overlapsQuantity(current[i], current[j])) return { kind: 'MULTIPLE' };
      }
    }
    return { kind: 'CONDITIONAL' };
  }
  const rule = current[0];
  if (rule.adjustmentType !== 'FIXED_PRICE'
    || decimalKey(rule.minQuantity || '0') !== '0'
    || decimalKey(rule.maxQuantity)) return { kind: 'CONDITIONAL' };
  return { kind: 'FIXED', amountMinor: rule.amountMinor };
}
