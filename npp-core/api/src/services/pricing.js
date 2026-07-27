import * as repo from '../db/repositories/pricing.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,18})$/;
const LIST_TYPES = new Set(['BASE', 'CHANNEL', 'CUSTOMER_GROUP', 'CUSTOMER', 'PROMOTION', 'CUSTOM']);
const STACKING_MODES = new Set(['EXCLUSIVE', 'STACKABLE']);
const ADJUSTMENT_TYPES = new Set(['FIXED_PRICE', 'PERCENT_DISCOUNT', 'AMOUNT_DISCOUNT', 'PERCENT_MARKUP', 'AMOUNT_MARKUP']);
const SOURCE_KINDS = new Set(['ADMIN', 'IMPORT', 'CODE']);
const SCALE = 1_000_000n;
const MAX_IMPORT_ROWS = 2000;
const DEFAULT_PRIORITY = Object.freeze({ BASE: 100, CHANNEL: 200, CUSTOMER_GROUP: 300, PROMOTION: 400, CUSTOMER: 500, CUSTOM: 600 });

function invalid(code, message, retryable = false) {
  return { ok: false, code, message, retryable };
}
function conflict(message, code = 'CONFLICT') {
  return invalid(code, message);
}
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function upper(value) {
  return text(value).toUpperCase();
}
function validUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}
function booleanField(payload, key, fallback) {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return { ok: true, value: fallback };
  if (typeof payload[key] !== 'boolean') return invalid('INVALID_BOOLEAN', `${key} must be a boolean`);
  return { ok: true, value: payload[key] };
}
function optionalText(value, maxLength, field) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const normalized = text(value);
  if (!normalized || normalized.length > maxLength) return invalid('INVALID_TEXT', `${field} must not exceed ${maxLength} characters`);
  return { ok: true, value: normalized };
}
function dateTime(value, { optional = true, field = 'date' } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return { ok: true, value: null };
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return invalid('INVALID_DATE_TIME', `${field} must be a valid date-time`);
  return { ok: true, value: parsed.toISOString() };
}
function expectedUpdatedAt(value) {
  const parsed = dateTime(value, { optional: false, field: 'expectedUpdatedAt' });
  if (!parsed.ok) return invalid(value ? 'INVALID_EXPECTED_UPDATED_AT' : 'MISSING_EXPECTED_UPDATED_AT', 'expectedUpdatedAt is required and must be a valid date-time');
  return parsed;
}
function integer(value, { min = 0, max = 1_000_000, field = 'value', fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return { ok: true, value: fallback };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return invalid('INVALID_INTEGER', `${field} must be an integer between ${min} and ${max}`);
  return { ok: true, value: parsed };
}
function amountMinor(value, { optional = false, field = 'amountMinor' } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return { ok: true, value: null, bigint: null };
  const normalized = typeof value === 'bigint' ? value.toString() : String(value ?? '').trim();
  if (!MONEY_PATTERN.test(normalized)) return invalid('INVALID_MONEY', `${field} must be a non-negative integer minor-unit amount`);
  return { ok: true, value: normalized, bigint: BigInt(normalized) };
}
function rateBps(value, { optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return { ok: true, value: null };
  return integer(value, { min: 0, max: 1_000_000, field: 'rateBps' });
}
function parseQuantity(value, { optional = false, field = 'quantity', allowZero = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return { ok: true, value: null, scaled: null };
  const normalized = String(value ?? '').trim();
  if (!QUANTITY_PATTERN.test(normalized)) return invalid('INVALID_QUANTITY', `${field} must be a decimal with at most 6 places`);
  const [whole, fraction = ''] = normalized.split('.');
  const scaled = BigInt(whole) * SCALE + BigInt((fraction + '000000').slice(0, 6));
  if (!allowZero && scaled <= 0n) return invalid('INVALID_QUANTITY', `${field} must be greater than zero`);
  return { ok: true, value: formatScaled(scaled, 6), scaled };
}
function formatScaled(value, scale) {
  const divisor = 10n ** BigInt(scale);
  const whole = value / divisor;
  const fraction = String(value % divisor).padStart(scale, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}
function normalizeMetadata(value) {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('INVALID_SOURCE_METADATA', 'sourceMetadata must be an object');
  return { ok: true, value };
}
function sameTimestamp(left, right) {
  const a = dateTime(left, { optional: false });
  const b = dateTime(right, { optional: false });
  return a.ok && b.ok && a.value === b.value;
}

function validateChannelInput(payload, { codeRequired = true, defaults = {} } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Channel data is required');
  const code = upper(payload.code ?? defaults.code);
  if (codeRequired && !CODE_PATTERN.test(code)) return invalid('INVALID_CODE', 'Channel code is invalid');
  const name = text(payload.name ?? defaults.name);
  if (!name || name.length > 256) return invalid('INVALID_NAME', 'Channel name is required and must not exceed 256 characters');
  const description = optionalText(Object.prototype.hasOwnProperty.call(payload, 'description') ? payload.description : defaults.description, 2000, 'description');
  if (!description.ok) return description;
  const active = booleanField(payload, 'isActive', defaults.isActive ?? true);
  if (!active.ok) return active;
  return { ok: true, normalized: { code, name, description: description.value, isActive: active.value } };
}

function validatePriceListInput(payload, { codeRequired = true, defaults = {} } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Price list data is required');
  const code = upper(payload.code ?? defaults.code);
  if (codeRequired && !CODE_PATTERN.test(code)) return invalid('INVALID_CODE', 'Price-list code is invalid');
  const name = text(payload.name ?? defaults.name);
  if (!name || name.length > 256) return invalid('INVALID_NAME', 'Price-list name is required and must not exceed 256 characters');
  const listType = upper(payload.listType ?? defaults.listType);
  if (!LIST_TYPES.has(listType)) return invalid('INVALID_LIST_TYPE', 'listType is invalid');
  const currencyCode = upper(payload.currencyCode ?? defaults.currencyCode ?? 'VND');
  if (!CURRENCY_PATTERN.test(currencyCode)) return invalid('INVALID_CURRENCY', 'currencyCode must contain 3 uppercase letters');
  const channelId = text(Object.prototype.hasOwnProperty.call(payload, 'channelId') ? payload.channelId : defaults.channelId) || null;
  const customerGroupId = text(Object.prototype.hasOwnProperty.call(payload, 'customerGroupId') ? payload.customerGroupId : defaults.customerGroupId) || null;
  const customerId = text(Object.prototype.hasOwnProperty.call(payload, 'customerId') ? payload.customerId : defaults.customerId) || null;
  for (const [field, value] of [['channelId', channelId], ['customerGroupId', customerGroupId], ['customerId', customerId]]) {
    if (value && !validUuid(value)) return invalid('INVALID_SCOPE_ID', `${field} must be a valid UUID`);
  }
  if (listType === 'BASE' && (channelId || customerGroupId || customerId)) return invalid('INVALID_SCOPE', 'BASE lists cannot have channel or customer scope');
  if (listType === 'CHANNEL' && (!channelId || customerGroupId || customerId)) return invalid('INVALID_SCOPE', 'CHANNEL lists require only channelId');
  if (listType === 'CUSTOMER_GROUP' && (!customerGroupId || customerId)) return invalid('INVALID_SCOPE', 'CUSTOMER_GROUP lists require customerGroupId and cannot target customerId');
  if (listType === 'CUSTOMER' && !customerId) return invalid('INVALID_SCOPE', 'CUSTOMER lists require customerId');
  const priority = integer(payload.priority ?? defaults.priority, { min: 0, max: 1_000_000, field: 'priority', fallback: DEFAULT_PRIORITY[listType] });
  if (!priority.ok) return priority;
  const stackingMode = upper(payload.stackingMode ?? defaults.stackingMode ?? (listType === 'PROMOTION' ? 'STACKABLE' : 'EXCLUSIVE'));
  if (!STACKING_MODES.has(stackingMode)) return invalid('INVALID_STACKING_MODE', 'stackingMode is invalid');
  const stop = booleanField(payload, 'stopProcessing', defaults.stopProcessing ?? false);
  if (!stop.ok) return stop;
  const from = dateTime(Object.prototype.hasOwnProperty.call(payload, 'effectiveFrom') ? payload.effectiveFrom : defaults.effectiveFrom, { field: 'effectiveFrom' });
  if (!from.ok) return from;
  const to = dateTime(Object.prototype.hasOwnProperty.call(payload, 'effectiveTo') ? payload.effectiveTo : defaults.effectiveTo, { field: 'effectiveTo' });
  if (!to.ok) return to;
  if (from.value && to.value && to.value <= from.value) return invalid('INVALID_EFFECTIVE_RANGE', 'effectiveTo must be after effectiveFrom');
  const description = optionalText(Object.prototype.hasOwnProperty.call(payload, 'description') ? payload.description : defaults.description, 4000, 'description');
  if (!description.ok) return description;
  const active = booleanField(payload, 'isActive', defaults.isActive ?? true);
  if (!active.ok) return active;
  return { ok: true, normalized: {
    code, name, listType, currencyCode, channelId, customerGroupId, customerId,
    priority: priority.value, stackingMode, stopProcessing: stop.value,
    effectiveFrom: from.value, effectiveTo: to.value, description: description.value, isActive: active.value,
  } };
}

function validatePriceItemInput(payload, { defaults = {} } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Price item data is required');
  const variantId = text(payload.variantId ?? defaults.variantId);
  if (!validUuid(variantId)) return invalid('INVALID_VARIANT_ID', 'variantId must be a valid UUID');
  const adjustmentType = upper(payload.adjustmentType ?? defaults.adjustmentType);
  if (!ADJUSTMENT_TYPES.has(adjustmentType)) return invalid('INVALID_ADJUSTMENT_TYPE', 'adjustmentType is invalid');
  const usesAmount = ['FIXED_PRICE', 'AMOUNT_DISCOUNT', 'AMOUNT_MARKUP'].includes(adjustmentType);
  const amount = amountMinor(Object.prototype.hasOwnProperty.call(payload, 'amountMinor') ? payload.amountMinor : defaults.amountMinor, { optional: !usesAmount });
  if (!amount.ok) return amount;
  const rate = rateBps(Object.prototype.hasOwnProperty.call(payload, 'rateBps') ? payload.rateBps : defaults.rateBps, { optional: usesAmount });
  if (!rate.ok) return rate;
  if (usesAmount && amount.value === null) return invalid('INVALID_PRICE_VALUE', 'amountMinor is required');
  if (!usesAmount && rate.value === null) return invalid('INVALID_PRICE_VALUE', 'rateBps is required');
  const min = parseQuantity(Object.prototype.hasOwnProperty.call(payload, 'minQuantity') ? payload.minQuantity : (defaults.minQuantity ?? '0'), { allowZero: true, field: 'minQuantity' });
  if (!min.ok) return min;
  const max = parseQuantity(Object.prototype.hasOwnProperty.call(payload, 'maxQuantity') ? payload.maxQuantity : defaults.maxQuantity, { optional: true, field: 'maxQuantity' });
  if (!max.ok) return max;
  if (max.scaled !== null && max.scaled <= min.scaled) return invalid('INVALID_QUANTITY_RANGE', 'maxQuantity must be greater than minQuantity');
  const from = dateTime(Object.prototype.hasOwnProperty.call(payload, 'effectiveFrom') ? payload.effectiveFrom : defaults.effectiveFrom, { field: 'effectiveFrom' });
  if (!from.ok) return from;
  const to = dateTime(Object.prototype.hasOwnProperty.call(payload, 'effectiveTo') ? payload.effectiveTo : defaults.effectiveTo, { field: 'effectiveTo' });
  if (!to.ok) return to;
  if (from.value && to.value && to.value <= from.value) return invalid('INVALID_EFFECTIVE_RANGE', 'effectiveTo must be after effectiveFrom');
  const sourceKind = upper(payload.sourceKind ?? defaults.sourceKind ?? 'ADMIN');
  if (!SOURCE_KINDS.has(sourceKind)) return invalid('INVALID_SOURCE_KIND', 'sourceKind is invalid');
  const sourceKey = optionalText(Object.prototype.hasOwnProperty.call(payload, 'sourceKey') ? payload.sourceKey : defaults.sourceKey, 256, 'sourceKey');
  if (!sourceKey.ok) return sourceKey;
  const externalRuleCode = optionalText(Object.prototype.hasOwnProperty.call(payload, 'externalRuleCode') ? payload.externalRuleCode : defaults.externalRuleCode, 128, 'externalRuleCode');
  if (!externalRuleCode.ok) return externalRuleCode;
  const note = optionalText(Object.prototype.hasOwnProperty.call(payload, 'note') ? payload.note : defaults.note, 2000, 'note');
  if (!note.ok) return note;
  const metadata = normalizeMetadata(Object.prototype.hasOwnProperty.call(payload, 'sourceMetadata') ? payload.sourceMetadata : defaults.sourceMetadata);
  if (!metadata.ok) return metadata;
  const active = booleanField(payload, 'isActive', defaults.isActive ?? true);
  if (!active.ok) return active;
  return { ok: true, normalized: {
    variantId, adjustmentType, amountMinor: usesAmount ? amount.value : null,
    rateBps: usesAmount ? null : rate.value, minQuantity: min.value, maxQuantity: max.value,
    effectiveFrom: from.value, effectiveTo: to.value, sourceKind,
    sourceKey: sourceKey.value, externalRuleCode: externalRuleCode.value,
    note: note.value, sourceMetadata: metadata.value, isActive: active.value,
  } };
}

async function validateScopeReferences(client, { installationId, data }) {
  if (data.channelId) {
    const channel = await repo.getSalesChannelById(client, { installationId, id: data.channelId });
    if (!channel) return invalid('CHANNEL_NOT_FOUND', 'Sales channel not found');
    if (data.isActive && !channel.is_active) return conflict('Sales channel is inactive', 'CHANNEL_INACTIVE');
  }
  if (data.customerGroupId) {
    const group = await repo.getCustomerGroupForPricing(client, { installationId, customerGroupId: data.customerGroupId });
    if (!group) return invalid('CUSTOMER_GROUP_NOT_FOUND', 'Customer group not found');
    if (data.isActive && !group.is_active) return conflict('Customer group is inactive', 'CUSTOMER_GROUP_INACTIVE');
  }
  if (data.customerId) {
    const customer = await repo.getCustomerForPricing(client, { installationId, customerId: data.customerId });
    if (!customer) return invalid('CUSTOMER_NOT_FOUND', 'Customer not found');
    if (data.isActive && !customer.is_active) return conflict('Customer is inactive', 'CUSTOMER_INACTIVE');
    if (data.customerGroupId && customer.group_id !== data.customerGroupId) return conflict('Customer does not belong to the selected customer group', 'CUSTOMER_GROUP_MISMATCH');
  }
  return { ok: true };
}

async function validatePriceableVariant(client, { installationId, variantId }) {
  const variant = await repo.getVariantForPricing(client, { installationId, variantId });
  if (!variant) return invalid('VARIANT_NOT_FOUND', 'Product variant not found');
  if (!variant.is_active || !variant.is_sellable) return conflict('Product variant must be active and sellable', 'VARIANT_NOT_PRICEABLE');
  if (!variant.unit_id || !variant.conversion_to_base) return conflict('Product variant requires unit and conversion metadata', 'VARIANT_UNIT_MISSING');
  return { ok: true, variant };
}

export async function listSalesChannels(client, args) {
  const search = text(args.search);
  if (search.length > 256) return invalid('INVALID_SEARCH', 'Search must not exceed 256 characters');
  return { ok: true, channels: await repo.listSalesChannels(client, { ...args, search: search || null }) };
}
export async function getSalesChannel(client, { installationId, id }) {
  if (!validUuid(id)) return invalid('NOT_FOUND', 'Sales channel not found');
  const channel = await repo.getSalesChannelById(client, { installationId, id });
  return channel ? { ok: true, channel } : invalid('NOT_FOUND', 'Sales channel not found');
}
export async function createSalesChannel(client, { installationId, payload, createdBy }) {
  const validation = validateChannelInput(payload);
  if (!validation.ok) return validation;
  if (await repo.getSalesChannelByCode(client, { installationId, code: validation.normalized.code })) return conflict('Channel code already exists', 'DUPLICATE_CODE');
  const channel = await repo.insertSalesChannel(client, { installationId, ...validation.normalized, createdBy });
  return channel ? { ok: true, channel } : conflict('Channel code already exists', 'DUPLICATE_CODE');
}
export async function updateSalesChannel(client, { installationId, id, payload, updatedBy }) {
  if (!validUuid(id)) return invalid('INVALID_ID', 'Sales channel ID is invalid');
  const existing = await repo.getSalesChannelById(client, { installationId, id, forUpdate: true });
  if (!existing) return invalid('NOT_FOUND', 'Sales channel not found');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'code') && upper(payload.code) !== existing.code) return invalid('IMMUTABLE_CODE', 'Channel code is immutable');
  const expected = expectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (!sameTimestamp(existing.updated_at, expected.value)) return conflict('Sales channel update conflict');
  const validation = validateChannelInput(payload ?? {}, { codeRequired: false, defaults: {
    code: existing.code, name: existing.name, description: existing.description, isActive: existing.is_active,
  } });
  if (!validation.ok) return validation;
  if (!validation.normalized.isActive && existing.is_active) {
    const dependencies = await repo.countActivePriceListsForChannel(client, { installationId, channelId: id });
    if (dependencies > 0) return conflict('Cannot deactivate a channel used by active price lists', 'CHANNEL_IN_USE');
  }
  const channel = await repo.updateSalesChannel(client, { installationId, id, ...validation.normalized, expectedUpdatedAt: expected.value, updatedBy });
  return channel ? { ok: true, channel, beforeData: existing, action: channel.is_active === existing.is_active ? 'update' : (channel.is_active ? 'activate' : 'deactivate') } : conflict('Sales channel update conflict');
}

export async function listPriceLists(client, args) {
  const search = text(args.search);
  if (search.length > 256) return invalid('INVALID_SEARCH', 'Search must not exceed 256 characters');
  const listType = args.listType ? upper(args.listType) : null;
  if (listType && !LIST_TYPES.has(listType)) return invalid('INVALID_LIST_TYPE', 'listType is invalid');
  const currencyCode = args.currencyCode ? upper(args.currencyCode) : null;
  if (currencyCode && !CURRENCY_PATTERN.test(currencyCode)) return invalid('INVALID_CURRENCY', 'currencyCode is invalid');
  return { ok: true, priceLists: await repo.listPriceLists(client, { ...args, search: search || null, listType, currencyCode }) };
}
export async function getPriceList(client, { installationId, id }) {
  if (!validUuid(id)) return invalid('NOT_FOUND', 'Price list not found');
  const priceList = await repo.getPriceListById(client, { installationId, id });
  return priceList ? { ok: true, priceList } : invalid('NOT_FOUND', 'Price list not found');
}
export async function createPriceList(client, { installationId, payload, createdBy }) {
  const validation = validatePriceListInput(payload);
  if (!validation.ok) return validation;
  const scope = await validateScopeReferences(client, { installationId, data: validation.normalized });
  if (!scope.ok) return scope;
  if (await repo.getPriceListByCode(client, { installationId, code: validation.normalized.code })) return conflict('Price-list code already exists', 'DUPLICATE_CODE');
  const priceList = await repo.insertPriceList(client, { installationId, ...validation.normalized, createdBy });
  return priceList ? { ok: true, priceList } : conflict('Price-list code already exists', 'DUPLICATE_CODE');
}
export async function updatePriceList(client, { installationId, id, payload, updatedBy }) {
  if (!validUuid(id)) return invalid('INVALID_ID', 'Price-list ID is invalid');
  const existing = await repo.getPriceListById(client, { installationId, id, forUpdate: true });
  if (!existing) return invalid('NOT_FOUND', 'Price list not found');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'code') && upper(payload.code) !== existing.code) return invalid('IMMUTABLE_CODE', 'Price-list code is immutable');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'listType') && upper(payload.listType) !== existing.list_type) return invalid('IMMUTABLE_LIST_TYPE', 'Price-list type is immutable');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'currencyCode') && upper(payload.currencyCode) !== existing.currency_code) return invalid('IMMUTABLE_CURRENCY', 'Price-list currency is immutable');
  const expected = expectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (!sameTimestamp(existing.updated_at, expected.value)) return conflict('Price-list update conflict');
  const validation = validatePriceListInput(payload ?? {}, { codeRequired: false, defaults: {
    code: existing.code, name: existing.name, listType: existing.list_type, currencyCode: existing.currency_code,
    channelId: existing.channel_id, customerGroupId: existing.customer_group_id, customerId: existing.customer_id,
    priority: existing.priority, stackingMode: existing.stacking_mode, stopProcessing: existing.stop_processing,
    effectiveFrom: existing.effective_from, effectiveTo: existing.effective_to,
    description: existing.description, isActive: existing.is_active,
  } });
  if (!validation.ok) return validation;
  const scope = await validateScopeReferences(client, { installationId, data: validation.normalized });
  if (!scope.ok) return scope;
  const priceList = await repo.updatePriceList(client, { installationId, id, ...validation.normalized, expectedUpdatedAt: expected.value, updatedBy });
  return priceList ? { ok: true, priceList, beforeData: existing, action: priceList.is_active === existing.is_active ? 'update' : (priceList.is_active ? 'activate' : 'deactivate') } : conflict('Price-list update conflict');
}

