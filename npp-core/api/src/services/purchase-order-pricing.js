import * as purchaseOrderRepository from '../db/repositories/purchase-order.js';
import * as priceRepository from '../db/repositories/supplier-purchase-price.js';
import * as priceService from './supplier-purchase-price.js';

const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const POSITIVE_DECIMAL_PATTERN = /^(?:0*\.[0-9]*[1-9][0-9]*|[1-9]\d*)(?:\.\d{1,6})?$/;
const MONETARY_KEYS = Object.freeze([
  'unitPrice',
  'discountMode',
  'discountValue',
  'discountAmount',
  'taxRate',
  'taxAmount',
]);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

export function canReadPurchaseOrderPrice(requestContext) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes('core.purchase-order.price.read');
}

export function canOverridePurchaseOrderPrice(requestContext) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes('core.purchase-order.price.override');
}

function positiveDecimal(value) {
  const normalized = String(value ?? '').trim();
  return POSITIVE_DECIMAL_PATTERN.test(normalized) ? normalized : null;
}

function nonNegativeDecimal(value, fallback = '0') {
  const normalized = String(value ?? fallback).trim();
  return DECIMAL_PATTERN.test(normalized) ? normalized : null;
}

function hasExplicitMonetaryInput(line) {
  return MONETARY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(line ?? {}, key));
}

function normalizedReason(value) {
  const reason = typeof value === 'string' ? value.trim() : '';
  return reason && reason.length <= 1000 ? reason : null;
}

function headerMatchesCurrent(payload, currentOrder) {
  if (!currentOrder) return false;
  return currentOrder.supplierId === payload.supplierId
    && currentOrder.placedAt === payload.orderDate
    && currentOrder.currency === String(payload.currencyCode ?? 'VND').trim().toUpperCase();
}

function currentLineFor(currentOrder, variantId) {
  return currentOrder?.lines?.find((line) => line.variantId === variantId) ?? null;
}

function sameQuantity(left, right) {
  const a = String(left ?? '').replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, '').replace(/\.$/, '');
  const b = String(right ?? '').replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, '').replace(/\.$/, '');
  return a === b;
}

function preservedFinancials(line) {
  return {
    unitPrice: String(line.unitPrice),
    discountMode: line.discountMode ?? 'TOTAL_AMOUNT',
    discountValue: String(line.discountValue ?? line.discountAmount ?? '0'),
    discountAmount: String(line.discountAmount ?? '0'),
    ...(line.taxRate === undefined || line.taxRate === null
      ? { taxAmount: String(line.taxAmount ?? '0') }
      : { taxRate: String(line.taxRate) }),
  };
}

