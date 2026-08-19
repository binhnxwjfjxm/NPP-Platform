import * as adjustmentRepository from '../db/repositories/inventory-adjustment.js';
import { createAdjustment } from './inventory-adjustment.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/;
const SCALE_6 = 1_000_000n;
const SCALE_12 = 1_000_000_000_000n;
const MAX_ROWS = 200;

function failure(code, message, details = {}, retryable = false) {
  return Object.freeze({ ok: false, code, message, details, retryable });
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function parseScaled(value, scaleDigits, { allowZero = true } = {}) {
  const normalized = String(value ?? '').trim();
  const pattern = scaleDigits === 6
    ? QUANTITY_PATTERN
    : /^(?:-?(?:0|[1-9]\d{0,29}))(?:\.\d{1,12})?$/;
  if (!pattern.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ''] = unsigned.split('.');
  const scale = scaleDigits === 6 ? SCALE_6 : SCALE_12;
  const scaled = BigInt(whole) * scale + BigInt(fraction.padEnd(scaleDigits, '0'));
  const signed = negative ? -scaled : scaled;
  if (!allowZero && signed === 0n) return null;
  return signed;
}

function formatScaled(value, scaleDigits) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = scaleDigits === 6 ? SCALE_6 : SCALE_12;
  const whole = absolute / scale;
  const fraction = String(absolute % scale).padStart(scaleDigits, '0').replace(/0+$/, '');
  const formatted = fraction ? `${whole}.${fraction}` : String(whole);
  return negative && absolute !== 0n ? `-${formatted}` : formatted;
}

function signedScaled(value) {
  const formatted = formatScaled(value, 12);
  return value > 0n ? `+${formatted}` : formatted;
}

function normalizeBulkRows(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Dữ liệu điều chỉnh tồn hàng loạt không hợp lệ.');
  }
  const warehouseId = text(payload.warehouseId, 64);
  if (!warehouseId || !UUID_PATTERN.test(warehouseId)) {
    return failure('INVALID_WAREHOUSE_ID', 'Hãy chọn kho cần điều chỉnh.');
  }
  if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > MAX_ROWS) {
    return failure('INVALID_ROWS', `Mỗi lần kiểm tra cần từ 1 đến ${MAX_ROWS} dòng.`);
  }

  const rows = payload.rows.map((source, index) => {
    const lineNumber = Number.isInteger(source?.lineNumber) && source.lineNumber > 0
      ? source.lineNumber
      : index + 2;
    const errors = [];
    const sku = text(source?.sku, 96)?.toUpperCase() ?? '';
    if (!sku) errors.push({ code: 'SKU_REQUIRED', message: `Dòng ${lineNumber}: Thiếu SKU.` });
    const actualScaled6 = parseScaled(source?.actualQuantity, 6);
    if (actualScaled6 === null) {
      errors.push({ code: 'INVALID_ACTUAL_QUANTITY', message: `Dòng ${lineNumber}: Tồn thực tế không hợp lệ.` });
    }
    const locationCodeRaw = source?.locationCode === undefined || source?.locationCode === null || String(source.locationCode).trim() === ''
      ? null
      : text(source.locationCode, 64);
    if (source?.locationCode && !locationCodeRaw) {
      errors.push({ code: 'INVALID_LOCATION_CODE', message: `Dòng ${lineNumber}: Mã vị trí quá dài hoặc không hợp lệ.` });
    }
    const lotCodeRaw = source?.lotCode === undefined || source?.lotCode === null || String(source.lotCode).trim() === ''
      ? null
      : text(source.lotCode, 100);
    if (source?.lotCode && !lotCodeRaw) {
      errors.push({ code: 'INVALID_LOT_CODE', message: `Dòng ${lineNumber}: Mã lô quá dài hoặc không hợp lệ.` });
    }
    return {
      lineNumber,
      sku,
      actualQuantity: actualScaled6 === null ? String(source?.actualQuantity ?? '').trim() : formatScaled(actualScaled6, 6),
      actualScaled6,
      locationCode: locationCodeRaw?.toUpperCase() ?? null,
      lotCode: lotCodeRaw?.toUpperCase() ?? null,
      errors,
    };
  });

  const counts = new Map();
  for (const row of rows) {
    if (!row.sku) continue;
    const key = [row.sku, row.locationCode ?? '', row.lotCode ?? ''].join('\u001f');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (!row.sku) continue;
    const key = [row.sku, row.locationCode ?? '', row.lotCode ?? ''].join('\u001f');
    if ((counts.get(key) ?? 0) > 1) {
      row.errors.push({
        code: 'DUPLICATE_ROW',
        message: `Dòng ${row.lineNumber}: SKU bị lặp trong cùng Lô/Vị trí. Hãy giữ một dòng cho mỗi phạm vi tồn.`,
      });
    }
  }

  return Object.freeze({ ok: true, warehouseId, rows });
}

