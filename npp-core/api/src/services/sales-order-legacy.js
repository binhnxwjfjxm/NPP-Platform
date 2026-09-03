import * as repository from '../db/repositories/sales-order.js';
import * as pricingService from './pricing.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import { allocateDocumentNumber } from './document-numbering.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const INTEGER_PATTERN = /^[1-9]\d{0,18}$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,18})$/;
const SOURCE_TYPES = new Set(['MANUAL', 'IMPORT', 'API', 'MCP']);
const COLLECTION_POLICIES = new Set(['PREPAID', 'COLLECT_ON_DELIVERY', 'COLLECT_AFTER_DELIVERY', 'CREDIT_TERMS']);
const DELIVERY_MODES = new Set(['DELIVERY', 'PICKUP']);
const CUSTOMER_MODES = new Set(['EXISTING', 'WALK_IN']);
const TAX_MODES = new Set(['EXCLUSIVE', 'INCLUSIVE']);
const DISCOUNT_MODES = new Set(['TOTAL_AMOUNT', 'PER_UNIT', 'PERCENT']);
const STATUSES = new Set(['draft', 'confirmed', 'cancelled', 'closed']);
const SCALE = 1_000_000n;
const WEIGHT_SCALE = 1_000_000_000n;
const WEIGHT_UOMS = new Set(['G', 'KG']);
const HUNDRED = 100n * SCALE;
const SALES_ORDER_SERIES_CODE = 'SALES_ORDER';

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function text(value, maxLength, required = false) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required && !normalized) return null;
  return normalized.length <= maxLength ? (normalized || null) : null;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function dateOnly(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  const match = DATE_PATTERN.exec(normalized);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])) return null;
  return normalized;
}

function storedDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return dateOnly(`${year}-${month}-${day}`);
  }
  return dateOnly(String(value).slice(0, 10));
}

function timestampDateOnly(value, timeZone) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(parsed);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return year && month && day ? dateOnly(`${year}-${month}-${day}`) : null;
  } catch {
    return null;
  }
}

function decimalScaled(value, { allowZero = true } = {}) {
  const normalized = String(value ?? '').trim();
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return null;
  const scaled = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  return !allowZero && scaled === 0n ? null : scaled;
}

function formatScaled(value) {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatWeightScaled(value) {
  const whole = value / WEIGHT_SCALE;
  const fraction = (value % WEIGHT_SCALE).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function parseWeightScaled(value) {
  if (value === null || value === undefined) return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/.exec(String(value).trim());
  if (!match) return null;
  return BigInt(match[1]) * WEIGHT_SCALE + BigInt((match[2] ?? '').padEnd(9, '0'));
}

export function calculateLineWeightSnapshot({ weightValue, weightUomCode, quantity }) {
  const hasValue = weightValue !== null && weightValue !== undefined && String(weightValue).trim() !== '';
  const hasUom = weightUomCode !== null && weightUomCode !== undefined && String(weightUomCode).trim() !== '';
  if (!hasValue && !hasUom) return Object.freeze({ ok: true, unitWeightKg: null, lineWeightKg: null });
  if (!hasValue || !hasUom) return Object.freeze({ ok: false, unitWeightKg: null, lineWeightKg: null });
  const weightScaled = decimalScaled(weightValue, { allowZero: false });
  const quantityScaled = decimalScaled(quantity, { allowZero: false });
  const uom = String(weightUomCode).trim().toUpperCase();
  if (weightScaled === null || quantityScaled === null || !WEIGHT_UOMS.has(uom)) return Object.freeze({ ok: false, unitWeightKg: null, lineWeightKg: null });
  const unitWeightKgScaled = uom === 'G' ? weightScaled : weightScaled * 1000n;
  const lineWeightKgScaled = halfUp(quantityScaled * unitWeightKgScaled, SCALE);
  return Object.freeze({ ok: true, unitWeightKg: formatWeightScaled(unitWeightKgScaled), lineWeightKg: formatWeightScaled(lineWeightKgScaled) });
}

function halfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter(isUuid).map((value) => value.trim()))]
    : [];
}

