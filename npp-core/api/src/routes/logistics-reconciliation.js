import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import {
  closeReconciledTrip,
  getTripReconciliation,
  receiveTripReturn,
} from '../services/logistics-trip-reconciliation.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.endsWith('_TRANSACTION_FAILED') || code.endsWith('_QUERY_FAILED')) return 503;
  if (code.startsWith('INVALID_') && code !== 'INVALID_TRIP_STATUS_TRANSITION') return 400;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('IDEMPOTENCY')
    || code.includes('EXCEEDS')
    || code.includes('UNRECONCILED')
    || code.includes('MISSING_ATTEMPTS')
    || code.includes('STATUS_TRANSITION')
    || code.includes('RECEIPT_POSTING')
  ) return 409;
  return 400;
}

function writeSuccess(res, data, options) {
  sendJson(
    res,
    200,
    createSuccessEnvelope(data, options.requestId, options.receivedAt),
    options.requestId,
  );
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(
      result.code,
      result.message,
      result.details ?? {},
      Boolean(result.retryable),
      statusFor(result.code),
    ),
    options.requestId,
    options.receivedAt,
  );
}

function withWarehouseScopes(requestContext, scopedWarehouseIds) {
  const scopes = Object.freeze({
    branchIds: Object.freeze([...(requestContext.scopes?.branchIds ?? [])]),
    warehouseIds: Object.freeze(scopedWarehouseIds),
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

async function authenticateAndAuthorize(req, res, options, permission) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const context = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(context, permission).ok) {
    sendError(res, apiError('PERMISSION_DENIED', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return ensureWarehouseScopes(options.getPool(), context);
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must use 1-128 safe characters',
    };
  }
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(error.code, error.publicMessage, {}, false, error.statusCode),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

export async function handleLogisticsReconciliationRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const match = pathname.match(/^\/api\/logistics\/trips\/([^/]+)\/(reconciliation|return-receipts|close)$/);
  if (!match) return false;
  const tripId = match[1];
  const action = match[2];
  const method = String(req.method ?? 'GET').toUpperCase();

  try {
    if (action === 'reconciliation' && method === 'GET') {
      const requestContext = await authenticateAndAuthorize(
        req,
        res,
        options,
        options.PERMISSIONS.coreDeliveryTripReconciliationRead,
      );
      if (!requestContext) return true;
      const result = await getTripReconciliation(options.getPool(), { requestContext, tripId });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result.trip, options);
      return true;
    }

    if (action === 'return-receipts' && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(
        req,
        res,
        options,
        options.PERMISSIONS.coreDeliveryTripReturnReceive,
      );
      if (!requestContext) return true;
      const payload = await readPayload(req, res, options);
      if (payload === null) return true;
      const idempotency = requireIdempotency(req);
      if (!idempotency.ok) {
        sendError(res, apiError(idempotency.code, idempotency.message, {}, false, 400), options.requestId, options.receivedAt);
        return true;
      }
      const result = await receiveTripReturn({
        adapter: options.getPool(),
        requestContext,
        tripId,
        idempotencyKey: idempotency.key,
        payload,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result, options);
      return true;
    }

    if (action === 'close' && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(
        req,
        res,
        options,
        options.PERMISSIONS.coreDeliveryTripClose,
      );
      if (!requestContext) return true;
      const payload = await readPayload(req, res, options);
      if (payload === null) return true;
      const idempotency = requireIdempotency(req);
      if (!idempotency.ok) {
        sendError(res, apiError(idempotency.code, idempotency.message, {}, false, 400), options.requestId, options.receivedAt);
        return true;
      }
      const result = await closeReconciledTrip({
        adapter: options.getPool(),
        requestContext,
        tripId,
        idempotencyKey: idempotency.key,
        payload,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result, options);
      return true;
    }

    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'logistics_reconciliation_route_unexpected_error',
      requestId: options.requestId,
      name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
      message: String(error?.message ?? 'Unknown logistics reconciliation error')
        .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
        .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
        .replace(/[\r\n\t]+/g, ' ')
        .slice(0, 240),
    }));
    sendError(
      res,
      apiError('LOGISTICS_RECONCILIATION_QUERY_FAILED', 'Dữ liệu đối soát chuyến tạm thời không khả dụng', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }
}