async function loadSkuMap(client, installationId, skus) {
  if (skus.length === 0) return new Map();
  const result = await client.query(
    `SELECT source.id AS source_variant_id,
            source.sku,
            source.product_id,
            source.unit_id AS source_unit_id,
            source.conversion_to_base,
            source_unit.code AS source_unit_code,
            product.code AS product_code,
            product.name AS product_name,
            base.id AS base_variant_id,
            base.sku AS base_sku,
            base.unit_id AS base_unit_id,
            base_unit.code AS base_unit_code,
            COALESCE(policy.lot_tracking_mode, 'NONE') AS lot_tracking_mode
       FROM shared.product_variants source
       JOIN shared.products product
         ON product.installation_id = source.installation_id
        AND product.id = source.product_id
       LEFT JOIN shared.units_of_measure source_unit
         ON source_unit.installation_id = source.installation_id
        AND source_unit.id = source.unit_id
        AND source_unit.is_active = true
       LEFT JOIN shared.product_variants base
         ON base.installation_id = source.installation_id
        AND base.product_id = source.product_id
        AND base.is_inventory_base = true
        AND base.is_active = true
       LEFT JOIN shared.units_of_measure base_unit
         ON base_unit.installation_id = base.installation_id
        AND base_unit.id = base.unit_id
        AND base_unit.is_active = true
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = base.installation_id
        AND policy.base_variant_id = base.id
      WHERE source.installation_id = $1
        AND upper(source.sku) = ANY($2::text[])
        AND source.is_active = true
        AND product.is_active = true
      ORDER BY upper(source.sku), source.id`,
    [installationId, skus],
  );
  const map = new Map();
  for (const row of result.rows ?? []) {
    const key = String(row.sku ?? '').trim().toUpperCase();
    const entries = map.get(key) ?? [];
    entries.push(row);
    map.set(key, entries);
  }
  return map;
}

async function loadBalanceMap(client, installationId, warehouseId, baseVariantIds) {
  if (baseVariantIds.length === 0) return new Map();
  const result = await client.query(
    `SELECT balance.base_variant_id,
            balance.location_id,
            location.code AS location_code,
            location.name AS location_name,
            balance.lot_id,
            lot.lot_code,
            COALESCE(balance.on_hand_quantity, 0)::numeric(30,12) AS on_hand_quantity
       FROM inventory.inventory_balances balance
       JOIN shared.warehouse_locations location
         ON location.installation_id = balance.installation_id
        AND location.warehouse_id = balance.warehouse_id
        AND location.id = balance.location_id
        AND location.is_active = true
       LEFT JOIN inventory.inventory_lots lot
         ON lot.installation_id = balance.installation_id
        AND lot.id = balance.lot_id
      WHERE balance.installation_id = $1
        AND balance.warehouse_id = $2
        AND balance.base_variant_id = ANY($3::uuid[])
      ORDER BY balance.base_variant_id, location.code, lot.lot_code NULLS FIRST`,
    [installationId, warehouseId, baseVariantIds],
  );
  const map = new Map();
  for (const row of result.rows ?? []) {
    const entries = map.get(row.base_variant_id) ?? [];
    entries.push(row);
    map.set(row.base_variant_id, entries);
  }
  return map;
}