export async function preparePurchaseOrderPricing(client, {
  requestContext,
  payload,
  currentOrder = null,
}) {
  if (!payload || !Array.isArray(payload.lines) || payload.lines.length === 0) {
    return failure('INVALID_LINES', 'Đơn đặt hàng phải có ít nhất một dòng SKU.');
  }
  const supplierId = typeof payload.supplierId === 'string' ? payload.supplierId.trim() : '';
  const orderDate = typeof payload.orderDate === 'string' ? payload.orderDate.trim() : '';
  const currencyCode = String(payload.currencyCode ?? 'VND').trim().toUpperCase();
  const variantIds = payload.lines.map((line) => String(line?.variantId ?? '').trim());
  const variants = await purchaseOrderRepository.getPurchaseOrderVariantEligibility(client, {
    installationId: requestContext.installationId,
    ids: variantIds,
  });
  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
  const mayOverride = canOverridePurchaseOrderPrice(requestContext);
  const preserveHeader = headerMatchesCurrent(payload, currentOrder);
  const provenance = [];
  const lines = [];

  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = payload.lines[index] ?? {};
    const variantId = String(input.variantId ?? '').trim();
    const variant = variantMap.get(variantId);
    if (!variant?.unit_id) return failure('SKU_UNIT_MISSING', `Dòng ${index + 1}: SKU chưa có đơn vị mua hàng hợp lệ.`);
    const quantity = positiveDecimal(input.quantity);
    if (!quantity) return failure('INVALID_QUANTITY', `Dòng ${index + 1}: số lượng phải lớn hơn 0.`);

    if (hasExplicitMonetaryInput(input)) {
      if (!mayOverride) {
        return failure('PURCHASE_ORDER_PRICE_OVERRIDE_FORBIDDEN', `Dòng ${index + 1}: không có quyền nhập tay hoặc thay đổi giá mua.`);
      }
      const unitPrice = positiveDecimal(input.unitPrice);
      if (!unitPrice) return failure('INVALID_UNIT_PRICE', `Dòng ${index + 1}: giá nhập tay phải lớn hơn 0.`);
      const overrideReason = normalizedReason(input.priceOverrideReason);
      if (!overrideReason) return failure('PURCHASE_ORDER_PRICE_OVERRIDE_REASON_REQUIRED', `Dòng ${index + 1}: phải nhập lý do thay giá mua.`);
      const discountValue = nonNegativeDecimal(input.discountValue ?? input.discountAmount ?? '0');
      if (discountValue === null) return failure('INVALID_DISCOUNT', `Dòng ${index + 1}: chiết khấu không hợp lệ.`);
      const taxRate = Object.prototype.hasOwnProperty.call(input, 'taxRate')
        ? nonNegativeDecimal(input.taxRate)
        : null;
      const taxAmount = taxRate === null ? nonNegativeDecimal(input.taxAmount ?? '0') : null;
      if (taxRate === null && taxAmount === null) return failure('INVALID_TAX', `Dòng ${index + 1}: thuế không hợp lệ.`);
      lines.push({
        ...input,
        unitPrice,
        discountMode: input.discountMode ?? 'TOTAL_AMOUNT',
        discountValue,
        ...(taxRate === null ? { taxAmount } : { taxRate }),
      });
      provenance.push({
        variantId,
        purchasePriceId: null,
        source: 'MANUAL_OVERRIDE',
        supplierSkuSnapshot: null,
        overrideReason,
      });
      continue;
    }

    const currentLine = preserveHeader ? currentLineFor(currentOrder, variantId) : null;
    if (currentLine && sameQuantity(currentLine.quantity, quantity) && positiveDecimal(currentLine.unitPrice)) {
      lines.push({ ...input, ...preservedFinancials(currentLine) });
      provenance.push({
        variantId,
        purchasePriceId: currentLine.purchasePriceId ?? null,
        source: currentLine.purchasePriceSource === 'SUPPLIER_PRICE' ? 'SUPPLIER_PRICE' : 'MANUAL_OVERRIDE',
        supplierSkuSnapshot: currentLine.supplierSkuSnapshot ?? null,
        overrideReason: currentLine.purchasePriceSource === 'SUPPLIER_PRICE'
          ? null
          : (currentLine.priceOverrideReason || 'Giữ nguyên giá đã lưu trước Phase 5.7'),
      });
      continue;
    }

    const resolved = await priceService.resolveSupplierPurchasePrice(client, {
      installationId: requestContext.installationId,
      supplierId,
      variantId,
      unitId: variant.unit_id,
      currencyCode,
      quantity,
      orderDate,
    });
    if (!resolved.ok) return failure(resolved.code, `Dòng ${index + 1}: ${resolved.message}`, resolved.retryable, resolved.details);
    if (resolved.status !== 'RESOLVED' || !resolved.price) {
      return failure(
        'SUPPLIER_PURCHASE_PRICE_NOT_FOUND',
        `Dòng ${index + 1}: chưa có giá mua hợp lệ cho nhà cung cấp, SKU, đơn vị, số lượng và ngày đặt hàng.`,
        false,
        { lineNumber: index + 1, variantId },
      );
    }
    lines.push({
      ...input,
      unitPrice: resolved.price.unitPrice,
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      taxRate: '0',
    });
    provenance.push({
      variantId,
      purchasePriceId: resolved.price.id,
      source: 'SUPPLIER_PRICE',
      supplierSkuSnapshot: resolved.price.supplierSku,
      overrideReason: null,
    });
  }

  return Object.freeze({
    ok: true,
    payload: Object.freeze({ ...payload, currencyCode, lines: Object.freeze(lines) }),
    provenance: Object.freeze(provenance),
  });
}

