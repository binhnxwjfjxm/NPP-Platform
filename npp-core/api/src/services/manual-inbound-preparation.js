import { PERMISSIONS } from '../access/permissions.js';
import { inventoryLedgerInternals } from './inventory-ledger.js';
import { inventoryLotInternals } from './inventory-lots.js';
import * as lotRepository from '../db/repositories/inventory-lots.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/;
const COST_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/;
const SCALE_6 = 1_000_000n;
const INBOUND_TYPES = new Set(['MANUAL_RECEIPT', 'OFF_DOCUMENT_CUSTOMER_RETURN', 'RECOVERY', 'OTHER']);

function failure(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, retryable: false, details });
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function optionalText(value, maxLength, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') return { ok: true, value: null };
  const normalized = String(value).trim();
  return normalized.length <= maxLength
    ? { ok: true, value: normalized }
    : failure('INVALID_TEXT_LENGTH', `${fieldName} vượt quá độ dài cho phép.`);
}

function strictDate(value) {
  const normalized = text(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized ?? '');
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3])
    ? normalized
    : null;
}

function canonicalDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const normalized = String(value).slice(0, 10);
  return strictDate(normalized);
}

function decimal6(value, lineNumber) {
  const normalized = text(value, 32);
  if (!normalized || !QUANTITY_PATTERN.test(normalized)) {
    return failure('INVALID_QUANTITY', `Dòng ${lineNumber}: Số lượng không hợp lệ.`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  const scaled = BigInt(whole) * SCALE_6 + BigInt(fraction.padEnd(6, '0'));
  if (scaled <= 0n) return failure('INVALID_QUANTITY', `Dòng ${lineNumber}: Số lượng phải lớn hơn 0.`);
  return { ok: true, value: `${whole}.${fraction.padEnd(6, '0')}`, scaled };
}

function decimalCost(value, lineNumber) {
  if (value === undefined || value === null || String(value).trim() === '') return { ok: true, value: null };
  const normalized = String(value).trim();
  if (!COST_PATTERN.test(normalized)) {
    return failure('INVALID_UNIT_COST', `Dòng ${lineNumber}: Giá vốn không hợp lệ.`);
  }
  const [whole, fraction = ''] = normalized.split('.');
  const scaled = BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, '0'));
  if (scaled <= 0n) return failure('INVALID_UNIT_COST', `Dòng ${lineNumber}: Giá vốn phải lớn hơn 0.`);
  return { ok: true, value: `${whole}.${fraction.padEnd(12, '0')}` };
}

function formatScaled6(value) {
  const whole = value / SCALE_6;
  const fraction = String(value % SCALE_6).padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions) && requestContext.permissions.includes(permission);
}

function allowedWarehouseIds(requestContext) {
  return [...new Set(
    (Array.isArray(requestContext?.scopes?.warehouseIds) ? requestContext.scopes.warehouseIds : [])
      .map((id) => String(id ?? '').trim())
      .filter((id) => UUID_PATTERN.test(id)),
  )];
}

function normalizePreviewPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Dữ liệu Nhập kho thủ công không hợp lệ.');
  }
  const warehouseId = text(payload.warehouseId, 64);
  if (!warehouseId || !UUID_PATTERN.test(warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'Hãy chọn kho nhập hợp lệ.');
  const inboundType = text(payload.inboundType, 64)?.toUpperCase() ?? null;
  if (!inboundType || !INBOUND_TYPES.has(inboundType)) return failure('INVALID_MANUAL_INBOUND_TYPE', 'Hãy chọn loại nhập kho.');
  const documentDate = strictDate(payload.documentDate);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'Ngày chứng từ không hợp lệ.');
  const referenceNumber = optionalText(payload.referenceNumber, 160, 'Số chứng từ tham chiếu');
  if (!referenceNumber.ok) return referenceNumber;
  const note = optionalText(payload.note, 2000, 'Ghi chú');
  if (!note.ok) return note;
  if (inboundType === 'OTHER' && !note.value) return failure('MANUAL_INBOUND_NOTE_REQUIRED', 'Loại “Khác” cần có ghi chú.');
  if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 500) {
    return failure('INVALID_ROWS', 'Danh sách cần có từ 1 đến 500 dòng hàng.');
  }

  const rows = [];
  for (let index = 0; index < payload.rows.length; index += 1) {
    const source = payload.rows[index];
    const lineNumber = index + 1;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return failure('INVALID_ROW', `Dòng ${lineNumber} không hợp lệ.`);
    const sku = text(source.sku, 96);
    if (!sku) return failure('SKU_REQUIRED', `Dòng ${lineNumber}: Thiếu SKU.`);
    const quantity = decimal6(source.sourceQuantity, lineNumber);
    if (!quantity.ok) return quantity;
    const unitCost = decimalCost(source.unitCost, lineNumber);
    if (!unitCost.ok) return unitCost;
    const locationCode = optionalText(source.locationCode, 64, `Dòng ${lineNumber}: Vị trí`);
    if (!locationCode.ok) return locationCode;
    const lotCodeInput = optionalText(source.lotCode, 100, `Dòng ${lineNumber}: Mã lô`);
    if (!lotCodeInput.ok) return lotCodeInput;
    let lotCode = null;
    if (lotCodeInput.value) {
      const normalizedLot = inventoryLotInternals.normalizeLotCode(lotCodeInput.value);
      if (!normalizedLot.ok) return failure(normalizedLot.code, `Dòng ${lineNumber}: Mã lô không hợp lệ.`);
      lotCode = normalizedLot.value;
    }
    const expiryDate = source.expiryDate ? strictDate(source.expiryDate) : null;
    if (source.expiryDate && !expiryDate) return failure('INVALID_EXPIRY_DATE', `Dòng ${lineNumber}: Hạn sử dụng không hợp lệ.`);
    const manufacturedDate = source.manufacturedDate ? strictDate(source.manufacturedDate) : null;
    if (source.manufacturedDate && !manufacturedDate) return failure('INVALID_MANUFACTURED_DATE', `Dòng ${lineNumber}: Ngày sản xuất không hợp lệ.`);
    const supplierLotReference = optionalText(source.supplierLotReference, 160, `Dòng ${lineNumber}: Mã lô nhà cung cấp`);
    if (!supplierLotReference.ok) return supplierLotReference;
    rows.push({
      lineNumber,
      sourceLineNumbers: [lineNumber],
      sku: sku.toUpperCase(),
      sourceQuantity: quantity.value,
      sourceQuantityScaled: quantity.scaled,
      unitCost: unitCost.value,
      locationCode: locationCode.value?.toUpperCase() ?? null,
      lotCode,
      manufacturedDate,
      expiryDate,
      supplierLotReference: supplierLotReference.value,
    });
  }

  const merged = new Map();
  for (const row of rows) {
    const key = [row.sku, row.locationCode ?? '', row.lotCode ?? '', row.manufacturedDate ?? '', row.expiryDate ?? '', row.unitCost ?? '', row.supplierLotReference ?? ''].join('\u001f');
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }
    existing.sourceQuantityScaled += row.sourceQuantityScaled;
    existing.sourceQuantity = formatScaled6(existing.sourceQuantityScaled);
    existing.sourceLineNumbers.push(...row.sourceLineNumbers);
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      warehouseId,
      inboundType,
      documentDate,
      referenceNumber: referenceNumber.value,
      note: note.value,
      rows: Object.freeze([...merged.values()]),
      inputRowCount: rows.length,
    }),
  });
}

async function inventoryManagementPolicyAvailable(client) {
  const result = await client.query(`SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'shared'
       AND table_name = 'products'
       AND column_name = 'is_inventory_managed'
  ) AS present`);
  return result.rows?.[0]?.present === true;
}

async function scopedWarehouse(client, requestContext, warehouseId) {
  if (!allowedWarehouseIds(requestContext).includes(warehouseId)) return null;
  const result = await client.query(
    `SELECT id, code, name
       FROM shared.warehouses
      WHERE installation_id = $1 AND id = $2 AND is_active = true`,
    [requestContext.installationId, warehouseId],
  );
  return result.rows?.[0] ?? null;
}

