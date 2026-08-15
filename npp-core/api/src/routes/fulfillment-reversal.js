import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import {
  executeReverseFulfillmentOrder,
  executeReverseFulfillmentPack,
  executeReverseFulfillmentPick,
  getFulfillmentReversalState,
} from '../services/sales-fulfillment-reversal.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (
    code.includes('BLOCKED')
    || code.includes('CONFLICT')
    || code.includes('IDEMPOTENCY')
    || code.includes('EXCEEDS')
    || code === 'NOTHING_TO_REVERSE'
  ) return 409;
  return 400;
}

function writeSuccess(res, data, options, statusCode = 200) {
  sendJson(
    res,
    statusCode,
    createSuccessEnvelope(data, options.requestId, options.receivedAt),
    options.requestId,
  );
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)),
    options.requestId,
    options.receivedAt,
  );
}

async function ensureWarehouseScopes(client, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) {
    return requestContext;
  }
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) return requestContext;
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: true,
    limit: 10000,
    offset: 0,
  });
  const scopes = Object.freeze({
    branchIds: Object.freeze([...(requestContext.scopes?.branchIds ?? [])]),
    warehouseIds: Object.freeze(warehouses.map((warehouse) => warehouse.id)),
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
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    return null;
  }
}

export async function handleFulfillmentReversalRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const method = String(req.method ?? 'GET').toUpperCase();

  const stateMatch = pathname.match(/^\/api\/inventory\/fulfillment-orders\/([^/]+)\/reversal-state$/);
  if (stateMatch && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreFulfillmentRead);
    if (!requestContext) return true;
    try {
      const result = await getFulfillmentReversalState(options.getPool(), {
        requestContext,
        salesOrderId: stateMatch[1],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result, options);
    } catch (error) {
      console.error(JSON.stringify({ event: 'fulfillment_reversal_state_error', requestId: options.requestId, name: error?.name ?? 'Error' }));
      sendError(res, apiError('FULFILLMENT_REVERSAL_QUERY_FAILED', 'Fulfillment reversal data is temporarily unavailable', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  const allocationMatch = pathname.match(
    /^\/api\/inventory\/fulfillment-allocations\/([^/]+)\/reverse-(pick|pack)$/,
  );
  const orderMatch = pathname.match(/^\/api\/inventory\/fulfillment-orders\/([^/]+)\/reverse$/);
  if ((!allocationMatch && !orderMatch) || method !== 'POST') return false;

  const permission = allocationMatch?.[2] === 'pack'
    ? options.PERMISSIONS.coreFulfillmentPack
    : options.PERMISSIONS.coreFulfillmentPick;
  const requestContext = await authenticateAndAuthorize(req, res, options, permission);
  if (!requestContext) return true;
  const payload = await readPayload(req, res, options);
  if (payload === null) return true;
  const idempotency = requireIdempotency(req);
  if (!idempotency.ok) {
    sendError(res, apiError(idempotency.code, idempotency.message, {}, false, 400), options.requestId, options.receivedAt);
    return true;
  }

  try {
    let result;
    if (orderMatch) {
      result = await executeReverseFulfillmentOrder({
        adapter: options.getPool(),
        requestContext,
        salesOrderId: orderMatch[1],
        idempotencyKey: idempotency.key,
        payload,
      });
    } else if (allocationMatch[2] === 'pick') {
      result = await executeReverseFulfillmentPick({
        adapter: options.getPool(),
        requestContext,
        allocationId: allocationMatch[1],
        idempotencyKey: idempotency.key,
        payload,
      });
    } else {
      result = await executeReverseFulfillmentPack({
        adapter: options.getPool(),
        requestContext,
        allocationId: allocationMatch[1],
        idempotencyKey: idempotency.key,
        payload,
      });
    }
    if (!result.ok) sendServiceError(res, result, options);
    else writeSuccess(res, result, options, result.replayed ? 200 : 201);
  } catch (error) {
    console.error(JSON.stringify({ event: 'fulfillment_reversal_error', requestId: options.requestId, name: error?.name ?? 'Error' }));
    sendError(res, apiError('FULFILLMENT_REVERSAL_FAILED', 'Fulfillment reversal failed', {}, true, 503), options.requestId, options.receivedAt);
  }
  return true;
}
