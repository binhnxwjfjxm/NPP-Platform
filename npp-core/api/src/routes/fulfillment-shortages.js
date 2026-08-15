import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import {
  executeCloseFulfillmentPicking,
  executeRecordFulfillmentShortage,
  getFulfillmentPickingCloseState,
} from '../services/sales-fulfillment-shortage.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('IDEMPOTENCY')
    || code.includes('EXCEEDS')
    || code.includes('ALREADY')
    || code.includes('BLOCKED')
  ) return 409;
  if (code.startsWith('INVALID_') || code.endsWith('_REQUIRED')) return 400;
  return 500;
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

function writeSuccess(res, data, options, statusCode = 200) {
  sendJson(
    res,
    statusCode,
    createSuccessEnvelope(data, options.requestId, options.receivedAt),
    options.requestId,
  );
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

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) {
      return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    }
    return { ok: true, key };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must use 1-128 safe characters',
    };
  }
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
    sendError(
      res,
      apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, permission).ok) {
    sendError(
      res,
      apiError('PERMISSION_DENIED', 'Permission denied', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return ensureWarehouseScopes(options.getPool(), requestContext);
}

async function executeMutation(req, res, options, permission, operation) {
  try {
    const requestContext = await authenticateAndAuthorize(req, res, options, permission);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const idempotency = requireIdempotency(req);
    if (!idempotency.ok) {
      sendError(
        res,
        apiError(idempotency.code, idempotency.message, {}, false, 400),
        options.requestId,
        options.receivedAt,
      );
      return true;
    }
    const result = await operation({ requestContext, payload, idempotencyKey: idempotency.key });
    if (!result.ok) sendServiceError(res, result, options);
    else writeSuccess(res, result, options, result.replayed ? 200 : 201);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'fulfillment_shortage_unexpected_error',
      requestId: options.requestId,
      name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    }));
    sendError(
      res,
      apiError('FULFILLMENT_SHORTAGE_FAILED', 'Fulfillment shortage operation failed', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
  return true;
}

export async function handleFulfillmentShortageRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const method = String(req.method ?? 'GET').toUpperCase();

  const shortageMatch = pathname.match(
    /^\/api\/inventory\/fulfillment-allocations\/([^/]+)\/shortage$/,
  );
  if (shortageMatch && method === 'POST') {
    return executeMutation(
      req,
      res,
      options,
      options.PERMISSIONS.coreFulfillmentPick,
      ({ requestContext, payload, idempotencyKey }) => executeRecordFulfillmentShortage({
        adapter: options.getPool(),
        requestContext,
        allocationId: shortageMatch[1],
        idempotencyKey,
        payload,
      }),
    );
  }

  const closeStateMatch = pathname.match(
    /^\/api\/inventory\/fulfillment-orders\/([^/]+)\/picking-close-state$/,
  );
  if (closeStateMatch && method === 'GET') {
    try {
      const requestContext = await authenticateAndAuthorize(
        req,
        res,
        options,
        options.PERMISSIONS.coreFulfillmentRead,
      );
      if (!requestContext) return true;
      const result = await getFulfillmentPickingCloseState(options.getPool(), {
        requestContext,
        salesOrderId: closeStateMatch[1],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result, options);
    } catch (error) {
      sendError(
        res,
        apiError('FULFILLMENT_CLOSE_STATE_FAILED', 'Picking close state is temporarily unavailable', {}, true, 503),
        options.requestId,
        options.receivedAt,
      );
    }
    return true;
  }

  const closeMatch = pathname.match(
    /^\/api\/inventory\/fulfillment-orders\/([^/]+)\/picking-close$/,
  );
  if (closeMatch && method === 'POST') {
    return executeMutation(
      req,
      res,
      options,
      options.PERMISSIONS.coreFulfillmentPick,
      ({ requestContext, payload, idempotencyKey }) => executeCloseFulfillmentPicking({
        adapter: options.getPool(),
        requestContext,
        salesOrderId: closeMatch[1],
        idempotencyKey,
        payload,
      }),
    );
  }

  return false;
}
