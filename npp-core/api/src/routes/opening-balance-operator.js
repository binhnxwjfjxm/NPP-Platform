import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import {
  postOpeningBalanceImport,
  validateOpeningBalanceImport,
} from '../services/opening-balance.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKU_PATTERN = /^[^\s][\s\S]{0,95}$/;
const LOCATION_CODE_PATTERN = /^[^\s][\s\S]{0,63}$/;

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function failure(code, message, details = {}, statusCode = 400) {
  return Object.freeze({ ok: false, code, message, details, statusCode });
}

function text(value, maxLength) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function withWarehouseScopes(requestContext, warehouseIds) {
  const scopes = Object.freeze({
    branchIds: Object.freeze([...(requestContext.scopes?.branchIds ?? [])]),
    warehouseIds: Object.freeze(warehouseIds),
    territoryIds: Object.freeze([...(requestContext.scopes?.territoryIds ?? [])]),
  });
  return Object.freeze({
    ...requestContext,
    scopes,
    authContext: requestContext.authContext
      ? Object.freeze({ ...requestContext.authContext, scopes })
      : requestContext.authContext,
  });
}

async function ensureBootstrapWarehouseScopes(client, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) {
    return requestContext;
  }
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
    return requestContext;
  }
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: true,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
}

async function authenticateAndAuthorize(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  let requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, options.PERMISSIONS.coreInventoryOpeningBalanceImport).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  requestContext = await ensureBootstrapWarehouseScopes(options.getPool(), requestContext);
  return requestContext;
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(error?.code ?? 'INVALID_JSON_BODY', error?.publicMessage ?? 'JSON body không hợp lệ', {}, false, error?.statusCode ?? 400),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key
      ? { ok: true, key }
      : failure('MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
  } catch {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key không hợp lệ');
  }
}

function writeSuccess(res, data, options, statusCode = 200) {
  sendJson(
    res,
    statusCode,
    createSuccessEnvelope(data, options.requestId, options.receivedAt),
    options.requestId,
  );
}

function serviceFailureStatus(result) {
  if (result?.code === 'WAREHOUSE_SCOPE_DENIED' || result?.code === 'PERMISSION_DENIED') return 403;
  if (result?.retryable) return 503;
  return result?.statusCode ?? 400;
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

async function getWarehouse(client, requestContext, warehouseId) {
  if (!UUID_PATTERN.test(String(warehouseId ?? ''))) return null;
  if (!warehouseAllowed(requestContext, warehouseId)) return null;
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: true,
    limit: 10000,
    offset: 0,
  });
  return warehouses.find((warehouse) => warehouse.id === warehouseId) ?? null;
}

export async function listOpeningBalanceWarehouseOptions(client, requestContext) {
  const rows = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: true,
    limit: 10000,
    offset: 0,
  });
  const allowed = new Set(requestContext.scopes?.warehouseIds ?? []);
  return rows
    .filter((warehouse) => allowed.has(warehouse.id))
    .map((warehouse) => ({ id: warehouse.id, code: warehouse.code, name: warehouse.name }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

export async function listOpeningBalanceLocationOptions(client, requestContext, warehouseId) {
  const warehouse = await getWarehouse(client, requestContext, warehouseId);
  if (!warehouse) return failure('WAREHOUSE_SCOPE_DENIED', 'Kho không hoạt động hoặc ngoài phạm vi được cấp', {}, 403);
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
    warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
    locations: result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      locationType: row.location_type,
    })),
  });
}

