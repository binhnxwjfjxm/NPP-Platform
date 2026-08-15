import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import { executeReleaseDeliveryOrderForReversal } from '../services/sales-delivery-order-reversal.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('BLOCKED') || code.includes('CONFLICT') || code.includes('IDEMPOTENCY') || code.includes('NOT_READY')) return 409;
  return 400;
}

async function scopedContext(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  let context = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(context, options.PERMISSIONS.coreDeliveryOrderCancel).ok) {
    sendError(res, apiError('PERMISSION_DENIED', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  if ((!context.scopes?.warehouseIds?.length) && context.roles?.includes('bootstrap')) {
    const warehouses = await warehouseRepository.listWarehousesForInstallation(options.getPool(), {
      installationId: context.installationId,
      active: true,
      limit: 10000,
      offset: 0,
    });
    const scopes = Object.freeze({
      branchIds: Object.freeze([...(context.scopes?.branchIds ?? [])]),
      warehouseIds: Object.freeze(warehouses.map((warehouse) => warehouse.id)),
      territoryIds: Object.freeze([...(context.scopes?.territoryIds ?? [])]),
    });
    context = Object.freeze({ ...context, scopes, authContext: context.authContext ? Object.freeze({ ...context.authContext, scopes }) : context.authContext });
  }
  return context;
}

export async function handleDeliveryOrderReversalRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const match = pathname.match(/^\/api\/delivery-orders\/([^/]+)\/release-for-reversal$/);
  if (!match) return false;
  if (String(req.method ?? 'GET').toUpperCase() !== 'POST') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = await scopedContext(req, res, options);
  if (!requestContext) return true;
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    return true;
  }
  let idempotencyKey;
  try {
    idempotencyKey = normalizeIdempotencyKey(req.headers['idempotency-key']);
  } catch (error) {
    sendError(res, apiError(error.code ?? 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must use 1-128 safe characters', {}, false, 400), options.requestId, options.receivedAt);
    return true;
  }
  if (!idempotencyKey) {
    sendError(res, apiError('MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required', {}, false, 400), options.requestId, options.receivedAt);
    return true;
  }
  try {
    const result = await executeReleaseDeliveryOrderForReversal({
      adapter: options.getPool(),
      requestContext,
      deliveryOrderId: match[1],
      idempotencyKey,
      payload,
    });
    if (!result.ok) {
      sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)), options.requestId, options.receivedAt);
    } else {
      sendJson(res, result.replayed ? 200 : 201, createSuccessEnvelope(result, options.requestId, options.receivedAt), options.requestId);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'delivery_order_reversal_error', requestId: options.requestId, name: error?.name ?? 'Error' }));
    sendError(res, apiError('DELIVERY_ORDER_REVERSAL_FAILED', 'Delivery Order reversal failed', {}, true, 503), options.requestId, options.receivedAt);
  }
  return true;
}
