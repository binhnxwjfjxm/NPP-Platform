import * as repository from '../db/repositories/sales-order.js';

const WALK_IN_MODE = 'WALK_IN';
const EXISTING_MODE = 'EXISTING';
const CUSTOMER_MODES = new Set([WALK_IN_MODE, EXISTING_MODE]);
const WALK_IN_COLLECTION_POLICIES = new Set(['PREPAID', 'COLLECT_ON_DELIVERY']);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((value) => typeof value === 'string' && value.trim()))]
    : [];
}

function normalizedMode(value) {
  const mode = String(value ?? EXISTING_MODE).trim().toUpperCase();
  return CUSTOMER_MODES.has(mode) ? mode : null;
}

function normalizedSourceType(payload, order) {
  return String(order?.source_type ?? payload?.sourceType ?? 'MANUAL').trim().toUpperCase();
}

function enforceWalkInShape(payload, sourceType) {
  const deliveryMode = String(payload?.deliveryMode ?? 'DELIVERY').trim().toUpperCase();
  const collectionPolicy = String(payload?.collectionPolicy ?? 'COLLECT_ON_DELIVERY').trim().toUpperCase();
  if (sourceType !== 'MANUAL') {
    return failure('WALK_IN_SOURCE_FORBIDDEN', 'Khách vãng lai chỉ dùng cho đơn tạo trực tiếp tại NPP');
  }
  if (deliveryMode !== 'PICKUP') {
    return failure('WALK_IN_PICKUP_REQUIRED', 'Khách vãng lai chỉ nhận hàng trực tiếp tại kho');
  }
  if (!WALK_IN_COLLECTION_POLICIES.has(collectionPolicy)) {
    return failure('WALK_IN_COLLECTION_POLICY_FORBIDDEN', 'Khách vãng lai không được bán chịu hoặc giao trước thu sau');
  }
  if (payload?.customerAddressId) {
    return failure('WALK_IN_ADDRESS_FORBIDDEN', 'Đơn khách vãng lai không sử dụng địa chỉ giao hàng');
  }
  return { ok: true, deliveryMode, collectionPolicy };
}

export async function normalizeSalesOrderEntryPayload(client, {
  requestContext,
  payload,
  salesOrderId = null,
}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Sales Order payload is required');
  }
  const mode = normalizedMode(payload.customerMode);
  if (!mode) return failure('INVALID_CUSTOMER_MODE', 'Chế độ khách hàng không hợp lệ');

  const order = salesOrderId
    ? await repository.getSalesOrderById(client, {
        installationId: requestContext.installationId,
        id: salesOrderId,
        warehouseIds: warehouseIds(requestContext),
      })
    : null;
  const sourceType = normalizedSourceType(payload, order);

  let customer = null;
  if (mode === WALK_IN_MODE) {
    const shape = enforceWalkInShape(payload, sourceType);
    if (!shape.ok) return shape;
    customer = await repository.ensureWalkInCustomer(client, {
      installationId: requestContext.installationId,
      actorId: requestContext.actorId,
    });
    if (!customer) return failure('WALK_IN_CUSTOMER_UNAVAILABLE', 'Không thể chuẩn bị khách vãng lai', true);
    return Object.freeze({
      ok: true,
      payload: Object.freeze({
        ...payload,
        customerMode: WALK_IN_MODE,
        customerId: customer.id,
        customerAddressId: undefined,
        deliveryMode: shape.deliveryMode,
        collectionPolicy: shape.collectionPolicy,
      }),
    });
  }

  if (typeof payload.customerId === 'string' && payload.customerId.trim()) {
    customer = await repository.getActiveCustomer(client, {
      installationId: requestContext.installationId,
      id: payload.customerId.trim(),
    });
  }
  if (customer?.code === repository.WALK_IN_CUSTOMER_CODE) {
    const shape = enforceWalkInShape(payload, sourceType);
    if (!shape.ok) return shape;
    return Object.freeze({
      ok: true,
      payload: Object.freeze({
        ...payload,
        customerMode: WALK_IN_MODE,
        customerId: customer.id,
        customerAddressId: undefined,
        deliveryMode: shape.deliveryMode,
        collectionPolicy: shape.collectionPolicy,
      }),
    });
  }

  return Object.freeze({ ok: true, payload: Object.freeze({ ...payload, customerMode: EXISTING_MODE }) });
}

export function evaluateSalesOrderSkuEligibility(row) {
  if (!row) return Object.freeze({ selectable: false, code: 'SKU_NOT_FOUND', message: 'Không tìm thấy SKU.' });
  if (row.product_is_active !== true) return Object.freeze({ selectable: false, code: 'PRODUCT_INACTIVE', message: 'Sản phẩm đang ngưng hoạt động.' });
  if (row.product_is_orderable !== true) return Object.freeze({ selectable: false, code: 'PRODUCT_NOT_ORDERABLE', message: 'Sản phẩm chưa được bật cho phép đặt hàng.' });
  if (row.variant_is_active !== true) return Object.freeze({ selectable: false, code: 'SKU_INACTIVE', message: 'SKU đang ngưng hoạt động.' });
  if (row.is_sellable !== true) return Object.freeze({ selectable: false, code: 'SKU_NOT_SELLABLE', message: 'SKU chưa được bật cho nghiệp vụ bán hàng.' });
  if (!row.unit_id) return Object.freeze({ selectable: false, code: 'SKU_UNIT_MISSING', message: 'SKU chưa có đơn vị bán và hệ số quy đổi.' });
  if (row.unit_is_active !== true) return Object.freeze({ selectable: false, code: 'SKU_UNIT_INACTIVE', message: 'Đơn vị bán đang ngưng hoạt động.' });
  const conversion = Number(row.conversion_to_base);
  if (!Number.isFinite(conversion) || conversion <= 0) return Object.freeze({ selectable: false, code: 'SKU_CONVERSION_INVALID', message: 'Hệ số quy đổi của SKU chưa hợp lệ.' });
  return Object.freeze({ selectable: true, code: 'ELIGIBLE', message: 'Có thể chọn để bán.' });
}

function mapSkuOption(row) {
  return Object.freeze({
    id: row.id,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    sku: row.sku,
    variantName: row.name,
    barcode: row.barcode ?? null,
    unitId: row.unit_id ?? null,
    unitCode: row.unit_code ?? null,
    unitName: row.unit_name ?? null,
    conversionToBase: row.conversion_to_base === null || row.conversion_to_base === undefined
      ? null
      : String(row.conversion_to_base),
    allowsFractional: row.allows_fractional === undefined ? null : row.allows_fractional,
    eligibility: evaluateSalesOrderSkuEligibility(row),
  });
}

export async function searchSalesOrderSkuOptions(client, {
  requestContext,
  search,
  limit = 20,
  offset = 0,
}) {
  const term = String(search ?? '').trim();
  if (term.length > 256) return failure('INVALID_SEARCH', 'Từ khóa tìm hàng không được vượt quá 256 ký tự');
  const rows = await repository.searchSalesOrderSkuOptions(client, {
    installationId: requestContext.installationId,
    search: term,
    limit: Math.max(1, Math.min(50, Number(limit) || 20)),
    offset: Math.max(0, Number(offset) || 0),
  });
  return Object.freeze({ ok: true, skuOptions: Object.freeze(rows.map(mapSkuOption)) });
}
