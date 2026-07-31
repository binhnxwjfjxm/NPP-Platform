import * as purchaseOrderRepository from '../db/repositories/purchase-order.js';
import * as priceRepository from '../db/repositories/supplier-purchase-price.js';
import * as priceService from './supplier-purchase-price.js';

const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const SCALE = 1_000_000n;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

export function canReadPurchaseOrderPrice(requestContext) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes('core.purchase-order.price.read');
}

export function canOverridePurchaseOrderPrice(requestContext) {
  return canReadPurchaseOrderPrice(requestContext)
    && Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes('core.purchase-order.price.override');
}

function decimalScaled(value) {
  const normalized = String(value ?? '').trim();
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
}

function positiveDecimal(value) {
  const normalized = String(value ?? '').trim();
  const scaled = decimalScaled(normalized);
  return scaled !== null && scaled > 0n ? normalized : null;
}

function nonNegativeDecimal(value, fallback = '0') {
  const normalized = String(value ?? fallback).trim();
  return decimalScaled(normalized) === null ? null : normalized;
}

function nonZero(value) {
  const scaled = decimalScaled(value);
  return scaled !== null && scaled > 0n;
}

function normalizedReason(value) {
  const reason = typeof value === 'string' ? value.trim() : '';
  return reason && reason.length <= 1000 ? reason : null;
}