export async function listPriceListItems(client, args) {
  if (!validUuid(args.priceListId)) return invalid('NOT_FOUND', 'Price list not found');
  if (args.variantId && !validUuid(args.variantId)) return invalid('INVALID_VARIANT_ID', 'variantId is invalid');
  const list = await repo.getPriceListById(client, { installationId: args.installationId, id: args.priceListId });
  if (!list) return invalid('NOT_FOUND', 'Price list not found');
  return { ok: true, items: await repo.listPriceListItems(client, args) };
}
export async function createPriceListItem(client, { installationId, priceListId, payload, createdBy }) {
  if (!validUuid(priceListId)) return invalid('INVALID_ID', 'Price-list ID is invalid');
  const list = await repo.getPriceListById(client, { installationId, id: priceListId });
  if (!list) return invalid('NOT_FOUND', 'Price list not found');
  const validation = validatePriceItemInput(payload);
  if (!validation.ok) return validation;
  if (list.list_type === 'BASE' && validation.normalized.adjustmentType !== 'FIXED_PRICE') return invalid('INVALID_BASE_PRICE', 'BASE lists only accept FIXED_PRICE items');
  const variant = await validatePriceableVariant(client, { installationId, variantId: validation.normalized.variantId });
  if (!variant.ok) return variant;
  if (validation.normalized.sourceKey && await repo.getPriceListItemBySourceKey(client, { installationId, sourceKey: validation.normalized.sourceKey })) return conflict('sourceKey already exists', 'DUPLICATE_SOURCE_KEY');
  const item = await repo.insertPriceListItem(client, { installationId, priceListId, ...validation.normalized, createdBy });
  return item ? { ok: true, item } : conflict('Price item conflicts with an existing source key', 'DUPLICATE_SOURCE_KEY');
}
export async function updatePriceListItem(client, { installationId, priceListId, itemId, payload, updatedBy }) {
  if (!validUuid(priceListId) || !validUuid(itemId)) return invalid('INVALID_ID', 'Price-list item ID is invalid');
  const list = await repo.getPriceListById(client, { installationId, id: priceListId });
  if (!list) return invalid('NOT_FOUND', 'Price list not found');
  const existing = await repo.getPriceListItemById(client, { installationId, priceListId, id: itemId, forUpdate: true });
  if (!existing) return invalid('NOT_FOUND', 'Price item not found');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'variantId') && text(payload.variantId) !== existing.variant_id) return invalid('IMMUTABLE_VARIANT', 'Price item variant is immutable');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'adjustmentType') && upper(payload.adjustmentType) !== existing.adjustment_type) return invalid('IMMUTABLE_ADJUSTMENT_TYPE', 'Price adjustment type is immutable');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'sourceKey') && text(payload.sourceKey) !== (existing.source_key ?? '')) return invalid('IMMUTABLE_SOURCE_KEY', 'Price item sourceKey is immutable');
  const expected = expectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (!sameTimestamp(existing.updated_at, expected.value)) return conflict('Price item update conflict');
  const validation = validatePriceItemInput(payload ?? {}, { defaults: {
    variantId: existing.variant_id, adjustmentType: existing.adjustment_type,
    amountMinor: existing.amount_minor, rateBps: existing.rate_bps,
    minQuantity: existing.min_quantity, maxQuantity: existing.max_quantity,
    effectiveFrom: existing.effective_from, effectiveTo: existing.effective_to,
    sourceKind: existing.source_kind, sourceKey: existing.source_key,
    externalRuleCode: existing.external_rule_code, note: existing.note,
    sourceMetadata: existing.source_metadata, isActive: existing.is_active,
  } });
  if (!validation.ok) return validation;
  if (list.list_type === 'BASE' && validation.normalized.adjustmentType !== 'FIXED_PRICE') return invalid('INVALID_BASE_PRICE', 'BASE lists only accept FIXED_PRICE items');
  const item = await repo.updatePriceListItem(client, {
    installationId, priceListId, id: itemId, ...validation.normalized,
    expectedUpdatedAt: expected.value, updatedBy,
  });
  return item ? { ok: true, item, beforeData: existing, action: item.is_active === existing.is_active ? 'update' : (item.is_active ? 'activate' : 'deactivate') } : conflict('Price item update conflict');
}

function halfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}
function applyAdjustment(current, candidate) {
  const type = candidate.adjustment_type;
  const amount = candidate.amount_minor === null ? null : BigInt(candidate.amount_minor);
  const rate = candidate.rate_bps === null ? null : BigInt(candidate.rate_bps);
  if (type === 'FIXED_PRICE') return amount;
  if (type === 'AMOUNT_DISCOUNT') return current > amount ? current - amount : 0n;
  if (type === 'AMOUNT_MARKUP') return current + amount;
  const delta = halfUp(current * rate, 10_000n);
  if (type === 'PERCENT_DISCOUNT') return current > delta ? current - delta : 0n;
  return current + delta;
}
function lineTotal(quantityScaled, unitPriceMinor) {
  return halfUp(quantityScaled * unitPriceMinor, SCALE);
}

export async function resolvePrice(client, { installationId, payload }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Pricing context is required');
  const variantId = text(payload.variantId);
  if (!validUuid(variantId)) return invalid('INVALID_VARIANT_ID', 'variantId must be a valid UUID');
  const quantity = parseQuantity(payload.quantity ?? '1', { field: 'quantity' });
  if (!quantity.ok) return quantity;
  const currencyCode = upper(payload.currencyCode ?? 'VND');
  if (!CURRENCY_PATTERN.test(currencyCode)) return invalid('INVALID_CURRENCY', 'currencyCode is invalid');
  const at = dateTime(payload.priceAt ?? new Date(), { optional: false, field: 'priceAt' });
  if (!at.ok) return at;
  const channelId = text(payload.channelId) || null;
  let customerGroupId = text(payload.customerGroupId) || null;
  const customerId = text(payload.customerId) || null;
  for (const [field, value] of [['channelId', channelId], ['customerGroupId', customerGroupId], ['customerId', customerId]]) {
    if (value && !validUuid(value)) return invalid('INVALID_SCOPE_ID', `${field} must be a valid UUID`);
  }
  const variant = await validatePriceableVariant(client, { installationId, variantId });
  if (!variant.ok) return variant;
  if (channelId) {
    const channel = await repo.getSalesChannelById(client, { installationId, id: channelId });
    if (!channel || !channel.is_active) return invalid('CHANNEL_NOT_FOUND', 'Active sales channel not found');
  }
  if (customerId) {
    const customer = await repo.getCustomerForPricing(client, { installationId, customerId });
    if (!customer || !customer.is_active) return invalid('CUSTOMER_NOT_FOUND', 'Active customer not found');
    if (customerGroupId && customer.group_id !== customerGroupId) return conflict('Customer does not belong to the selected group', 'CUSTOMER_GROUP_MISMATCH');
    customerGroupId = customer.group_id ?? customerGroupId;
  } else if (customerGroupId) {
    const group = await repo.getCustomerGroupForPricing(client, { installationId, customerGroupId });
    if (!group || !group.is_active) return invalid('CUSTOMER_GROUP_NOT_FOUND', 'Active customer group not found');
  }
  const candidates = await repo.getResolutionCandidates(client, {
    installationId, variantId, currencyCode, priceAt: at.value, quantity: quantity.value,
    channelId, customerGroupId, customerId,
  });
  const base = candidates.find((row) => row.list_type === 'BASE' && row.adjustment_type === 'FIXED_PRICE');
  if (!base) return invalid('BASE_PRICE_NOT_FOUND', 'No active base price is available for this SKU and currency');
  let current = BigInt(base.amount_minor);
  const steps = [{
    kind: 'BASE', priceListId: base.price_list_id, priceListCode: base.price_list_code,
    itemId: base.item_id, adjustmentType: base.adjustment_type,
    beforeUnitPriceMinor: null, afterUnitPriceMinor: current.toString(),
  }];
  const manual = amountMinor(payload.manualUnitPriceMinor, { optional: true, field: 'manualUnitPriceMinor' });
  if (!manual.ok) return manual;
  if (manual.value !== null) {
    const reason = text(payload.manualReason);
    if (!reason || reason.length > 500) return invalid('MANUAL_REASON_REQUIRED', 'manualReason is required and must not exceed 500 characters');
    steps.push({ kind: 'MANUAL_OVERRIDE', reason, beforeUnitPriceMinor: current.toString(), afterUnitPriceMinor: manual.value });
    current = manual.bigint;
    return { ok: true, resolution: {
      variant: variant.variant, currencyCode, quantity: quantity.value, priceAt: at.value,
      channelId, customerGroupId, customerId,
      baseUnitPriceMinor: base.amount_minor, finalUnitPriceMinor: current.toString(),
      lineTotalMinor: lineTotal(quantity.scaled, current).toString(), steps,
    } };
  }
  let exclusiveApplied = false;
  for (const candidate of candidates) {
    if (candidate.item_id === base.item_id || candidate.list_type === 'BASE') continue;
    if (candidate.stacking_mode === 'EXCLUSIVE' && exclusiveApplied) {
      steps.push({ kind: 'SKIPPED', reason: 'LOWER_PRIORITY_EXCLUSIVE', priceListId: candidate.price_list_id, priceListCode: candidate.price_list_code, itemId: candidate.item_id });
      continue;
    }
    const before = current;
    current = applyAdjustment(current, candidate);
    steps.push({
      kind: 'RULE', priceListId: candidate.price_list_id, priceListCode: candidate.price_list_code,
      priceListType: candidate.list_type, itemId: candidate.item_id,
      adjustmentType: candidate.adjustment_type, amountMinor: candidate.amount_minor,
      rateBps: candidate.rate_bps, beforeUnitPriceMinor: before.toString(), afterUnitPriceMinor: current.toString(),
      priority: candidate.priority, stackingMode: candidate.stacking_mode,
      sourceKind: candidate.source_kind, sourceKey: candidate.source_key,
      externalRuleCode: candidate.external_rule_code,
    });
    if (candidate.stacking_mode === 'EXCLUSIVE') exclusiveApplied = true;
    if (candidate.stop_processing) break;
  }
  return { ok: true, resolution: {
    variant: variant.variant, currencyCode, quantity: quantity.value, priceAt: at.value,
    channelId, customerGroupId, customerId,
    baseUnitPriceMinor: base.amount_minor, finalUnitPriceMinor: current.toString(),
    lineTotalMinor: lineTotal(quantity.scaled, current).toString(), steps,
  } };
}