async function loadLocationMap(client, installationId, warehouseId, locationCodes) {
  if (locationCodes.length === 0) return new Map();
  const result = await client.query(
    `SELECT id, code, name
       FROM shared.warehouse_locations
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND upper(code) = ANY($3::text[])
        AND is_active = true
      ORDER BY code, id`,
    [installationId, warehouseId, locationCodes],
  );
  return new Map((result.rows ?? []).map((row) => [String(row.code).trim().toUpperCase(), row]));
}

async function loadLotMap(client, installationId, baseVariantIds, lotCodes) {
  if (baseVariantIds.length === 0 || lotCodes.length === 0) return new Map();
  const result = await client.query(
    `SELECT id, base_variant_id, lot_code
       FROM inventory.inventory_lots
      WHERE installation_id = $1
        AND base_variant_id = ANY($2::uuid[])
        AND upper(lot_code) = ANY($3::text[])
      ORDER BY base_variant_id, lot_code, id`,
    [installationId, baseVariantIds, lotCodes],
  );
  const map = new Map();
  for (const row of result.rows ?? []) {
    map.set(`${row.base_variant_id}\u001f${String(row.lot_code).trim().toUpperCase()}`, row);
  }
  return map;
}

function sameCode(left, right) {
  return String(left ?? '').trim().toUpperCase() === String(right ?? '').trim().toUpperCase();
}

