import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import {
  getAssignedDriverTrip,
  listAssignedDriverTrips,
} from '../services/logistics-driver-delivery.js';

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

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    const error = new Error('INVALID_QUERY_PARAMETER');
    error.code = 'INVALID_QUERY_PARAMETER';
    error.publicMessage = `Query parameter must be an integer between 0 and ${max}`;
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function writeSuccess(res, data, options) {
  res.setHeader('Cache-Control', 'no-store');
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

async function authenticateDriver(req, res, options) {
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
  if (!options.authorize(requestContext, options.PERMISSIONS.coreDeliveryTripDriverRead).ok) {
    sendError(
      res,
      apiError('PERMISSION_DENIED', 'Permission denied', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return requestContext;
}

export async function handleLogisticsDriverRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  if (pathname !== '/api/logistics/driver/trips'
      && !pathname.startsWith('/api/logistics/driver/trips/')) return false;

  const method = String(req.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    sendError(
      res,
      apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  try {
    const requestContext = await authenticateDriver(req, res, options);
    if (!requestContext) return true;

    if (pathname === '/api/logistics/driver/trips') {
      const result = await listAssignedDriverTrips(options.getPool(), {
        requestContext,
        limit: parseInteger(url.searchParams.get('limit'), 100, 500),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, { driver: result.driver, trips: result.trips }, options);
      return true;
    }

    const detailMatch = pathname.match(/^\/api\/logistics\/driver\/trips\/([^/]+)$/);
    if (!detailMatch) {
      sendError(
        res,
        apiError('NOT_FOUND', 'Route not found', {}, false, 404),
        options.requestId,
        options.receivedAt,
      );
      return true;
    }
    const result = await getAssignedDriverTrip(options.getPool(), {
      requestContext,
      tripId: detailMatch[1],
    });
    if (!result.ok) sendServiceError(res, result, options);
    else writeSuccess(res, { driver: result.driver, trip: result.trip }, options);
    return true;
  } catch (error) {
    if (typeof error?.statusCode === 'number' && typeof error?.publicMessage === 'string') {
      sendError(
        res,
        apiError(error.code, error.publicMessage, {}, false, error.statusCode),
        options.requestId,
        options.receivedAt,
      );
      return true;
    }
    console.error(JSON.stringify({
      event: 'logistics_driver_route_unexpected_error',
      requestId: options.requestId,
      name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    }));
    sendError(
      res,
      apiError('DELIVERY_DRIVER_ROUTE_FAILED', 'Delivery data is temporarily unavailable', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }
}