export async function listManualInboundWarehouseOptions(client, { requestContext }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPrepare)) {
    return failure('PERMISSION_DENIED', 'Không có quyền chuẩn bị Nhập kho thủ công.', 403);
  }
  const warehouseIds = allowedWarehouseIds(requestContext);
  if (warehouseIds.length === 0) return Object.freeze({ ok: true, warehouses: Object.freeze([]) });
  const result = await client.query(
    `SELECT id, code, name
       FROM shared.warehouses
      WHERE installation_id = $1
        AND id = ANY($2::uuid[])
        AND is_active = true
      ORDER BY code ASC, id ASC`,
    [requestContext.installationId, warehouseIds],
  );
  return Object.freeze({
    ok: true,
    warehouses: Object.freeze(result.rows.map((row) => ({ id: row.id, code: row.code, name: row.name }))),
  });
}

export async function listManualInboundLocationOptions(client, { requestContext, warehouseId }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPrepare)) {
    return failure('PERMISSION_DENIED', 'Không có quyền chuẩn bị Nhập kho thủ công.', 403);
  }
  if (!UUID_PATTERN.test(String(warehouseId ?? ''))) return failure('INVALID_WAREHOUSE_ID', 'Kho nhập không hợp lệ.');
  const warehouse = await scopedWarehouse(client, requestContext, warehouseId);
  if (!warehouse) return failure('WAREHOUSE_SCOPE_DENIED', 'Kho không hoạt động hoặc ngoài phạm vi được cấp.', 403);
  const result = await client.query(
    `SELECT id, code, name, location_type
       FROM shared.warehouse_locations
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND is_active = true
      ORDER BY code ASC, id ASC`,
    [requestContext.installationId, warehouseId],
  );
  return Object.freeze({
    ok: true,
    warehouse: Object.freeze({ id: warehouse.id, code: warehouse.code, name: warehouse.name }),
    locations: Object.freeze(result.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, locationType: row.location_type }))),
  });
}

async function resolveSkuMap(client, installationId, skus, policyAvailable) {
  if (skus.length === 0) return new Map();
  const inventoryManagedField = policyAvailable ? 'p.is_inventory_managed' : 'NULL::boolean';
  const result = await client.query(
    `SELECT pv.id, pv.sku, pv.product_id, pv.unit_id, pv.conversion_to_base,
            unit.code AS unit_code, unit.allows_fractional,
            p.code AS product_code, p.name AS product_name, ${inventoryManagedField} AS is_inventory_managed,
            base.id AS base_variant_id, base.sku AS base_sku,
            policy.lot_tracking_mode, policy.expiry_tracking_mode, policy.location_required
       FROM shared.product_variants pv
       JOIN shared.products p
         ON p.installation_id = pv.installation_id AND p.id = pv.product_id
       JOIN shared.units_of_measure unit
         ON unit.installation_id = pv.installation_id AND unit.id = pv.unit_id AND unit.is_active = true
       LEFT JOIN shared.product_variants base
         ON base.installation_id = pv.installation_id
        AND base.product_id = pv.product_id
        AND base.is_inventory_base = true
        AND base.is_active = true
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = base.installation_id AND policy.base_variant_id = base.id
      WHERE pv.installation_id = $1
        AND upper(pv.sku) = ANY($2::text[])
        AND pv.is_active = true
        AND p.is_active = true
      ORDER BY pv.sku ASC, pv.id ASC`,
    [installationId, skus],
  );
  const map = new Map();
  for (const row of result.rows) {
    const key = String(row.sku).trim().toUpperCase();
    const entries = map.get(key) ?? [];
    entries.push(row);
    map.set(key, entries);
  }
  return map;
}

async function resolveLocationMap(client, installationId, warehouseId, codes) {
  if (codes.length === 0) return new Map();
  const result = await client.query(
    `SELECT id, code, name, location_type
       FROM shared.warehouse_locations
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND upper(code) = ANY($3::text[])
        AND is_active = true
      ORDER BY code ASC, id ASC`,
    [installationId, warehouseId, codes],
  );
  return new Map(result.rows.map((row) => [String(row.code).trim().toUpperCase(), row]));
}

