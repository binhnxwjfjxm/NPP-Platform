import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import { getDeliveryTripAttemptSummary } from '../services/logistics-delivery-attempt-read.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.endsWith('_QUERY_FAILED')) return 503;
  return 400;
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

async function authenticateDispatcher(req, res, options) {
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
  const context = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(context, options.PERMISSIONS.coreDeliveryAttemptRead).ok
      || !options.authorize(context, options.PERMISSIONS.coreDeliveryTripRead).ok) {
    sendError(
      res,
      apiError('PERMISSION_DENIED', 'Permission denied', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return ensureWarehouseScopes(options.getPool(), context);
}

export async function handleLogisticsAttemptRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const match = pathname.match(/^\/api\/logistics\/trips\/([^/]+)\/attempts$/);
  if (!match) return false;
  if (String(req.method ?? 'GET').toUpperCase() !== 'GET') {
    sendError(
      res,
      apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  try {
    const requestContext = await authenticateDispatcher(req, res, options);
    if (!requestContext) return true;
    const result = await getDeliveryTripAttemptSummary(options.getPool(), {
      requestContext,
      tripId: match[1],
    });
    if (!result.ok) {
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
    } else {
      res.setHeader('Cache-Control', 'no-store');
      sendJson(
        res,
        200,
        createSuccessEnvelope({ trip: result.trip, attempts: result.attempts }, options.requestId, options.receivedAt),
        options.requestId,
      );
    }
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'logistics_attempt_read_route_failed',
      requestId: options.requestId,
      name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    }));
    sendError(
      res,
      apiError('DELIVERY_ATTEMPT_SUMMARY_QUERY_FAILED', 'Delivery attempt summary is temporarily unavailable', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }
}
