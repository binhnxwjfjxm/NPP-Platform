import * as portalRepository from '../db/repositories/customer-portal.js';
import * as portalCatalogRepository from '../db/repositories/customer-portal-catalog.js';
import * as pricingService from './pricing.js';
import * as salesOrderService from './sales-order.js';
import * as salesOrderEntryService from './sales-order-entry.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const MAX_ORDER_LINES = 200;
const PORTAL_SOURCE_PREFIX = 'CUSTOMER_PORTAL:';
const CATALOG_PRICE_CONCURRENCY = 4;
const PURCHASE_MODES = new Set(['retail', 'case']);
const PROCESSING_FULFILLMENT_STATES = new Set([
  'backordered',
  'partially_reserved', 'reserved',
  'partially_allocated', 'allocated',
  'partially_picked', 'picked',
  'partially_packed', 'packed',
  'partially_issued', 'issued',
  'partially_fulfilled', 'fulfilled',
]);

function failure(code, message, statusCode = 400, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, retryable, details });
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  if (values.length === 0) return [];
  const output = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

function mapAddress(row) {
  const parts = [row.address_line1, row.address_line2, row.ward, row.district, row.province]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return Object.freeze({
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name ?? '',
    phone: row.phone ?? '',
    addressLine: parts.join(', '),
    isDefault: row.is_default === true,
  });
}

function portalSource(order) {
  return order?.sourceType === 'API' && String(order?.sourceId ?? '').startsWith(PORTAL_SOURCE_PREFIX);
}

function currentVersion(order) {
  if (!Array.isArray(order?.versions)) return null;
  return order.versions.find((version) => String(version.versionNumber) === String(order.currentVersionNumber))
    ?? order.versions.at(-1)
    ?? null;
}

function customerStatus(order) {
  if (order.status === 'cancelled') return 'CANCELLED';
  if (order.status === 'closed') return 'COMPLETED';
  if (['dispatched', 'partially_delivered'].includes(order.deliveryStatus)) return 'DELIVERING';
  if (PROCESSING_FULFILLMENT_STATES.has(order.fulfillmentStatus)) return 'PROCESSING';
  if (order.status === 'confirmed') return 'CONFIRMED';
  return 'SUBMITTED';
}

function timelineFor(order) {
  const status = customerStatus(order);
  const timeline = [{ status: 'SUBMITTED', at: order.createdAt, note: 'Đơn đã được gửi từ ứng dụng.' }];
  if (order.confirmedAt) timeline.push({ status: 'CONFIRMED', at: order.confirmedAt, note: 'Đơn đã được xác nhận.' });
  if (order.cancelledAt) timeline.push({ status: 'CANCELLED', at: order.cancelledAt, note: 'Đơn đã được hủy.' });
  if (status === 'COMPLETED') timeline.push({ status: 'COMPLETED', at: order.updatedAt, note: 'Đơn đã hoàn tất.' });
  return Object.freeze(timeline);
}

function submissionKey(sourceId) {
  const value = String(sourceId ?? '');
  return value.startsWith(PORTAL_SOURCE_PREFIX) ? value.split(':').at(-1) ?? '' : '';
}

function mapPortalOrder(order) {
  const version = currentVersion(order);
  const lines = Array.isArray(version?.lines) ? version.lines : [];
  const address = version?.customerAddress ?? {};
  const mappedLines = lines.map((line) => Object.freeze({
    sku: line.sku,
    productName: line.itemName,
    packaging: line.unitCode,
    unit: line.unitCode,
    quantity: numeric(line.quantity),
    note: line.note ?? '',
    unitPrice: numeric(line.unitPrice),
    currency: 'VND',
  }));
  return Object.freeze({
    id: order.id,
    code: order.number ?? `SO-${order.id.slice(0, 8).toUpperCase()}`,
    submittedAt: order.createdAt,
    status: customerStatus(order),
    statusTimeline: timelineFor(order),
    address: Object.freeze({
      id: version?.customerAddressId ?? '',
      label: String(address.label ?? 'Địa chỉ giao hàng'),
      recipientName: String(address.recipientName ?? ''),
      phone: String(address.phone ?? ''),
      addressLine: [address.addressLine1, address.addressLine2, address.ward, address.district, address.province].filter(Boolean).join(', '),
      isDefault: false,
    }),
    lines: Object.freeze(mappedLines),
    totalQuantity: mappedLines.reduce((sum, line) => sum + line.quantity, 0),
    pricedSubtotal: mappedLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    hasPendingPrice: false,
    orderNote: version?.note ?? '',
    submissionKey: submissionKey(order.sourceId),
  });
}

