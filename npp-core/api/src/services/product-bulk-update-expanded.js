import * as variantRepo from '../db/repositories/product-variants.js';
import * as productService from './product.js';
import * as productCrudService from './product-with-inventory-policy.js';
import * as productUnitService from './product-unit.js';

export const EXTENDED_PRODUCT_UPDATE_MAPPINGS = Object.freeze([
  'PRODUCT_NAME', 'CATALOG_NAME', 'CATEGORY_CODE', 'BRAND_CODE', 'DESCRIPTION', 'NOTES',
  'PRODUCT_CATALOG_VISIBLE', 'PRODUCT_ORDERABLE', 'PRODUCT_INVENTORY_MANAGED', 'PRODUCT_ACTIVE',
  'VARIANT_NAME', 'VARIANT_KIND', 'INVENTORY_BASE', 'SELLABLE', 'VARIANT_CATALOG_VISIBLE', 'VARIANT_ACTIVE',
  'UNIT_CODE', 'CONVERSION_TO_BASE', 'PURCHASABLE', 'NET_CONTENT_VALUE', 'NET_CONTENT_UOM',
  'SOURCE_UNIT_LABEL', 'SOURCE_PACKAGE_DESCRIPTION',
]);

const PRODUCT_MAPPINGS = new Set([
  'PRODUCT_NAME', 'CATALOG_NAME', 'CATEGORY_CODE', 'BRAND_CODE', 'DESCRIPTION', 'NOTES',
  'PRODUCT_CATALOG_VISIBLE', 'PRODUCT_ORDERABLE', 'PRODUCT_INVENTORY_MANAGED', 'PRODUCT_ACTIVE',
]);
const VARIANT_MAPPINGS = new Set([
  'VARIANT_NAME', 'VARIANT_KIND', 'INVENTORY_BASE', 'SELLABLE', 'VARIANT_CATALOG_VISIBLE', 'VARIANT_ACTIVE',
]);
const UNIT_MAPPINGS = new Set([
  'UNIT_CODE', 'CONVERSION_TO_BASE', 'PURCHASABLE', 'NET_CONTENT_VALUE', 'NET_CONTENT_UOM',
  'SOURCE_UNIT_LABEL', 'SOURCE_PACKAGE_DESCRIPTION',
]);
const NET_CONTENT_UOMS = new Set(['G', 'KG', 'ML', 'L', 'EA', 'OTHER']);
const DECIMAL_6 = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/;
const FIELD_LABELS = Object.freeze({
  PRODUCT_NAME: 'Tên sản phẩm',
  CATALOG_NAME: 'Tên hiển thị bán hàng',
  CATEGORY_CODE: 'Loại sản phẩm',
  BRAND_CODE: 'Nhãn hàng',
  DESCRIPTION: 'Mô tả',
  NOTES: 'Ghi chú',
  PRODUCT_CATALOG_VISIBLE: 'Hiển thị sản phẩm khi bán hàng',
  PRODUCT_ORDERABLE: 'Cho phép đặt hàng',
  PRODUCT_INVENTORY_MANAGED: 'Quản lý tồn kho',
  PRODUCT_ACTIVE: 'Sản phẩm đang sử dụng',
  VARIANT_NAME: 'Tên SKU / quy cách',
  VARIANT_KIND: 'Loại SKU',
  INVENTORY_BASE: 'SKU dùng làm đơn vị tồn chuẩn',
  SELLABLE: 'Cho phép bán SKU',
  VARIANT_CATALOG_VISIBLE: 'Hiển thị SKU khi bán hàng',
  VARIANT_ACTIVE: 'SKU đang sử dụng',
  UNIT_CODE: 'Đơn vị tính',
  CONVERSION_TO_BASE: 'Hệ số quy đổi về đơn vị tồn chuẩn',
  PURCHASABLE: 'Cho phép mua SKU',
  NET_CONTENT_VALUE: 'Định lượng quy cách',
  NET_CONTENT_UOM: 'Đơn vị định lượng',
  SOURCE_UNIT_LABEL: 'Tên đơn vị nguồn',
  SOURCE_PACKAGE_DESCRIPTION: 'Mô tả quy cách nguồn',
  WEIGHT_VALUE: 'Khối lượng',
  WEIGHT_UOM: 'Đơn vị khối lượng',
});