export async function applyPurchaseOrderPricingProvenance(client, {
  requestContext,
  purchaseOrder,
  provenance,
}) {
  for (const item of provenance) {
    const updated = await priceRepository.setPurchaseOrderLinePriceProvenance(client, {
      installationId: requestContext.installationId,
      purchaseOrderId: purchaseOrder.id,
      variantId: item.variantId,
      purchasePriceId: item.purchasePriceId,
      source: item.source,
      supplierSkuSnapshot: item.supplierSkuSnapshot,
      overrideReason: item.overrideReason,
      actorId: requestContext.actorId,
    });
    if (!updated) throw new Error('purchase_order_price_provenance_missing_line');
  }
}

export async function enrichPurchaseOrderPricing(client, { requestContext, purchaseOrder }) {
  if (!purchaseOrder?.id || !Array.isArray(purchaseOrder.lines)) return purchaseOrder;
  const rows = await priceRepository.getPurchaseOrderPriceProvenance(client, {
    installationId: requestContext.installationId,
    purchaseOrderId: purchaseOrder.id,
  });
  const byVariant = new Map(rows.map((row) => [row.variant_id, row]));
  return Object.freeze({
    ...purchaseOrder,
    lines: Object.freeze(purchaseOrder.lines.map((line) => {
      const price = byVariant.get(line.variantId);
      return Object.freeze({
        ...line,
        priceStatus: positiveDecimal(line.unitPrice) ? 'RESOLVED' : 'NOT_FOUND',
        purchasePriceId: price?.purchase_price_id ?? null,
        purchasePriceSource: price?.purchase_price_source ?? null,
        purchasePriceResolvedAt: price?.purchase_price_resolved_at ?? null,
        supplierSkuSnapshot: price?.supplier_sku_snapshot ?? null,
        priceOverrideReason: price?.purchase_price_override_reason ?? null,
      });
    })),
  });
}

function projectLineWithoutPrice(line) {
  const {
    unitPrice: _unitPrice,
    discountMode: _discountMode,
    discountValue: _discountValue,
    discountAmount: _discountAmount,
    taxRate: _taxRate,
    taxAmount: _taxAmount,
    lineTotal: _lineTotal,
    purchasePriceId: _purchasePriceId,
    purchasePriceSource: _purchasePriceSource,
    purchasePriceResolvedAt: _purchasePriceResolvedAt,
    supplierSkuSnapshot: _supplierSkuSnapshot,
    priceOverrideReason: _priceOverrideReason,
    ...safe
  } = line;
  return Object.freeze({
    ...safe,
    priceStatus: positiveDecimal(line.unitPrice) ? 'RESOLVED' : 'NOT_FOUND',
  });
}

export function projectPurchaseOrderPricing(requestContext, purchaseOrder) {
  if (!purchaseOrder || canReadPurchaseOrderPrice(requestContext)) return purchaseOrder;
  const {
    subtotal: _subtotal,
    discountTotal: _discountTotal,
    taxTotal: _taxTotal,
    total: _total,
    ...safeOrder
  } = purchaseOrder;
  return Object.freeze({
    ...safeOrder,
    priceStatus: Array.isArray(purchaseOrder.lines)
      && purchaseOrder.lines.length > 0
      && purchaseOrder.lines.every((line) => positiveDecimal(line.unitPrice))
      ? 'RESOLVED'
      : 'NOT_FOUND',
    lines: Array.isArray(purchaseOrder.lines)
      ? Object.freeze(purchaseOrder.lines.map(projectLineWithoutPrice))
      : purchaseOrder.lines,
  });
}

export function validatePurchaseOrderPriceReady(purchaseOrder) {
  if (!Array.isArray(purchaseOrder?.lines) || purchaseOrder.lines.length === 0) {
    return failure('INVALID_LINES', 'Đơn đặt hàng phải có ít nhất một dòng.');
  }
  const invalidLine = purchaseOrder.lines.findIndex((line) => !positiveDecimal(line.unitPrice));
  if (invalidLine >= 0) {
    return failure('PURCHASE_ORDER_PRICE_UNRESOLVED', `Dòng ${invalidLine + 1}: giá mua chưa được phân giải hoặc không lớn hơn 0.`);
  }
  return { ok: true };
}

export const purchaseOrderPricingInternals = Object.freeze({
  hasExplicitMonetaryInput,
  positiveDecimal,
  projectLineWithoutPrice,
});