async function currentCost(client, installationId, warehouseId, baseVariantId) {
  const result = await client.query(
    `SELECT average_unit_cost
       FROM inventory.inventory_cost_balances
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND base_variant_id = $3
        AND status = 'COSTED'
        AND average_unit_cost > 0
      LIMIT 1`,
    [installationId, warehouseId, baseVariantId],
  );
  const value = result.rows?.[0]?.average_unit_cost;
  return value === undefined || value === null ? null : String(value);
}

export async function validateManualInboundPostInventoryPolicy(client, { requestContext, rows }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPost)) {
    return failure('PERMISSION_DENIED', 'Không có quyền xác nhận Nhập kho thủ công.', 403);
  }
  if (!Array.isArray(rows) || rows.length === 0) return failure('INVALID_ROWS', 'Chứng từ chưa có dòng hàng.');
  const rawVariantIds = rows.map((row) => String(row?.sourceVariantId ?? '').trim());
  if (rawVariantIds.some((id) => !UUID_PATTERN.test(id))) return failure('INVALID_SOURCE_VARIANT_ID', 'Có SKU không hợp lệ trong chứng từ.');
  const sourceVariantIds = [...new Set(rawVariantIds)];
  if (!await inventoryManagementPolicyAvailable(client)) {
    return failure('INVENTORY_POLICY_UNAVAILABLE', 'Chính sách quản lý tồn chưa sẵn sàng; chưa thể ghi sổ Nhập kho thủ công.', 409);
  }
  const result = await client.query(
    `SELECT pv.id, pv.sku, p.is_inventory_managed
       FROM shared.product_variants pv
       JOIN shared.products p
         ON p.installation_id = pv.installation_id AND p.id = pv.product_id
      WHERE pv.installation_id = $1
        AND pv.id = ANY($2::uuid[])
        AND pv.is_active = true
        AND p.is_active = true`,
    [requestContext.installationId, sourceVariantIds],
  );
  if (result.rows.length !== sourceVariantIds.length) {
    return failure('SKU_NOT_FOUND', 'Có SKU không tồn tại hoặc không hoạt động.');
  }
  const blocked = result.rows.find((row) => row.is_inventory_managed !== true);
  if (blocked) {
    return failure('SKU_NOT_INVENTORY_MANAGED', `SKU ${blocked.sku}: Mã hàng này không quản lý tồn nên không dùng Nhập kho thủ công.`);
  }
  return Object.freeze({ ok: true });
}

