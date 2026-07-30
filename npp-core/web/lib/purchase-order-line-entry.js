const SCALE = 1_000_000n;
const DECIMAL_PATTERN = /^\d{1,14}(?:\.(\d{1,6}))?$/;
const SAFE_INTERMEDIATE_PATTERN = /^\d{0,14}(?:[,.]\d{0,6})?$/;

export const PURCHASE_ORDER_DISCOUNT_MODES = Object.freeze({
  totalAmount: 'TOTAL_AMOUNT',
  percent: 'PERCENT',
});

export function normalizeDecimalForApi(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!SAFE_INTERMEDIATE_PATTERN.test(raw)) return null;
  const normalized = raw.replace(',', '.');
  if (normalized === '.' || normalized.endsWith('.')) return null;
  if (!DECIMAL_PATTERN.test(normalized)) return null;
  const [integer, fraction = ''] = normalized.split('.');
  const cleanInteger = integer.replace(/^0+(?=\d)/, '') || '0';
  const cleanFraction = fraction.replace(/0+$/, '');
  return cleanFraction ? cleanInteger + '.' + cleanFraction : cleanInteger;
}

export function isSafeDecimalIntermediate(value) {
  const raw = String(value ?? '').trim();
  return raw === '' || SAFE_INTERMEDIATE_PATTERN.test(raw);
}

export function decimalToScaled(value, allowZero = true) {
  const normalized = normalizeDecimalForApi(value);
  if (normalized === null) return null;
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return null;
  const [integerPart, fractionPart = ''] = normalized.split('.');
  const scaled = BigInt(integerPart) * SCALE + BigInt(fractionPart.padEnd(6, '0') || '0');
  return !allowZero && scaled === 0n ? null : scaled;
}

export function scaledToDecimal(value) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const integer = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return sign + integer.toString() + (fraction ? '.' + fraction : '');
}

export function multiplyScaled(left, right) {
  return (left * right + SCALE / 2n) / SCALE;
}

export function percentOfScaled(base, percent) {
  return (base * percent + 50n * SCALE) / (100n * SCALE);
}

export function formatDecimalForInput(value) {
  const normalized = normalizeDecimalForApi(value);
  return normalized ?? String(value ?? '').trim();
}

export function formatDecimalForDisplay(value) {
  const normalized = normalizeDecimalForApi(value);
  if (normalized === null) return 'â€”';
  const [integer, fraction = ''] = normalized.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction ? grouped + ',' + fraction : grouped;
}

export function calculatePurchaseOrderLineFinancials(line) {
  const quantity = decimalToScaled(line.quantity, false);
  const unitPrice = decimalToScaled(line.unitPrice || '0');
  if (quantity === null || unitPrice === null) return null;
  const gross = multiplyScaled(quantity, unitPrice);
  const mode = line.discountMode === PURCHASE_ORDER_DISCOUNT_MODES.percent ? PURCHASE_ORDER_DISCOUNT_MODES.percent : PURCHASE_ORDER_DISCOUNT_MODES.totalAmount;
  const valueSource = line.discountValue ?? line.discountAmount ?? '0';
  const discountValue = decimalToScaled(valueSource || '0');
  const taxRate = decimalToScaled(line.taxRate ?? '0');
  if (discountValue === null || taxRate === null) return null;
  const discountAmount = mode === PURCHASE_ORDER_DISCOUNT_MODES.percent ? percentOfScaled(gross, discountValue) : discountValue;
  const discountedBase = gross - discountAmount;
  if (discountedBase < 0n) return null;
  const taxAmount = percentOfScaled(discountedBase, taxRate);
  const lineTotal = discountedBase + taxAmount;
  return Object.freeze({
    gross: scaledToDecimal(gross),
    discountMode: mode,
    discountValue: scaledToDecimal(discountValue),
    discountAmount: scaledToDecimal(discountAmount),
    taxRate: scaledToDecimal(taxRate),
    taxAmount: scaledToDecimal(taxAmount),
    lineTotal: scaledToDecimal(lineTotal),
  });
}

export function calculatePurchaseOrderDraftTotals(lines) {
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  const lineTotals = [];
  for (const line of lines) {
    const financials = calculatePurchaseOrderLineFinancials(line);
    if (!financials) { lineTotals.push('0'); continue; }
    const gross = decimalToScaled(financials.gross) ?? 0n;
    const discount = decimalToScaled(financials.discountAmount) ?? 0n;
    const tax = decimalToScaled(financials.taxAmount) ?? 0n;
    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;
    lineTotals.push(financials.lineTotal);
  }
  return Object.freeze({
    subtotal: scaledToDecimal(subtotal),
    discountTotal: scaledToDecimal(discountTotal),
    taxTotal: scaledToDecimal(taxTotal),
    total: scaledToDecimal(subtotal - discountTotal + taxTotal),
    lineTotals: Object.freeze(lineTotals),
  });
}

export function parsePurchaseOrderPasteGrid(text) {
  const rows = String(text ?? '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  return rows.map((row, index) => {
    const cells = row.split(/[\t,;]/).map((cell) => cell.trim());
    const [sku = '', quantity = '', unitPrice = '', discountMode = 'TOTAL_AMOUNT', discountValue = '0', taxRate = '0', ...noteCells] = cells;
    const normalizedMode = String(discountMode).trim().toUpperCase() === 'PERCENT' ? 'PERCENT' : 'TOTAL_AMOUNT';
    const errors = [];
    if (!sku) errors.push('Thiáº¿u SKU hoáº·c mÃ£ váº¡ch.');
    if (decimalToScaled(quantity, false) === null) errors.push('Sá»‘ lÆ°á»£ng khÃ´ng há»£p lá»‡.');
    if (decimalToScaled(unitPrice || '0') === null) errors.push('ÄÆ¡n giÃ¡ khÃ´ng há»£p lá»‡.');
    if (decimalToScaled(discountValue || '0') === null) errors.push('Chiáº¿t kháº¥u khÃ´ng há»£p lá»‡.');
    if (decimalToScaled(taxRate || '0') === null) errors.push('Thuáº¿ suáº¥t khÃ´ng há»£p lá»‡.');
    return Object.freeze({
      rowNumber: index + 1,
      sku,
      quantity,
      unitPrice: unitPrice || '0',
      discountMode: normalizedMode,
      discountValue: discountValue || '0',
      taxRate: taxRate || '0',
      note: noteCells.join(' ').slice(0, 2000),
      errors: Object.freeze(errors),
    });
  });
}