function warehouseAllowed(requestContext, warehouseId) {
  return warehouseIds(requestContext).includes(warehouseId);
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function orderEmployeeVisibility(requestContext) {
  return Object.freeze({
    employeeId: isUuid(requestContext?.employeeId) ? requestContext.employeeId.trim() : null,
    actorId: typeof requestContext?.actorId === 'string' && requestContext.actorId.trim()
      ? requestContext.actorId.trim()
      : null,
    allowAllEmployees: hasPermission(requestContext, 'core.sales-order.read-all'),
  });
}

function addressSnapshot(address) {
  if (!address) return null;
  return {
    label: address.label,
    recipientName: address.recipient_name ?? null,
    phone: address.phone ?? null,
    addressLine1: address.address_line1,
    addressLine2: address.address_line2 ?? null,
    ward: address.ward ?? null,
    district: address.district ?? null,
    province: address.province ?? null,
    postalCode: address.postal_code ?? null,
    countryCode: address.country_code,
  };
}

function mapLine(line) {
  return Object.freeze({
    id: line.id,
    lineNumber: Number(line.line_number),
    variantId: line.variant_id,
    sku: line.sku_snapshot,
    itemName: line.item_name_snapshot,
    unitId: line.unit_id,
    unitCode: line.unit_code_snapshot,
    unitName: line.unit_name ?? line.unit_code_snapshot,
    conversionToBase: String(line.conversion_to_base),
    quantity: String(line.ordered_quantity),
    baseQuantity: String(line.base_quantity),
    unitWeightKg: line.unit_weight_kg === null ? null : String(line.unit_weight_kg),
    lineWeightKg: line.line_weight_kg === null ? null : String(line.line_weight_kg),
    priceListId: line.price_list_id ?? null,
    priceRuleId: line.price_rule_id ?? null,
    priceSource: line.price_source,
    unitPrice: String(line.unit_price),
    discountMode: line.discount_mode,
    discountValue: String(line.discount_value),
    discountAmount: String(line.discount_amount),
    taxMode: line.tax_mode,
    taxRate: String(line.tax_rate),
    taxAmount: String(line.tax_amount),
    lineSubtotal: String(line.line_subtotal),
    lineTotal: String(line.line_total),
    note: line.note ?? null,
  });
}

function mapVersion(version, lines = undefined) {
  const walkInDisplayName = version.walk_in_display_name_snapshot ?? null;
  const walkInPhone = version.walk_in_phone_snapshot ?? null;
  const mappedLines = lines ? Object.freeze(lines.map(mapLine)) : undefined;
  const scaledWeights = mappedLines ? mappedLines.map((line) => parseWeightScaled(line.lineWeightKg)) : [];
  const missingWeightLineCount = scaledWeights.filter((value) => value === null).length;
  const totalWeightKg = mappedLines && mappedLines.length > 0 && missingWeightLineCount === 0
    ? formatWeightScaled(scaledWeights.reduce((sum, value) => sum + value, 0n))
    : null;
  return Object.freeze({
    id: version.id,
    versionNumber: String(version.version_number),
    status: version.version_status,
    customerMode: walkInDisplayName || walkInPhone ? 'WALK_IN' : 'EXISTING',
    customerId: version.customer_id,
    customerCode: version.customer_code_snapshot,
    customerName: walkInDisplayName ?? version.customer_name_snapshot,
    walkInDisplayName,
    walkInPhone,
    customerAddressId: version.customer_address_id ?? null,
    customerAddress: version.customer_address_snapshot ?? null,
    warehouseId: version.warehouse_id,
    warehouseCode: version.warehouse_code_snapshot,
    warehouseName: version.warehouse_name_snapshot,
    deliveryMode: version.delivery_mode,
    sourceType: version.source_type,
    sourceId: version.source_id ?? null,
    sourceOutletId: version.source_outlet_id ?? null,
    collectionPolicy: version.collection_policy,
    currency: version.currency_code,
    requestedDeliveryDate: storedDateOnly(version.requested_delivery_date),
    note: version.note ?? null,
    subtotal: String(version.subtotal),
    discountTotal: String(version.discount_total),
    taxTotal: String(version.tax_total),
    total: String(version.total),
    totalWeightKg,
    missingWeightLineCount,
    amendmentReason: version.amendment_reason ?? null,
    basedOnVersionNumber: version.based_on_version_number === null ? null : String(version.based_on_version_number),
    priceOverrideReason: version.price_override_reason ?? null,
    revision: String(version.revision),
    createdAt: version.created_at,
    createdBy: version.created_by,
    confirmedAt: version.confirmed_at ?? null,
    confirmedBy: version.confirmed_by ?? null,
    lines: mappedLines,
  });
}

function mapOrder(order, versions = undefined) {
  const walkInDisplayName = order.walk_in_display_name ?? null;
  const walkInPhone = order.walk_in_phone ?? null;
  return Object.freeze({
    id: order.id,
    number: order.order_number ?? null,
    status: order.status,
    currentVersionNumber: String(order.current_version_number),
    sourceType: order.source_type,
    sourceId: order.source_id ?? null,
    sourceOutletId: order.source_outlet_id ?? null,
    customerMode: walkInDisplayName || walkInPhone ? 'WALK_IN' : 'EXISTING',
    customerId: order.customer_id,
    customerCode: order.customer_code,
    customerName: walkInDisplayName ?? order.customer_name,
    walkInDisplayName,
    walkInPhone,
    customerAddressId: order.customer_address_id ?? null,
    warehouseId: order.warehouse_id,
    warehouseCode: order.warehouse_code,
    warehouseName: order.warehouse_name,
    deliveryMode: order.delivery_mode,
    collectionPolicy: order.collection_policy,
    fulfillmentStatus: order.fulfillment_status,
    deliveryStatus: order.delivery_status,
    settlementStatus: order.settlement_status,
    receivableRemainingAmount: String(order.receivable_remaining_amount ?? 0),
    currency: order.currency_code,
    requestedDeliveryDate: storedDateOnly(order.requested_delivery_date),
    note: order.note ?? null,
    revision: String(order.revision),
    confirmedAt: order.confirmed_at ?? null,
    confirmedBy: order.confirmed_by ?? null,
    cancelledAt: order.cancelled_at ?? null,
    cancelledBy: order.cancelled_by ?? null,
    cancellationReason: order.cancellation_reason ?? null,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    createdBy: order.created_by,
    updatedBy: order.updated_by,
    versions,
  });
}

async function loadOrder(client, { requestContext, id, forUpdate = false }) {
  const order = await repository.getSalesOrderById(client, {
    installationId: requestContext.installationId,
    id,
    warehouseIds: warehouseIds(requestContext),
    ...orderEmployeeVisibility(requestContext),
    forUpdate,
  });
  if (!order) return failure('SALES_ORDER_NOT_FOUND', 'Sales order not found');
  return { ok: true, order };
}

async function loadOrderDetail(client, { requestContext, id, forUpdate = false }) {
  const loaded = await loadOrder(client, { requestContext, id, forUpdate });
  if (!loaded.ok) return loaded;
  const versions = await repository.getSalesOrderVersions(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
  });
  const mapped = [];
  for (const version of versions) {
    const lines = await repository.getSalesOrderVersionLines(client, {
      installationId: requestContext.installationId,
      versionId: version.id,
    });
    mapped.push(mapVersion(version, lines));
  }
  return { ok: true, salesOrder: mapOrder(loaded.order, Object.freeze(mapped)) };
}