async function resolveSkuMap(client, installationId, skus) {
  if (skus.length === 0) return new Map();
  const result = await client.query(
    `SELECT pv.id, pv.sku, pv.unit_id, unit.code AS unit_code,
            p.code AS product_code, p.name AS product_name,
            base.id AS base_variant_id, base.sku AS base_sku,
            policy.lot_tracking_mode, policy.expiry_tracking_mode, policy.location_required
       FROM shared.product_variants pv
       JOIN shared.products p
         ON p.installation_id = pv.installation_id
        AND p.id = pv.product_id
       LEFT JOIN shared.units_of_measure unit
         ON unit.installation_id = pv.installation_id
        AND unit.id = pv.unit_id
       LEFT JOIN shared.product_variants base
         ON base.installation_id = pv.installation_id
        AND base.product_id = pv.product_id
        AND base.is_inventory_base = true
        AND base.is_active = true
       LEFT JOIN inventory.product_tracking_policies policy
         ON policy.installation_id = base.installation_id
        AND policy.base_variant_id = base.id
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
    const existing = map.get(key) ?? [];
    existing.push(row);
    map.set(key, existing);
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
  const map = new Map();
  for (const row of result.rows) map.set(String(row.code).trim().toUpperCase(), row);
  return map;
}

export async function resolveOpeningBalanceOperatorPayload(client, requestContext, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Dữ liệu nhập tồn đầu kỳ không hợp lệ');
  }
  const warehouseId = String(payload.warehouseId ?? '').trim();
  const warehouse = await getWarehouse(client, requestContext, warehouseId);
  if (!warehouse) return failure('WAREHOUSE_SCOPE_DENIED', 'Hãy chọn một kho đang hoạt động trong phạm vi được cấp', {}, 403);
  if (!Array.isArray(payload.rows) || payload.rows.length < 1 || payload.rows.length > 500) {
    return failure('INVALID_ROWS', 'Tệp phải có từ 1 đến 500 dòng dữ liệu');
  }

  const parsedRows = payload.rows.map((row, index) => ({
    source: row && typeof row === 'object' && !Array.isArray(row) ? row : {},
    lineNumber: index + 1,
    sku: text(row?.sku, 96),
    locationCode: row?.locationCode === undefined || row?.locationCode === null || String(row.locationCode).trim() === ''
      ? null
      : text(row.locationCode, 64),
  }));
  const skuKeys = [...new Set(parsedRows.map((row) => row.sku?.toUpperCase()).filter(Boolean))];
  const locationKeys = [...new Set(parsedRows.map((row) => row.locationCode?.toUpperCase()).filter(Boolean))];
  const [skuMap, locationMap] = await Promise.all([
    resolveSkuMap(client, requestContext.installationId, skuKeys),
    resolveLocationMap(client, requestContext.installationId, warehouseId, locationKeys),
  ]);

  const rowErrors = [];
  const legacyRows = [];
  const displayRows = [];

  for (const parsed of parsedRows) {
    const { source, lineNumber, sku, locationCode } = parsed;
    if (!sku || !SKU_PATTERN.test(sku)) {
      rowErrors.push({ lineNumber, code: 'SKU_REQUIRED', message: 'Thiếu SKU hợp lệ.' });
      displayRows.push({ lineNumber, warehouseCode: warehouse.code, warehouseName: warehouse.name, sku: sku ?? '', locationCode, sourceQuantity: source.sourceQuantity ?? '' });
      continue;
    }
    const variants = skuMap.get(sku.toUpperCase()) ?? [];
    if (variants.length === 0) {
      rowErrors.push({ lineNumber, code: 'SKU_NOT_FOUND', message: `SKU ${sku} không tồn tại hoặc không hoạt động.` });
      displayRows.push({ lineNumber, warehouseCode: warehouse.code, warehouseName: warehouse.name, sku, locationCode, sourceQuantity: source.sourceQuantity ?? '' });
      continue;
    }
    if (variants.length > 1) {
      rowErrors.push({ lineNumber, code: 'SKU_AMBIGUOUS', message: `SKU ${sku} không duy nhất; cần chuẩn hóa danh mục hàng.` });
      displayRows.push({ lineNumber, warehouseCode: warehouse.code, warehouseName: warehouse.name, sku, locationCode, sourceQuantity: source.sourceQuantity ?? '' });
      continue;
    }

    let location = null;
    if (locationCode) {
      if (!LOCATION_CODE_PATTERN.test(locationCode)) {
        rowErrors.push({ lineNumber, code: 'INVALID_LOCATION_CODE', message: `Mã vị trí ${locationCode} không hợp lệ.` });
        displayRows.push({ lineNumber, warehouseCode: warehouse.code, warehouseName: warehouse.name, sku, locationCode, sourceQuantity: source.sourceQuantity ?? '' });
        continue;
      }
      location = locationMap.get(locationCode.toUpperCase()) ?? null;
      if (!location) {
        rowErrors.push({ lineNumber, code: 'LOCATION_NOT_FOUND', message: `Vị trí ${locationCode} không tồn tại/không hoạt động trong kho ${warehouse.code}.` });
        displayRows.push({ lineNumber, warehouseCode: warehouse.code, warehouseName: warehouse.name, sku, locationCode, sourceQuantity: source.sourceQuantity ?? '' });
        continue;
      }
    }

    const variant = variants[0];
    legacyRows.push({
      warehouseId,
      locationId: location?.id ?? null,
      sourceVariantId: variant.id,
      sourceQuantity: source.sourceQuantity,
      lotCode: source.lotCode || null,
      manufacturedDate: source.manufacturedDate || null,
      expiryDate: source.expiryDate || null,
      supplierLotReference: source.supplierLotReference || null,
      sourceLineReference: source.sourceLineReference || `Dong-${lineNumber + 1}`,
      metadata: source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata) ? source.metadata : {},
    });
    displayRows.push({
      lineNumber,
      warehouseId,
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      locationId: location?.id ?? null,
      locationCode: location?.code ?? null,
      locationName: location?.name ?? null,
      sourceVariantId: variant.id,
      sourceSku: variant.sku,
      sourceUnitId: variant.unit_id,
      sourceUnitCode: variant.unit_code,
      productCode: variant.product_code,
      productName: variant.product_name,
      baseVariantId: variant.base_variant_id,
      baseSku: variant.base_sku,
      lotTrackingMode: variant.lot_tracking_mode ?? null,
      expiryTrackingMode: variant.expiry_tracking_mode ?? null,
      locationRequired: variant.location_required ?? null,
      sourceQuantity: source.sourceQuantity,
      lotCode: source.lotCode || null,
      manufacturedDate: source.manufacturedDate || null,
      expiryDate: source.expiryDate || null,
    });
  }

  return Object.freeze({
    ok: rowErrors.length === 0,
    rowErrors: Object.freeze(rowErrors),
    displayRows: Object.freeze(displayRows),
    legacyPayload: Object.freeze({
      sourceKey: payload.sourceKey,
      sourceFilename: payload.sourceFilename ?? null,
      documentDate: payload.documentDate,
      contentChecksum: payload.contentChecksum,
      metadata: {
        ...(payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata) ? payload.metadata : {}),
        operatorInputVersion: 1,
        selectedWarehouseId: warehouseId,
        selectedWarehouseCode: warehouse.code,
      },
      rows: legacyRows,
    }),
  });
}

function mergeValidationRows(displayRows, serviceRows) {
  const byLineNumber = new Map(serviceRows.map((row) => [Number(row.lineNumber), row]));
  return displayRows.map((display) => {
    const service = byLineNumber.get(Number(display.lineNumber)) ?? {};
    return {
      ...display,
      ...service,
      sourceQuantityScaled: service.sourceQuantityScaled === undefined || service.sourceQuantityScaled === null
        ? service.sourceQuantityScaled
        : String(service.sourceQuantityScaled),
    };
  });
}

export async function handleOpeningBalanceOperatorRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/inventory/opening-balances/operator/')) return false;
  const method = String(req.method ?? 'GET').toUpperCase();
  let requestContext;
  try {
    requestContext = await authenticateAndAuthorize(req, res, options);
  } catch (error) {
    sendError(res, apiError('OPENING_BALANCE_OPERATOR_UNAVAILABLE', 'Không tải được dữ liệu tồn đầu kỳ', {}, true, 503), options.requestId, options.receivedAt);
    return true;
  }
  if (!requestContext) return true;

  try {
    if (url.pathname === '/api/inventory/opening-balances/operator/warehouses' && method === 'GET') {
      sendSuccess(res, await listOpeningBalanceWarehouseOptions(options.getPool(), requestContext), options.requestId, options.receivedAt);
      return true;
    }

    if (url.pathname === '/api/inventory/opening-balances/operator/locations' && method === 'GET') {
      const result = await listOpeningBalanceLocationOptions(options.getPool(), requestContext, url.searchParams.get('warehouseId'));
      if (!result.ok) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, false, result.statusCode ?? 400), options.requestId, options.receivedAt);
        return true;
      }
      sendSuccess(res, { warehouse: result.warehouse, locations: result.locations }, options.requestId, options.receivedAt);
      return true;
    }

    if (url.pathname === '/api/inventory/opening-balances/operator/validate' && method === 'POST') {
      const body = await readPayload(req, res, options);
      if (body === null) return true;
      const resolved = await resolveOpeningBalanceOperatorPayload(options.getPool(), requestContext, body);
      if (resolved.code) {
        sendError(res, apiError(resolved.code, resolved.message, resolved.details ?? {}, false, resolved.statusCode ?? 400), options.requestId, options.receivedAt);
        return true;
      }
      if (!resolved.ok) {
        writeSuccess(res, {
          rowErrors: resolved.rowErrors,
          rows: resolved.displayRows,
          totals: { rowCount: 0, sourceQuantityTotal: '0', baseQuantityTotal: '0' },
        }, options);
        return true;
      }
      const result = await validateOpeningBalanceImport(options.getPool(), {
        requestContext,
        payload: resolved.legacyPayload,
      });
      if (!result.ok && result.code) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), serviceFailureStatus(result)), options.requestId, options.receivedAt);
        return true;
      }
      writeSuccess(res, {
        rowErrors: result.rowErrors ?? [],
        rows: mergeValidationRows(resolved.displayRows, result.rows ?? []),
        totals: result.totals ?? { rowCount: 0, sourceQuantityTotal: '0', baseQuantityTotal: '0' },
      }, options);
      return true;
    }

    if (url.pathname === '/api/inventory/opening-balances/operator/post' && method === 'POST') {
      const body = await readPayload(req, res, options);
      if (body === null) return true;
      const idempotency = requireIdempotency(req);
      if (!idempotency.ok) {
        sendError(res, apiError(idempotency.code, idempotency.message, {}, false, 400), options.requestId, options.receivedAt);
        return true;
      }
      const resolved = await resolveOpeningBalanceOperatorPayload(options.getPool(), requestContext, body);
      if (resolved.code) {
        sendError(res, apiError(resolved.code, resolved.message, resolved.details ?? {}, false, resolved.statusCode ?? 400), options.requestId, options.receivedAt);
        return true;
      }
      if (!resolved.ok) {
        sendError(res, apiError('OPENING_BALANCE_VALIDATION_FAILED', 'Dữ liệu tồn đầu kỳ chưa hợp lệ', { rowErrors: resolved.rowErrors }, false, 400), options.requestId, options.receivedAt);
        return true;
      }
      const result = await postOpeningBalanceImport({
        adapter: options.getPool(),
        requestContext,
        idempotencyKey: idempotency.key,
        payload: resolved.legacyPayload,
      });
      if (!result.ok) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), serviceFailureStatus(result)), options.requestId, options.receivedAt);
        return true;
      }
      writeSuccess(res, {
        ok: true,
        replayed: result.replayed,
        import: result.import,
        movement: result.movement,
        totals: result.totals,
      }, options, result.replayed ? 200 : 201);
      return true;
    }

    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'opening_balance_operator_failed',
      requestId: options.requestId,
      errorName: error?.name ?? null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }));
    sendError(res, apiError('OPENING_BALANCE_OPERATOR_UNAVAILABLE', 'Tồn đầu kỳ tạm thời chưa khả dụng', {}, true, 503), options.requestId, options.receivedAt);
    return true;
  }
}