function mapPortalSnapshot(row) {
  const address = row.customer_address_snapshot ?? {};
  const rawLines = Array.isArray(row.lines) ? row.lines : [];
  const mappedLines = rawLines.map((line) => Object.freeze({
    sku: String(line.sku ?? ''),
    productName: String(line.itemName ?? ''),
    packaging: line.unitCode ?? '',
    unit: line.unitCode ?? '',
    quantity: numeric(line.quantity),
    note: line.note ?? '',
    unitPrice: numeric(line.unitPrice),
    currency: 'VND',
  }));
  const orderForStatus = {
    status: row.status,
    fulfillmentStatus: row.fulfillment_status,
    deliveryStatus: row.delivery_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
  };
  return Object.freeze({
    id: row.id,
    code: row.order_number ?? `SO-${row.id.slice(0, 8).toUpperCase()}`,
    submittedAt: row.created_at,
    status: customerStatus(orderForStatus),
    statusTimeline: timelineFor(orderForStatus),
    address: Object.freeze({
      id: row.customer_address_id ?? '',
      label: String(address.label ?? 'Địa chỉ giao hàng'),
      recipientName: String(address.recipientName ?? ''),
      phone: String(address.phone ?? ''),
      addressLine: [address.addressLine1, address.addressLine2, address.ward, address.district, address.province].filter(Boolean).join(', '),
      isDefault: false,
    }),
    lines: Object.freeze(mappedLines),
    totalQuantity: mappedLines.reduce((sum, line) => sum + line.quantity, 0),
    pricedSubtotal: mappedLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    hasPendingPrice: false,
    orderNote: row.version_note ?? '',
    submissionKey: submissionKey(row.source_id),
  });
}

function purchaseModeFor(option) {
  return String(option?.variant_kind ?? '').toUpperCase() === 'CARTON' ? 'case' : 'retail';
}

function variantKindsForPurchaseMode(purchaseMode) {
  if (purchaseMode === 'case') return Object.freeze(['CARTON']);
  if (purchaseMode === 'retail') return Object.freeze(['BASE', 'OTHER']);
  return null;
}

function mapCatalogCategory(row) {
  return Object.freeze({
    id: row.id,
    name: row.name,
    shortName: row.name,
    parentCategoryId: row.parent_category_id ?? null,
  });
}

export async function resolvePortalMembership(client, { installationId, subject }) {
  const membership = await portalRepository.getActiveMembershipByIdentity(client, {
    installationId,
    provider: 'CLERK',
    providerSubject: subject,
  });
  if (!membership) return failure('CUSTOMER_PORTAL_MEMBERSHIP_REQUIRED', 'Tài khoản chưa được liên kết với khách hàng đang hoạt động.', 403);
  return Object.freeze({ ok: true, membership });
}

export function createPortalRequestContext(createContext, config, membership, { requestId, receivedAt }) {
  return createContext({
    config,
    requestId,
    receivedAt,
    principal: {
      actorId: `portal:${membership.portal_user_id}`,
      roles: ['customer-portal'],
      permissions: [],
      scopes: { warehouseIds: [membership.default_warehouse_id] },
      sourceApp: 'customer-ordering',
    },
  });
}

export function portalProfile(membership) {
  return Object.freeze({
    customerCode: membership.customer_code,
    displayName: membership.portal_display_name ?? membership.customer_name,
    outletName: membership.customer_name,
    phone: '',
  });
}

export async function listPortalAddresses(client, { requestContext, membership }) {
  const rows = await portalRepository.listActiveCustomerAddresses(client, {
    installationId: requestContext.installationId,
    customerId: membership.customer_id,
  });
  return Object.freeze({ ok: true, addresses: Object.freeze(rows.map(mapAddress)) });
}