export async function importPricing(client, { installationId, payload, createdBy }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Pricing import payload is required');
  const channels = Array.isArray(payload.channels) ? payload.channels : [];
  const lists = Array.isArray(payload.priceLists) ? payload.priceLists : [];
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (channels.length + lists.length + items.length === 0) return invalid('INVALID_IMPORT', 'Pricing import must contain channels, priceLists or items');
  if (items.length > MAX_IMPORT_ROWS) return invalid('IMPORT_TOO_LARGE', `Pricing import supports at most ${MAX_IMPORT_ROWS} items`);
  const duplicateSourceKeys = new Set();
  for (const item of items) {
    const key = text(item?.sourceKey);
    if (!key) return invalid('IMPORT_SOURCE_KEY_REQUIRED', 'Every imported item requires sourceKey');
    if (duplicateSourceKeys.has(key)) return conflict('Duplicate sourceKey in import payload', 'DUPLICATE_IMPORT_SOURCE_KEY');
    duplicateSourceKeys.add(key);
  }
  let channelsCreated = 0;
  for (const row of channels) {
    const validation = validateChannelInput(row);
    if (!validation.ok) return validation;
    const existing = await repo.getSalesChannelByCode(client, { installationId, code: validation.normalized.code });
    if (!existing) {
      const created = await repo.insertSalesChannel(client, { installationId, ...validation.normalized, createdBy });
      if (!created) return conflict('Channel import conflict', 'IMPORT_CONFLICT');
      channelsCreated += 1;
    }
  }
  let listsCreated = 0;
  for (const row of lists) {
    const normalizedRow = { ...row };
    if (!normalizedRow.channelId && row.channelCode) {
      const channel = await repo.getSalesChannelByCode(client, { installationId, code: upper(row.channelCode) });
      if (!channel) return invalid('CHANNEL_NOT_FOUND', `Channel ${row.channelCode} not found`);
      normalizedRow.channelId = channel.id;
    }
    const validation = validatePriceListInput(normalizedRow);
    if (!validation.ok) return validation;
    const existing = await repo.getPriceListByCode(client, { installationId, code: validation.normalized.code });
    if (!existing) {
      const scope = await validateScopeReferences(client, { installationId, data: validation.normalized });
      if (!scope.ok) return scope;
      const created = await repo.insertPriceList(client, { installationId, ...validation.normalized, createdBy });
      if (!created) return conflict('Price-list import conflict', 'IMPORT_CONFLICT');
      listsCreated += 1;
    } else if (existing.list_type !== validation.normalized.listType || existing.currency_code !== validation.normalized.currencyCode) {
      return conflict(`Price list ${existing.code} has incompatible immutable identity`, 'IMPORT_IDENTITY_CONFLICT');
    }
  }
  let itemsCreated = 0;
  let itemsUpdated = 0;
  for (const row of items) {
    const list = await repo.getPriceListByCode(client, { installationId, code: upper(row.priceListCode) });
    if (!list) return invalid('PRICE_LIST_NOT_FOUND', `Price list ${row.priceListCode} not found`);
    const variant = await repo.getVariantBySkuForPricing(client, { installationId, sku: upper(row.sku) });
    if (!variant) return invalid('VARIANT_NOT_FOUND', `SKU ${row.sku} not found`);
    const validation = validatePriceItemInput({ ...row, variantId: variant.id, sourceKind: row.sourceKind ?? 'IMPORT' });
    if (!validation.ok) return validation;
    if (list.list_type === 'BASE' && validation.normalized.adjustmentType !== 'FIXED_PRICE') return invalid('INVALID_BASE_PRICE', 'BASE lists only accept FIXED_PRICE items');
    const existing = await repo.getPriceListItemBySourceKey(client, { installationId, sourceKey: validation.normalized.sourceKey, forUpdate: true });
    if (!existing) {
      const created = await repo.insertPriceListItem(client, { installationId, priceListId: list.id, ...validation.normalized, createdBy });
      if (!created) return conflict('Price item import conflict', 'IMPORT_CONFLICT');
      itemsCreated += 1;
    } else {
      if (existing.price_list_id !== list.id || existing.variant_id !== variant.id || existing.adjustment_type !== validation.normalized.adjustmentType) {
        return conflict(`sourceKey ${validation.normalized.sourceKey} points to a different identity`, 'IMPORT_IDENTITY_CONFLICT');
      }
      const updated = await repo.updatePriceListItem(client, {
        installationId, priceListId: list.id, id: existing.id, ...validation.normalized,
        expectedUpdatedAt: existing.updated_at, updatedBy: createdBy,
      });
      if (!updated) return conflict('Price item import update conflict', 'IMPORT_CONFLICT');
      itemsUpdated += 1;
    }
  }
  return { ok: true, import: {
    id: text(payload.sourceBatchId) || 'pricing-import', channelsCreated, listsCreated,
    itemsCreated, itemsUpdated, totalItems: items.length,
  } };
}
