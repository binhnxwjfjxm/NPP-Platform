import * as repository from '../db/repositories/sales-order.js';
import * as productMetadataRepository from '../db/repositories/sales-order-product-metadata.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WALK_IN_MODE = 'WALK_IN';
const EXISTING_MODE = 'EXISTING';
const CUSTOMER_MODES = new Set([WALK_IN_MODE, EXISTING_MODE]);
const WALK_IN_COLLECTION_POLICIES = new Set(['PREPAID', 'COLLECT_ON_DELIVERY']);
const TAX_MODES = new Set(['EXCLUSIVE', 'INCLUSIVE']);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((value) => typeof value === 'string' && value.trim()))]
    : [];
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function orderEmployeeVisibility(requestContext) {
  const employeeId = typeof requestContext?.employeeId === 'string'
    && UUID_PATTERN.test(requestContext.employeeId.trim())
    ? requestContext.employeeId.trim()
    : null;
  return Object.freeze({
    employeeId,
    allowAllEmployees: hasPermission(requestContext, 'core.sales-order.read-all'),
  });
}

function normalizedMode(value) {
  const mode = String(value ?? EXISTING_MODE).trim().toUpperCase();
  return CUSTOMER_MODES.has(mode) ? mode : null;
}

function normalizedSourceType(payload, order) {
  return String(order?.source_type ?? payload?.sourceType ?? 'MANUAL').trim().toUpperCase();
}

function optionalText(value, maxLength) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : undefined;
}

function taxSettings(settings) {
  const mode = TAX_MODES.has(String(settings?.default_tax_mode ?? '').toUpperCase())
    ? String(settings.default_tax_mode).toUpperCase()
    : 'EXCLUSIVE';
  const rate = String(settings?.default_tax_rate ?? '0');
  return Object.freeze({ taxMode: mode, taxRate: rate });
}

function applyDefaultTax(lines, settings) {
  if (!Array.isArray(lines)) return lines;
  if (!settings) return lines;
  const defaults = taxSettings(settings);
  return lines.map((line) => Object.freeze({
    ...line,
    taxMode: defaults.taxMode,
    taxRate: defaults.taxRate,
  }));
}

function enforceWalkInShape(payload, sourceType) {
  const deliveryMode = String(payload?.deliveryMode ?? 'DELIVERY').trim().toUpperCase();
  const collectionPolicy = String(payload?.collectionPolicy ?? 'COLLECT_ON_DELIVERY').trim().toUpperCase();
  if (sourceType !== 'MANUAL') {
    return failure('WALK_IN_SOURCE_FORBIDDEN', 'Khách vãng lai chỉ dùng cho đơn tạo trực tiếp tại Công Ty');
  }
  if (deliveryMode !== 'PICKUP') {
    return failure('WALK_IN_PICKUP_REQUIRED', 'Khách vãng lai chỉ dùng Giao tại quầy');
  }
  if (!WALK_IN_COLLECTION_POLICIES.has(collectionPolicy)) {
    return failure('WALK_IN_COLLECTION_POLICY_FORBIDDEN', 'Khách vãng lai không được bán chịu hoặc giao trước thu sau');
  }
  if (payload?.customerAddressId) {
    return failure('WALK_IN_ADDRESS_FORBIDDEN', 'Đơn khách vãng lai không sử dụng địa chỉ giao hàng');
  }
  const requestedDisplayName = optionalText(payload?.walkInDisplayName, 256);
  if (requestedDisplayName === undefined) return failure('INVALID_WALK_IN_NAME', 'Tên khách vãng lai không được vượt quá 256 ký tự');
  const phone = optionalText(payload?.walkInPhone, 64);
  if (phone === undefined) return failure('INVALID_WALK_IN_PHONE', 'Số điện thoại khách vãng lai không được vượt quá 64 ký tự');
  return {
    ok: true,
    deliveryMode,
    collectionPolicy,
    displayName: requestedDisplayName ?? 'Khách vãng lai',
    phone,
  };
}

export async function getSalesOrderEntrySettings(client, { requestContext }) {
  const settings = await repository.getSalesOrderSettings(client, {
    installationId: requestContext.installationId,
  });
  const defaults = taxSettings(settings);
  return Object.freeze({
    ok: true,
    settings: Object.freeze({
      walkInConfigured: Boolean(
        settings?.walk_in_customer_id
        && settings?.customer_id
        && settings?.customer_is_active === true
      ),
      walkInBootstrapSupported: true,
      defaultTaxMode: defaults.taxMode,
      defaultTaxRate: defaults.taxRate,
    }),
  });
}