function validateList(input) {
  if (input.status && !STATUSES.has(input.status)) return failure('INVALID_STATUS', 'Sales order status is invalid');
  if (input.customerId && !isUuid(input.customerId)) return failure('INVALID_CUSTOMER_ID', 'Customer ID is invalid');
  if (input.warehouseId && (!isUuid(input.warehouseId) || !warehouseAllowed(input.requestContext, input.warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const search = text(input.search, 256, false);
  if (input.search && search === null) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  return { ok: true, search };
}

export async function listSalesOrders(client, input) {
  const validation = validateList(input);
  if (!validation.ok) return validation;
  const rows = await repository.listSalesOrders(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: warehouseIds(input.requestContext),
    ...orderEmployeeVisibility(input.requestContext),
    status: input.status ?? null,
    customerId: input.customerId ?? null,
    warehouseId: input.warehouseId ?? null,
    search: validation.search,
    limit: Math.max(1, Math.min(1000, Number(input.limit) || 100)),
    offset: Math.max(0, Number(input.offset) || 0),
  });
  return Object.freeze({ ok: true, salesOrders: Object.freeze(rows.map((row) => mapOrder(row))) });
}

export async function getSalesOrder(client, input) {
  if (!isUuid(input.id)) return failure('SALES_ORDER_NOT_FOUND', 'Sales order not found');
  return loadOrderDetail(client, input);
}

function normalizeSource(payload) {
  const sourceType = String(payload?.sourceType ?? 'MANUAL').trim().toUpperCase();
  if (!SOURCE_TYPES.has(sourceType)) return failure('INVALID_SOURCE_TYPE', 'Source type is invalid');
  const sourceId = text(payload?.sourceId, 256, sourceType !== 'MANUAL');
  const sourceOutletId = text(payload?.sourceOutletId, 256, false);
  if (sourceType === 'MANUAL' && (payload?.sourceId || payload?.sourceOutletId)) {
    return failure('INVALID_SOURCE_REFERENCE', 'Manual orders cannot contain external source identity');
  }
  if (sourceType !== 'MANUAL' && !sourceId) return failure('SOURCE_ID_REQUIRED', 'Source ID is required');
  if (sourceType !== 'MCP' && payload?.sourceOutletId) return failure('INVALID_SOURCE_OUTLET', 'Source outlet is only valid for MCP orders');
  return { ok: true, sourceType, sourceId, sourceOutletId };
}

async function validateHeader(client, { requestContext, payload, fixedSource = null }) {
  if (!isUuid(payload?.customerId)) return failure('INVALID_CUSTOMER_ID', 'Customer ID is invalid');
  if (!isUuid(payload?.warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'Warehouse ID is invalid');
  if (!warehouseAllowed(requestContext, payload.warehouseId)) return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  const customerMode = String(payload?.customerMode ?? 'EXISTING').trim().toUpperCase();
  if (!CUSTOMER_MODES.has(customerMode)) return failure('INVALID_CUSTOMER_MODE', 'Customer mode is invalid');
  const deliveryMode = String(payload?.deliveryMode ?? 'DELIVERY').trim().toUpperCase();
  if (!DELIVERY_MODES.has(deliveryMode)) return failure('INVALID_DELIVERY_MODE', 'Delivery mode is invalid');
  const collectionPolicy = String(payload?.collectionPolicy ?? 'COLLECT_ON_DELIVERY').trim().toUpperCase();
  if (!COLLECTION_POLICIES.has(collectionPolicy)) return failure('INVALID_COLLECTION_POLICY', 'Collection policy is invalid');
  const currencyCode = String(payload?.currency ?? 'VND').trim().toUpperCase();
  if (currencyCode !== 'VND') return failure('UNSUPPORTED_CURRENCY', 'Phase 6B currently supports VND only');
  const requestedDeliveryDate = payload?.requestedDeliveryDate ? dateOnly(payload.requestedDeliveryDate) : null;
  if (payload?.requestedDeliveryDate && !requestedDeliveryDate) return failure('INVALID_REQUESTED_DELIVERY_DATE', 'Requested delivery date is invalid');
  const note = text(payload?.note, 4000, false);
  if (payload?.note && note === null) return failure('INVALID_NOTE', 'Note must not exceed 4000 characters');
  const walkInDisplayName = customerMode === 'WALK_IN' ? text(payload?.walkInDisplayName, 256, false) : null;
  if (customerMode === 'WALK_IN' && payload?.walkInDisplayName && walkInDisplayName === null) {
    return failure('INVALID_WALK_IN_NAME', 'Walk-in customer name must not exceed 256 characters');
  }
  const walkInPhone = customerMode === 'WALK_IN' ? text(payload?.walkInPhone, 64, false) : null;
  if (customerMode === 'WALK_IN' && payload?.walkInPhone && walkInPhone === null) {
    return failure('INVALID_WALK_IN_PHONE', 'Walk-in phone must not exceed 64 characters');
  }

  const customer = await repository.getActiveCustomer(client, { installationId: requestContext.installationId, id: payload.customerId });
  if (!customer) return failure('CUSTOMER_NOT_FOUND', 'Customer not found');
  if (!customer.is_active) return failure('CUSTOMER_INACTIVE', 'Customer is inactive');
  if (customerMode === 'WALK_IN' && !await repository.isConfiguredWalkInCustomer(client, {
    installationId: requestContext.installationId,
    customerId: customer.id,
  })) {
    return failure('WALK_IN_CUSTOMER_UNAVAILABLE', 'Configured walk-in customer is missing or inactive');
  }
  if (customerMode === 'WALK_IN' && (deliveryMode !== 'PICKUP' || collectionPolicy === 'CREDIT_TERMS' || collectionPolicy === 'COLLECT_AFTER_DELIVERY')) {
    return failure('WALK_IN_POLICY_FORBIDDEN', 'Walk-in customer requires pickup and immediate collection');
  }

  const warehouse = await repository.getActiveWarehouse(client, { installationId: requestContext.installationId, id: payload.warehouseId });
  if (!warehouse) return failure('WAREHOUSE_NOT_FOUND', 'Warehouse not found');
  if (!warehouse.is_active) return failure('WAREHOUSE_INACTIVE', 'Warehouse is inactive');

  let address = null;
  if (deliveryMode === 'DELIVERY') {
    if (!isUuid(payload?.customerAddressId)) return failure('CUSTOMER_ADDRESS_NOT_FOUND', 'Active customer delivery address is required');
    address = await repository.getCustomerAddress(client, { installationId: requestContext.installationId, id: payload.customerAddressId });
    if (!address) return failure('CUSTOMER_ADDRESS_NOT_FOUND', 'Customer address not found');
    if (!address.is_active) return failure('CUSTOMER_ADDRESS_INACTIVE', 'Customer address is inactive');
    if (address.customer_id !== customer.id) return failure('CUSTOMER_ADDRESS_MISMATCH', 'Customer address does not belong to the selected customer');
  } else if (payload?.customerAddressId) {
    return failure('PICKUP_ADDRESS_NOT_ALLOWED', 'Pickup orders do not use a customer delivery address');
  }

  if (collectionPolicy === 'CREDIT_TERMS'
    && (Number(customer.payment_terms_days) <= 0 || Number(customer.credit_limit) <= 0)
    && !hasPermission(requestContext, 'core.sales-order.credit.override')) {
    return failure('CREDIT_APPROVAL_REQUIRED', 'Customer does not have approved credit terms');
  }
  if (collectionPolicy === 'CREDIT_TERMS'
    && (Number(customer.payment_terms_days) <= 0 || Number(customer.credit_limit) <= 0)
    && !text(payload?.creditOverrideReason, 1000, true)) {
    return failure('CREDIT_OVERRIDE_REASON_REQUIRED', 'Credit override reason is required');
  }

  const source = fixedSource ?? normalizeSource(payload);
  if (!source.ok) return source;
  return {
    ok: true,
    customer,
    customerMode,
    walkInDisplayName,
    walkInPhone,
    address,
    warehouse,
    deliveryMode,
    collectionPolicy,
    currencyCode,
    requestedDeliveryDate,
    note,
    source,
  };
}

function discountAmount({ mode, value, grossMinor, quantityScaled }) {
  if (mode === 'TOTAL_AMOUNT') return value;
  if (mode === 'PER_UNIT') return halfUp(quantityScaled * value, SCALE);
  return halfUp(grossMinor * value, HUNDRED);
}

function priceProvenance(resolution) {
  const applied = Array.isArray(resolution.steps)
    ? resolution.steps.filter((step) => step.kind === 'BASE' || step.kind === 'RULE')
    : [];
  const first = applied[0] ?? null;
  const last = applied.at(-1) ?? null;
  return {
    priceListId: first?.priceListId ?? null,
    priceRuleId: last?.itemId ?? null,
  };
}

async function prepareLines(client, { requestContext, header, payload }) {
  if (!Array.isArray(payload?.lines) || payload.lines.length < 1 || payload.lines.length > 1000) {
    return failure('INVALID_LINES', 'Sales order must contain between 1 and 1000 lines');
  }
  const lines = [];
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  let total = 0n;
  let priceOverrideReason = null;

  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = payload.lines[index] ?? {};
    if (!isUuid(input.variantId)) return failure('INVALID_VARIANT_ID', 'Every line requires a valid variant ID', false, { line: index + 1 });
    const variant = await repository.getSalesVariant(client, { installationId: requestContext.installationId, id: input.variantId });
    if (!variant) return failure('SKU_NOT_FOUND', 'SKU not found', false, { line: index + 1 });
    if (!variant.product_is_active || !variant.product_is_orderable || !variant.is_active || !variant.is_sellable) {
      return failure('SKU_NOT_SELLABLE', 'SKU is inactive or not enabled for Sales', false, { line: index + 1 });
    }
    if (!variant.unit_id || !variant.unit_is_active) return failure('SKU_UNIT_INVALID', 'SKU requires an active unit', false, { line: index + 1 });
    const quantity = decimalScaled(input.quantity, { allowZero: false });
    const conversion = decimalScaled(variant.conversion_to_base, { allowZero: false });
    if (quantity === null || conversion === null) return failure('INVALID_QUANTITY', 'Quantity or unit conversion is invalid', false, { line: index + 1 });
    const weightSnapshot = calculateLineWeightSnapshot({ weightValue: variant.weight_value, weightUomCode: variant.weight_uom_code, quantity: formatScaled(quantity) });
    if (!weightSnapshot.ok) return failure('SKU_WEIGHT_INVALID', 'Khối lượng SKU không hợp lệ; hãy cập nhật Danh mục sản phẩm.', false, { line: index + 1 });
    if (!variant.allows_fractional && quantity % SCALE !== 0n) return failure('FRACTIONAL_QUANTITY_NOT_ALLOWED', 'Selected unit does not allow fractional quantity', false, { line: index + 1 });

    const manualPrice = input.manualUnitPriceMinor === undefined || input.manualUnitPriceMinor === null || input.manualUnitPriceMinor === ''
      ? null
      : String(input.manualUnitPriceMinor).trim();
    if (manualPrice !== null && !hasPermission(requestContext, 'core.sales-order.price.override')) {
      return failure('PRICE_OVERRIDE_FORBIDDEN', 'Price override permission is required', false, { line: index + 1 });
    }
    if (manualPrice !== null && !MONEY_PATTERN.test(manualPrice)) {
      return failure('INVALID_MONEY', 'Manual unit price must be a non-negative VND amount', false, { line: index + 1 });
    }
    const manualReason = manualPrice === null ? null : text(input.manualReason, 500, true);
    if (manualPrice !== null && !manualReason) return failure('PRICE_OVERRIDE_REASON_REQUIRED', 'Price override reason is required', false, { line: index + 1 });
    if (manualReason) priceOverrideReason = priceOverrideReason ? `${priceOverrideReason}; ${manualReason}` : manualReason;

    let price = await pricingService.resolvePrice(client, {
      installationId: requestContext.installationId,
      payload: {
        variantId: input.variantId,
        quantity: formatScaled(quantity),
        currencyCode: header.currencyCode,
        customerId: header.customerMode === 'WALK_IN' ? null : header.customer.id,
        customerGroupId: header.customerMode === 'WALK_IN' ? null : (header.customer.group_id ?? null),
        priceAt: new Date().toISOString(),
        manualUnitPriceMinor: manualPrice,
        manualReason,
      },
    });
    if (!price.ok && price.code === 'BASE_PRICE_NOT_FOUND' && manualPrice !== null) {
      price = {
        ok: true,
        resolution: {
          finalUnitPriceMinor: manualPrice,
          steps: [
            { kind: 'SKIPPED', reason: 'BASE_PRICE_NOT_FOUND' },
            { kind: 'MANUAL_OVERRIDE', reason: manualReason, afterUnitPriceMinor: manualPrice },
          ],
        },
      };
    }
    if (!price.ok) return failure(price.code, price.message, price.retryable, { line: index + 1 });
    const unitPriceMinor = BigInt(price.resolution.finalUnitPriceMinor);
    const grossMinor = halfUp(quantity * unitPriceMinor, SCALE);

    const mode = String(input.discountMode ?? 'TOTAL_AMOUNT').trim().toUpperCase();
    if (!DISCOUNT_MODES.has(mode)) return failure('INVALID_DISCOUNT_MODE', 'Discount mode is invalid', false, { line: index + 1 });
    const discountValueScaled = decimalScaled(input.discountValue ?? '0', { allowZero: true });
    if (discountValueScaled === null) return failure('INVALID_DISCOUNT', 'Discount value is invalid', false, { line: index + 1 });
    let normalizedDiscountValue;
    let discountMinor;
    if (mode === 'PERCENT') {
      if (discountValueScaled > HUNDRED) return failure('INVALID_DISCOUNT', 'Discount percent cannot exceed 100', false, { line: index + 1 });
      normalizedDiscountValue = discountValueScaled;
      discountMinor = discountAmount({ mode, value: discountValueScaled, grossMinor, quantityScaled: quantity });
    } else {
      if (discountValueScaled % SCALE !== 0n) return failure('INVALID_DISCOUNT', 'VND discount must be a whole amount', false, { line: index + 1 });
      normalizedDiscountValue = discountValueScaled / SCALE;
      discountMinor = discountAmount({ mode, value: normalizedDiscountValue, grossMinor, quantityScaled: quantity });
    }
    if (discountMinor > grossMinor) return failure('DISCOUNT_EXCEEDS_LINE', 'Discount cannot exceed line gross amount', false, { line: index + 1 });

    const taxMode = String(input.taxMode ?? 'EXCLUSIVE').trim().toUpperCase();
    if (!TAX_MODES.has(taxMode)) return failure('INVALID_TAX_MODE', 'Tax mode is invalid', false, { line: index + 1 });
    const taxRate = decimalScaled(input.taxRate ?? '0', { allowZero: true });
    if (taxRate === null || taxRate > HUNDRED) return failure('INVALID_TAX_RATE', 'Tax rate must be between 0 and 100', false, { line: index + 1 });
    const discountedMinor = grossMinor - discountMinor;
    let taxMinor;
    let lineSubtotalMinor;
    let lineTotalMinor;
    if (taxMode === 'EXCLUSIVE') {
      taxMinor = halfUp(discountedMinor * taxRate, HUNDRED);
      lineSubtotalMinor = grossMinor;
      lineTotalMinor = discountedMinor + taxMinor;
    } else {
      taxMinor = taxRate === 0n ? 0n : halfUp(discountedMinor * taxRate, HUNDRED + taxRate);
      lineSubtotalMinor = grossMinor - taxMinor;
      lineTotalMinor = discountedMinor;
    }
    const provenance = priceProvenance(price.resolution);
    const baseQuantity = halfUp(quantity * conversion, SCALE);
    lines.push({
      lineNumber: index + 1,
      variantId: variant.id,
      sku: variant.sku,
      itemName: variant.product_name,
      unitId: variant.unit_id,
      unitCode: variant.unit_code,
      conversionToBase: formatScaled(conversion),
      quantity: formatScaled(quantity),
      baseQuantity: formatScaled(baseQuantity),
      unitWeightKg: weightSnapshot.unitWeightKg,
      lineWeightKg: weightSnapshot.lineWeightKg,
      priceListId: manualPrice === null ? provenance.priceListId : null,
      priceRuleId: manualPrice === null ? provenance.priceRuleId : null,
      priceSource: manualPrice === null ? 'PRICE_ENGINE' : 'MANUAL_OVERRIDE',
      unitPrice: unitPriceMinor.toString(),
      discountMode: mode,
      discountValue: mode === 'PERCENT' ? formatScaled(normalizedDiscountValue) : normalizedDiscountValue.toString(),
      discountAmount: discountMinor.toString(),
      taxMode,
      taxRate: formatScaled(taxRate),
      taxAmount: taxMinor.toString(),
      lineSubtotal: lineSubtotalMinor.toString(),
      lineTotal: lineTotalMinor.toString(),
      note: text(input.note, 2000, false),
    });
    subtotal += lineSubtotalMinor;
    discountTotal += discountMinor;
    taxTotal += taxMinor;
    total += lineTotalMinor;
  }
  if (total !== subtotal - discountTotal + taxTotal) return failure('TOTAL_RECONCILIATION_FAILED', 'Sales order totals did not reconcile');
  return {
    ok: true,
    lines,
    subtotal: subtotal.toString(),
    discountTotal: discountTotal.toString(),
    taxTotal: taxTotal.toString(),
    total: total.toString(),
    priceOverrideReason,
  };
}

async function prepareCommercialVersion(client, { requestContext, payload, fixedSource = null }) {
  const header = await validateHeader(client, { requestContext, payload, fixedSource });
  if (!header.ok) return header;
  const financials = await prepareLines(client, { requestContext, header, payload });
  if (!financials.ok) return financials;
  return { ok: true, header, financials };
}

function versionData({ requestContext, salesOrderId, versionNumber, prepared, amendmentReason = null, basedOnVersionNumber = null }) {
  return {
    installationId: requestContext.installationId,
    salesOrderId,
    versionNumber,
    customerId: prepared.header.customer.id,
    customerCode: prepared.header.customer.code,
    customerName: prepared.header.customer.name,
    walkInDisplayName: prepared.header.walkInDisplayName,
    walkInPhone: prepared.header.walkInPhone,
    customerAddressId: prepared.header.address?.id ?? null,
    customerAddressSnapshot: addressSnapshot(prepared.header.address),
    warehouseId: prepared.header.warehouse.id,
    warehouseCode: prepared.header.warehouse.code,
    warehouseName: prepared.header.warehouse.name,
    deliveryMode: prepared.header.deliveryMode,
    sourceType: prepared.header.source.sourceType,
    sourceId: prepared.header.source.sourceId,
    sourceOutletId: prepared.header.source.sourceOutletId,
    collectionPolicy: prepared.header.collectionPolicy,
    currencyCode: prepared.header.currencyCode,
    requestedDeliveryDate: prepared.header.requestedDeliveryDate,
    note: prepared.header.note,
    subtotal: prepared.financials.subtotal,
    discountTotal: prepared.financials.discountTotal,
    taxTotal: prepared.financials.taxTotal,
    total: prepared.financials.total,
    amendmentReason,
    basedOnVersionNumber,
    priceOverrideReason: prepared.financials.priceOverrideReason,
    actorId: requestContext.actorId,
  };
}

export async function createSalesOrder(client, { requestContext, payload }) {
  const prepared = await prepareCommercialVersion(client, { requestContext, payload });
  if (!prepared.ok) return prepared;
  if (prepared.header.source.sourceId) {
    const existing = await repository.getSalesOrderBySource(client, {
      installationId: requestContext.installationId,
      sourceType: prepared.header.source.sourceType,
      sourceId: prepared.header.source.sourceId,
    });
    if (existing) return failure('SOURCE_REFERENCE_DUPLICATE', 'Source reference already belongs to another Sales Order', false, { salesOrderId: existing.id });
  }
  const salesOrderId = await repository.insertSalesOrder(client, {
    installationId: requestContext.installationId,
    sourceType: prepared.header.source.sourceType,
    sourceId: prepared.header.source.sourceId,
    sourceOutletId: prepared.header.source.sourceOutletId,
    customerId: prepared.header.customer.id,
    walkInDisplayName: prepared.header.walkInDisplayName,
    walkInPhone: prepared.header.walkInPhone,
    customerAddressId: prepared.header.address?.id ?? null,
    warehouseId: prepared.header.warehouse.id,
    deliveryMode: prepared.header.deliveryMode,
    collectionPolicy: prepared.header.collectionPolicy,
    currencyCode: prepared.header.currencyCode,
    requestedDeliveryDate: prepared.header.requestedDeliveryDate,
    note: prepared.header.note,
    actorId: requestContext.actorId,
  });
  if (!salesOrderId) return failure('SALES_ORDER_CREATE_CONFLICT', 'Sales Order could not be created', true);
  const versionId = await repository.insertSalesOrderVersion(client, versionData({
    requestContext, salesOrderId, versionNumber: 1, prepared,
  }));
  await repository.insertSalesOrderVersionLines(client, {
    installationId: requestContext.installationId,
    versionId,
    lines: prepared.financials.lines,
    actorId: requestContext.actorId,
  });
  return loadOrderDetail(client, { requestContext, id: salesOrderId });
}

export async function updateSalesOrderDraft(client, { requestContext, id, versionNumber, payload }) {
  if (!isUuid(id)) return failure('SALES_ORDER_NOT_FOUND', 'Sales order not found');
  const loaded = await loadOrder(client, { requestContext, id, forUpdate: true });
  if (!loaded.ok) return loaded;
  const number = Number(versionNumber ?? loaded.order.current_version_number);
  if (!Number.isInteger(number) || number < 1) return failure('INVALID_VERSION', 'Sales Order version is invalid');
  const version = await repository.getSalesOrderVersion(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    versionNumber: number,
    forUpdate: true,
  });
  if (!version || version.version_status !== 'draft') return failure('SALES_ORDER_DRAFT_LOCKED', 'Sales Order version is not editable');
  const expectedRevision = String(payload?.expectedRevision ?? '').trim();
  if (!INTEGER_PATTERN.test(expectedRevision)) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  const fixedSource = {
    ok: true,
    sourceType: loaded.order.source_type,
    sourceId: loaded.order.source_id,
    sourceOutletId: loaded.order.source_outlet_id,
  };
  const prepared = await prepareCommercialVersion(client, { requestContext, payload, fixedSource });
  if (!prepared.ok) return prepared;
  const updated = await repository.replaceDraftVersion(client, {
    ...versionData({ requestContext, salesOrderId: id, versionNumber: number, prepared,
      amendmentReason: version.amendment_reason, basedOnVersionNumber: version.based_on_version_number }),
    expectedRevision,
    lines: prepared.financials.lines,
  });
  if (!updated) return failure('REVISION_CONFLICT', 'Sales Order draft was changed by another request', true);
  return loadOrderDetail(client, { requestContext, id });
}

async function ensureSalesOrderSeries(client, { installationId, actorId }) {
  let series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: SALES_ORDER_SERIES_CODE,
  });
  if (series) return series;
  series = await documentNumberRepository.insertDocumentNumberSeries(client, {
    installationId,
    code: SALES_ORDER_SERIES_CODE,
    documentType: 'SALES_ORDER',
    name: 'Đơn bán hàng',
    prefix: 'SO-',
    numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
    resetPolicy: 'MONTHLY',
    sequenceWidth: 6,
    startCounter: '1',
    timezoneName: 'Asia/Ho_Chi_Minh',
    description: 'Số đơn bán hàng chính thức.',
    isActive: true,
    createdBy: actorId,
  });
  return series ?? documentNumberRepository.getDocumentNumberSeriesByCode(client, { installationId, code: SALES_ORDER_SERIES_CODE });
}

