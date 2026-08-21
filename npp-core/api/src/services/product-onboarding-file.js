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

async function activeProductVariantSnapshot(client, installationId, productCodes) {
  if (!productCodes.length) return [];
  const result = await client.query(
    `SELECT p.code AS product_code,
            pv.id,
            pv.product_id,
            pv.sku,
            pv.name AS sku_name,
            pv.variant_kind,
            pv.is_inventory_base,
            pv.is_sellable,
            pv.is_catalog_visible,
            pv.is_active,
            unit.code AS unit_code,
            pv.conversion_to_base::text AS conversion_to_base,
            policy.lot_tracking_mode,
            policy.expiry_tracking_mode,
            policy.location_required,
            policy.version AS policy_version
       FROM shared.products p
       JOIN shared.product_variants pv
         ON pv.installation_id = p.installation_id
        AND pv.product_id = p.id
       LEFT JOIN shared.units_of_measure unit
         ON unit.installation_id = pv.installation_id
        AND unit.id = pv.unit_id
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = pv.installation_id
        AND policy.base_variant_id = pv.id
      WHERE p.installation_id = $1
        AND upper(p.code) = ANY($2::text[])
        AND pv.is_active = true
      ORDER BY p.code ASC, pv.sku ASC`,
    [installationId, productCodes],
  );
  return result.rows ?? [];
}

function activeBaseTargets(rows, sourceRowCount = rows.length) {
  const byProduct = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const productCode = upper(row.productCode);
    const sku = upper(row.sku);
    if (!productCode || !sku) continue;
    if (booleanValue(row.isInventoryBase) !== true || booleanValue(row.isActive) !== true) continue;
    const list = byProduct.get(productCode) ?? [];
    list.push(Object.freeze({ sku, row: index < sourceRowCount ? index + 2 : null }));
    byProduct.set(productCode, list);
  }
  return byProduct;
}

async function expandIncrementalProductPayload(client, installationId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows)) {
    return Object.freeze({ ok: true, payload, sourceRowCount: 0, activeBaseTargets: new Map() });
  }

  const sourceRows = payload.rows;
  const templates = new Map();
  const incomingSkus = new Map();
  for (const raw of sourceRows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const productCode = upper(raw.productCode);
    const sku = upper(raw.sku);
    if (!productCode) continue;
    if (!templates.has(productCode)) templates.set(productCode, raw);
    if (sku) {
      const set = incomingSkus.get(productCode) ?? new Set();
      set.add(sku);
      incomingSkus.set(productCode, set);
    }
  }

  const requestedBaseTargets = activeBaseTargets(sourceRows, sourceRows.length);
  for (const [productCode, targets] of requestedBaseTargets) {
    const uniqueSkus = [...new Set(targets.map((item) => item.sku))];
    if (uniqueSkus.length > 1) {
      return failure(
        'ACTIVE_INVENTORY_BASE_CONFLICT',
        `Sản phẩm ${productCode} chỉ được có một SKU tồn chuẩn đang hoạt động.`,
        409,
        { productCode, skus: uniqueSkus, rows: targets.map((item) => item.row).filter(Boolean) },
      );
    }
  }

  const productCodes = [...templates.keys()];
  const existingRows = await activeProductVariantSnapshot(client, installationId, productCodes);
  const expandedRows = [...sourceRows];
  for (const existing of existingRows) {
    const productCode = upper(existing.product_code);
    const sku = upper(existing.sku);
    const template = templates.get(productCode);
    if (!template || incomingSkus.get(productCode)?.has(sku)) continue;

    const targetSku = requestedBaseTargets.get(productCode)?.[0]?.sku ?? null;
    const finalInventoryBase = targetSku ? targetSku === sku : existing.is_inventory_base === true;
    if (!existing.unit_code || !existing.conversion_to_base) {
      return failure(
        'EXISTING_SKU_CONFIGURATION_INCOMPLETE',
        `SKU ${sku} của sản phẩm ${productCode} đang thiếu đơn vị tính hoặc hệ số quy đổi. Hãy hoàn thiện quy cách SKU rồi nhập lại file.`,
        409,
        { productCode, sku },
      );
    }
    if (finalInventoryBase && existing.policy_version == null) {
      return failure(
        'EXISTING_TRACKING_POLICY_INCOMPLETE',
        `SKU tồn chuẩn ${sku} của sản phẩm ${productCode} đang thiếu cấu hình lô/hạn dùng/vị trí. Hãy hoàn thiện cấu hình rồi nhập lại file.`,
        409,
        { productCode, sku },
      );
    }

    expandedRows.push(Object.freeze({
      ...template,
      sku,
      skuName: existing.sku_name,
      variantKind: existing.variant_kind,
      isInventoryBase: finalInventoryBase,
      isSellable: existing.is_sellable === true,
      isCatalogVisible: existing.is_catalog_visible === true,
      isActive: true,
      unitCode: existing.unit_code,
      conversionToBase: existing.conversion_to_base,
      lotTrackingMode: finalInventoryBase ? existing.lot_tracking_mode : '',
      expiryTrackingMode: finalInventoryBase ? existing.expiry_tracking_mode : '',
      locationRequired: finalInventoryBase ? existing.location_required === true : '',
    }));
  }

  return Object.freeze({
    ok: true,
    payload: Object.freeze({ ...payload, rows: Object.freeze(expandedRows) }),
    sourceRowCount: sourceRows.length,
    activeBaseTargets: requestedBaseTargets,
  });
}