function hasMeaningfulMonetaryInput(line) {
  if (!line || typeof line !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(line, 'unitPrice')
    || nonZero(line.discountValue ?? line.discountAmount)
    || nonZero(line.taxRate)
    || nonZero(line.taxAmount)
    || Boolean(normalizedReason(line.priceOverrideReason));
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

function sameDecimal(left, right) {
  const a = decimalScaled(left);
  const b = decimalScaled(right);
  return a !== null && b !== null && a === b;
}

function sameQuantity(left, right) {
  return sameDecimal(left, right);
}

function currentDiscountValue(line) {
  return line.discountValue ?? line.discountAmount ?? '0';
}

function inputTaxShape(line) {
  if (Object.prototype.hasOwnProperty.call(line ?? {}, 'taxRate')) {
    return { kind: 'RATE', value: line.taxRate ?? '0' };
  }
  return { kind: 'AMOUNT', value: line?.taxAmount ?? '0' };
}

function currentTaxShape(line) {
  if (line?.taxRate !== undefined && line.taxRate !== null) {
    return { kind: 'RATE', value: line.taxRate };
  }
  return { kind: 'AMOUNT', value: line?.taxAmount ?? '0' };
}

function matchesCurrentFinancials(input, currentLine) {
  if (!currentLine || !positiveDecimal(input.unitPrice)) return false;
  if (!sameDecimal(input.unitPrice, currentLine.unitPrice)) return false;
  if ((input.discountMode ?? 'TOTAL_AMOUNT') !== (currentLine.discountMode ?? 'TOTAL_AMOUNT')) return false;
  if (!sameDecimal(input.discountValue ?? input.discountAmount ?? '0', currentDiscountValue(currentLine))) return false;
  const inputTax = inputTaxShape(input);
  const currentTax = currentTaxShape(currentLine);
  return inputTax.kind === currentTax.kind && sameDecimal(inputTax.value, currentTax.value);
}

function preservedFinancials(line) {
  return {
    unitPrice: String(line.unitPrice),
    discountMode: line.discountMode ?? 'TOTAL_AMOUNT',
    discountValue: String(currentDiscountValue(line)),
    ...(line.taxRate === undefined || line.taxRate === null
      ? { taxAmount: String(line.taxAmount ?? '0') }
      : { taxRate: String(line.taxRate) }),
  };
}

function preservedProvenance(currentLine, variantId) {
  const source = currentLine.purchasePriceSource === 'SUPPLIER_PRICE'
    ? 'SUPPLIER_PRICE'
    : 'MANUAL_OVERRIDE';
  return {
    variantId,
    purchasePriceId: source === 'SUPPLIER_PRICE' ? (currentLine.purchasePriceId ?? null) : null,
    source,
    supplierSkuSnapshot: currentLine.supplierSkuSnapshot ?? null,
    overrideReason: source === 'SUPPLIER_PRICE'
      ? null
      : (currentLine.priceOverrideReason || 'Giá đã lưu trước Phase 5.7'),
  };
}

async function resolveLinePrice(client, {
  requestContext,
  supplierId,
  variantId,
  unitId,
  currencyCode,
  quantity,
  orderDate,
  lineNumber,
}) {
  const resolved = await priceService.resolveSupplierPurchasePrice(client, {
    installationId: requestContext.installationId,
    supplierId,
    variantId,
    unitId,
    currencyCode,
    quantity,
    orderDate,
  });
  if (!resolved.ok) {
    return failure(resolved.code, `Dòng ${lineNumber}: ${resolved.message}`, resolved.retryable, resolved.details);
  }
  return { ok: true, resolved };
}

function supplierResolvedLine(input, resolvedPrice) {
  return {
    ...input,
    unitPrice: resolvedPrice.unitPrice,
    discountMode: 'TOTAL_AMOUNT',
    discountValue: '0',
    taxRate: '0',
  };
}

function supplierResolvedProvenance(variantId, resolvedPrice) {
  return {
    variantId,
    purchasePriceId: resolvedPrice.id,
    source: 'SUPPLIER_PRICE',
    supplierSkuSnapshot: resolvedPrice.supplierSku,
    overrideReason: null,
  };
}

function normalizeManualFinancials(input, lineNumber) {
  const unitPrice = positiveDecimal(input.unitPrice);
  if (!unitPrice) return failure('INVALID_UNIT_PRICE', `Dòng ${lineNumber}: giá nhập tay phải lớn hơn 0.`);
  const overrideReason = normalizedReason(input.priceOverrideReason);
  if (!overrideReason) {
    return failure('PURCHASE_ORDER_PRICE_OVERRIDE_REASON_REQUIRED', `Dòng ${lineNumber}: phải nhập lý do thay giá mua.`);
  }
  const discountValue = nonNegativeDecimal(input.discountValue ?? input.discountAmount ?? '0');
  if (discountValue === null) return failure('INVALID_DISCOUNT', `Dòng ${lineNumber}: chiết khấu không hợp lệ.`);
  const hasTaxRate = Object.prototype.hasOwnProperty.call(input, 'taxRate');
  const taxRate = hasTaxRate ? nonNegativeDecimal(input.taxRate ?? '0') : null;
  const taxAmount = hasTaxRate ? null : nonNegativeDecimal(input.taxAmount ?? '0');
  if ((hasTaxRate && taxRate === null) || (!hasTaxRate && taxAmount === null)) {
    return failure('INVALID_TAX', `Dòng ${lineNumber}: thuế không hợp lệ.`);
  }
  return {
    ok: true,
    line: {
      ...input,
      unitPrice,
      discountMode: input.discountMode ?? 'TOTAL_AMOUNT',
      discountValue,
      ...(hasTaxRate ? { taxRate } : { taxAmount }),
    },
    overrideReason,
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
    const lineNumber = index + 1;
    const input = payload.lines[index] ?? {};
    const variantId = String(input.variantId ?? '').trim();
    const variant = variantMap.get(variantId);
    if (!variant?.unit_id) return failure('SKU_UNIT_MISSING', `Dòng ${lineNumber}: SKU chưa có đơn vị mua hàng hợp lệ.`);
    const quantity = positiveDecimal(input.quantity);
    if (!quantity) return failure('INVALID_QUANTITY', `Dòng ${lineNumber}: số lượng phải lớn hơn 0.`);

    const currentLine = preserveHeader ? currentLineFor(currentOrder, variantId) : null;
    const preserveCurrent = currentLine
      && sameQuantity(currentLine.quantity, quantity)
      && positiveDecimal(currentLine.unitPrice)
      && (!hasMeaningfulMonetaryInput(input) || matchesCurrentFinancials(input, currentLine))
      && !normalizedReason(input.priceOverrideReason);
    if (preserveCurrent) {
      lines.push({ ...input, ...preservedFinancials(currentLine) });
      provenance.push(preservedProvenance(currentLine, variantId));
      continue;
    }

    const resolvedResult = await resolveLinePrice(client, {
      requestContext,
      supplierId,
      variantId,
      unitId: variant.unit_id,
      currencyCode,
      quantity,
      orderDate,
      lineNumber,
    });
    if (!resolvedResult.ok) return resolvedResult;
    const resolvedPrice = resolvedResult.resolved.status === 'RESOLVED'
      ? resolvedResult.resolved.price
      : null;

    const explicitPositivePrice = positiveDecimal(input.unitPrice);
    const defaultFinancialShape = !hasMeaningfulMonetaryInput(input);
    const matchesResolvedDefault = resolvedPrice
      && explicitPositivePrice
      && sameDecimal(explicitPositivePrice, resolvedPrice.unitPrice)
      && !nonZero(input.discountValue ?? input.discountAmount)
      && !nonZero(input.taxRate)
      && !nonZero(input.taxAmount)
      && !normalizedReason(input.priceOverrideReason);

    if (defaultFinancialShape || matchesResolvedDefault) {
      if (!resolvedPrice) {
        return failure(
          'SUPPLIER_PURCHASE_PRICE_NOT_FOUND',
          `Dòng ${lineNumber}: chưa có giá mua hợp lệ cho nhà cung cấp, SKU, đơn vị, số lượng và ngày đặt hàng.`,
          false,
          { lineNumber, variantId },
        );
      }
      lines.push(supplierResolvedLine(input, resolvedPrice));
      provenance.push(supplierResolvedProvenance(variantId, resolvedPrice));
      continue;
    }

    if (!mayOverride) {
      return failure('PURCHASE_ORDER_PRICE_OVERRIDE_FORBIDDEN', `Dòng ${lineNumber}: không có quyền nhập tay hoặc thay đổi giá mua.`);
    }
    const manual = normalizeManualFinancials(input, lineNumber);
    if (!manual.ok) return manual;
    lines.push(manual.line);
    provenance.push({
      variantId,
      purchasePriceId: null,
      source: 'MANUAL_OVERRIDE',
      supplierSkuSnapshot: null,
      overrideReason: manual.overrideReason,
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
  decimalScaled,
  hasMeaningfulMonetaryInput,
  matchesCurrentFinancials,
  positiveDecimal,
  projectLineWithoutPrice,
  sameDecimal,
});
