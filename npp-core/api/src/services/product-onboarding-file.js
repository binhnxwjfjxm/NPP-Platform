import * as fileOperationService from './file-operations.js';
import * as productUnitService from './product-unit.js';
import * as inventoryLotService from './inventory-lots.js';

export const PRODUCT_ONBOARDING_FILE_COLUMNS = Object.freeze([
  ...fileOperationService.PRODUCT_FILE_COLUMNS,
  'unitCode',
  'conversionToBase',
  'lotTrackingMode',
  'expiryTrackingMode',
  'locationRequired',
]);

const DECIMAL_6 = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/;

function failure(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, details });
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function canonicalDecimal(value) {
  const normalized = text(value);
  if (!DECIMAL_6.test(normalized) || /^0(?:\.0+)?$/.test(normalized)) return null;
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/0+$/, '').replace(/\.$/, '');
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  const normalized = upper(value);
  if (['TRUE', '1', 'YES', 'Y', 'CO', 'CÓ'].includes(normalized)) return true;
  if (['FALSE', '0', 'NO', 'N', 'KHONG', 'KHÔNG'].includes(normalized)) return false;
  return null;
}

function lotMode(value) {
  const normalized = upper(value);
  if (['REQUIRED', 'CO', 'CÓ', 'THEO LO', 'THEO LÔ'].includes(normalized)) return 'REQUIRED';
  if (['NONE', 'KHONG', 'KHÔNG', 'KHONG THEO LO', 'KHÔNG THEO LÔ'].includes(normalized)) return 'NONE';
  return null;
}

function expiryMode(value) {
  const normalized = upper(value);
  if (['REQUIRED', 'BAT BUOC', 'BẮT BUỘC'].includes(normalized)) return 'REQUIRED';
  if (['OPTIONAL', 'TUY CHON', 'TÙY CHỌN', 'CO THE NHAP', 'CÓ THỂ NHẬP'].includes(normalized)) return 'OPTIONAL';
  if (['NONE', 'KHONG', 'KHÔNG'].includes(normalized)) return 'NONE';
  return null;
}