export async function previewManualInbound(client, { requestContext, payload }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryManualInboundPrepare)) {
    return failure('PERMISSION_DENIED', 'Không có quyền chuẩn bị Nhập kho thủ công.', 403);
  }
  const normalized = normalizePreviewPayload(payload);
  if (!normalized.ok) return normalized;
  const body = normalized.value;
  const warehouse = await scopedWarehouse(client, requestContext, body.warehouseId);
  if (!warehouse) return failure('WAREHOUSE_SCOPE_DENIED', 'Kho không hoạt động hoặc ngoài phạm vi được cấp.', 403);

  const policyAvailable = await inventoryManagementPolicyAvailable(client);
  const skuKeys = [...new Set(body.rows.map((row) => row.sku))];
  const locationKeys = [...new Set(body.rows.map((row) => row.locationCode).filter(Boolean))];
  const [skuMap, locationMap] = await Promise.all([
    resolveSkuMap(client, requestContext.installationId, skuKeys, policyAvailable),
    resolveLocationMap(client, requestContext.installationId, body.warehouseId, locationKeys),
  ]);

  const rowErrors = [];
  const displayRows = [];
  let totalQuantityScaled = 0n;

  for (const row of body.rows) {
    const display = {
      lineNumber: row.lineNumber,
      sourceLineNumbers: row.sourceLineNumbers,
      sku: row.sku,
      sourceQuantity: formatScaled6(row.sourceQuantityScaled),
      unitCost: row.unitCost,
      locationCode: row.locationCode,
      lotCode: row.lotCode,
      manufacturedDate: row.manufacturedDate,
      expiryDate: row.expiryDate,
      supplierLotReference: row.supplierLotReference,
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      status: 'NEEDS_ATTENTION',
      requiredFields: [],
    };
    totalQuantityScaled += row.sourceQuantityScaled;
    const variants = skuMap.get(row.sku) ?? [];
    if (variants.length === 0) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'SKU_NOT_FOUND', message: `SKU ${row.sku} không tồn tại hoặc không hoạt động.` });
      displayRows.push(display);
      continue;
    }
    if (variants.length > 1) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'SKU_AMBIGUOUS', message: `SKU ${row.sku} đang bị trùng trong danh mục hàng.` });
      displayRows.push(display);
      continue;
    }
    const variant = variants[0];
    Object.assign(display, {
      sourceVariantId: variant.id,
      sourceUnitCode: variant.unit_code,
      productCode: variant.product_code,
      productName: variant.product_name,
      baseVariantId: variant.base_variant_id,
      baseSku: variant.base_sku,
      lotTrackingMode: variant.lot_tracking_mode ?? null,
      expiryTrackingMode: variant.expiry_tracking_mode ?? null,
      locationRequired: variant.location_required === true,
    });

    if (!policyAvailable) {
      rowErrors.push({
        lineNumber: row.lineNumber,
        code: 'INVENTORY_POLICY_UNAVAILABLE',
        message: `SKU ${row.sku}: Chưa xác định chính sách quản lý tồn.`,
      });
      displayRows.push(display);
      continue;
    }
    if (variant.is_inventory_managed !== true) {
      rowErrors.push({
        lineNumber: row.lineNumber,
        code: 'SKU_NOT_INVENTORY_MANAGED',
        message: `SKU ${row.sku}: Mã hàng này không quản lý tồn nên không dùng Nhập kho thủ công.`,
      });
      displayRows.push(display);
      continue;
    }
    if (!variant.base_variant_id) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'BASE_VARIANT_NOT_AVAILABLE', message: `SKU ${row.sku}: Chưa có đơn vị tồn kho cơ sở.` });
      displayRows.push(display);
      continue;
    }
    if (variant.conversion_to_base === null || variant.conversion_to_base === undefined) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'CONVERSION_NOT_CONFIGURED', message: `SKU ${row.sku}: Chưa có quy đổi về đơn vị tồn kho.` });
      displayRows.push(display);
      continue;
    }
    if (!variant.allows_fractional && row.sourceQuantityScaled % SCALE_6 !== 0n) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'FRACTIONAL_QUANTITY_NOT_ALLOWED', message: `SKU ${row.sku}: Đơn vị này không nhận số lượng lẻ.` });
      displayRows.push(display);
      continue;
    }
    if (!variant.lot_tracking_mode || !variant.expiry_tracking_mode || variant.location_required === null || variant.location_required === undefined) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'TRACKING_POLICY_NOT_FOUND', message: `SKU ${row.sku}: Chưa cấu hình chính sách lô, hạn dùng hoặc vị trí.` });
      displayRows.push(display);
      continue;
    }

    let location = null;
    if (row.locationCode) {
      location = locationMap.get(row.locationCode) ?? null;
      if (!location) {
        display.requiredFields.push('LOCATION');
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOCATION_NOT_FOUND', message: `Dòng ${row.lineNumber}: Vị trí ${row.locationCode} không có trong kho ${warehouse.code}.` });
      } else {
        Object.assign(display, { locationId: location.id, locationCode: location.code, locationName: location.name });
      }
    }
    if (variant.location_required && !location) {
      if (!display.requiredFields.includes('LOCATION')) display.requiredFields.push('LOCATION');
      rowErrors.push({ lineNumber: row.lineNumber, code: 'LOCATION_REQUIRED', message: `SKU ${row.sku}: Cần chọn vị trí kho.` });
    }

    if (variant.lot_tracking_mode === 'NONE') {
      if (row.lotCode || row.expiryDate || row.manufacturedDate || row.supplierLotReference) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_NOT_ALLOWED', message: `SKU ${row.sku}: Mã hàng này không quản lý theo lô; hãy bỏ thông tin lô và hạn dùng.` });
      }
    } else if (!row.lotCode) {
      display.requiredFields.push('LOT');
      rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_REQUIRED', message: `SKU ${row.sku}: Cần nhập mã lô.` });
    }

    if (variant.expiry_tracking_mode === 'REQUIRED' && !row.expiryDate) {
      display.requiredFields.push('EXPIRY');
      rowErrors.push({ lineNumber: row.lineNumber, code: 'EXPIRY_REQUIRED', message: `SKU ${row.sku}: Cần nhập hạn sử dụng.` });
    }
    if (variant.expiry_tracking_mode === 'NONE' && row.expiryDate) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'EXPIRY_NOT_ALLOWED', message: `SKU ${row.sku}: Mã hàng này không quản lý hạn sử dụng.` });
    }

    if (row.lotCode) {
      const existingLot = await lotRepository.getInventoryLotByIdentity(client, {
        installationId: requestContext.installationId,
        baseVariantId: variant.base_variant_id,
        normalizedLotCode: row.lotCode,
      });
      if (existingLot && row.expiryDate && canonicalDate(existingLot.expiry_date) !== row.expiryDate) {
        if (!display.requiredFields.includes('EXPIRY')) display.requiredFields.push('EXPIRY');
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_EXPIRY_MISMATCH', message: `SKU ${row.sku}: Hạn sử dụng không khớp với lô đã có.` });
      }
    }

    let resolvedCost = row.unitCost;
    let costSource = row.unitCost ? 'ENTERED' : null;
    if (!resolvedCost) {
      resolvedCost = await currentCost(client, requestContext.installationId, body.warehouseId, variant.base_variant_id);
      if (resolvedCost) costSource = 'CURRENT';
    }
    if (!resolvedCost) {
      display.requiredFields.push('COST');
      rowErrors.push({ lineNumber: row.lineNumber, code: 'UNIT_COST_REQUIRED', message: `SKU ${row.sku}: Cần nhập giá vốn.` });
    }
    Object.assign(display, { unitCost: resolvedCost, costSource });

    const multiplication = inventoryLedgerInternals.multiplyToBase(
      formatScaled6(row.sourceQuantityScaled),
      String(variant.conversion_to_base),
      'IN',
    );
    if (!multiplication.ok) {
      rowErrors.push({ lineNumber: row.lineNumber, code: multiplication.code, message: `SKU ${row.sku}: Không quy đổi được số lượng về đơn vị tồn kho.` });
    } else {
      Object.assign(display, { baseQuantity: multiplication.baseQuantityDelta });
    }

    const ownErrors = rowErrors.some((error) => error.lineNumber === row.lineNumber);
    display.status = ownErrors ? 'NEEDS_ATTENTION' : 'READY';
    displayRows.push(display);
  }

  return Object.freeze({
    ok: true,
    preview: Object.freeze({
      ready: rowErrors.length === 0,
      warehouse: Object.freeze({ id: warehouse.id, code: warehouse.code, name: warehouse.name }),
      header: Object.freeze({
        inboundType: body.inboundType,
        documentDate: body.documentDate,
        referenceNumber: body.referenceNumber,
        note: body.note,
      }),
      rowErrors: Object.freeze(rowErrors),
      rows: Object.freeze(displayRows),
      totals: Object.freeze({
        inputRowCount: body.inputRowCount,
        previewRowCount: body.rows.length,
        mergedDuplicateCount: body.inputRowCount - body.rows.length,
        sourceQuantityTotal: formatScaled6(totalQuantityScaled),
        readyRowCount: displayRows.filter((row) => row.status === 'READY').length,
        attentionRowCount: displayRows.filter((row) => row.status !== 'READY').length,
      }),
      stockUnchanged: true,
    }),
  });
}

export const manualInboundPreparationInternals = Object.freeze({
  normalizePreviewPayload,
  formatScaled6,
});