function preflightUnitAssignments(rows, sourceRowCount) {
  const assignments = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const productCode = upper(row.productCode);
    const sku = upper(row.sku);
    const unitCode = upper(row.unitCode);
    if (!productCode || !sku || !unitCode || booleanValue(row.isActive) !== true) continue;
    const key = `${productCode}\u0000${unitCode}`;
    const existing = assignments.get(key);
    if (!existing) {
      assignments.set(key, Object.freeze({ sku, row: index < sourceRowCount ? index + 2 : null }));
      continue;
    }
    if (existing.sku === sku) continue;
    return failure(
      'PRODUCT_UNIT_CONFLICT',
      `Sản phẩm ${productCode} đang gán đơn vị ${unitCode} cho nhiều SKU hoạt động (${existing.sku}, ${sku}). Mỗi đơn vị chỉ được gán cho một SKU hoạt động của cùng sản phẩm.`,
      409,
      {
        productCode,
        unitCode,
        skus: [existing.sku, sku],
        rows: [existing.row, index < sourceRowCount ? index + 2 : null].filter(Boolean),
      },
    );
  }
  return Object.freeze({ ok: true });
}

async function neutralizeTransientVariantConstraints(client, installationId, productCodes, baseTargets, updatedBy) {
  if (!productCodes.length) return;
  await client.query(
    `UPDATE shared.product_variants pv
        SET unit_id = NULL,
            conversion_to_base = NULL,
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), pv.updated_at + interval '1 millisecond'),
            updated_by = $3
       FROM shared.products p
      WHERE p.installation_id = $1
        AND pv.installation_id = p.installation_id
        AND pv.product_id = p.id
        AND upper(p.code) = ANY($2::text[])
        AND pv.unit_id IS NOT NULL`,
    [installationId, productCodes, updatedBy],
  );

  for (const [productCode, targets] of baseTargets) {
    const targetSku = targets[0]?.sku;
    if (!targetSku) continue;
    await client.query(
      `UPDATE shared.product_variants pv
          SET is_inventory_base = false,
              updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), pv.updated_at + interval '1 millisecond'),
              updated_by = $4
         FROM shared.products p
        WHERE p.installation_id = $1
          AND p.code = $2
          AND pv.installation_id = p.installation_id
          AND pv.product_id = p.id
          AND pv.is_active = true
          AND pv.is_inventory_base = true
          AND pv.sku <> $3`,
      [installationId, productCode, targetSku, updatedBy],
    );
  }
}