function failure(code, message, details = {}) {
  return { ok: false, code, message, retryable: false, details };
}
function text(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function mappedCell(mappings, cells, mapping) {
  const index = mappings.indexOf(mapping);
  if (index < 0) return { mapped: false, present: false, value: undefined };
  if (index >= cells.length) return { mapped: true, present: false, value: undefined };
  return { mapped: true, present: true, value: text(cells[index]) };
}
function booleanValue(value) {
  const normalized = upper(value);
  if (['TRUE', '1', 'YES', 'Y', 'CO', 'CÓ'].includes(normalized)) return { ok: true, value: true };
  if (['FALSE', '0', 'NO', 'N', 'KHONG', 'KHÔNG'].includes(normalized)) return { ok: true, value: false };
  return failure('INVALID_BOOLEAN', 'Giá trị phải là Có hoặc Không');
}
function decimal6(value, fieldLabel) {
  const normalized = text(value).replace(',', '.');
  if (!DECIMAL_6.test(normalized) || /^0(?:\.0+)?$/.test(normalized)) {
    return failure('INVALID_DECIMAL', `${fieldLabel} phải lớn hơn 0 và có tối đa 6 chữ số thập phân`);
  }
  return { ok: true, value: normalized.includes('.') ? normalized.replace(/0+$/, '').replace(/\.$/, '') : normalized };
}
function displayBoolean(value) { return value === true ? 'Có' : 'Không'; }
function displayNullable(value) { const normalized = text(value); return normalized || 'Trống'; }
function displayVariantKind(value) {
  return ({ BASE: 'Đơn vị lẻ', CARTON: 'Thùng', OTHER: 'Quy cách khác' })[upper(value)] ?? text(value);
}
function displayWeight(value, uom) {
  if (value === null || value === undefined || value === '') return 'Chưa khai báo';
  const label = upper(uom) === 'G' ? 'g' : upper(uom) === 'KG' ? 'kg' : text(uom);
  return label ? `${value} ${label}` : String(value);
}
function change(mapping, oldValue, newValue) {
  return { field: mapping, label: FIELD_LABELS[mapping] ?? mapping, oldValue: String(oldValue), newValue: String(newValue) };
}
function rowError(row, sku, code, message) {
  return { rowNumber: row.rowNumber, sku, status: 'error', errors: [{ code, message }], changes: [], cells: row.cells };
}

async function loadVariants(client, installationId, skus, dependencies) {
  const lookup = dependencies.getProductVariantsByIdsOrSkus ?? variantRepo.getProductVariantsByIdsOrSkus;
  const rows = skus.length ? await lookup(client, { installationId, ids: [], skus }) : [];
  return new Map(rows.map((item) => [upper(item.sku), item]));
}

async function loadProducts(client, installationId, productIds, dependencies) {
  if (dependencies.getProductsByIds) {
    const rows = await dependencies.getProductsByIds(client, { installationId, productIds });
    return new Map(rows.map((item) => [item.id, item]));
  }
  if (!productIds.length) return new Map();
  const result = await client.query(
    `SELECT p.id, p.code, p.name, p.catalog_name, p.category_id, p.brand_id, p.description, p.notes,
            p.is_catalog_visible, p.is_orderable, p.is_inventory_managed, p.is_active, p.updated_at,
            c.code AS category_code, b.code AS brand_code
       FROM shared.products p
       LEFT JOIN shared.product_categories c ON c.installation_id = p.installation_id AND c.id = p.category_id
       LEFT JOIN shared.product_brands b ON b.installation_id = p.installation_id AND b.id = p.brand_id
      WHERE p.installation_id = $1 AND p.id = ANY($2::uuid[])`,
    [installationId, productIds],
  );
  return new Map((result.rows ?? []).map((item) => [item.id, item]));
}

async function loadReferenceMap(client, installationId, table, codes, dependencies, dependencyKey) {
  if (!codes.length) return new Map();
  if (dependencies[dependencyKey]) {
    const rows = await dependencies[dependencyKey](client, { installationId, codes });
    return new Map(rows.map((item) => [upper(item.code), item]));
  }
  const result = await client.query(
    `SELECT id, code, is_active FROM ${table} WHERE installation_id = $1 AND upper(code) = ANY($2::text[])`,
    [installationId, codes],
  );
  return new Map((result.rows ?? []).map((item) => [upper(item.code), item]));
}

function referenceCodes(rows, mappings, mapping) {
  const index = mappings.indexOf(mapping);
  if (index < 0) return [];
  return [...new Set(rows.map((row) => index < row.cells.length ? upper(row.cells[index]) : '').filter(Boolean))];
}

function productIntentValue(mapping, raw) {
  if (['CATEGORY_CODE', 'BRAND_CODE'].includes(mapping)) return upper(raw);
  if (['PRODUCT_CATALOG_VISIBLE', 'PRODUCT_ORDERABLE', 'PRODUCT_INVENTORY_MANAGED', 'PRODUCT_ACTIVE'].includes(mapping)) {
    const parsed = booleanValue(raw);
    return parsed.ok ? String(parsed.value) : `INVALID:${upper(raw)}`;
  }
  return text(raw);
}

function conflictingProductIds(rows, mappings, variants) {
  const seen = new Map();
  const conflicts = new Set();
  for (const row of rows) {
    const sku = upper(row.cells[0]);
    const variant = variants.get(sku);
    if (!variant) continue;
    for (const mapping of PRODUCT_MAPPINGS) {
      const cell = mappedCell(mappings, row.cells, mapping);
      if (!cell.present) continue;
      const key = `${variant.product_id}:${mapping}`;
      const value = productIntentValue(mapping, cell.value);
      if (!seen.has(key)) seen.set(key, value);
      else if (seen.get(key) !== value) conflicts.add(variant.product_id);
    }
  }
  return conflicts;
}

function buildProductPatch(product, mappings, cells, references) {
  const payload = {};
  const changes = [];
  for (const mapping of PRODUCT_MAPPINGS) {
    const cell = mappedCell(mappings, cells, mapping);
    if (!cell.present) continue;
    const raw = cell.value;
    if (mapping === 'PRODUCT_NAME') payload.name = raw;
    else if (mapping === 'CATALOG_NAME') payload.catalogName = raw || null;
    else if (mapping === 'CATEGORY_CODE') {
      const code = upper(raw);
      const item = code ? references.categories.get(code) : null;
      if (code && (!item || item.is_active === false)) return failure('CATEGORY_NOT_FOUND', `Loại sản phẩm ${code} không tồn tại hoặc đã ngừng sử dụng`);
      payload.categoryId = item?.id ?? null;
    } else if (mapping === 'BRAND_CODE') {
      const code = upper(raw);
      const item = code ? references.brands.get(code) : null;
      if (code && (!item || item.is_active === false)) return failure('BRAND_NOT_FOUND', `Nhãn hàng ${code} không tồn tại hoặc đã ngừng sử dụng`);
      payload.brandId = item?.id ?? null;
    } else if (mapping === 'DESCRIPTION') payload.description = raw || null;
    else if (mapping === 'NOTES') payload.notes = raw || null;
    else if (mapping === 'PRODUCT_CATALOG_VISIBLE') { const parsed = booleanValue(raw); if (!parsed.ok) return parsed; payload.isCatalogVisible = parsed.value; }
    else if (mapping === 'PRODUCT_ORDERABLE') { const parsed = booleanValue(raw); if (!parsed.ok) return parsed; payload.isOrderable = parsed.value; }
    else if (mapping === 'PRODUCT_INVENTORY_MANAGED') { const parsed = booleanValue(raw); if (!parsed.ok) return parsed; payload.isInventoryManaged = parsed.value; }
    else if (mapping === 'PRODUCT_ACTIVE') { const parsed = booleanValue(raw); if (!parsed.ok) return parsed; payload.isActive = parsed.value; }
  }

  const validation = productService.validateProductInput(payload, { codeRequired: false, defaults: {
    code: product.code,
    name: product.name,
    catalogName: product.catalog_name,
    categoryId: product.category_id,
    brandId: product.brand_id,
    description: product.description,
    notes: product.notes,
    isCatalogVisible: product.is_catalog_visible,
    isOrderable: product.is_orderable,
    isActive: product.is_active,
  } });
  if (!validation.ok) return failure(validation.code, validation.message, validation.details ?? {});

  const next = validation.normalized;
  const managed = Object.prototype.hasOwnProperty.call(payload, 'isInventoryManaged')
    ? payload.isInventoryManaged
    : product.is_inventory_managed !== false;
  const checks = [
    ['PRODUCT_NAME', product.name, next.name, displayNullable],
    ['CATALOG_NAME', product.catalog_name, next.catalogName, displayNullable],
    ['CATEGORY_CODE', product.category_code, [...references.categories.values()].find((item) => item.id === next.categoryId)?.code ?? '', displayNullable],
    ['BRAND_CODE', product.brand_code, [...references.brands.values()].find((item) => item.id === next.brandId)?.code ?? '', displayNullable],
    ['DESCRIPTION', product.description, next.description, displayNullable],
    ['NOTES', product.notes, next.notes, displayNullable],
    ['PRODUCT_CATALOG_VISIBLE', product.is_catalog_visible, next.isCatalogVisible, displayBoolean],
    ['PRODUCT_ORDERABLE', product.is_orderable, next.isOrderable, displayBoolean],
    ['PRODUCT_INVENTORY_MANAGED', product.is_inventory_managed !== false, managed, displayBoolean],
    ['PRODUCT_ACTIVE', product.is_active, next.isActive, displayBoolean],
  ];
  for (const [mapping, oldValue, newValue, formatter] of checks) {
    const cell = mappedCell(mappings, cells, mapping);
    if (!cell.present) continue;
    changes.push(change(mapping, formatter(oldValue), formatter(newValue)));
  }
  const changed = changes.some((item) => item.oldValue !== item.newValue);
  return { ok: true, payload, changes, changed };
}

function buildVariantPatch(variant, mappings, cells) {
  const payload = {};
  const changes = [];
  for (const mapping of VARIANT_MAPPINGS) {
    const cell = mappedCell(mappings, cells, mapping);
    if (!cell.present) continue;
    if (mapping === 'VARIANT_NAME') payload.name = cell.value;
    else if (mapping === 'VARIANT_KIND') payload.variantKind = upper(cell.value);
    else {
      const parsed = booleanValue(cell.value);
      if (!parsed.ok) return parsed;
      if (mapping === 'INVENTORY_BASE') payload.isInventoryBase = parsed.value;
      if (mapping === 'SELLABLE') payload.isSellable = parsed.value;
      if (mapping === 'VARIANT_CATALOG_VISIBLE') payload.isCatalogVisible = parsed.value;
      if (mapping === 'VARIANT_ACTIVE') payload.isActive = parsed.value;
    }
  }

  const weight = mappedCell(mappings, cells, 'WEIGHT_VALUE');
  const weightUom = mappedCell(mappings, cells, 'WEIGHT_UOM');
  if (weight.present || weightUom.present) {
    const weightBlank = weight.present && weight.value === '';
    const uomBlank = weightUom.present && weightUom.value === '';
    if ((weightBlank && weightUom.present && !uomBlank) || (uomBlank && weight.present && !weightBlank)) {
      return failure('INVALID_WEIGHT_PAIR', 'Khi xóa khối lượng hoặc đơn vị khối lượng, không được đồng thời nhập giá trị còn lại');
    }
    if (weightBlank || uomBlank) {
      payload.weightValue = null;
      payload.weightUomCode = null;
    } else {
      payload.weightValue = weight.present ? weight.value.replace(',', '.') : variant.weight_value;
      payload.weightUomCode = weightUom.present ? upper(weightUom.value) : variant.weight_uom_code;
    }
  }

  const validation = productService.validateProductVariantInput(payload, { skuRequired: false, defaults: {
    sku: variant.sku,
    name: variant.name,
    variantKind: variant.variant_kind,
    isInventoryBase: variant.is_inventory_base,
    isSellable: variant.is_sellable,
    isCatalogVisible: variant.is_catalog_visible,
    isActive: variant.is_active,
    weightValue: variant.weight_value,
    weightUomCode: variant.weight_uom_code,
  } });
  if (!validation.ok) return failure(validation.code, validation.message, validation.details ?? {});
  const next = validation.normalized;
  const checks = [
    ['VARIANT_NAME', variant.name, next.name, displayNullable],
    ['VARIANT_KIND', variant.variant_kind, next.variantKind, displayVariantKind],
    ['INVENTORY_BASE', variant.is_inventory_base, next.isInventoryBase, displayBoolean],
    ['SELLABLE', variant.is_sellable, next.isSellable, displayBoolean],
    ['VARIANT_CATALOG_VISIBLE', variant.is_catalog_visible, next.isCatalogVisible, displayBoolean],
    ['VARIANT_ACTIVE', variant.is_active, next.isActive, displayBoolean],
  ];
  for (const [mapping, oldValue, newValue, formatter] of checks) {
    if (!mappedCell(mappings, cells, mapping).present) continue;
    changes.push(change(mapping, formatter(oldValue), formatter(newValue)));
  }
  if (weight.present || weightUom.present) {
    changes.push(change('WEIGHT_VALUE', displayWeight(variant.weight_value, variant.weight_uom_code), displayWeight(next.weightValue, next.weightUomCode)));
  }
  const changed = changes.some((item) => item.oldValue !== item.newValue);
  return { ok: true, payload, changes, changed };
}

function buildUnitPatch(variant, mappings, cells, references) {
  const touchesUnit = [...UNIT_MAPPINGS].some((mapping) => mappedCell(mappings, cells, mapping).present);
  if (!touchesUnit) return { ok: true, payload: null, changes: [], changed: false };

  const unitCell = mappedCell(mappings, cells, 'UNIT_CODE');
  const conversionCell = mappedCell(mappings, cells, 'CONVERSION_TO_BASE');
  const purchasableCell = mappedCell(mappings, cells, 'PURCHASABLE');
  const netValueCell = mappedCell(mappings, cells, 'NET_CONTENT_VALUE');
  const netUomCell = mappedCell(mappings, cells, 'NET_CONTENT_UOM');
  const sourceUnitCell = mappedCell(mappings, cells, 'SOURCE_UNIT_LABEL');
  const sourcePackageCell = mappedCell(mappings, cells, 'SOURCE_PACKAGE_DESCRIPTION');

  const unitCode = unitCell.present ? upper(unitCell.value) : upper(variant.unit_code);
  const unit = references.units.get(unitCode);
  if (!unitCode || !unit || unit.is_active === false) return failure('UNIT_NOT_FOUND', `Đơn vị tính ${unitCode || '(trống)'} không tồn tại hoặc đã ngừng sử dụng`);
  const conversionResult = decimal6(conversionCell.present ? conversionCell.value : variant.conversion_to_base, 'Hệ số quy đổi');
  if (!conversionResult.ok) return conversionResult;
  const isPurchasable = purchasableCell.present ? booleanValue(purchasableCell.value) : { ok: true, value: variant.is_purchasable !== false };
  if (!isPurchasable.ok) return isPurchasable;

  let netContent = variant.net_content_value
    ? { value: String(variant.net_content_value), unitCode: upper(variant.net_content_uom_code) }
    : null;
  if (netValueCell.present || netUomCell.present) {
    const valueBlank = netValueCell.present && netValueCell.value === '';
    const uomBlank = netUomCell.present && netUomCell.value === '';
    if ((valueBlank && netUomCell.present && !uomBlank) || (uomBlank && netValueCell.present && !valueBlank)) {
      return failure('INVALID_NET_CONTENT_PAIR', 'Khi xóa định lượng hoặc đơn vị định lượng, không được đồng thời nhập giá trị còn lại');
    }
    if (valueBlank || uomBlank) netContent = null;
    else {
      const netValue = decimal6(netValueCell.present ? netValueCell.value : variant.net_content_value, 'Định lượng quy cách');
      if (!netValue.ok) return netValue;
      const netUom = netUomCell.present ? upper(netUomCell.value) : upper(variant.net_content_uom_code);
      if (!NET_CONTENT_UOMS.has(netUom)) return failure('INVALID_NET_CONTENT_UOM', 'Đơn vị định lượng không hợp lệ');
      netContent = { value: netValue.value, unitCode: netUom };
    }
  }

  const sourceUnitLabel = sourceUnitCell.present ? (sourceUnitCell.value || null) : (variant.source_unit_label ?? null);
  const sourcePackageDescription = sourcePackageCell.present ? (sourcePackageCell.value || null) : (variant.source_package_description ?? null);
  if (text(sourceUnitLabel).length > 128) return failure('INVALID_SOURCE_UNIT_LABEL', 'Tên đơn vị nguồn tối đa 128 ký tự');
  if (text(sourcePackageDescription).length > 512) return failure('INVALID_SOURCE_PACKAGE_DESCRIPTION', 'Mô tả quy cách nguồn tối đa 512 ký tự');
  if (variant.is_inventory_base && conversionResult.value !== '1') return failure('INVALID_BASE_CONVERSION', 'SKU tồn chuẩn phải có hệ số quy đổi bằng 1');

  const payload = {
    unitId: unit.id,
    conversionToBase: conversionResult.value,
    isPurchasable: isPurchasable.value,
    netContent,
    sourceUnitLabel,
    sourcePackageDescription,
    sourceMetadata: variant.unit_source_metadata ?? {},
  };
  const checks = [
    ['UNIT_CODE', variant.unit_code, unit.code, displayNullable],
    ['CONVERSION_TO_BASE', variant.conversion_to_base, conversionResult.value, displayNullable],
    ['PURCHASABLE', variant.is_purchasable !== false, isPurchasable.value, displayBoolean],
    ['NET_CONTENT_VALUE', variant.net_content_value, netContent?.value ?? null, displayNullable],
    ['NET_CONTENT_UOM', variant.net_content_uom_code, netContent?.unitCode ?? null, displayNullable],
    ['SOURCE_UNIT_LABEL', variant.source_unit_label, sourceUnitLabel, displayNullable],
    ['SOURCE_PACKAGE_DESCRIPTION', variant.source_package_description, sourcePackageDescription, displayNullable],
  ];
  const changes = [];
  for (const [mapping, oldValue, newValue, formatter] of checks) {
    if (!mappedCell(mappings, cells, mapping).present) continue;
    changes.push(change(mapping, formatter(oldValue), formatter(newValue)));
  }
  const changed = changes.some((item) => item.oldValue !== item.newValue);
  return { ok: true, payload, changes, changed };
}

async function savepoint(client, name, action) {
  if (!client?.query) return action();
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await action();
    if (!result.ok) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    }
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    const sqlState = text(error?.code);
    if (sqlState.startsWith('23')) {
      return failure('ROW_UPDATE_CONFLICT', 'Dữ liệu dòng này xung đột với cấu hình sản phẩm hiện có; dòng được bỏ qua');
    }
    throw error;
  }
}