function scopeOptions(candidates) {
  const seen = new Set();
  const options = [];
  for (const candidate of candidates ?? []) {
    const locationCode = String(candidate.location_code ?? '').trim().toUpperCase();
    if (!locationCode) continue;
    const lotCode = candidate.lot_code ? String(candidate.lot_code).trim().toUpperCase() : null;
    const key = `${locationCode}\u001f${lotCode ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(Object.freeze({
      locationCode,
      locationName: candidate.location_name ?? null,
      lotCode,
    }));
  }
  return Object.freeze(options);
}

function uniqueCodes(candidates, field) {
  const seen = new Set();
  const values = [];
  for (const candidate of candidates ?? []) {
    const raw = candidate?.[field];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const value = String(raw).trim().toUpperCase();
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function resolveScopeSelection(row, source, balanceCandidates = []) {
  const candidates = Array.isArray(balanceCandidates) ? balanceCandidates : [];
  const lotRequired = source?.lot_tracking_mode === 'REQUIRED';
  const scopeRequired = row.actualScaled6 !== 0n || candidates.length > 0;
  let locationCode = row.locationCode ?? null;
  let lotCode = row.lotCode ?? null;
  let locationAutoFilled = false;
  let lotAutoFilled = false;

  if (lotRequired && !lotCode) {
    const lotCandidates = locationCode
      ? candidates.filter((item) => sameCode(item.location_code, locationCode))
      : candidates;
    const lotCodes = uniqueCodes(lotCandidates, 'lot_code');
    if (lotCodes.length === 1) {
      [lotCode] = lotCodes;
      lotAutoFilled = true;
    }
  }

  if (!locationCode) {
    const locationCandidates = lotCode
      ? candidates.filter((item) => sameCode(item.lot_code, lotCode))
      : candidates;
    const locationCodes = uniqueCodes(locationCandidates, 'location_code');
    if (locationCodes.length === 1) {
      [locationCode] = locationCodes;
      locationAutoFilled = true;
    }
  }

  if (lotRequired && !lotCode) {
    const lotCandidates = locationCode
      ? candidates.filter((item) => sameCode(item.location_code, locationCode))
      : candidates;
    const lotCodes = uniqueCodes(lotCandidates, 'lot_code');
    if (lotCodes.length === 1) {
      [lotCode] = lotCodes;
      lotAutoFilled = true;
    }
  }

  let filteredCandidates = candidates;
  if (locationCode) filteredCandidates = filteredCandidates.filter((item) => sameCode(item.location_code, locationCode));
  if (lotCode) filteredCandidates = filteredCandidates.filter((item) => sameCode(item.lot_code, lotCode));

  return Object.freeze({
    locationCode,
    lotCode,
    lotRequired,
    scopeRequired,
    locationAutoFilled,
    lotAutoFilled,
    requiresLocationSelection: scopeRequired && !locationCode,
    requiresLotSelection: scopeRequired && lotRequired && !lotCode,
    scopeOptions: scopeOptions(candidates),
    candidates: Object.freeze([...filteredCandidates]),
  });
}

function canonicalQuantityForDelta(deltaScaled12, source) {
  const absolute = deltaScaled12 < 0n ? -deltaScaled12 : deltaScaled12;
  if (absolute === 0n) return null;
  const conversionScaled6 = parseScaled(source.conversion_to_base, 6, { allowZero: false });
  if (conversionScaled6 === null) return null;
  if (absolute % conversionScaled6 === 0n) {
    const sourceScaled6 = absolute / conversionScaled6;
    const quantity = formatScaled(sourceScaled6, 6);
    if (QUANTITY_PATTERN.test(quantity) && sourceScaled6 > 0n) {
      return {
        sourceVariantId: source.source_variant_id,
        quantity,
        unitCode: source.source_unit_code,
      };
    }
  }
  if (absolute % SCALE_6 === 0n) {
    const baseScaled6 = absolute / SCALE_6;
    const quantity = formatScaled(baseScaled6, 6);
    if (QUANTITY_PATTERN.test(quantity) && baseScaled6 > 0n) {
      return {
        sourceVariantId: source.base_variant_id,
        quantity,
        unitCode: source.base_unit_code,
      };
    }
  }
  return null;
}

function previewRow(row, source, scope, currentScaled12) {
  const errors = [...row.errors];
  const conversionScaled6 = parseScaled(source?.conversion_to_base, 6, { allowZero: false });
  if (source && (!source.base_variant_id || !source.base_unit_id || !source.base_unit_code || !source.source_unit_code || conversionScaled6 === null)) {
    errors.push({
      code: 'SKU_INVENTORY_SETUP_INCOMPLETE',
      message: `Dòng ${row.lineNumber}: SKU chưa có đủ đơn vị hoặc quy đổi tồn kho.`,
    });
  }
  const actualBaseScaled12 = row.actualScaled6 !== null && conversionScaled6 !== null
    ? row.actualScaled6 * conversionScaled6
    : null;
  const deltaScaled12 = actualBaseScaled12 === null || currentScaled12 === null
    ? null
    : actualBaseScaled12 - currentScaled12;
  const canonical = deltaScaled12 === null || deltaScaled12 === 0n || !source
    ? null
    : canonicalQuantityForDelta(deltaScaled12, source);
  if (deltaScaled12 !== null && deltaScaled12 !== 0n && !canonical) {
    errors.push({
      code: 'ADJUSTMENT_PRECISION_UNSUPPORTED',
      message: `Dòng ${row.lineNumber}: Chênh lệch không thể biểu diễn chính xác theo đơn vị đã thiết lập.`,
    });
  }
  const direction = deltaScaled12 === null || deltaScaled12 === 0n ? 'NONE' : deltaScaled12 > 0n ? 'IN' : 'OUT';
  return {
    lineNumber: row.lineNumber,
    sku: row.sku,
    productCode: source?.product_code ?? null,
    productName: source?.product_name ?? null,
    enteredQuantity: row.actualQuantity,
    enteredUnitCode: source?.source_unit_code ?? null,
    actualBaseQuantity: actualBaseScaled12 === null ? null : formatScaled(actualBaseScaled12, 12),
    baseUnitCode: source?.base_unit_code ?? null,
    currentBaseQuantity: currentScaled12 === null ? null : formatScaled(currentScaled12, 12),
    deltaBaseQuantity: deltaScaled12 === null ? null : formatScaled(deltaScaled12, 12),
    signedDeltaBaseQuantity: deltaScaled12 === null ? null : signedScaled(deltaScaled12),
    direction,
    locationId: scope?.location_id ?? null,
    locationCode: scope?.location_code ?? row.locationCode,
    locationName: scope?.location_name ?? null,
    lotId: scope?.lot_id ?? null,
    lotCode: scope?.lot_code ?? row.lotCode,
    lotTrackingMode: source?.lot_tracking_mode ?? 'NONE',
    lotRequired: Boolean(row.lotRequired),
    scopeRequired: Boolean(row.scopeRequired),
    requiresLocationSelection: Boolean(row.requiresLocationSelection),
    requiresLotSelection: Boolean(row.requiresLotSelection),
    locationAutoFilled: Boolean(row.locationAutoFilled),
    lotAutoFilled: Boolean(row.lotAutoFilled),
    scopeOptions: row.scopeOptions ?? Object.freeze([]),
    baseVariantId: source?.base_variant_id ?? null,
    canonicalSourceVariantId: canonical?.sourceVariantId ?? null,
    canonicalQuantity: canonical?.quantity ?? null,
    canonicalUnitCode: canonical?.unitCode ?? null,
    status: errors.length === 0 ? 'READY' : 'NEEDS_ATTENTION',
    errors,
  };
}

async function prepareBulkAdjustment(client, { requestContext, payload, lockScopes = false }) {
  const normalized = normalizeBulkRows(payload);
  if (!normalized.ok) return normalized;
  const allowed = new Set(Array.isArray(requestContext?.scopes?.warehouseIds) ? requestContext.scopes.warehouseIds : []);
  if (!allowed.has(normalized.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Kho nằm ngoài phạm vi được cấp.');
  }
  const warehouse = await adjustmentRepository.loadWarehouse(client, {
    installationId: requestContext.installationId,
    warehouseId: normalized.warehouseId,
  });
  if (!warehouse?.is_active || ['vehicle', 'transit'].includes(String(warehouse.warehouse_type).toLowerCase())) {
    return failure('WAREHOUSE_NOT_AVAILABLE', 'Kho đã chọn không thể lập phiếu điều chỉnh tồn.');
  }

  const skus = [...new Set(normalized.rows.filter((row) => row.sku).map((row) => row.sku))];
  const skuMap = await loadSkuMap(client, requestContext.installationId, skus);
  const uniqueSources = [];
  for (const sku of skus) {
    const entries = skuMap.get(sku) ?? [];
    if (entries.length === 1 && entries[0].base_variant_id) uniqueSources.push(entries[0]);
  }
  const baseVariantIds = [...new Set(uniqueSources.map((row) => row.base_variant_id))];
  const [balanceMap, locationMap, lotMap] = await Promise.all([
    loadBalanceMap(client, requestContext.installationId, normalized.warehouseId, baseVariantIds),
    loadLocationMap(
      client,
      requestContext.installationId,
      normalized.warehouseId,
      [...new Set(normalized.rows.map((row) => row.locationCode).filter(Boolean))],
    ),
    loadLotMap(
      client,
      requestContext.installationId,
      baseVariantIds,
      [...new Set(normalized.rows.map((row) => row.lotCode).filter(Boolean))],
    ),
  ]);

  const resolved = normalized.rows.map((row) => {
    const rowErrors = [...row.errors];
    const sourceEntries = row.sku ? (skuMap.get(row.sku) ?? []) : [];
    if (row.sku && sourceEntries.length === 0) {
      rowErrors.push({ code: 'SKU_NOT_FOUND', message: `Dòng ${row.lineNumber}: Không tìm thấy SKU đang hoạt động.` });
    } else if (sourceEntries.length > 1) {
      rowErrors.push({ code: 'SKU_AMBIGUOUS', message: `Dòng ${row.lineNumber}: SKU không xác định duy nhất. Hãy kiểm tra danh mục sản phẩm.` });
    }
    const source = sourceEntries.length === 1 ? sourceEntries[0] : null;
    if (source && (!source.base_variant_id || !source.base_unit_id || !source.source_unit_id)) {
      rowErrors.push({ code: 'SKU_INVENTORY_SETUP_INCOMPLETE', message: `Dòng ${row.lineNumber}: SKU chưa được thiết lập đầy đủ cho tồn kho.` });
    }

    let scope = null;
    let selection = Object.freeze({
      locationCode: row.locationCode,
      lotCode: row.lotCode,
      lotRequired: false,
      scopeRequired: false,
      locationAutoFilled: false,
      lotAutoFilled: false,
      requiresLocationSelection: false,
      requiresLotSelection: false,
      scopeOptions: Object.freeze([]),
      candidates: Object.freeze([]),
    });

    if (source?.base_variant_id) {
      const balanceCandidates = balanceMap.get(source.base_variant_id) ?? [];
      selection = resolveScopeSelection(row, source, balanceCandidates);

      if (selection.requiresLotSelection) {
        rowErrors.push({
          code: 'LOT_SELECTION_REQUIRED',
          message: `Dòng ${row.lineNumber}: Sản phẩm quản lý lô. Hãy chọn Lô * tại Xem trước.`,
        });
      }
      if (selection.requiresLocationSelection) {
        rowErrors.push({
          code: 'LOCATION_SELECTION_REQUIRED',
          message: `Dòng ${row.lineNumber}: Có nhiều hoặc chưa có Vị trí xác định. Hãy chọn Vị trí * tại Xem trước.`,
        });
      }

      if (selection.candidates.length === 1) {
        scope = selection.candidates[0];
      } else if (selection.candidates.length > 1
          && !selection.requiresLotSelection
          && !selection.requiresLocationSelection) {
        rowErrors.push({
          code: 'STOCK_SCOPE_AMBIGUOUS',
          message: `Dòng ${row.lineNumber}: Có nhiều dòng tồn cùng phù hợp. Hãy kiểm tra lại Lô/Vị trí và chính sách theo dõi của sản phẩm.`,
        });
      }

      if (!scope && row.locationCode && !locationMap.get(row.locationCode)) {
        rowErrors.push({ code: 'LOCATION_NOT_FOUND', message: `Dòng ${row.lineNumber}: Không tìm thấy Vị trí ${row.locationCode} trong kho đã chọn.` });
      }
      if (!scope && row.lotCode && !lotMap.get(`${source.base_variant_id}\u001f${row.lotCode}`)) {
        rowErrors.push({ code: 'LOT_NOT_FOUND', message: `Dòng ${row.lineNumber}: Không tìm thấy Lô ${row.lotCode} của SKU này.` });
      }

      if (!scope
          && !selection.requiresLotSelection
          && !selection.requiresLocationSelection
          && selection.locationCode) {
        const location = locationMap.get(selection.locationCode) ?? null;
        const lot = selection.lotCode
          ? (lotMap.get(`${source.base_variant_id}\u001f${selection.lotCode}`) ?? null)
          : null;
        const locationWasEntered = Boolean(row.locationCode);
        const lotWasEntered = Boolean(row.lotCode);
        const locationValid = !locationWasEntered || Boolean(location);
        const lotValid = !lotWasEntered || Boolean(lot);
        if (locationValid && lotValid && location) {
          scope = {
            base_variant_id: source.base_variant_id,
            location_id: location.id,
            location_code: location.code,
            location_name: location.name,
            lot_id: lot?.id ?? null,
            lot_code: lot?.lot_code ?? null,
            on_hand_quantity: '0',
          };
        }
      }

      if (!scope
          && row.actualScaled6 !== 0n
          && !selection.requiresLotSelection
          && !selection.requiresLocationSelection
          && rowErrors.length === row.errors.length) {
        rowErrors.push({
          code: 'STOCK_SCOPE_NOT_FOUND',
          message: `Dòng ${row.lineNumber}: Chưa xác định được dòng tồn. Hãy chọn Lô/Vị trí cần thiết tại Xem trước.`,
        });
      }
    }

    return {
      ...row,
      locationCode: selection.locationCode,
      lotCode: selection.lotCode,
      lotRequired: selection.lotRequired,
      scopeRequired: selection.scopeRequired,
      requiresLocationSelection: selection.requiresLocationSelection,
      requiresLotSelection: selection.requiresLotSelection,
      locationAutoFilled: selection.locationAutoFilled,
      lotAutoFilled: selection.lotAutoFilled,
      scopeOptions: selection.scopeOptions,
      errors: rowErrors,
      source,
      scope,
    };
  });

  const scopeCounts = new Map();
  for (const row of resolved) {
    if (!row.source?.base_variant_id || !row.scope?.location_id) continue;
    const key = [row.source.base_variant_id, row.scope.location_id, row.scope.lot_id ?? ''].join('\u001f');
    scopeCounts.set(key, (scopeCounts.get(key) ?? 0) + 1);
  }
  for (const row of resolved) {
    if (!row.source?.base_variant_id || !row.scope?.location_id) continue;
    const key = [row.source.base_variant_id, row.scope.location_id, row.scope.lot_id ?? ''].join('\u001f');
    if ((scopeCounts.get(key) ?? 0) > 1) {
      row.errors.push({
        code: 'DUPLICATE_STOCK_SCOPE',
        message: `Dòng ${row.lineNumber}: Phạm vi tồn này xuất hiện nhiều lần trong file. Hãy giữ một dòng Tồn thực tế cho mỗi Sản phẩm/Lô/Vị trí.`,
      });
    }
  }

  let lockedByLine = new Map();
  if (lockScopes) {
    const scopes = resolved
      .filter((row) => row.errors.length === 0 && row.scope?.location_id && row.source?.base_variant_id)
      .map((row) => ({
        scope_key: `bulk_${row.lineNumber}`,
        location_id: row.scope.location_id,
        base_variant_id: row.source.base_variant_id,
        lot_id: row.scope.lot_id ?? null,
      }));
    if (scopes.length > 0) {
      const locked = await adjustmentRepository.currentScopeVersions(client, {
        installationId: requestContext.installationId,
        warehouseId: normalized.warehouseId,
        scopes,
        lock: true,
      });
      lockedByLine = new Map((locked ?? []).map((item) => [Number(String(item.scope_key).replace('bulk_', '')), item]));
    }
  }

  const previewRows = resolved.map((row) => {
    let currentScaled12 = row.scope ? parseScaled(row.scope.on_hand_quantity ?? '0', 12) : 0n;
    if (row.errors.length > 0) currentScaled12 = row.scope ? currentScaled12 : null;
    if (lockScopes && row.scope?.location_id && row.errors.length === 0) {
      const locked = lockedByLine.get(row.lineNumber);
      if (!locked) {
        row.errors.push({ code: 'STOCK_SCOPE_CHANGED', message: `Dòng ${row.lineNumber}: Phạm vi tồn vừa thay đổi. Hãy kiểm tra lại file.` });
        currentScaled12 = null;
      } else {
        currentScaled12 = parseScaled(locked.current_on_hand ?? '0', 12);
      }
    }
    const source = row.source;
    const mapped = previewRow(row, source, row.scope, currentScaled12);
    if (!row.scope && mapped.direction !== 'NONE' && mapped.status === 'READY') {
      mapped.errors.push({ code: 'STOCK_SCOPE_NOT_FOUND', message: `Dòng ${row.lineNumber}: Chưa xác định được Lô/Vị trí để lập phiếu.` });
      mapped.status = 'NEEDS_ATTENTION';
    }
    return mapped;
  });

  const rowErrors = previewRows.flatMap((row) => row.errors.map((error) => ({ lineNumber: row.lineNumber, ...error })));
  const totals = {
    inputRowCount: normalized.rows.length,
    readyRowCount: previewRows.filter((row) => row.status === 'READY').length,
    attentionRowCount: previewRows.filter((row) => row.status !== 'READY').length,
    increaseRowCount: previewRows.filter((row) => row.status === 'READY' && row.direction === 'IN').length,
    decreaseRowCount: previewRows.filter((row) => row.status === 'READY' && row.direction === 'OUT').length,
    unchangedRowCount: previewRows.filter((row) => row.status === 'READY' && row.direction === 'NONE').length,
  };
  return Object.freeze({
    ok: true,
    warehouseId: normalized.warehouseId,
    preview: Object.freeze({
      ready: rowErrors.length === 0,
      stockUnchanged: true,
      rows: Object.freeze(previewRows),
      rowErrors: Object.freeze(rowErrors),
      totals: Object.freeze(totals),
    }),
  });
}

export async function previewBulkAdjustment(client, { requestContext, payload }) {
  return prepareBulkAdjustment(client, { requestContext, payload, lockScopes: false });
}

export async function confirmBulkAdjustment(client, { requestContext, payload }) {
  const reasonNote = text(payload?.reasonNote, 2000);
  if (!reasonNote) return failure('REASON_NOTE_REQUIRED', 'Hãy nhập diễn giải cho đợt điều chỉnh tồn hàng loạt.');
  const prepared = await prepareBulkAdjustment(client, { requestContext, payload, lockScopes: true });
  if (!prepared.ok) return prepared;
  if (!prepared.preview.ready) {
    return failure(
      'BULK_ADJUSTMENT_RECHECK_REQUIRED',
      'Dữ liệu còn dòng cần xử lý hoặc tồn kho vừa thay đổi. Hãy kiểm tra và xem trước lại trước khi lập phiếu.',
      { rowErrors: prepared.preview.rowErrors },
    );
  }
  const increases = prepared.preview.rows.filter((row) => row.direction === 'IN');
  const decreases = prepared.preview.rows.filter((row) => row.direction === 'OUT');
  if (increases.length === 0 && decreases.length === 0) {
    return failure('NO_ADJUSTMENT_REQUIRED', 'Tồn thực tế đang khớp tồn hệ thống, không cần lập phiếu điều chỉnh.');
  }
  const increaseReasonCode = text(payload?.increaseReasonCode, 64);
  const decreaseReasonCode = text(payload?.decreaseReasonCode, 64);
  if (increases.length > 0 && !increaseReasonCode) return failure('INCREASE_REASON_REQUIRED', 'Hãy chọn lý do cho các dòng tăng tồn.');
  if (decreases.length > 0 && !decreaseReasonCode) return failure('DECREASE_REASON_REQUIRED', 'Hãy chọn lý do cho các dòng giảm tồn.');

  const groups = [
    { direction: 'IN', rows: increases, reasonCode: increaseReasonCode },
    { direction: 'OUT', rows: decreases, reasonCode: decreaseReasonCode },
  ].filter((group) => group.rows.length > 0);
  const adjustments = [];
  for (const group of groups) {
    const result = await createAdjustment(client, {
      requestContext,
      payload: {
        warehouseId: prepared.warehouseId,
        documentKind: 'MANUAL_ADJUSTMENT',
        adjustmentDirection: group.direction,
        reasonCode: group.reasonCode,
        reasonNote,
        lines: group.rows.map((row) => ({
          sourceLocationId: row.locationId,
          sourceVariantId: row.canonicalSourceVariantId,
          lotId: row.lotId,
          quantity: row.canonicalQuantity,
        })),
      },
    });
    if (!result.ok) return result;
    adjustments.push(result.adjustment);
  }
  return Object.freeze({
    ok: true,
    adjustments: Object.freeze(adjustments),
    preview: prepared.preview,
  });
}

export const inventoryAdjustmentBulkInternals = Object.freeze({
  MAX_ROWS,
  parseScaled,
  formatScaled,
  normalizeBulkRows,
  resolveScopeSelection,
  canonicalQuantityForDelta,
});