export async function confirmSalesOrder(client, { requestContext, id, versionNumber, idempotencyKey }) {
  if (!isUuid(id)) return failure('SALES_ORDER_NOT_FOUND', 'Sales order not found');
  const loaded = await loadOrder(client, { requestContext, id, forUpdate: true });
  if (!loaded.ok) return loaded;
  if (!['draft', 'confirmed'].includes(loaded.order.status)) return failure('INVALID_STATUS_TRANSITION', 'Sales Order cannot be confirmed from its current status');
  const number = Number(versionNumber ?? (loaded.order.status === 'draft' ? 1 : Number(loaded.order.current_version_number) + 1));
  const version = await repository.getSalesOrderVersion(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    versionNumber: number,
    forUpdate: true,
  });
  if (!version || version.version_status !== 'draft') return failure('SALES_ORDER_DRAFT_NOT_FOUND', 'Draft version not found');
  const lines = await repository.getSalesOrderVersionLines(client, { installationId: requestContext.installationId, versionId: version.id });
  if (lines.length < 1) return failure('EMPTY_SALES_ORDER', 'Sales Order must contain at least one line');

  let orderNumber = loaded.order.order_number;
  let allocationId = loaded.order.order_number_allocation_id;
  if (!orderNumber) {
    const series = await ensureSalesOrderSeries(client, { installationId: requestContext.installationId, actorId: requestContext.actorId });
    if (!series) return failure('DOCUMENT_NUMBER_SERIES_UNAVAILABLE', 'Sales Order number series is unavailable', true);
    const documentDate = timestampDateOnly(loaded.order.created_at, series.timezone_name);
    if (!documentDate) return failure('INVALID_ORDER_DATE', 'Sales Order creation date is invalid');
    const allocation = await allocateDocumentNumber(client, {
      installationId: requestContext.installationId,
      seriesId: series.id,
      idempotencyKey: `sales-order:${id}:confirm:${idempotencyKey}`,
      payload: {
        documentDate,
        metadata: { salesOrderId: id, versionNumber: number },
      },
      actorId: requestContext.actorId,
      requestId: requestContext.requestId,
      sourceApp: requestContext.sourceApp,
    });
    if (!allocation.ok) return allocation;
    orderNumber = allocation.allocation.document_number;
    allocationId = allocation.allocation.id;
  }
  const confirmed = await repository.confirmSalesOrderVersion(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    versionNumber: number,
    previousVersionNumber: loaded.order.status === 'confirmed' ? Number(loaded.order.current_version_number) : null,
    orderNumber,
    allocationId,
    actorId: requestContext.actorId,
  });
  if (!confirmed) return failure('CONFIRM_CONFLICT', 'Sales Order confirmation conflicted with another request', true);
  return loadOrderDetail(client, { requestContext, id });
}

