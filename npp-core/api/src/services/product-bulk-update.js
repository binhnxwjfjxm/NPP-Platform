import * as variantRepo from '../db/repositories/product-variants.js';
import * as productService from './product.js';

const MAX_ROWS = 500;
const SKU = 'SKU';
const IGNORE = 'IGNORE';
const WEIGHT_VALUE = 'WEIGHT_VALUE';
const WEIGHT_UOM = 'WEIGHT_UOM';
const ALLOWED_MAPPINGS = new Set([SKU, IGNORE, WEIGHT_VALUE, WEIGHT_UOM]);

function invalid(code, message, details = {}) {
  return { ok: false, code, message, retryable: false, details };
}

function asText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function canonicalSku(value) {
  const validation = productService.validateProductVariantInput({
    sku: value,
    name: 'SKU',
    variantKind: 'BASE',
    isInventoryBase: false,
    isSellable: true,
    isCatalogVisible: false,
    isActive: true,
  });
  if (!validation.ok) return null;
  return validation.normalized.sku;
}

function normalizeMappings(value) {
  if (!Array.isArray(value) || value.length < 2) {
    return invalid('INVALID_FIELD_MAPPING', 'Cần có cột SKU và ít nhất một cột dữ liệu');
  }
  const mappings = value.map((item) => asText(item).toUpperCase());
  if (mappings[0] !== SKU) return invalid('INVALID_SKU_COLUMN', 'Cột 1 phải cố định là SKU');
  const seen = new Set();
  let updateFieldCount = 0;
  for (let index = 0; index < mappings.length; index += 1) {
    const mapping = mappings[index];
    if (!ALLOWED_MAPPINGS.has(mapping)) return invalid('INVALID_FIELD_MAPPING', `Cột ${index + 1} có thuộc tính cập nhật không hợp lệ`);
    if (index > 0 && mapping === SKU) return invalid('INVALID_SKU_COLUMN', 'SKU chỉ được dùng ở cột 1');
    if (mapping === IGNORE || mapping === SKU) continue;
    updateFieldCount += 1;
    if (seen.has(mapping)) return invalid('DUPLICATE_FIELD_MAPPING', 'Một thuộc tính không được ánh xạ vào nhiều cột');
    seen.add(mapping);
  }
  if (updateFieldCount === 0) return invalid('MISSING_UPDATE_FIELD', 'Chọn ít nhất một thuộc tính cần cập nhật');
  return { ok: true, mappings };
}

function normalizeRows(value) {
  if (!Array.isArray(value) || value.length === 0) return invalid('INVALID_UPDATE_ROWS', 'Tệp cập nhật không có dòng dữ liệu');
  if (value.length > MAX_ROWS) return invalid('UPDATE_TOO_LARGE', `Mỗi lần cập nhật tối đa ${MAX_ROWS} dòng`);
  const rows = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Array.isArray(row.cells)) {
      return invalid('INVALID_UPDATE_ROWS', `Dòng ${index + 1} không hợp lệ`);
    }
    const rowNumber = Number.isInteger(row.rowNumber) && row.rowNumber > 0 ? row.rowNumber : index + 1;
    rows.push({ rowNumber, cells: row.cells });
  }
  return { ok: true, rows };
}

function displayWeight(value, uom) {
  if (value === null || value === undefined || value === '') return 'Chưa khai báo';
  const label = uom === 'G' ? 'g' : uom === 'KG' ? 'kg' : asText(uom);
  return label ? `${value} ${label}` : String(value);
}

function rowError(rowNumber, sku, code, message, cells) {
  return {
    rowNumber,
    sku,
    status: 'error',
    errors: [{ code, message }],
    changes: [],
    cells,
  };
}

function getMappedCell(mappings, cells, mapping) {
  const index = mappings.indexOf(mapping);
  if (index < 0 || index >= cells.length) return { mapped: index >= 0, present: false, value: undefined, index };
  return { mapped: true, present: true, value: asText(cells[index]), index };
}