export function normalizeProductOnboardingRows(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows)) {
    return failure('INVALID_PRODUCT_ONBOARDING_FILE', 'File sản phẩm phải chứa danh sách rows.');
  }

  const rows = [];
  for (let index = 0; index < payload.rows.length; index += 1) {
    const raw = payload.rows[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return failure('INVALID_PRODUCT_ONBOARDING_ROW', `Dòng ${index + 2} không hợp lệ.`);
    }
    const productCode = upper(raw.productCode);
    const sku = upper(raw.sku);
    const hasOnboardingData = ['unitCode', 'conversionToBase', 'lotTrackingMode', 'expiryTrackingMode', 'locationRequired']
      .some((key) => text(raw[key]) !== '');
    if (!sku) {
      if (hasOnboardingData) return failure('ONBOARDING_WITHOUT_SKU', `Dòng ${index + 2}: cấu hình kho chỉ áp dụng khi có SKU.`);
      rows.push(Object.freeze({ productCode, sku: '', isInventoryBase: false }));
      continue;
    }

    const unitCode = upper(raw.unitCode);
    if (!unitCode) return failure('UNIT_CODE_REQUIRED', `Dòng ${index + 2}: SKU ${sku} cần unitCode.`);
    const conversionToBase = canonicalDecimal(raw.conversionToBase);
    if (!conversionToBase) return failure('CONVERSION_REQUIRED', `Dòng ${index + 2}: SKU ${sku} cần conversionToBase lớn hơn 0, tối đa 6 số lẻ.`);
    const isInventoryBase = booleanValue(raw.isInventoryBase);
    if (isInventoryBase === null) return failure('INVALID_INVENTORY_BASE', `Dòng ${index + 2}: isInventoryBase phải là TRUE/FALSE.`);

    let normalizedLotMode = null;
    let normalizedExpiryMode = null;
    let locationRequired = null;
    if (isInventoryBase) {
      if (conversionToBase !== '1') return failure('INVALID_BASE_CONVERSION', `Dòng ${index + 2}: SKU tồn chuẩn ${sku} phải có conversionToBase = 1.`);
      normalizedLotMode = lotMode(raw.lotTrackingMode);
      normalizedExpiryMode = expiryMode(raw.expiryTrackingMode);
      locationRequired = booleanValue(raw.locationRequired);
      if (!normalizedLotMode) return failure('LOT_TRACKING_MODE_REQUIRED', `Dòng ${index + 2}: chọn quản lý lô cho SKU tồn chuẩn ${sku}.`);
      if (!normalizedExpiryMode) return failure('EXPIRY_TRACKING_MODE_REQUIRED', `Dòng ${index + 2}: chọn chính sách hạn dùng cho SKU tồn chuẩn ${sku}.`);
      if (locationRequired === null) return failure('LOCATION_POLICY_REQUIRED', `Dòng ${index + 2}: locationRequired phải là TRUE/FALSE.`);
      if (normalizedExpiryMode !== 'NONE' && normalizedLotMode !== 'REQUIRED') {
        return failure('TRACKING_POLICY_CONFLICT', `Dòng ${index + 2}: quản lý hạn dùng yêu cầu SKU ${sku} phải quản lý theo lô.`);
      }
    } else if (text(raw.lotTrackingMode) || text(raw.expiryTrackingMode) || text(raw.locationRequired)) {
      return failure('TRACKING_POLICY_BASE_ONLY', `Dòng ${index + 2}: chính sách lô/hạn dùng/vị trí chỉ khai báo trên SKU tồn chuẩn.`);
    }

    rows.push(Object.freeze({
      productCode,
      sku,
      unitCode,
      conversionToBase,
      isInventoryBase,
      lotTrackingMode: normalizedLotMode,
      expiryTrackingMode: normalizedExpiryMode,
      locationRequired,
    }));
  }
  return Object.freeze({ ok: true, rows: Object.freeze(rows) });
}

async function onboardingSnapshot(client, installationId, skus) {
  if (!skus.length) return new Map();
  const result = await client.query(
    `SELECT pv.id,
            pv.product_id,
            pv.sku,
            pv.is_inventory_base,
            pv.is_purchasable,
            p.code AS product_code,
            unit.code AS unit_code,
            pv.conversion_to_base::text AS conversion_to_base,
            policy.lot_tracking_mode,
            policy.expiry_tracking_mode,
            policy.location_required,
            policy.version AS policy_version
       FROM shared.product_variants pv
       JOIN shared.products p
         ON p.installation_id = pv.installation_id
        AND p.id = pv.product_id
       LEFT JOIN shared.units_of_measure unit
         ON unit.installation_id = pv.installation_id
        AND unit.id = pv.unit_id
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = pv.installation_id
        AND policy.base_variant_id = pv.id
      WHERE pv.installation_id = $1
        AND upper(pv.sku) = ANY($2::text[])`,
    [installationId, skus],
  );
  return new Map((result.rows ?? []).map((row) => [upper(row.sku), row]));
}

async function unitMap(client, installationId, codes) {
  if (!codes.length) return new Map();
  const result = await client.query(
    `SELECT id, code, is_active
       FROM shared.units_of_measure
      WHERE installation_id = $1
        AND upper(code) = ANY($2::text[])`,
    [installationId, codes],
  );
  return new Map((result.rows ?? []).map((row) => [upper(row.code), row]));
}

