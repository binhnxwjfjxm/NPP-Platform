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
  // Do not silently choose a price when overlapping rules can both apply.
  if (current.length > 1) return { kind: 'MULTIPLE' };
  const rule = current[0];
  if (rule.adjustmentType !== 'FIXED_PRICE'
    || decimalKey(rule.minQuantity || '0') !== '0'
    || decimalKey(rule.maxQuantity)) return { kind: 'CONDITIONAL' };
  return { kind: 'FIXED', amountMinor: rule.amountMinor };
}