export async function bulkUpdateExtendedProductFields(client, {
  installationId,
  payload,
  updatedBy,
  mappings,
  rows,
  normalizedSkus,
  skuCounts,
}, dependencies = {}) {
  const dryRun = payload.dryRun === true;
  const candidateSkus = [...new Set(normalizedSkus.filter((sku) => sku && (skuCounts.get(sku) ?? 0) === 1))];
  const variants = await loadVariants(client, installationId, candidateSkus, dependencies);
  const productIds = [...new Set([...variants.values()].map((variant) => variant.product_id))];
  const products = await loadProducts(client, installationId, productIds, dependencies);
  const needsUnitReferences = [...UNIT_MAPPINGS].some((mapping) => mappings.includes(mapping));
  const references = {
    categories: await loadReferenceMap(client, installationId, 'shared.product_categories', referenceCodes(rows, mappings, 'CATEGORY_CODE'), dependencies, 'getCategoriesByCodes'),
    brands: await loadReferenceMap(client, installationId, 'shared.product_brands', referenceCodes(rows, mappings, 'BRAND_CODE'), dependencies, 'getBrandsByCodes'),
    units: needsUnitReferences
      ? await loadReferenceMap(client, installationId, 'shared.units_of_measure', [
          ...new Set([
            ...referenceCodes(rows, mappings, 'UNIT_CODE'),
            ...[...variants.values()].map((variant) => upper(variant.unit_code)).filter(Boolean),
          ]),
        ], dependencies, 'getUnitsByCodes')
      : new Map(),
  };
  const productConflicts = conflictingProductIds(rows, mappings, variants);
  const updateProduct = dependencies.updateProduct ?? productCrudService.updateProduct;
  const updateVariant = dependencies.updateProductVariant ?? productService.updateProductVariant;
  const assignVariantUnit = dependencies.assignVariantUnit ?? productUnitService.assignVariantUnit;

  const previewRows = [];
  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rawSku = text(row.cells[0]);
    const sku = normalizedSkus[index];
    if (!rawSku) { previewRows.push(rowError(row, '', 'MISSING_SKU', 'SKU không được để trống')); skipped += 1; continue; }
    if (!sku) { previewRows.push(rowError(row, rawSku, 'INVALID_SKU', 'SKU không hợp lệ')); skipped += 1; continue; }
    if ((skuCounts.get(sku) ?? 0) > 1) { previewRows.push(rowError(row, sku, 'DUPLICATE_SKU', 'SKU bị trùng trong cùng tệp')); skipped += 1; continue; }
    let variant = variants.get(sku);
    if (!variant) { previewRows.push(rowError(row, sku, 'SKU_NOT_FOUND', 'SKU không tồn tại; dòng này sẽ được bỏ qua')); skipped += 1; continue; }
    let product = products.get(variant.product_id);
    if (!product) { previewRows.push(rowError(row, sku, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm của SKU; dòng này sẽ được bỏ qua')); skipped += 1; continue; }
    if (productConflicts.has(product.id)) {
      previewRows.push(rowError(row, sku, 'CONFLICTING_PRODUCT_VALUES', 'Các SKU cùng sản phẩm đang yêu cầu giá trị cấp sản phẩm khác nhau; các dòng này được bỏ qua'));
      skipped += 1;
      continue;
    }

    const productPatch = buildProductPatch(product, mappings, row.cells, references);
    if (!productPatch.ok) { previewRows.push(rowError(row, sku, productPatch.code, productPatch.message)); skipped += 1; continue; }
    const variantPatch = buildVariantPatch(variant, mappings, row.cells);
    if (!variantPatch.ok) { previewRows.push(rowError(row, sku, variantPatch.code, variantPatch.message)); skipped += 1; continue; }
    const variantForUnitValidation = {
      ...variant,
      is_inventory_base: Object.prototype.hasOwnProperty.call(variantPatch.payload, 'isInventoryBase')
        ? variantPatch.payload.isInventoryBase
        : variant.is_inventory_base,
    };
    const unitPatch = buildUnitPatch(variantForUnitValidation, mappings, row.cells, references);
    if (!unitPatch.ok) { previewRows.push(rowError(row, sku, unitPatch.code, unitPatch.message)); skipped += 1; continue; }

    const changes = [...productPatch.changes, ...variantPatch.changes, ...unitPatch.changes];
    const changed = productPatch.changed || variantPatch.changed || unitPatch.changed;
    if (dryRun) {
      if (!changed) unchanged += 1;
      previewRows.push({ rowNumber: row.rowNumber, sku, status: changed ? 'ready' : 'unchanged', errors: [], changes, cells: row.cells });
      continue;
    }
    if (!changed) {
      unchanged += 1;
      previewRows.push({ rowNumber: row.rowNumber, sku, status: 'unchanged', errors: [], changes, cells: row.cells });
      continue;
    }

    const result = await savepoint(client, `bulk_product_row_${index + 1}`, async () => {
      let nextProduct = product;
      let nextVariant = variant;
      if (productPatch.changed) {
        const productResult = await updateProduct(client, {
          id: product.id,
          installationId,
          payload: { ...productPatch.payload, expectedUpdatedAt: product.updated_at },
          updatedBy,
        });
        if (!productResult.ok) return productResult;
        nextProduct = productResult.product;
      }
      if (variantPatch.changed) {
        const variantResult = await updateVariant(client, {
          productId: variant.product_id,
          variantId: variant.id,
          installationId,
          payload: { ...variantPatch.payload, expectedUpdatedAt: nextVariant.updated_at },
          updatedBy,
        });
        if (!variantResult.ok) return variantResult;
        nextVariant = variantResult.variant;
      }
      if (unitPatch.changed) {
        const unitResult = await assignVariantUnit(client, {
          installationId,
          productId: nextVariant.product_id,
          variantId: nextVariant.id,
          payload: { ...unitPatch.payload, expectedUpdatedAt: nextVariant.updated_at },
          updatedBy,
        });
        if (!unitResult.ok) return unitResult;
        nextVariant = unitResult.variant;
      }
      return { ok: true, product: nextProduct, variant: nextVariant };
    });
    if (!result.ok) {
      previewRows.push(rowError(row, sku, result.code, result.message));
      skipped += 1;
      continue;
    }
    product = result.product;
    variant = result.variant;
    products.set(product.id, product);
    variants.set(sku, variant);
    updated += 1;
    previewRows.push({ rowNumber: row.rowNumber, sku, status: 'updated', errors: [], changes, cells: row.cells });
  }

  return {
    ok: true,
    updated,
    skipped,
    ready: previewRows.filter((row) => row.status === 'ready').length,
    unchanged,
    rows: previewRows,
  };
}