function mapProductImportDatabaseError(error, requestContext) {
  const sqlState = text(error?.code);
  if (!sqlState.startsWith('23')) return null;
  const constraint = text(error?.constraint);
  console.error(JSON.stringify({
    event: 'product_import_integrity_conflict',
    requestId: text(requestContext?.requestId) || null,
    sqlState,
    constraint: constraint || null,
    table: text(error?.table) || null,
  }));

  if (constraint.includes('product_variants_one_active_unit_per_product_idx')) {
    return failure('PRODUCT_UNIT_CONFLICT', 'Một đơn vị tính đang được gán cho nhiều SKU hoạt động của cùng sản phẩm. Hãy kiểm tra lại cột Đơn vị tính.', 409, {
      conflictCode: 'DUPLICATE_ACTIVE_PRODUCT_UNIT',
      reason: 'ACTIVE_UNIT_ALREADY_ASSIGNED',
    });
  }
  if (constraint.includes('product_variants_one_active_inventory_base_idx')) {
    return failure('ACTIVE_INVENTORY_BASE_CONFLICT', 'Một sản phẩm chỉ được có một SKU tồn chuẩn đang hoạt động. Hãy kiểm tra lại cột Tồn chuẩn.', 409, {
      conflictCode: 'MULTIPLE_ACTIVE_INVENTORY_BASE',
      reason: 'ACTIVE_INVENTORY_BASE_ALREADY_EXISTS',
    });
  }
  if (constraint.includes('product_variants_sku_installation_unique')) {
    return failure('DUPLICATE_SKU', 'SKU trong file đã thuộc một sản phẩm khác. Hãy kiểm tra lại cột SKU.', 409, {
      conflictCode: 'SKU_ALREADY_EXISTS',
      reason: 'SKU_IDENTITY_CONFLICT',
    });
  }
  if (constraint.includes('products_code_installation_unique')) {
    return failure('DUPLICATE_PRODUCT_CODE', 'Mã sản phẩm trong file đang xung đột với dữ liệu hiện có. Hãy kiểm tra lại cột Mã SP.', 409, {
      conflictCode: 'PRODUCT_CODE_ALREADY_EXISTS',
      reason: 'PRODUCT_IDENTITY_CONFLICT',
    });
  }
  if (sqlState === '23514') {
    return failure('PRODUCT_IMPORT_RULE_CONFLICT', 'Dữ liệu quy cách SKU không thỏa quy tắc sản phẩm. Hãy kiểm tra Tồn chuẩn, Đơn vị tính và Hệ số quy đổi.', 409, {
      conflictCode: 'PRODUCT_RULE_CONFLICT',
      reason: 'DATABASE_CHECK_CONSTRAINT',
    });
  }
  if (sqlState === '23503') {
    return failure('PRODUCT_IMPORT_REFERENCE_CONFLICT', 'Dữ liệu sản phẩm đang tham chiếu tới cấu hình không còn tồn tại hoặc không còn hiệu lực. Hãy tải lại dữ liệu rồi kiểm tra đơn vị/nhóm/nhãn hàng.', 409, {
      conflictCode: 'REFERENCE_CONFLICT',
      reason: 'DATABASE_REFERENCE_CONSTRAINT',
    });
  }
  return failure('PRODUCT_IMPORT_DATA_CONFLICT', 'Dữ liệu trong file xung đột với dữ liệu sản phẩm hiện có. Hệ thống đã dừng toàn bộ lần nhập này; hãy kiểm tra các dòng được chọn rồi thử lại.', 409, {
    conflictCode: 'PRODUCT_DATA_CONFLICT',
    reason: 'DATABASE_INTEGRITY_CONSTRAINT',
  });
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
  try {
    const expanded = await expandIncrementalProductPayload(client, requestContext.installationId, payload);
    if (!expanded.ok) return expanded;

    const normalized = normalizeProductOnboardingRows(expanded.payload);
    if (!normalized.ok) return normalized;

    const unitPreflight = preflightUnitAssignments(expanded.payload.rows, expanded.sourceRowCount);
    if (!unitPreflight.ok) return unitPreflight;

    const onboardingRows = normalized.rows.filter((row) => row.sku);
    const unitCodes = [...new Set(onboardingRows.map((row) => row.unitCode))];
    const units = await unitMap(client, requestContext.installationId, unitCodes);
    for (const code of unitCodes) {
      const unit = units.get(code);
      if (!unit || !unit.is_active) return failure('UNIT_NOT_FOUND', `Đơn vị ${code} không tồn tại hoặc không hoạt động.`, 404);
    }

    if (onboardingRows.length) {
      const productCodes = [...new Set(onboardingRows.map((row) => row.productCode).filter(Boolean))];
      await neutralizeTransientVariantConstraints(
        client,
        requestContext.installationId,
        productCodes,
        expanded.activeBaseTargets,
        requestContext.actorId,
      );
    }

    const base = await fileOperationService.importProductRows(client, { requestContext, payload: expanded.payload });
    if (!base.ok) return base;

    if (!onboardingRows.length) return Object.freeze({ ...base, onboarding: { variantsConfigured: 0, policiesConfigured: 0 } });

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
  } catch (error) {
    const mapped = mapProductImportDatabaseError(error, requestContext);
    if (mapped) return mapped;
    throw error;
  }
}
