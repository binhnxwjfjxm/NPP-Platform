import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import * as balanceRepository from '../db/repositories/inventory-balance.js';
import * as lotRepository from '../db/repositories/inventory-lots.js';
import {
  getInventoryLot,
  getInventoryTrackingPolicy,
  listInventoryLots,
  listInventoryTrackingPolicies,
  upsertInventoryTrackingPolicy,
} from '../services/inventory-lots.js';
import {
  getOpeningBalanceImport,
  listOpeningBalanceImports,
  postOpeningBalanceImport,
  validateOpeningBalanceImport,
} from '../services/opening-balance.js';
import {
  listInventoryMovementDrillDown,
  listInventoryMovementHistory,
} from '../services/inventory-balance.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import { handleFulfillmentOperationRoutes } from './fulfillment-operations.js';
import { handleFulfillmentReversalRoutes } from './fulfillment-reversal.js';
import { handleDeliveryOrderRoutes } from './delivery-orders.js';
import { handleDeliveryOrderReversalRoutes } from './delivery-order-reversal.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'INVALID_JSON_BODY' || code.startsWith('INVALID_') || code.endsWith('_REQUIRED')) return 400;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('DUPLICATE')
    || code.includes('IDEMPOTENCY')
  ) return 409;
  return 500;
}

function sendServiceError(res, result, context) {
  sendError(
    res,
    apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)),
    context.requestId,
    context.receivedAt,
  );
}

async function readPayload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return null;
  }
}

function parseBoolean(value) {
  if (value === null) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
    code: 'INVALID_QUERY_PARAMETER',
    publicMessage: 'Query parameter must be true or false',
    statusCode: 400,
  });
}

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Query parameter must be an integer between 0 and ${max}`,
      statusCode: 400,
    });
  }
  return parsed;
}

function parseOffset(value, fallback = 0) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: 'Query offset must be a non-negative safe integer',
      statusCode: 400,
    });
  }
  return parsed;
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch (error) {
    return { ok: false, code: error.code ?? 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
}

function writeSuccess(res, data, context, statusCode = 200) {
  sendJson(
    res,
    statusCode,
    createSuccessEnvelope(data, context.requestId, context.receivedAt),
    context.requestId,
  );
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

async function ensureWarehouseScopes(client, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) {
    return requestContext;
  }
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
}

async function authenticateAndAuthorize(req, res, options, permission) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  const allowed = options.authorize(requestContext, permission);
  if (!allowed.ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return requestContext;
}

async function handleTrackingPolicies(req, res, options, pathname, method) {
  if (pathname === '/api/inventory/tracking-policies' && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryTrackingPolicyRead);
    if (!requestContext) return true;
    try {
      const scopedRequestContext = await ensureWarehouseScopes(options.getPool(), requestContext);
      const result = await listInventoryTrackingPolicies(options.getPool(), {
        requestContext: scopedRequestContext,
        search: new URL(`http://localhost${req.url}`).searchParams.get('search'),
        active: (() => {
          try { return parseBoolean(new URL(`http://localhost${req.url}`).searchParams.get('active')); } catch { return null; }
        })(),
        limit: parseInteger(new URL(`http://localhost${req.url}`).searchParams.get('limit'), 200, 1000),
        offset: parseOffset(new URL(`http://localhost${req.url}`).searchParams.get('offset')),
      });
      if (!result.ok) return sendServiceError(res, result, options), true;
      writeSuccess(res, result.policies, options);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    }
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/inventory\/tracking-policies\/([^/]+)$/);
  if (!detailMatch) return false;
  const baseVariantId = detailMatch[1];

  if (method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryTrackingPolicyRead);
    if (!requestContext) return true;
    const result = await getInventoryTrackingPolicy(options.getPool(), { requestContext: await ensureWarehouseScopes(options.getPool(), requestContext), baseVariantId });
    if (!result.ok) return sendServiceError(res, result, options), true;
    writeSuccess(res, result.policy, options);
    return true;
  }

  if (method === 'PUT') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryTrackingPolicyManage);
    if (!requestContext) return true;
    const body = await readPayload(req, res, options);
    if (body === null) return true;
    const result = await upsertInventoryTrackingPolicy(options.getPool(), {
      requestContext: await ensureWarehouseScopes(options.getPool(), requestContext),
      payload: { ...body, baseVariantId },
    });
    if (!result.ok) return sendServiceError(res, result, options), true;
    writeSuccess(res, result.policy, options, result.replayed ? 200 : 201);
    return true;
  }

  return false;
}

async function handleLots(req, res, options, pathname, method) {
  if (pathname === '/api/inventory/lots' && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryLotRead);
    if (!requestContext) return true;
    const url = new URL(`http://localhost${req.url}`);
    try {
      const scopedRequestContext = await ensureWarehouseScopes(options.getPool(), requestContext);
      const result = await listInventoryLots(options.getPool(), {
        requestContext: scopedRequestContext,
        search: url.searchParams.get('search'),
        baseVariantId: url.searchParams.get('baseVariantId'),
        limit: parseInteger(url.searchParams.get('limit'), 200, 1000),
        offset: parseOffset(url.searchParams.get('offset')),
      });
      if (!result.ok) return sendServiceError(res, result, options), true;
      writeSuccess(res, result.lots, options);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    }
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/inventory\/lots\/([^/]+)$/);
  if (!detailMatch || method !== 'GET') return false;
  const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryLotRead);
  if (!requestContext) return true;
  const result = await getInventoryLot(options.getPool(), { requestContext: await ensureWarehouseScopes(options.getPool(), requestContext), id: detailMatch[1] });
  if (!result.ok) return sendServiceError(res, result, options), true;
  writeSuccess(res, result.lot, options);
  return true;
}