export async function createSalesOrderAmendment(client, { requestContext, id, payload }) {
  if (!isUuid(id)) return failure('SALES_ORDER_NOT_FOUND', 'Sales order not found');
  const reason = text(payload?.reason, 1000, true);
  if (!reason) return failure('AMENDMENT_REASON_REQUIRED', 'Amendment reason is required');
  const loaded = await loadOrder(client, { requestContext, id, forUpdate: true });
  if (!loaded.ok) return loaded;
  if (loaded.order.status !== 'confirmed') return failure('INVALID_STATUS_TRANSITION', 'Only confirmed Sales Orders can be amended');
  const versions = await repository.getSalesOrderVersions(client, { installationId: requestContext.installationId, salesOrderId: id });
  if (versions.some((entry) => entry.version_status === 'draft')) return failure('AMENDMENT_DRAFT_EXISTS', 'A draft amendment already exists');
  const current = versions.find((entry) => Number(entry.version_number) === Number(loaded.order.current_version_number));
  if (!current || current.version_status !== 'confirmed') return failure('CONFIRMED_VERSION_NOT_FOUND', 'Current confirmed version was not found');
  const currentLines = await repository.getSalesOrderVersionLines(client, { installationId: requestContext.installationId, versionId: current.id });
  const nextVersion = Number(current.version_number) + 1;
  const versionId = await repository.insertSalesOrderVersion(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    versionNumber: nextVersion,
    customerId: current.customer_id,
    customerCode: current.customer_code_snapshot,
    customerName: current.customer_name_snapshot,
    walkInDisplayName: current.walk_in_display_name_snapshot,
    walkInPhone: current.walk_in_phone_snapshot,
    customerAddressId: current.customer_address_id,
    customerAddressSnapshot: current.customer_address_snapshot,
    warehouseId: current.warehouse_id,
    warehouseCode: current.warehouse_code_snapshot,
    warehouseName: current.warehouse_name_snapshot,
    deliveryMode: current.delivery_mode,
    sourceType: current.source_type,
    sourceId: current.source_id,
    sourceOutletId: current.source_outlet_id,
    collectionPolicy: current.collection_policy,
    currencyCode: current.currency_code,
    requestedDeliveryDate: storedDateOnly(current.requested_delivery_date),
    note: current.note,
    subtotal: String(current.subtotal),
    discountTotal: String(current.discount_total),
    taxTotal: String(current.tax_total),
    total: String(current.total),
    amendmentReason: reason,
    basedOnVersionNumber: Number(current.version_number),
    priceOverrideReason: current.price_override_reason,
    actorId: requestContext.actorId,
  });
  await repository.insertSalesOrderVersionLines(client, {
    installationId: requestContext.installationId,
    versionId,
    actorId: requestContext.actorId,
    lines: currentLines.map((line) => ({
      lineNumber: Number(line.line_number), variantId: line.variant_id,
      sku: line.sku_snapshot, itemName: line.item_name_snapshot, unitId: line.unit_id,
      unitCode: line.unit_code_snapshot, conversionToBase: String(line.conversion_to_base),
      quantity: String(line.ordered_quantity), baseQuantity: String(line.base_quantity),
      unitWeightKg: line.unit_weight_kg === null ? null : String(line.unit_weight_kg),
      lineWeightKg: line.line_weight_kg === null ? null : String(line.line_weight_kg),
      priceListId: line.price_list_id, priceRuleId: line.price_rule_id,
      priceSource: line.price_source, unitPrice: String(line.unit_price),
      discountMode: line.discount_mode, discountValue: String(line.discount_value),
      discountAmount: String(line.discount_amount), taxMode: line.tax_mode,
      taxRate: String(line.tax_rate), taxAmount: String(line.tax_amount),
      lineSubtotal: String(line.line_subtotal), lineTotal: String(line.line_total), note: line.note,
    })),
  });
  return loadOrderDetail(client, { requestContext, id });
}

export async function cancelSalesOrder(client, { requestContext, id, payload }) {
  if (!isUuid(id)) return failure('SALES_ORDER_NOT_FOUND', 'Sales order not found');
  const reason = text(payload?.reason, 1000, true);
  if (!reason) return failure('CANCELLATION_REASON_REQUIRED', 'Cancellation reason is required');
  const loaded = await loadOrder(client, { requestContext, id, forUpdate: true });
  if (!loaded.ok) return loaded;
  if (!['draft', 'confirmed'].includes(loaded.order.status)) return failure('INVALID_STATUS_TRANSITION', 'Sales Order cannot be cancelled from its current status');
  if (await repository.hasBlockingExecutionFacts(client, { installationId: requestContext.installationId, salesOrderId: id })) {
    return failure('SALES_ORDER_HAS_EXECUTION_FACTS', 'Sales Order has fulfillment, delivery or accounting facts and cannot be cancelled directly');
  }
  const cancelled = await repository.cancelSalesOrder(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    reason,
    actorId: requestContext.actorId,
  });
  if (!cancelled) return failure('CANCEL_CONFLICT', 'Sales Order cancellation conflicted with another request', true);
  return loadOrderDetail(client, { requestContext, id });
}
