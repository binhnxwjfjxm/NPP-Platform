// One canonical comparison between an on-screen Retail cart and the Company's
// saved version. Used at autosave completion, before checkout and before print.
// No browser globals: regression tests execute these checks against real arrays.
function decimal(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0';
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

export function checkoutLinesMatch(savedLines, cartLines, manualPrices = {}) {
  if (!Array.isArray(savedLines) || !Array.isArray(cartLines)
    || savedLines.length !== cartLines.length || cartLines.length === 0) return false;
  const savedByVariant = new Map();
  for (const line of savedLines) {
    if (!line?.variantId || savedByVariant.has(line.variantId)) return false;
    savedByVariant.set(line.variantId, line);
  }
  for (const cart of cartLines) {
    const saved = savedByVariant.get(cart.id);
    if (!saved || decimal(saved.quantity) === null
      || decimal(saved.quantity) !== decimal(cart.quantity)
      || saved.taxMode !== cart.taxMode
      || decimal(saved.taxRate) !== decimal(cart.taxRate)) return false;
    const manual = String(manualPrices[cart.id] ?? '').trim();
    if (manual !== '') {
      if (decimal(manual) === null || saved.priceSource !== 'MANUAL_OVERRIDE'
        || decimal(saved.unitPrice) !== decimal(manual)) return false;
    }
  }
  return true;
}

export function draftMatchesRetailContext(order, context) {
  if (!order || order.status !== 'draft'
    || order.warehouseId !== context.warehouseId
    || order.customerMode !== context.customerMode
    || (context.customerMode === 'EXISTING'
      && String(order.customerId ?? '') !== String(context.customerId ?? ''))) return false;
  const mode = context.documentDiscountMode || 'NONE';
  if (String(order.documentDiscountMode ?? 'NONE') !== mode) return false;
  if (mode !== 'NONE' && decimal(order.documentDiscountValue ?? '0')
    !== decimal(context.documentDiscountValue ?? '0')) return false;
  return true;
}
