const SCALE = 1_000_000n;
const HUNDRED = 100n * SCALE;
const DOCUMENT_DISCOUNT_MODES = new Set(['NONE', 'PERCENT', 'TOTAL_AMOUNT']);

function failure(code, message, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable: false, details });
}

export function parseScaledDecimal(value, { allowZero = true, maxWholeDigits = 18 } = {}) {
  const normalized = String(value ?? '').trim();
  const pattern = new RegExp(`^(0|[1-9]\\d{0,${Math.max(0, maxWholeDigits - 1)}})(?:\\.(\\d{1,6}))?$`);
  const match = pattern.exec(normalized);
  if (!match) return null;
  const scaled = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  return !allowZero && scaled === 0n ? null : scaled;
}

export function formatScaledDecimal(value) {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function halfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

export function normalizeDocumentDiscount(payload, requestContext) {
  const mode = String(payload?.documentDiscountMode ?? 'NONE').trim().toUpperCase();
  if (!DOCUMENT_DISCOUNT_MODES.has(mode)) {
    return failure('INVALID_DOCUMENT_DISCOUNT_MODE', 'Document discount mode is invalid');
  }
  const raw = payload?.documentDiscountValue ?? '0';
  const scaled = parseScaledDecimal(raw, { allowZero: true });
  if (scaled === null) {
    return failure('INVALID_DOCUMENT_DISCOUNT', 'Document discount value is invalid');
  }
  if (mode === 'PERCENT' && scaled > HUNDRED) {
    return failure('INVALID_DOCUMENT_DISCOUNT', 'Document discount percent cannot exceed 100');
  }
  if (mode === 'TOTAL_AMOUNT' && scaled % SCALE !== 0n) {
    return failure('INVALID_DOCUMENT_DISCOUNT', 'VND document discount must be a whole amount');
  }
  if (mode === 'NONE' && scaled !== 0n) {
    return failure('INVALID_DOCUMENT_DISCOUNT', 'NONE document discount must have value 0');
  }
  const positive = scaled > 0n;
  const permissions = Array.isArray(requestContext?.permissions) ? requestContext.permissions : [];
  if (positive && !permissions.includes('core.sales-order.discount.override')) {
    return failure('DOCUMENT_DISCOUNT_FORBIDDEN', 'Document discount permission is required');
  }
  const reason = positive ? String(payload?.documentDiscountReason ?? '').trim() : null;
  if (positive && (!reason || reason.length > 1000)) {
    return failure('DOCUMENT_DISCOUNT_REASON_REQUIRED', 'Document discount reason is required and must not exceed 1000 characters');
  }
  return Object.freeze({
    ok: true,
    mode,
    value: mode === 'TOTAL_AMOUNT' ? (scaled / SCALE).toString() : formatScaledDecimal(scaled),
    scaled,
    positive,
    reason,
  });
}

export function documentDiscountTarget({ mode, valueScaled, grossTotalMinor }) {
  if (mode === 'NONE' || valueScaled === 0n) return 0n;
  if (mode === 'PERCENT') return halfUp(grossTotalMinor * valueScaled, HUNDRED);
  const amount = valueScaled / SCALE;
  return amount;
}

export function allocateLargestRemainder(grossByLine, targetMinor) {
  const eligible = grossByLine
    .map((gross, index) => ({ lineNumber: index + 1, gross: BigInt(gross) }))
    .filter((entry) => entry.gross > 0n);
  const totalGross = eligible.reduce((sum, entry) => sum + entry.gross, 0n);
  if (targetMinor < 0n || targetMinor > totalGross) {
    return failure('DOCUMENT_DISCOUNT_EXCEEDS_GROSS', 'Document discount cannot exceed eligible gross');
  }
  const allocations = grossByLine.map(() => 0n);
  if (targetMinor === 0n || totalGross === 0n) return Object.freeze({ ok: true, allocations });

  let allocated = 0n;
  const ranked = eligible.map((entry) => {
    const numerator = entry.gross * targetMinor;
    const floor = numerator / totalGross;
    const remainder = numerator % totalGross;
    allocations[entry.lineNumber - 1] = floor;
    allocated += floor;
    return { ...entry, remainder };
  }).sort((left, right) => {
    if (left.remainder === right.remainder) return left.lineNumber - right.lineNumber;
    return left.remainder > right.remainder ? -1 : 1;
  });

  let remaining = targetMinor - allocated;
  for (const entry of ranked) {
    if (remaining === 0n) break;
    const index = entry.lineNumber - 1;
    if (allocations[index] < entry.gross) {
      allocations[index] += 1n;
      remaining -= 1n;
    }
  }
  if (remaining !== 0n) {
    return failure('DOCUMENT_DISCOUNT_ALLOCATION_FAILED', 'Document discount allocation did not reconcile');
  }
  return Object.freeze({ ok: true, allocations });
}

export function taxAfterDiscount({ grossMinor, discountMinor, taxMode, taxRateScaled }) {
  const discounted = grossMinor - discountMinor;
  if (discounted < 0n) return failure('DISCOUNT_EXCEEDS_LINE', 'Discount cannot exceed line gross');
  if (taxMode === 'EXCLUSIVE') {
    const taxMinor = halfUp(discounted * taxRateScaled, HUNDRED);
    return Object.freeze({
      ok: true,
      lineSubtotalMinor: grossMinor,
      taxMinor,
      lineTotalMinor: discounted + taxMinor,
    });
  }
  const taxMinor = taxRateScaled === 0n
    ? 0n
    : halfUp(discounted * taxRateScaled, HUNDRED + taxRateScaled);
  return Object.freeze({
    ok: true,
    lineSubtotalMinor: grossMinor - taxMinor,
    taxMinor,
    lineTotalMinor: discounted,
  });
}

export function canonicalPricingFingerprint(resolution) {
  const steps = Array.isArray(resolution?.steps) ? resolution.steps : [];
  const normalized = JSON.stringify({
    variantId: resolution?.variant?.id ?? resolution?.variantId ?? null,
    currencyCode: resolution?.currencyCode ?? null,
    quantity: resolution?.quantity ?? null,
    priceAt: resolution?.priceAt ?? null,
    channelId: resolution?.channelId ?? null,
    customerGroupId: resolution?.customerGroupId ?? null,
    customerId: resolution?.customerId ?? null,
    baseUnitPriceMinor: resolution?.baseUnitPriceMinor ?? null,
    systemUnitPriceMinor: resolution?.systemUnitPriceMinor ?? resolution?.finalUnitPriceMinor ?? null,
    steps: steps.map((step) => ({
      kind: step.kind,
      reason: step.reason ?? null,
      priceListId: step.priceListId ?? null,
      itemId: step.itemId ?? null,
      beforeUnitPriceMinor: step.beforeUnitPriceMinor ?? null,
      afterUnitPriceMinor: step.afterUnitPriceMinor ?? null,
      priority: step.priority ?? null,
      stackingMode: step.stackingMode ?? null,
    })),
  });
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `pricing-v1-${hash.toString(16).padStart(8, '0')}`;
}