export async function listPortalCatalog(client, {
  requestContext,
  membership,
  search = '',
  categoryId = null,
  purchaseMode = null,
  includeCategories = false,
  limit = 50,
  offset = 0,
}) {
  const normalizedSearch = String(search ?? '').trim();
  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 50));
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const normalizedCategoryId = String(categoryId ?? '').trim() || null;
  const normalizedPurchaseMode = String(purchaseMode ?? '').trim().toLowerCase() || null;
  if (normalizedSearch.length > 256) return failure('INVALID_SEARCH', 'Từ khóa tìm hàng không được vượt quá 256 ký tự.');
  if (normalizedCategoryId && !UUID_PATTERN.test(normalizedCategoryId)) return failure('INVALID_CATEGORY_ID', 'Nhóm sản phẩm không hợp lệ.');
  if (normalizedPurchaseMode && !PURCHASE_MODES.has(normalizedPurchaseMode)) return failure('INVALID_PURCHASE_MODE', 'Hình thức mua không hợp lệ.');

  const [catalogRows, categoryRows] = await Promise.all([
    portalCatalogRepository.searchPortalCatalogOptions(client, {
      installationId: requestContext.installationId,
      search: normalizedSearch,
      categoryId: normalizedCategoryId,
      variantKinds: variantKindsForPurchaseMode(normalizedPurchaseMode),
      limit: normalizedLimit + 1,
      offset: normalizedOffset,
    }),
    includeCategories
      ? portalCatalogRepository.listPortalCatalogCategories(client, { installationId: requestContext.installationId })
      : Promise.resolve([]),
  ]);
  const hasMore = catalogRows.length > normalizedLimit;
  const pageRows = catalogRows.slice(0, normalizedLimit);
  const priceAt = new Date().toISOString();
  const items = await mapWithConcurrency(pageRows, CATALOG_PRICE_CONCURRENCY, async (option) => {
    const resolved = await pricingService.resolvePrice(client, {
      installationId: requestContext.installationId,
      payload: {
        variantId: option.id,
        quantity: '1',
        currencyCode: 'VND',
        priceAt,
        channelId: membership.sales_channel_id,
        customerId: membership.customer_id,
      },
    });
    return Object.freeze({
      sku: option.sku,
      variantId: option.id,
      productId: option.product_id,
      productCode: option.product_code,
      name: option.product_name,
      variantName: option.variant_name,
      categoryId: option.category_id ?? null,
      categoryName: option.category_name ?? null,
      parentCategoryId: option.parent_category_id ?? null,
      parentCategoryName: option.parent_category_name ?? null,
      brandName: option.brand_name ?? null,
      purchaseMode: purchaseModeFor(option),
      unitCode: option.unit_code,
      unitName: option.unit_name,
      conversionToBase: option.conversion_to_base,
      price: resolved.ok
        ? Object.freeze({ status: 'available', amount: Number(resolved.resolution.finalUnitPriceMinor), currency: 'VND' })
        : Object.freeze({ status: 'customer_price_pending', amount: null, currency: 'VND' }),
    });
  });
  return Object.freeze({
    ok: true,
    items: Object.freeze(items),
    categories: Object.freeze(categoryRows.map(mapCatalogCategory)),
    limit: normalizedLimit,
    offset: normalizedOffset,
    hasMore,
  });
}

async function resolveOrderLines(client, { requestContext, lines }) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_ORDER_LINES) {
    return failure('INVALID_ORDER_LINES', `Đơn hàng phải có từ 1 đến ${MAX_ORDER_LINES} dòng.`);
  }
  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const input = lines[index] ?? {};
    const sku = String(input.sku ?? '').trim().toUpperCase();
    const quantity = Number(input.quantity);
    if (!sku || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      return failure('INVALID_ORDER_LINE', 'SKU hoặc số lượng không hợp lệ.', 400, false, { line: index + 1 });
    }
    if (seen.has(sku)) return failure('DUPLICATE_ORDER_SKU', 'Một SKU chỉ được xuất hiện một lần trong đơn.', 400, false, { line: index + 1, sku });
    seen.add(sku);
    const found = await salesOrderEntryService.searchSalesOrderSkuOptions(client, { requestContext, search: sku, limit: 50, offset: 0 });
    if (!found.ok) return found;
    const option = found.skuOptions.find((item) => String(item.sku).trim().toUpperCase() === sku);
    if (!option) return failure('SKU_NOT_ORDERABLE', `SKU ${sku} hiện không thể đặt hàng.`, 409, false, { line: index + 1, sku });
    normalized.push(Object.freeze({ variantId: option.id, quantity: String(quantity), note: String(input.note ?? '').trim().slice(0, 2000) }));
  }
  return Object.freeze({ ok: true, lines: Object.freeze(normalized) });
}