export async function exportProductOnboardingRows(client, { requestContext, format = 'tabular' }) {
  const base = await fileOperationService.exportProductRows(client, { requestContext, format });
  if (!base.ok) return base;
  const skus = [...new Set(base.rows.map((row) => upper(row.sku)).filter(Boolean))];
  const snapshot = await onboardingSnapshot(client, requestContext.installationId, skus);
  const rows = base.rows.map((row) => {
    const info = snapshot.get(upper(row.sku));
    const inventoryBase = info?.is_inventory_base === true;
    return Object.freeze({
      ...row,
      unitCode: info?.unit_code ?? '',
      conversionToBase: info?.conversion_to_base ?? '',
      lotTrackingMode: inventoryBase ? info?.lot_tracking_mode ?? '' : '',
      expiryTrackingMode: inventoryBase ? info?.expiry_tracking_mode ?? '' : '',
      locationRequired: inventoryBase && info?.policy_version != null ? info.location_required === true : '',
    });
  });
  return Object.freeze({ ...base, columns: PRODUCT_ONBOARDING_FILE_COLUMNS, rows: Object.freeze(rows) });
}

export async function importProductOnboardingRows(client, { requestContext, payload }) {
  const normalized = normalizeProductOnboardingRows(payload);
  if (!normalized.ok) return normalized;

  const base = await fileOperationService.importProductRows(client, { requestContext, payload });
  if (!base.ok) return base;

  const onboardingRows = normalized.rows.filter((row) => row.sku);
  if (!onboardingRows.length) return Object.freeze({ ...base, onboarding: { variantsConfigured: 0, policiesConfigured: 0 } });

  const unitCodes = [...new Set(onboardingRows.map((row) => row.unitCode))];
  const units = await unitMap(client, requestContext.installationId, unitCodes);
  for (const code of unitCodes) {
    const unit = units.get(code);
    if (!unit || !unit.is_active) return failure('UNIT_NOT_FOUND', `Đơn vị ${code} không tồn tại hoặc không hoạt động.`, 404);
  }

  const skus = [...new Set(onboardingRows.map((row) => row.sku))];
  let variants = await onboardingSnapshot(client, requestContext.installationId, skus);
  let variantsConfigured = 0;
  for (const row of onboardingRows) {
    const variant = variants.get(row.sku);
    if (!variant) return failure('VARIANT_NOT_FOUND', `SKU ${row.sku} không tồn tại sau import.`, 404);
    if (upper(variant.product_code) !== row.productCode) {
      return failure('VARIANT_PRODUCT_MISMATCH', `SKU ${row.sku} không thuộc sản phẩm ${row.productCode}.`, 409);
    }
    if (variant.is_inventory_base !== row.isInventoryBase) {
      return failure('BASE_VARIANT_MISMATCH', `Trạng thái SKU tồn chuẩn của ${row.sku} không khớp dữ liệu import.`, 409);
    }
    const assigned = await productUnitService.assignVariantUnit(client, {
      installationId: requestContext.installationId,
      productId: variant.product_id,
      variantId: variant.id,
      payload: {
        unitId: units.get(row.unitCode).id,
        conversionToBase: row.conversionToBase,
        isPurchasable: variant.is_purchasable !== false,
        sourceMetadata: { source: 'product-file-onboarding' },
      },
      updatedBy: requestContext.actorId,
      requireExpected: false,
    });
    if (!assigned.ok) return assigned;
    variantsConfigured += 1;
  }

  variants = await onboardingSnapshot(client, requestContext.installationId, skus);
  let policiesConfigured = 0;
  for (const row of onboardingRows.filter((item) => item.isInventoryBase)) {
    const variant = variants.get(row.sku);
    if (!variant) return failure('VARIANT_NOT_FOUND', `SKU tồn chuẩn ${row.sku} không tồn tại sau import.`, 404);
    const policy = await inventoryLotService.upsertInventoryTrackingPolicy(client, {
      requestContext,
      payload: {
        baseVariantId: variant.id,
        lotTrackingMode: row.lotTrackingMode,
        expiryTrackingMode: row.expiryTrackingMode,
        locationRequired: row.locationRequired,
        ...(variant.policy_version == null ? {} : { expectedVersion: Number(variant.policy_version) }),
        metadata: { source: 'product-file-onboarding' },
      },
    });
    if (!policy.ok) return policy;
    policiesConfigured += 1;
  }

  return Object.freeze({
    ...base,
    onboarding: Object.freeze({ variantsConfigured, policiesConfigured }),
  });
}