async function handleBalances(req, res, options, pathname, method) {
  if (!pathname.startsWith('/api/inventory/balances') || method !== 'GET') return false;
  const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryRead);
  if (!requestContext) return true;
  const scopedRequestContext = await ensureWarehouseScopes(options.getPool(), requestContext);
  const url = new URL(`http://localhost${req.url}`);
  const history = pathname.endsWith('/history');
  const drillDown = pathname.endsWith('/drill-down');
  try {
    if (history) {
      const result = await listInventoryMovementHistory(options.getPool(), {
        requestContext: scopedRequestContext,
        warehouseId: url.searchParams.get('warehouseId'),
        locationId: url.searchParams.get('locationId'),
        baseVariantId: url.searchParams.get('baseVariantId'),
        lotId: url.searchParams.get('lotId'),
        scopeMode: url.searchParams.get('scope') || 'exact',
        limit: parseInteger(url.searchParams.get('limit'), 51, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) return sendServiceError(res, result, options), true;
      writeSuccess(res, result.rows, options);
      return true;
    }

    if (drillDown) {
      const result = await listInventoryMovementDrillDown(options.getPool(), {
        requestContext: scopedRequestContext,
        warehouseId: url.searchParams.get('warehouseId'),
        locationId: url.searchParams.get('locationId'),
        baseVariantId: url.searchParams.get('baseVariantId'),
        lotId: url.searchParams.get('lotId'),
        limit: parseInteger(url.searchParams.get('limit'), 500, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) return sendServiceError(res, result, options), true;
      writeSuccess(res, result.lines, options);
      return true;
    }

    const rows = await balanceRepository.listInventoryBalances(options.getPool(), {
      installationId: scopedRequestContext.installationId,
      warehouseId: url.searchParams.get('warehouseId') || null,
      baseVariantId: url.searchParams.get('baseVariantId') || null,
      lotId: url.searchParams.get('lotId') || null,
      limit: parseInteger(url.searchParams.get('limit'), 500, 1000),
      offset: parseOffset(url.searchParams.get('offset')),
    });
    writeSuccess(res, rows, options);
    return true;
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    return true;
  }
}

async function handleOpeningBalances(req, res, options, pathname, method) {
  if (pathname === '/api/inventory/opening-balances/validate' && method === 'POST') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryOpeningBalanceImport);
    if (!requestContext) return true;
    const body = await readPayload(req, res, options);
    if (body === null) return true;
    try {
      const result = await validateOpeningBalanceImport(options.getPool(), { requestContext: await ensureWarehouseScopes(options.getPool(), requestContext), payload: body });
      if (!result.ok) return sendServiceError(res, result, options), true;
      writeSuccess(res, {
        rowErrors: result.rowErrors,
        rows: result.rows.map((row) => ({
          ...row,
          sourceQuantityScaled: row.sourceQuantityScaled === undefined || row.sourceQuantityScaled === null
            ? row.sourceQuantityScaled
            : String(row.sourceQuantityScaled),
        })),
        totals: result.totals,
      }, options);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (pathname === '/api/inventory/opening-balances/post' && method === 'POST') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryOpeningBalanceImport);
    if (!requestContext) return true;
    const body = await readPayload(req, res, options);
    if (body === null) return true;
    const idempotency = requireIdempotency(req);
    if (!idempotency.ok) {
      sendError(res, apiError(idempotency.code, idempotency.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const result = await postOpeningBalanceImport({
        adapter: options.getPool(),
        requestContext: await ensureWarehouseScopes(options.getPool(), requestContext),
        idempotencyKey: idempotency.key,
        payload: body,
      });
      if (!result.ok) return sendServiceError(res, result, options), true;
      writeSuccess(res, {
        ok: true,
        replayed: result.replayed,
        import: result.import,
        movement: result.movement,
        totals: result.totals,
      }, options, result.replayed ? 200 : 201);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (pathname === '/api/inventory/opening-balances' && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryRead);
    if (!requestContext) return true;
    try {
      const scopedRequestContext = await ensureWarehouseScopes(options.getPool(), requestContext);
      const result = await listOpeningBalanceImports(options.getPool(), {
        requestContext: scopedRequestContext,
        limit: parseInteger(new URL(`http://localhost${req.url}`).searchParams.get('limit'), 100, 1000),
        offset: parseInteger(new URL(`http://localhost${req.url}`).searchParams.get('offset'), 0, 10000),
      });
      if (!result.ok) return sendServiceError(res, result, options), true;
      writeSuccess(res, result.imports, options);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    }
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/inventory\/opening-balances\/([^/]+)$/);
  if (!detailMatch || method !== 'GET') return false;
  const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryRead);
  if (!requestContext) return true;
  const result = await getOpeningBalanceImport(options.getPool(), { requestContext: await ensureWarehouseScopes(options.getPool(), requestContext), id: detailMatch[1] });
  if (!result.ok) return sendServiceError(res, result, options), true;
  writeSuccess(res, result, options);
  return true;
}

export async function handleInventoryRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname.startsWith('/api/delivery-orders')) {
    if (await handleDeliveryOrderReversalRoutes(req, res, options)) return true;
    return handleDeliveryOrderRoutes(req, res, options);
  }
  if (!pathname.startsWith('/api/inventory')) return false;
  const method = String(req.method ?? 'GET').toUpperCase();
  if (await handleFulfillmentReversalRoutes(req, res, options)) return true;
  if (await handleFulfillmentOperationRoutes(req, res, options)) return true;
  if (await handleTrackingPolicies(req, res, options, pathname, method)) return true;
  if (await handleLots(req, res, options, pathname, method)) return true;
  if (await handleBalances(req, res, options, pathname, method)) return true;
  if (await handleOpeningBalances(req, res, options, pathname, method)) return true;
  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}