function buildWeightPatch(existing, mappings, cells) {
  const weight = getMappedCell(mappings, cells, WEIGHT_VALUE);
  const uom = getMappedCell(mappings, cells, WEIGHT_UOM);
  if (!weight.present && !uom.present) return { ok: true, changed: false, payload: {}, changes: [] };

  const weightBlank = weight.present && weight.value === '';
  const uomBlank = uom.present && uom.value === '';
  if ((weightBlank && uom.present && !uomBlank) || (uomBlank && weight.present && !weightBlank)) {
    return invalid('INVALID_WEIGHT_PAIR', 'Khi xóa khối lượng hoặc đơn vị khối lượng, không được đồng thời nhập giá trị còn lại');
  }

  let nextWeight;
  let nextUom;
  if (weightBlank || uomBlank) {
    nextWeight = null;
    nextUom = null;
  } else {
    nextWeight = weight.present ? weight.value.replace(',', '.') : existing.weight_value;
    nextUom = uom.present ? uom.value.toUpperCase() : existing.weight_uom_code;
  }

  const validation = productService.validateProductVariantInput({
    weightValue: nextWeight,
    weightUomCode: nextUom,
  }, { skuRequired: false, defaults: {
    sku: existing.sku,
    name: existing.name,
    variantKind: existing.variant_kind,
    isInventoryBase: existing.is_inventory_base,
    isSellable: existing.is_sellable,
    isCatalogVisible: existing.is_catalog_visible,
    isActive: existing.is_active,
    weightValue: existing.weight_value,
    weightUomCode: existing.weight_uom_code,
  } });
  if (!validation.ok) return invalid(validation.code, validation.message, validation.details ?? {});

  const normalized = validation.normalized;
  const changed = String(existing.weight_value ?? '') !== String(normalized.weightValue ?? '')
    || String(existing.weight_uom_code ?? '') !== String(normalized.weightUomCode ?? '');
  const changes = [];
  if (weight.present || uom.present) {
    changes.push({
      field: 'weight',
      label: 'Khối lượng',
      oldValue: displayWeight(existing.weight_value, existing.weight_uom_code),
      newValue: displayWeight(normalized.weightValue, normalized.weightUomCode),
    });
  }
  return {
    ok: true,
    changed,
    payload: { weightValue: normalized.weightValue, weightUomCode: normalized.weightUomCode },
    changes,
  };
}

export async function bulkUpdateProductVariants(client, {
  installationId,
  payload,
  updatedBy,
}, dependencies = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_UPDATE_PAYLOAD', 'Dữ liệu cập nhật không hợp lệ');
  const mappingResult = normalizeMappings(payload.mappings);
  if (!mappingResult.ok) return mappingResult;
  const rowResult = normalizeRows(payload.rows);
  if (!rowResult.ok) return rowResult;
  const mappings = mappingResult.mappings;
  const rows = rowResult.rows;
  const dryRun = payload.dryRun === true;
  const lookupVariant = dependencies.getProductVariantBySku ?? variantRepo.getProductVariantBySku;
  const updateVariant = dependencies.updateProductVariant ?? productService.updateProductVariant;

  const normalizedSkus = rows.map((row) => canonicalSku(row.cells[0]));
  const skuCounts = new Map();
  for (const sku of normalizedSkus) if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);

  const previewRows = [];
  let updated = 0;
  let skipped = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rawSku = asText(row.cells[0]);
    const sku = normalizedSkus[index];
    if (!rawSku) {
      previewRows.push(rowError(row.rowNumber, '', 'MISSING_SKU', 'SKU không được để trống', row.cells));
      skipped += 1;
      continue;
    }
    if (!sku) {
      previewRows.push(rowError(row.rowNumber, rawSku, 'INVALID_SKU', 'SKU không hợp lệ', row.cells));
      skipped += 1;
      continue;
    }
    if ((skuCounts.get(sku) ?? 0) > 1) {
      previewRows.push(rowError(row.rowNumber, sku, 'DUPLICATE_SKU', 'SKU bị trùng trong cùng tệp', row.cells));
      skipped += 1;
      continue;
    }

    const existing = await lookupVariant(client, { installationId, sku });
    if (!existing) {
      previewRows.push(rowError(row.rowNumber, sku, 'SKU_NOT_FOUND', 'SKU không tồn tại; dòng này sẽ được bỏ qua', row.cells));
      skipped += 1;
      continue;
    }

    const patch = buildWeightPatch(existing, mappings, row.cells);
    if (!patch.ok) {
      previewRows.push(rowError(row.rowNumber, sku, patch.code, patch.message, row.cells));
      skipped += 1;
      continue;
    }

    if (!dryRun && patch.changed) {
      const result = await updateVariant(client, {
        productId: existing.product_id,
        variantId: existing.id,
        installationId,
        payload: { ...patch.payload, expectedUpdatedAt: existing.updated_at },
        updatedBy,
      });
      if (!result.ok) {
        previewRows.push(rowError(row.rowNumber, sku, result.code, result.message, row.cells));
        skipped += 1;
        continue;
      }
      updated += 1;
    }

    previewRows.push({
      rowNumber: row.rowNumber,
      sku,
      status: dryRun ? 'ready' : (patch.changed ? 'updated' : 'unchanged'),
      errors: [],
      changes: patch.changes,
      cells: row.cells,
    });
  }

  return {
    ok: true,
    updated,
    skipped,
    ready: previewRows.filter((row) => row.status === 'ready').length,
    unchanged: previewRows.filter((row) => row.status === 'unchanged').length,
    rows: previewRows,
  };
}

export const PRODUCT_VARIANT_UPDATE_MAPPINGS = Object.freeze({ SKU, IGNORE, WEIGHT_VALUE, WEIGHT_UOM });
