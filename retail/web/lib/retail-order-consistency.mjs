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

export function projectedRetailDraftTotal(subtotal, discountMode, discountValue) {
  const base = Math.max(0, Number(subtotal) || 0);
  const requested = Math.max(0, Number(discountValue) || 0);
  const discount = discountMode === 'PERCENT'
    ? Math.round(base * Math.min(100, requested) / 100)
    : discountMode === 'TOTAL_AMOUNT' ? Math.round(requested) : 0;
  return Math.max(0, base - Math.min(base, discount));
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

/**
 * Draft writes are guarded by sales_order_versions.revision, not the aggregate
 * sales_orders.revision used when confirming, issuing stock or settling.
 */
export function activeDraftRevision(order) {
  if (!order || order.status !== 'draft') return null;
  const version = Array.isArray(order.versions)
    ? order.versions.find((item) => String(item.versionNumber) === String(order.currentVersionNumber))
    : null;
  const revision = String(version?.revision ?? '');
  return /^\d+$/.test(revision) ? revision : null;
}

/**
 * An automatic retry may only rebase onto a newer server revision when the
 * persisted commercial contents have not changed. Different server contents
 * need an explicit operator decision, never a background overwrite.
 */
export function sameSavedDraft(before, after) {
  if (!before || !after || before.id !== after.id
    || before.status !== 'draft' || after.status !== 'draft'
    || String(before.currentVersionNumber) !== String(after.currentVersionNumber)) return false;
  const fields = ['warehouseId', 'customerMode', 'customerId', 'collectionPolicy',
    'note', 'documentDiscountMode', 'documentDiscountReason'];
  if (fields.some((field) => String(before[field] ?? '') !== String(after[field] ?? ''))) return false;
  if (decimal(before.documentDiscountValue ?? '0') !== decimal(after.documentDiscountValue ?? '0')) return false;
  const current = (order) => Array.isArray(order.versions)
    ? order.versions.find((item) => String(item.versionNumber) === String(order.currentVersionNumber))
    : null;
  const previousLines = current(before)?.lines;
  const latestLines = current(after)?.lines;
  if (!Array.isArray(previousLines) || !Array.isArray(latestLines)
    || previousLines.length !== latestLines.length) return false;
  const byVariant = new Map();
  for (const line of previousLines) {
    if (!line?.variantId || byVariant.has(line.variantId)) return false;
    byVariant.set(line.variantId, line);
  }
  for (const line of latestLines) {
    const old = byVariant.get(line?.variantId);
    if (!old || old.taxMode !== line.taxMode || old.priceSource !== line.priceSource
      || decimal(old.quantity) !== decimal(line.quantity)
      || decimal(old.taxRate) !== decimal(line.taxRate)
      || decimal(old.unitPrice) !== decimal(line.unitPrice)
      || decimal(old.lineTotal) !== decimal(line.lineTotal)) return false;
    byVariant.delete(line.variantId);
  }
  return byVariant.size === 0;
}
