import * as purchaseOrderRepository from '../db/repositories/purchase-order.js';
import * as trackingRepository from '../db/repositories/goods-receipt-tracking.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function warehouseScopeIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((value) => UUID_PATTERN.test(String(value))).map((value) => String(value).trim()))]
    : [];
}

function mapRequirement(row) {
  const trackingPolicy = row.base_variant_id && row.lot_tracking_mode && row.expiry_tracking_mode
    ? Object.freeze({
      baseVariantId: row.base_variant_id,
      lotTrackingMode: row.lot_tracking_mode,
      expiryTrackingMode: row.expiry_tracking_mode,
      locationRequired: Boolean(row.location_required),
    })
    : null;
  return Object.freeze({
    purchaseOrderLineId: row.purchase_order_line_id,
    lineNumber: Number(row.line_number),
    sourceVariantId: row.source_variant_id,
    skuCode: row.sku_snapshot,
    trackingPolicy,
  });
}

export async function getPurchaseOrderTrackingRequirements(client, { requestContext, purchaseOrderId }) {
  const normalizedId = typeof purchaseOrderId === 'string' ? purchaseOrderId.trim() : '';
  if (!UUID_PATTERN.test(normalizedId)) {
    return failure('INVALID_PURCHASE_ORDER_ID', 'Purchase order ID must be a valid UUID');
  }

  const order = await purchaseOrderRepository.getPurchaseOrderById(client, {
    installationId: requestContext.installationId,
    id: normalizedId,
    warehouseIds: warehouseScopeIds(requestContext),
  });
  if (!order) return failure('PURCHASE_ORDER_NOT_FOUND', 'Purchase order was not found');

  const rows = await trackingRepository.listPurchaseOrderTrackingRequirements(client, {
    installationId: requestContext.installationId,
    purchaseOrderId: normalizedId,
  });
  return Object.freeze({
    ok: true,
    requirements: Object.freeze(rows.map(mapRequirement)),
  });
}
