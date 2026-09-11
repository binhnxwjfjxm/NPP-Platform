import * as base from './file-operations.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, details });
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

async function loadWarehouseById(client, requestContext, warehouseId) {
  const result = await client.query(
    `SELECT id, code, name, location_management_mode
       FROM shared.warehouses
      WHERE installation_id = $1
        AND id = $2::uuid
        AND is_active = true`,
    [requestContext.installationId, warehouseId],
  );
  return result.rows?.[0] ?? null;
}

async function loadWarehouseByCode(client, requestContext, warehouseCode) {
  const result = await client.query(
    `SELECT id, code, name, location_management_mode
       FROM shared.warehouses
      WHERE installation_id = $1
        AND code = $2
        AND is_active = true`,
    [requestContext.installationId, warehouseCode],
  );
  return result.rows?.[0] ?? null;
}

function validateWarehouseMode(warehouse) {
  if (!warehouse) return failure('WAREHOUSE_NOT_FOUND', 'Không tìm thấy Kho đang sử dụng.', 404);
  if (!['MANAGED', 'UNMANAGED'].includes(warehouse.location_management_mode)) {
    return failure(
      'WAREHOUSE_LOCATION_MODE_REQUIRED',
      `Kho ${warehouse.code} chưa thiết lập chế độ quản lý vị trí.`,
      409,
    );
  }
  return null;
}

function validateWarehouseScope(requestContext, warehouse) {
  const allowed = requestContext.scopes?.warehouseIds ?? [];
  return allowed.includes(warehouse.id)
    ? null
    : failure('WAREHOUSE_SCOPE_DENIED', 'Kho nằm ngoài phạm vi được cấp quyền.', 403);
}

async function validateManagedLocations(client, requestContext, warehouse, rows) {
  const locationCodes = [...new Set(rows.map((row) => upper(row?.locationCode)).filter(Boolean))];
  if (warehouse.location_management_mode === 'MANAGED') {
    const missingRow = rows.findIndex((row) => !upper(row?.locationCode));
    if (missingRow >= 0) {
      return failure(
        'LOCATION_REQUIRED',
        `Dòng ${missingRow + 1}: Kho ${warehouse.code} có quản lý vị trí, cần nhập Mã vị trí.`,
      );
    }
    const result = await client.query(
      `SELECT code
         FROM shared.warehouse_locations
        WHERE installation_id = $1
          AND warehouse_id = $2
          AND code = ANY($3::text[])
          AND is_active = true
          AND location_type = 'storage'`,
      [requestContext.installationId, warehouse.id, locationCodes],
    );
    const validCodes = new Set((result.rows ?? []).map((row) => row.code));
    const invalid = locationCodes.find((code) => !validCodes.has(code));
    if (invalid) {
      return failure(
        'LOCATION_NOT_FOUND',
        `Vị trí ${invalid} không phải vị trí lưu trữ đang sử dụng của Kho ${warehouse.code}.`,
        404,
      );
    }
    return null;
  }

  const suppliedRow = rows.findIndex((row) => upper(row?.locationCode));
  if (suppliedRow >= 0) {
    return failure(
      'LOCATION_NOT_ALLOWED',
      `Dòng ${suppliedRow + 1}: Kho ${warehouse.code} không quản lý vị trí. Để trống cột Mã vị trí.`,
    );
  }
  return null;
}

export async function exportStocktakeRows(client, { requestContext, warehouseId, format = 'tabular' }) {
  const normalizedWarehouseId = text(warehouseId);
  if (!UUID_PATTERN.test(normalizedWarehouseId)) return failure('INVALID_WAREHOUSE_ID', 'Kho không hợp lệ.');
  const warehouse = await loadWarehouseById(client, requestContext, normalizedWarehouseId);
  const modeError = validateWarehouseMode(warehouse);
  if (modeError) return modeError;
  const scopeError = validateWarehouseScope(requestContext, warehouse);
  if (scopeError) return scopeError;

  const result = await base.exportStocktakeRows(client, { requestContext, warehouseId: warehouse.id, format });
  if (!result.ok) return result;
  const mismatch = result.rows.find((row) => (
    warehouse.location_management_mode === 'MANAGED'
      ? !text(row.locationCode)
      : Boolean(text(row.locationCode))
  ));
  if (mismatch) {
    return failure(
      'WAREHOUSE_LOCATION_DATA_MISMATCH',
      `Tồn kho ${warehouse.code} chưa đồng nhất với chế độ quản lý vị trí. Cần đối soát trước khi xuất file kiểm kê.`,
      409,
    );
  }
  return result;
}

export async function importStocktakeRows(client, { requestContext, payload }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows) || payload.rows.length === 0) {
    return base.importStocktakeRows(client, { requestContext, payload });
  }
  const warehouseCodes = [...new Set(payload.rows.map((row) => upper(row?.warehouseCode)).filter(Boolean))];
  if (warehouseCodes.length !== 1) {
    return failure('MULTIPLE_STOCKTAKE_WAREHOUSES', 'Một file kiểm kê chỉ được chứa một Kho.');
  }
  const warehouse = await loadWarehouseByCode(client, requestContext, warehouseCodes[0]);
  const modeError = validateWarehouseMode(warehouse);
  if (modeError) return modeError;
  const scopeError = validateWarehouseScope(requestContext, warehouse);
  if (scopeError) return scopeError;
  const locationError = await validateManagedLocations(client, requestContext, warehouse, payload.rows);
  if (locationError) return locationError;
  return base.importStocktakeRows(client, { requestContext, payload });
}

export const exportProductRows = base.exportProductRows;
export const importProductRows = base.importProductRows;
export const exportPricingRows = base.exportPricingRows;
export const importPricingRows = base.importPricingRows;
export const listMovementRows = base.listMovementRows;
export const buildQuotationRows = base.buildQuotationRows;
export const PRODUCT_FILE_COLUMNS = base.PRODUCT_FILE_COLUMNS;
export const PRICING_FILE_COLUMNS = base.PRICING_FILE_COLUMNS;
export const STOCKTAKE_FILE_COLUMNS = base.STOCKTAKE_FILE_COLUMNS;
export const MOVEMENT_FILE_COLUMNS = base.MOVEMENT_FILE_COLUMNS;
