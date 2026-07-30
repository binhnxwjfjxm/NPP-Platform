import * as unitRepo from '../db/repositories/units.js';
import * as productRepo from '../db/repositories/products.js';
import * as variantRepo from '../db/repositories/product-variants.js';
import * as barcodeRepo from '../db/repositories/product-barcodes.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/;
const BARCODE_TYPES = new Set(['EAN13', 'EAN8', 'UPC_A', 'CODE128', 'INTERNAL', 'OTHER']);
const UNIT_KINDS = new Set(['COUNT', 'WEIGHT', 'VOLUME', 'PACKAGE', 'OTHER']);
const NET_CONTENT_UOMS = new Set(['G', 'KG', 'ML', 'L', 'EA', 'OTHER']);
const MAX_IMPORT_ROWS = 1000;
const SCALE = 1_000_000n;

function invalid(code, message, retryable = false) {
  return { ok: false, code, message, retryable };
}

function conflict(message, code = 'CONFLICT') {
  return invalid(code, message);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function code(value) {
  return text(value).toUpperCase();
}

function validUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function dateTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function expectedUpdatedAt(value) {
  const normalized = dateTime(value);
  if (!normalized) {
    return invalid(
      value === undefined || value === null || value === '' ? 'MISSING_EXPECTED_UPDATED_AT' : 'INVALID_EXPECTED_UPDATED_AT',
      'expectedUpdatedAt is required and must be a valid date-time',
    );
  }
  return { ok: true, value: normalized };
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

function decimal(value, { allowZero = false, field = 'value' } = {}) {
  const normalized = typeof value === 'number' ? String(value) : text(value);
  if (!DECIMAL_PATTERN.test(normalized)) return invalid('INVALID_DECIMAL', `${field} must be a non-negative decimal with at most 6 decimal places`);
  const scaled = parseScaledDecimal(normalized);
  if (!allowZero && scaled <= 0n) return invalid('INVALID_DECIMAL', `${field} must be greater than zero`);
  return { ok: true, value: formatScaledDecimal(scaled, 6), scaled };
}

function parseScaledDecimal(value) {
  const [whole, fractional = ''] = String(value).split('.');
  return BigInt(whole) * SCALE + BigInt((fractional + '000000').slice(0, 6));
}

function formatScaledDecimal(value, scale) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = absolute / divisor;
  const fractional = String(absolute % divisor).padStart(scale, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fractional ? `.${fractional}` : ''}`;
}

export function multiplyDecimalStrings(left, right) {
  const leftValue = decimal(left, { allowZero: true, field: 'quantity' });
  if (!leftValue.ok) return leftValue;
  const rightValue = decimal(right, { allowZero: false, field: 'conversionToBase' });
  if (!rightValue.ok) return rightValue;
  const product = leftValue.scaled * rightValue.scaled;
  return { ok: true, value: formatScaledDecimal(product, 12) };
}

function validateUnitInput(payload, { codeRequired = true, defaults = {} } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Unit data is required');
  const normalizedCode = code(payload.code ?? defaults.code);
  if (codeRequired && !CODE_PATTERN.test(normalizedCode)) return invalid('INVALID_UNIT_CODE', 'Unit code is invalid');
  const name = text(payload.name ?? defaults.name);
  if (!name || name.length > 128) return invalid('INVALID_UNIT_NAME', 'Unit name is required and must not exceed 128 characters');
  const symbol = optionalText(Object.prototype.hasOwnProperty.call(payload, 'symbol') ? payload.symbol : defaults.symbol, 32, 'symbol');
  if (!symbol.ok) return symbol;
  const unitKind = code(payload.unitKind ?? defaults.unitKind);
  if (!UNIT_KINDS.has(unitKind)) return invalid('INVALID_UNIT_KIND', 'unitKind is invalid');
  const fractional = booleanField(payload, 'allowsFractional', defaults.allowsFractional ?? false);
  if (!fractional.ok) return fractional;
  const active = booleanField(payload, 'isActive', defaults.isActive ?? true);
  if (!active.ok) return active;
  return { ok: true, normalized: { code: normalizedCode, name, symbol: symbol.value, unitKind, allowsFractional: fractional.value, isActive: active.value } };
}

function validateVariantUnitInput(payload, defaults = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Variant unit data is required');
  const unitId = text(payload.unitId ?? defaults.unitId);
  if (!validUuid(unitId)) return invalid('INVALID_UNIT_ID', 'unitId must be a valid UUID');
  const conversion = decimal(payload.conversionToBase ?? defaults.conversionToBase, { field: 'conversionToBase' });
  if (!conversion.ok) return conversion;
  const purchasable = booleanField(payload, 'isPurchasable', defaults.isPurchasable ?? true);
  if (!purchasable.ok) return purchasable;
  let netContentValue = null;
  let netContentUomCode = null;
  const rawNetContent = Object.prototype.hasOwnProperty.call(payload, 'netContent') ? payload.netContent : defaults.netContent;
  if (rawNetContent !== undefined && rawNetContent !== null) {
    if (typeof rawNetContent !== 'object' || Array.isArray(rawNetContent)) return invalid('INVALID_NET_CONTENT', 'netContent must be an object or null');
    const net = decimal(rawNetContent.value, { field: 'netContent.value' });
    if (!net.ok) return net;
    const netUom = code(rawNetContent.unitCode);
    if (!NET_CONTENT_UOMS.has(netUom)) return invalid('INVALID_NET_CONTENT_UOM', 'netContent.unitCode is invalid');
    netContentValue = net.value;
    netContentUomCode = netUom;
  }
  const sourceUnitLabel = optionalText(
    Object.prototype.hasOwnProperty.call(payload, 'sourceUnitLabel') ? payload.sourceUnitLabel : defaults.sourceUnitLabel,
    128,
    'sourceUnitLabel',
  );
  if (!sourceUnitLabel.ok) return sourceUnitLabel;
  const sourcePackageDescription = optionalText(
    Object.prototype.hasOwnProperty.call(payload, 'sourcePackageDescription') ? payload.sourcePackageDescription : defaults.sourcePackageDescription,
    512,
    'sourcePackageDescription',
  );
  if (!sourcePackageDescription.ok) return sourcePackageDescription;
  const sourceMetadata = Object.prototype.hasOwnProperty.call(payload, 'sourceMetadata') ? payload.sourceMetadata : (defaults.sourceMetadata ?? {});
  if (!sourceMetadata || typeof sourceMetadata !== 'object' || Array.isArray(sourceMetadata)) return invalid('INVALID_SOURCE_METADATA', 'sourceMetadata must be an object');
  return {
    ok: true,
    normalized: {
      unitId,
      conversionToBase: conversion.value,
      isPurchasable: purchasable.value,
      netContentValue,
      netContentUomCode,
      sourceUnitLabel: sourceUnitLabel.value,
      sourcePackageDescription: sourcePackageDescription.value,
      sourceMetadata,
    },
  };
}

function validateBarcodeInput(payload, defaults = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Barcode data is required');
  const barcode = text(payload.barcode ?? defaults.barcode);
  if (!barcode || barcode.length > 128) return invalid('INVALID_BARCODE', 'barcode is required and must not exceed 128 characters');
  const normalizedBarcode = barcode.toUpperCase();
  const barcodeType = code(payload.barcodeType ?? defaults.barcodeType ?? 'OTHER');
  if (!BARCODE_TYPES.has(barcodeType)) return invalid('INVALID_BARCODE_TYPE', 'barcodeType is invalid');
  const primary = booleanField(payload, 'isPrimary', defaults.isPrimary ?? false);
  if (!primary.ok) return primary;
  const active = booleanField(payload, 'isActive', defaults.isActive ?? true);
  if (!active.ok) return active;
  if (primary.value && !active.value) return invalid('INVALID_PRIMARY_BARCODE', 'A primary barcode must be active');
  const sourceReference = optionalText(
    Object.prototype.hasOwnProperty.call(payload, 'sourceReference') ? payload.sourceReference : defaults.sourceReference,
    512,
    'sourceReference',
  );
  if (!sourceReference.ok) return sourceReference;
  const sourceMetadata = Object.prototype.hasOwnProperty.call(payload, 'sourceMetadata') ? payload.sourceMetadata : (defaults.sourceMetadata ?? {});
  if (!sourceMetadata || typeof sourceMetadata !== 'object' || Array.isArray(sourceMetadata)) return invalid('INVALID_SOURCE_METADATA', 'sourceMetadata must be an object');
  return { ok: true, normalized: { barcode, normalizedBarcode, barcodeType, isPrimary: primary.value, isActive: active.value, sourceReference: sourceReference.value, sourceMetadata } };
}

async function resolveProductVariant(client, { installationId, productId, variantId, forUpdate = false }) {
  if (!validUuid(productId) || !validUuid(variantId)) return invalid('NOT_FOUND', 'Product variant not found');
  const product = await productRepo.getProductByIdForInstallation(client, { id: productId, installationId });
  if (!product) return invalid('NOT_FOUND', 'Product not found');
  const variant = forUpdate
    ? await variantRepo.getProductVariantByIdForInstallationForUpdate(client, { id: variantId, installationId })
    : await variantRepo.getProductVariantByIdForInstallation(client, { id: variantId, installationId });
  if (!variant || variant.product_id !== product.id) return invalid('NOT_FOUND', 'Product variant not found');
  return { ok: true, product, variant };
}

export async function listUnits(client, { installationId, search, active, limit = 200, offset = 0 }) {
  const normalizedSearch = text(search);
  if (normalizedSearch.length > 256) return invalid('INVALID_SEARCH', 'Search must not exceed 256 characters');
  const units = await unitRepo.listUnits(client, { installationId, search: normalizedSearch || null, active, limit, offset });
  return { ok: true, units };
}

export async function getUnit(client, { installationId, id }) {
  if (!validUuid(id)) return invalid('NOT_FOUND', 'Unit not found');
  const unit = await unitRepo.getUnitById(client, { installationId, id });
  return unit ? { ok: true, unit } : invalid('NOT_FOUND', 'Unit not found');
}

export async function createUnit(client, { installationId, payload, createdBy }) {
  const validation = validateUnitInput(payload);
  if (!validation.ok) return validation;
  if (await unitRepo.getUnitByCode(client, { installationId, code: validation.normalized.code })) return conflict('Unit code already exists', 'DUPLICATE_CODE');
  const unit = await unitRepo.insertUnit(client, { installationId, ...validation.normalized, createdBy });
  return unit ? { ok: true, unit } : conflict('Unit code already exists', 'DUPLICATE_CODE');
}

export async function updateUnit(client, { installationId, id, payload, updatedBy }) {
  if (!validUuid(id)) return invalid('INVALID_ID', 'Unit ID is invalid');
  const existing = await unitRepo.getUnitByIdForUpdate(client, { installationId, id });
  if (!existing) return invalid('NOT_FOUND', 'Unit not found');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'code') && code(payload.code) !== existing.code) return invalid('IMMUTABLE_CODE', 'Unit code is immutable');
  const expected = expectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (dateTime(existing.updated_at) !== expected.value) return conflict('Unit update conflict');
  const validation = validateUnitInput(payload ?? {}, { codeRequired: false, defaults: {
    code: existing.code,
    name: existing.name,
    symbol: existing.symbol,
    unitKind: existing.unit_kind,
    allowsFractional: existing.allows_fractional,
    isActive: existing.is_active,
  } });
  if (!validation.ok) return validation;
  if (!validation.normalized.isActive && existing.is_active) {
    const assignments = await unitRepo.countActiveVariantAssignments(client, { installationId, unitId: existing.id });
    if (assignments > 0) return conflict('Cannot deactivate a unit used by active product variants');
  }
  const unit = await unitRepo.updateUnit(client, {
    installationId,
    id,
    ...validation.normalized,
    expectedUpdatedAt: expected.value,
    updatedBy,
  });
  return unit ? { ok: true, unit, beforeData: existing, action: validation.normalized.isActive === existing.is_active ? 'update' : (validation.normalized.isActive ? 'activate' : 'deactivate') } : conflict('Unit update conflict');
}

export async function getVariantUnit(client, { installationId, productId, variantId }) {
  const resolved = await resolveProductVariant(client, { installationId, productId, variantId });
  return resolved.ok ? { ok: true, variant: resolved.variant } : resolved;
}

export async function assignVariantUnit(client, { installationId, productId, variantId, payload, updatedBy, requireExpected = true }) {
  const resolved = await resolveProductVariant(client, { installationId, productId, variantId, forUpdate: true });
  if (!resolved.ok) return resolved;
  const expected = requireExpected ? expectedUpdatedAt(payload?.expectedUpdatedAt) : { ok: true, value: null };
  if (!expected.ok) return expected;
  if (requireExpected && dateTime(resolved.variant.updated_at) !== expected.value) return conflict('Product variant update conflict');
  const validation = validateVariantUnitInput(payload ?? {}, {
    unitId: resolved.variant.unit_id,
    conversionToBase: resolved.variant.conversion_to_base,
    isPurchasable: resolved.variant.is_purchasable,
    netContent: resolved.variant.net_content_value ? { value: resolved.variant.net_content_value, unitCode: resolved.variant.net_content_uom_code } : null,
    sourceUnitLabel: resolved.variant.source_unit_label,
    sourcePackageDescription: resolved.variant.source_package_description,
    sourceMetadata: resolved.variant.unit_source_metadata ?? {},
  });
  if (!validation.ok) return validation;
  const unit = await unitRepo.getUnitById(client, { installationId, id: validation.normalized.unitId });
  if (!unit) return invalid('UNIT_NOT_FOUND', 'Unit not found');
  if (!unit.is_active) return conflict('Inactive unit cannot be assigned', 'UNIT_INACTIVE');
  if (resolved.variant.is_inventory_base && validation.normalized.conversionToBase !== '1') {
    return invalid('INVALID_BASE_CONVERSION', 'Inventory-base variant conversion must equal 1');
  }
  const updated = await variantRepo.updateVariantUnit(client, {
    installationId,
    id: resolved.variant.id,
    ...validation.normalized,
    unitSourceMetadata: validation.normalized.sourceMetadata,
    expectedUpdatedAt: expected.value,
    updatedBy,
  });
  if (!updated) return conflict('Product variant unit update conflict');
  return { ok: true, variant: updated, beforeData: resolved.variant, action: 'assign_unit' };
}

export async function listBarcodes(client, { installationId, productId, variantId }) {
  const resolved = await resolveProductVariant(client, { installationId, productId, variantId });
  if (!resolved.ok) return resolved;
  const barcodes = await barcodeRepo.listBarcodesForVariant(client, { installationId, variantId: resolved.variant.id });
  return { ok: true, barcodes };
}

export async function createBarcode(client, { installationId, productId, variantId, payload, createdBy }) {
  const resolved = await resolveProductVariant(client, { installationId, productId, variantId, forUpdate: true });
  if (!resolved.ok) return resolved;
  const validation = validateBarcodeInput(payload);
  if (!validation.ok) return validation;
  const duplicate = await barcodeRepo.getBarcodeByNormalizedValue(client, { installationId, normalizedBarcode: validation.normalized.normalizedBarcode });
  if (duplicate) return conflict('Barcode already exists', 'DUPLICATE_BARCODE');
  if (validation.normalized.isPrimary) {
    await barcodeRepo.clearPrimaryBarcode(client, { installationId, variantId: resolved.variant.id, excludeId: '00000000-0000-0000-0000-000000000000', updatedBy: createdBy });
  }
  const barcode = await barcodeRepo.insertBarcode(client, {
    installationId,
    variantId: resolved.variant.id,
    ...validation.normalized,
    createdBy,
  });
  return barcode ? { ok: true, barcode } : conflict('Barcode already exists', 'DUPLICATE_BARCODE');
}

export async function updateBarcode(client, { installationId, productId, variantId, barcodeId, payload, updatedBy }) {
  const resolved = await resolveProductVariant(client, { installationId, productId, variantId, forUpdate: true });
  if (!resolved.ok) return resolved;
  if (!validUuid(barcodeId)) return invalid('INVALID_ID', 'Barcode ID is invalid');
  const existing = await barcodeRepo.getBarcodeByIdForUpdate(client, { installationId, id: barcodeId });
  if (!existing || existing.variant_id !== resolved.variant.id) return invalid('NOT_FOUND', 'Barcode not found');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'barcode') && text(payload.barcode).toUpperCase() !== existing.normalized_barcode) {
    return invalid('IMMUTABLE_BARCODE', 'Barcode value is immutable');
  }
  const expected = expectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (dateTime(existing.updated_at) !== expected.value) return conflict('Barcode update conflict');
  const validation = validateBarcodeInput(payload ?? {}, {
    barcode: existing.barcode,
    barcodeType: existing.barcode_type,
    isPrimary: existing.is_primary,
    isActive: existing.is_active,
    sourceReference: existing.source_reference,
    sourceMetadata: existing.source_metadata,
  });
  if (!validation.ok) return validation;
  if (validation.normalized.isPrimary && validation.normalized.isActive) {
    await barcodeRepo.clearPrimaryBarcode(client, { installationId, variantId: existing.variant_id, excludeId: existing.id, updatedBy });
  }
  const barcode = await barcodeRepo.updateBarcode(client, {
    installationId,
    id: existing.id,
    ...validation.normalized,
    expectedUpdatedAt: expected.value,
    updatedBy,
  });
  return barcode ? { ok: true, barcode, beforeData: existing, action: validation.normalized.isActive === existing.is_active ? 'update' : (validation.normalized.isActive ? 'activate' : 'deactivate') } : conflict('Barcode update conflict');
}

export async function normalizeQuantity(client, { installationId, productId, variantId, payload }) {
  const resolved = await resolveProductVariant(client, { installationId, productId, variantId });
  if (!resolved.ok) return resolved;
  if (!resolved.variant.is_active) return conflict('Inactive product variant cannot normalize quantity', 'VARIANT_INACTIVE');
  if (!resolved.variant.unit_id || !resolved.variant.conversion_to_base) return conflict('Product variant does not have a unit conversion', 'UNIT_CONVERSION_MISSING');
  const quantity = decimal(payload?.quantity, { allowZero: true, field: 'quantity' });
  if (!quantity.ok) return quantity;
  if (!resolved.variant.allows_fractional && quantity.value.includes('.')) return invalid('FRACTIONAL_QUANTITY_NOT_ALLOWED', 'This unit only accepts whole quantities');
  const multiplied = multiplyDecimalStrings(quantity.value, String(resolved.variant.conversion_to_base));
  if (!multiplied.ok) return multiplied;
  return { ok: true, normalization: {
    productId: resolved.product.id,
    variantId: resolved.variant.id,
    sku: resolved.variant.sku,
    unitCode: resolved.variant.unit_code,
    enteredQuantity: quantity.value,
    conversionToBase: String(resolved.variant.conversion_to_base),
    baseQuantity: multiplied.value,
    inventoryBase: Boolean(resolved.variant.is_inventory_base),
  } };
}

function normalizeImportUnit(raw) {
  const validation = validateUnitInput({
    code: raw?.code,
    name: raw?.name,
    symbol: raw?.symbol ?? null,
    unitKind: raw?.unitKind,
    allowsFractional: raw?.allowsFractional,
    isActive: true,
  });
  if (!validation.ok) return validation;
  return validation;
}

async function getOrCreateImportUnit(client, { installationId, raw, createdBy }) {
  const validation = normalizeImportUnit(raw);
  if (!validation.ok) return validation;
  const existing = await unitRepo.getUnitByCode(client, { installationId, code: validation.normalized.code });
  if (existing) {
    if (existing.unit_kind !== validation.normalized.unitKind || existing.allows_fractional !== validation.normalized.allowsFractional) {
      return conflict(`Unit ${existing.code} conflicts with the reviewed import contract`, 'UNIT_DEFINITION_CONFLICT');
    }
    if (!existing.is_active) return conflict(`Unit ${existing.code} is inactive`, 'UNIT_INACTIVE');
    return { ok: true, unit: existing, created: false };
  }
  const unit = await unitRepo.insertUnit(client, { installationId, ...validation.normalized, createdBy });
  return unit ? { ok: true, unit, created: true } : conflict('Unit code already exists', 'DUPLICATE_CODE');
}

function variantUnitPayload(sourceVariant, unitId, source, warnings) {
  return {
    unitId,
    conversionToBase: sourceVariant.conversionToBase,
    isPurchasable: sourceVariant.isPurchasable !== false,
    netContent: sourceVariant.netContent ?? null,
    sourceUnitLabel: sourceVariant.unit?.sourceLabel ?? null,
    sourcePackageDescription: sourceVariant.sourcePackageDescription ?? null,
    sourceMetadata: { source, warnings: warnings ?? [] },
  };
}

export async function importProductUnits(client, { installationId, payload, createdBy }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows)) return invalid('INVALID_IMPORT', 'rows array is required');
  if (payload.rows.length < 1 || payload.rows.length > MAX_IMPORT_ROWS) return invalid('INVALID_IMPORT_SIZE', `rows must contain 1-${MAX_IMPORT_ROWS} items`);
  const seenProducts = new Set();
  const seenSkus = new Set();
  const seenBarcodes = new Set();
  for (const [index, row] of payload.rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return invalid('INVALID_IMPORT_ROW', `Row ${index + 1} is invalid`);
    if (Array.isArray(row.blockingReview) && row.blockingReview.length > 0) return conflict(`Row ${index + 1} requires business review`, 'IMPORT_REVIEW_REQUIRED');
    const productCode = code(row.productCode);
    const baseSku = code(row.baseVariant?.sku);
    const convertedSku = code(row.convertedVariant?.sku);
    if (!productCode || !baseSku || !convertedSku) return invalid('INVALID_IMPORT_ROW', `Row ${index + 1} is missing productCode or SKU`);
    if (seenProducts.has(productCode)) return conflict(`Duplicate productCode ${productCode} in import`, 'DUPLICATE_IMPORT_PRODUCT');
    if (seenSkus.has(baseSku) || seenSkus.has(convertedSku) || baseSku === convertedSku) return conflict(`Duplicate SKU in import row ${index + 1}`, 'DUPLICATE_IMPORT_SKU');
    seenProducts.add(productCode);
    seenSkus.add(baseSku);
    seenSkus.add(convertedSku);
    const barcode = text(row.convertedVariant?.barcode).toUpperCase();
    if (barcode) {
      if (seenBarcodes.has(barcode)) return conflict(`Duplicate barcode ${barcode} in import`, 'DUPLICATE_IMPORT_BARCODE');
      seenBarcodes.add(barcode);
    }
  }

  let unitsCreated = 0;
  let variantsAssigned = 0;
  let barcodesCreated = 0;
  let barcodesReused = 0;
  for (const row of payload.rows) {
    const productCode = code(row.productCode);
    const product = await productRepo.getProductByCode(client, { installationId, code: productCode });
    if (!product) return invalid('PRODUCT_NOT_FOUND', `Product ${productCode} not found`);
    const baseVariant = await variantRepo.getProductVariantBySku(client, { installationId, sku: code(row.baseVariant.sku) });
    const convertedVariant = await variantRepo.getProductVariantBySku(client, { installationId, sku: code(row.convertedVariant.sku) });
    if (!baseVariant || !convertedVariant || baseVariant.product_id !== product.id || convertedVariant.product_id !== product.id) {
      return conflict(`SKU ownership mismatch for product ${productCode}`, 'VARIANT_PRODUCT_MISMATCH');
    }
    if (!baseVariant.is_inventory_base || convertedVariant.is_inventory_base) return conflict(`Inventory-base SKU flags are invalid for ${productCode}`, 'BASE_VARIANT_MISMATCH');

    const baseUnitResult = await getOrCreateImportUnit(client, { installationId, raw: row.baseVariant.unit, createdBy });
    if (!baseUnitResult.ok) return baseUnitResult;
    const convertedUnitResult = await getOrCreateImportUnit(client, { installationId, raw: row.convertedVariant.unit, createdBy });
    if (!convertedUnitResult.ok) return convertedUnitResult;
    unitsCreated += Number(baseUnitResult.created) + Number(convertedUnitResult.created);

    const baseAssignment = await assignVariantUnit(client, {
      installationId,
      productId: product.id,
      variantId: baseVariant.id,
      payload: variantUnitPayload(row.baseVariant, baseUnitResult.unit.id, row.source, row.warnings),
      updatedBy: createdBy,
      requireExpected: false,
    });
    if (!baseAssignment.ok) return baseAssignment;
    const convertedAssignment = await assignVariantUnit(client, {
      installationId,
      productId: product.id,
      variantId: convertedVariant.id,
      payload: variantUnitPayload(row.convertedVariant, convertedUnitResult.unit.id, row.source, row.warnings),
      updatedBy: createdBy,
      requireExpected: false,
    });
    if (!convertedAssignment.ok) return convertedAssignment;
    variantsAssigned += 2;

    const rawBarcode = text(row.convertedVariant.barcode);
    if (rawBarcode) {
      const normalizedBarcode = rawBarcode.toUpperCase();
      const existingBarcode = await barcodeRepo.getBarcodeByNormalizedValue(client, { installationId, normalizedBarcode });
      if (existingBarcode) {
        if (existingBarcode.variant_id !== convertedVariant.id) return conflict(`Barcode ${rawBarcode} belongs to another SKU`, 'DUPLICATE_BARCODE');
        barcodesReused += 1;
      } else {
        const barcode = await barcodeRepo.insertBarcode(client, {
          installationId,
          variantId: convertedVariant.id,
          barcode: rawBarcode,
          normalizedBarcode,
          barcodeType: code(row.convertedVariant.barcodeType ?? 'INTERNAL'),
          isPrimary: true,
          isActive: true,
          sourceReference: `${row.source?.workbook ?? 'reviewed import'}#${row.sourceRow ?? ''}`,
          sourceMetadata: { source: row.source ?? {}, warnings: row.warnings ?? [] },
          createdBy,
        });
        if (!barcode) return conflict(`Barcode ${rawBarcode} already exists`, 'DUPLICATE_BARCODE');
        barcodesCreated += 1;
      }
    }
  }
  return { ok: true, import: { rows: payload.rows.length, unitsCreated, variantsAssigned, barcodesCreated, barcodesReused } };
}
