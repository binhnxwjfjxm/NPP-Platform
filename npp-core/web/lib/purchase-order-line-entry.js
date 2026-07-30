const SCALE = 1_000_000n;
const ONE_HUNDRED_PERCENT = 100n * SCALE;
const DECIMAL_PATTERN = /^\d{1,14}(?:\.(\d{1,6}))?$/;
const SAFE_INTERMEDIATE_PATTERN = /^\d{0,14}(?:[,.]\d{0,6})?$/;

export const PURCHASE_ORDER_DISCOUNT_MODES = Object.freeze({
  totalAmount: 'TOTAL_AMOUNT',
  perUnit: 'PER_UNIT',
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
  return cleanFraction ? `${cleanInteger}.${cleanFraction}` : cleanInteger;
}

export function isSafeDecimalIntermediate(value) {
  const raw = String(value ?? '').trim();
  return raw === '' || SAFE_INTERMEDIATE_PATTERN.test(raw);
}

export function decimalToScaled(value, allowZero = true) {
  const normalized = normalizeDecimalForApi(value);
  if (normalized === null) return null;
  const [integerPart, fractionPart = ''] = normalized.split('.');
  const scaled = BigInt(integerPart) * SCALE + BigInt(fractionPart.padEnd(6, '0') || '0');
  return !allowZero && scaled === 0n ? null : scaled;
}

export function scaledToDecimal(value) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const integer = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
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
  if (normalized === null) return '—';
  const [integer, fraction = ''] = normalized.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction ? `${grouped},${fraction}` : grouped;
}

function normalizeDiscountMode(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (['%', 'PERCENT'].includes(normalized)) return PURCHASE_ORDER_DISCOUNT_MODES.percent;
  if (['PER_UNIT', 'UNIT', 'GIAM_MOI_DON_VI'].includes(normalized)) return PURCHASE_ORDER_DISCOUNT_MODES.perUnit;
  if (['', 'TOTAL_AMOUNT', 'TOTAL', 'AMOUNT'].includes(normalized)) return PURCHASE_ORDER_DISCOUNT_MODES.totalAmount;
  return null;
}

export function calculatePurchaseOrderLineFinancials(line) {
  const quantity = decimalToScaled(line.quantity, false);
  const unitPrice = decimalToScaled(line.unitPrice || '0');
  if (quantity === null || unitPrice === null) return null;
  const mode = normalizeDiscountMode(line.discountMode ?? PURCHASE_ORDER_DISCOUNT_MODES.totalAmount);
  if (!mode) return null;
  const discountValue = decimalToScaled(line.discountValue ?? line.discountAmount ?? '0');
  const taxRate = decimalToScaled(line.taxRate ?? '0');
  if (discountValue === null || taxRate === null || taxRate > ONE_HUNDRED_PERCENT) return null;
  if (mode === PURCHASE_ORDER_DISCOUNT_MODES.percent && discountValue > ONE_HUNDRED_PERCENT) return null;
  const gross = multiplyScaled(quantity, unitPrice);
  const discountAmount = mode === PURCHASE_ORDER_DISCOUNT_MODES.percent
    ? percentOfScaled(gross, discountValue)
    : mode === PURCHASE_ORDER_DISCOUNT_MODES.perUnit
      ? multiplyScaled(quantity, discountValue)
      : discountValue;
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
    if (!financials) {
      lineTotals.push('0');
      continue;
    }
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

function splitPasteRow(row) {
  if (row.includes('\t')) return row.split('\t');
  return row.split(';');
}

function looksLikeHeader(cells) {
  const first = String(cells[0] ?? '').trim().toLowerCase();
  const second = String(cells[1] ?? '').trim().toLowerCase();
  return ['sku', 'mã sku', 'ma sku', 'barcode', 'mã vạch', 'ma vach'].includes(first)
    && ['số lượng', 'so luong', 'quantity', 'qty'].includes(second);
}

export function parsePurchaseOrderPasteGrid(text) {
  const rawRows = String(text ?? '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  const rows = rawRows.length > 0 && looksLikeHeader(splitPasteRow(rawRows[0])) ? rawRows.slice(1) : rawRows;
  return rows.slice(0, 500).map((row, index) => {
    const cells = splitPasteRow(row).map((cell) => cell.trim());
    const [sku = '', quantity = '', unitPrice = '', discountMode = 'TOTAL_AMOUNT', discountValue = '0', taxRate = '0', ...noteCells] = cells;
    const normalizedMode = normalizeDiscountMode(discountMode);
    const errors = [];
    if (!sku) errors.push('Thiếu SKU hoặc mã vạch.');
    if (decimalToScaled(quantity, false) === null) errors.push('Số lượng không hợp lệ.');
    if (decimalToScaled(unitPrice || '0') === null) errors.push('Đơn giá không hợp lệ.');
    if (!normalizedMode) errors.push('Kiểu chiết khấu không hợp lệ.');
    if (decimalToScaled(discountValue || '0') === null) errors.push('Chiết khấu không hợp lệ.');
    const parsedTaxRate = decimalToScaled(taxRate || '0');
    if (parsedTaxRate === null || parsedTaxRate > ONE_HUNDRED_PERCENT) errors.push('Thuế suất phải từ 0 đến 100%.');
    if (normalizedMode === PURCHASE_ORDER_DISCOUNT_MODES.percent) {
      const parsedDiscount = decimalToScaled(discountValue || '0');
      if (parsedDiscount !== null && parsedDiscount > ONE_HUNDRED_PERCENT) errors.push('Chiết khấu phần trăm phải từ 0 đến 100%.');
    }
    return Object.freeze({
      rowNumber: index + 1,
      sku,
      quantity,
      unitPrice: unitPrice || '0',
      discountMode: normalizedMode ?? PURCHASE_ORDER_DISCOUNT_MODES.totalAmount,
      discountValue: discountValue || '0',
      taxRate: taxRate || '0',
      note: noteCells.join(' ').slice(0, 2000),
      errors: Object.freeze(errors),
    });
  });
}