export async function createPortalOrder(client, {
  requestContext,
  membership,
  idempotencyKey,
  payload,
}) {
  const key = String(idempotencyKey ?? '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) return failure('INVALID_IDEMPOTENCY_KEY', 'Khóa chống trùng đơn hàng không hợp lệ.');
  const addressId = String(payload?.addressId ?? '').trim();
  if (!UUID_PATTERN.test(addressId)) return failure('INVALID_DELIVERY_ADDRESS', 'Địa chỉ giao hàng không hợp lệ.');
  const address = await portalRepository.getActiveCustomerAddress(client, {
    installationId: requestContext.installationId,
    customerId: membership.customer_id,
    addressId,
  });
  if (!address) return failure('DELIVERY_ADDRESS_NOT_FOUND', 'Địa chỉ giao hàng không thuộc tài khoản khách hàng.', 403);
  const lineResult = await resolveOrderLines(client, { requestContext, lines: payload?.lines });
  if (!lineResult.ok) return lineResult;
  const note = String(payload?.orderNote ?? '').trim();
  if (note.length > 500) return failure('INVALID_ORDER_NOTE', 'Ghi chú đơn hàng không được vượt quá 500 ký tự.');
  const sourceId = `${PORTAL_SOURCE_PREFIX}${membership.portal_user_id}:${key}`;
  const draftPayload = {
    customerMode: 'EXISTING',
    customerId: membership.customer_id,
    customerAddressId: address.id,
    warehouseId: membership.default_warehouse_id,
    salesChannelId: membership.sales_channel_id,
    deliveryMode: 'DELIVERY',
    collectionPolicy: membership.collection_policy,
    currency: 'VND',
    sourceType: 'API',
    sourceId,
    note,
    lines: lineResult.lines,
  };
  const normalized = await salesOrderEntryService.normalizeSalesOrderEntryPayload(client, {
    requestContext,
    payload: draftPayload,
  });
  if (!normalized.ok) return normalized;
  const created = await salesOrderService.createSalesOrder(client, {
    requestContext,
    payload: normalized.payload,
  });
  if (!created.ok) return created;
  return Object.freeze({ ok: true, order: mapPortalOrder(created.salesOrder) });
}

export async function listPortalOrders(client, { requestContext, membership }) {
  const rows = await portalRepository.listPortalOrderSnapshots(client, {
    installationId: requestContext.installationId,
    customerId: membership.customer_id,
    warehouseId: membership.default_warehouse_id,
    limit: 100,
    offset: 0,
  });
  return Object.freeze({ ok: true, orders: Object.freeze(rows.map(mapPortalSnapshot)) });
}

export async function getPortalOrder(client, { requestContext, membership, orderId }) {
  const loaded = await salesOrderService.getSalesOrder(client, { requestContext, id: orderId });
  if (!loaded.ok || !portalSource(loaded.salesOrder) || loaded.salesOrder.customerId !== membership.customer_id) {
    return failure('CUSTOMER_PORTAL_ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.', 404);
  }
  return Object.freeze({ ok: true, order: mapPortalOrder(loaded.salesOrder), salesOrder: loaded.salesOrder });
}

export async function cancelPortalOrder(client, {
  requestContext,
  membership,
  orderId,
  idempotencyKey,
}) {
  if (membership.allow_cancel !== true) return failure('CUSTOMER_PORTAL_CANCEL_FORBIDDEN', 'Tài khoản này không được phép hủy đơn.', 403);
  const current = await getPortalOrder(client, { requestContext, membership, orderId });
  if (!current.ok) return current;
  const cancelled = await salesOrderService.cancelSalesOrder(client, {
    requestContext,
    id: orderId,
    idempotencyKey,
    payload: { reason: 'Khách hàng hủy trên Customer Ordering' },
  });
  if (!cancelled.ok) return cancelled;
  return Object.freeze({ ok: true, order: mapPortalOrder(cancelled.salesOrder) });
}

export const CUSTOMER_PORTAL_SOURCE_PREFIX = PORTAL_SOURCE_PREFIX;
export const customerPortalCatalogInternals = Object.freeze({ purchaseModeFor, variantKindsForPurchaseMode });