export async function normalizeSalesOrderEntryPayload(client, {
  requestContext,
  payload,
  salesOrderId = null,
}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Dữ liệu đơn bán hàng là bắt buộc');
  }
  const mode = normalizedMode(payload.customerMode);
  if (!mode) return failure('INVALID_CUSTOMER_MODE', 'Chế độ khách hàng không hợp lệ');

  const order = salesOrderId
    ? await repository.getSalesOrderById(client, {
        installationId: requestContext.installationId,
        id: salesOrderId,
        warehouseIds: warehouseIds(requestContext),
        ...orderEmployeeVisibility(requestContext),
      })
    : null;
  if (salesOrderId && !order) return failure('SALES_ORDER_NOT_FOUND', 'Không tìm thấy đơn bán hàng');
  const sourceType = normalizedSourceType(payload, order);
  let settings = await repository.getSalesOrderSettings(client, {
    installationId: requestContext.installationId,
  });

  let customer = null;
  if (mode === WALK_IN_MODE) {
    const shape = enforceWalkInShape(payload, sourceType);
    if (!shape.ok) return shape;
    customer = await repository.ensureWalkInCustomer(client, {
      installationId: requestContext.installationId,
      actorId: requestContext.actorId,
    });
    if (!customer) {
      return failure(
        'WALK_IN_CUSTOMER_UNAVAILABLE',
        'Khách vãng lai của Công Ty chưa được cấu hình hợp lệ',
        false,
      );
    }
    settings = await repository.getSalesOrderSettings(client, {
      installationId: requestContext.installationId,
    });
    return Object.freeze({
      ok: true,
      payload: Object.freeze({
        ...payload,
        customerMode: WALK_IN_MODE,
        customerId: customer.id,
        customerAddressId: undefined,
        walkInDisplayName: shape.displayName,
        walkInPhone: shape.phone,
        deliveryMode: shape.deliveryMode,
        collectionPolicy: shape.collectionPolicy,
        lines: applyDefaultTax(payload.lines, settings),
      }),
    });
  }

  if (typeof payload.customerId === 'string' && payload.customerId.trim()) {
    customer = await repository.getActiveCustomer(client, {
      installationId: requestContext.installationId,
      id: payload.customerId.trim(),
    });
  }
  if (customer && await repository.isConfiguredWalkInCustomer(client, {
    installationId: requestContext.installationId,
    customerId: customer.id,
  })) {
    const shape = enforceWalkInShape(payload, sourceType);
    if (!shape.ok) return shape;
    return Object.freeze({
      ok: true,
      payload: Object.freeze({
        ...payload,
        customerMode: WALK_IN_MODE,
        customerId: customer.id,
        customerAddressId: undefined,
        walkInDisplayName: shape.displayName,
        walkInPhone: shape.phone,
        deliveryMode: shape.deliveryMode,
        collectionPolicy: shape.collectionPolicy,
        lines: applyDefaultTax(payload.lines, settings),
      }),
    });
  }

  return Object.freeze({
    ok: true,
    payload: Object.freeze({
      ...payload,
      customerMode: EXISTING_MODE,
      walkInDisplayName: undefined,
      walkInPhone: undefined,
      lines: applyDefaultTax(payload.lines, settings),
    }),
  });
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
  return Object.freeze({ selectable: true, code: 'ELIGIBLE', message: '' });
}

function mapSkuOption(row, defaults, metadata = null) {
  return Object.freeze({
    id: row.id,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    categoryId: metadata?.category_id ?? null,
    categoryCode: metadata?.category_code ?? null,
    categoryName: metadata?.category_name ?? null,
    parentCategoryId: metadata?.parent_category_id ?? null,
    parentCategoryCode: metadata?.parent_category_code ?? null,
    parentCategoryName: metadata?.parent_category_name ?? null,
    brandId: metadata?.brand_id ?? null,
    brandCode: metadata?.brand_code ?? null,
    brandName: metadata?.brand_name ?? null,
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
    defaultTaxMode: defaults.taxMode,
    defaultTaxRate: defaults.taxRate,
    eligibility: evaluateSalesOrderSkuEligibility(row),
  });
}

export async function searchSalesOrderSkuOptions(client, {
  requestContext,
  search,
  categoryId = null,
  retailSearch = false,
  limit = 20,
  offset = 0,
}) {
  const term = String(search ?? '').trim();
  if (term.length > 256) return failure('INVALID_SEARCH', 'Từ khóa tìm hàng không được vượt quá 256 ký tự');
  const [rows, settings] = await Promise.all([
    repository.searchSalesOrderSkuOptions(client, {
      installationId: requestContext.installationId,
      search: term,
      categoryId,
      retailSearch,
      limit: Math.max(1, Math.min(50, Number(limit) || 20)),
      offset: Math.max(0, Number(offset) || 0),
    }),
    repository.getSalesOrderSettings(client, { installationId: requestContext.installationId }),
  ]);
  const metadataRows = await productMetadataRepository.listSalesOrderProductMetadata(client, {
    installationId: requestContext.installationId,
    productIds: rows.map((row) => row.product_id),
  });
  const metadataByProductId = new Map(metadataRows.map((row) => [row.product_id, row]));
  const defaults = taxSettings(settings);
  return Object.freeze({
    ok: true,
    skuOptions: Object.freeze(rows.map((row) => mapSkuOption(row, defaults, metadataByProductId.get(row.product_id) ?? null))),
  });
}
