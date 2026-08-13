import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import { assignDeliveryOrders } from '../services/logistics-trip-batch-assignment.js';
import {
  createDriverProfile,
  listDriverEmployees,
  listDriverProfiles,
  lockDeliveryTrip,
  planDeliveryTrip,
} from '../services/logistics-driver-profile.js';
import {
  createDeliveryRoute,
  createDeliveryTrip,
  createVehicle,
  getDeliveryTrip,
  listDeliveryRoutes,
  listDeliveryTrips,
  listEligibleDeliveryOrders,
  listVehicles,
  reopenDeliveryTrip,
  reorderTripStops,
  unassignDeliveryOrder,
  updateDeliveryTrip,
} from '../services/logistics-trip-planning.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.endsWith('_TRANSACTION_FAILED') || code.endsWith('_QUERY_FAILED')) return 503;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('DUPLICATE')
    || code.includes('IDEMPOTENCY')
    || code.includes('ALREADY_ASSIGNED')
    || code.includes('ALREADY_LINKED')
    || code.includes('LOCKED')
    || code.includes('NOT_EDITABLE')
    || code.includes('NOT_ELIGIBLE')
    || code.includes('NOT_AVAILABLE')
    || code.includes('ASSIGNMENT_REQUIRED')
    || code.includes('STATUS_TRANSITION')
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

function sanitizedUnexpectedError(error, requestId) {
  const message = typeof error?.message === 'string'
    ? error.message
        .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
        .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
        .replace(/[\r\n\t]+/g, ' ')
        .slice(0, 240)
    : 'Unknown logistics error';
  return {
    event: 'logistics_route_unexpected_error',
    requestId,
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    message,
  };
}

function sendUnexpectedError(res, error, options) {
  if (error && typeof error.statusCode === 'number' && typeof error.publicMessage === 'string') {
    sendError(
      res,
      apiError(error.code ?? 'INVALID_QUERY_PARAMETER', error.publicMessage, {}, false, error.statusCode),
      options.requestId,
      options.receivedAt,
    );
    return;
  }
  console.error(JSON.stringify(sanitizedUnexpectedError(error, options.requestId)));
  sendError(
    res,
    apiError('LOGISTICS_QUERY_FAILED', 'Dữ liệu điều phối tạm thời không khả dụng', {}, true, 503),
    options.requestId,
    options.receivedAt,
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
  const context = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(context, permission).ok) {
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

async function executeRead(req, res, options, { permission, operation, select }) {
  try {
    const requestContext = await authenticateAndAuthorize(req, res, options, permission);
    if (!requestContext) return true;
    const result = await operation(requestContext);
    if (!result.ok) sendServiceError(res, result, options);
    else writeSuccess(res, select(result), options);
  } catch (error) {
    sendUnexpectedError(res, error, options);
  }
  return true;
}

async function executeBusinessMutation(req, res, options, { permission, operation, statusCode = 201 }) {
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
    else writeSuccess(res, result, options, result.replayed ? 200 : statusCode);
  } catch (error) {
    sendUnexpectedError(res, error, options);
  }
  return true;
}

async function executeMasterMutation(req, res, options, { permission, route, operation, select }) {
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
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route,
      payload,
      onProcess: async () => {
        const result = await operation({ requestContext, payload });
        if (!result.ok) {
          return {
            statusCode: statusFor(result.code),
            contentType: 'application/json',
            requestId: options.requestId,
            body: {
              error: {
                code: result.code,
                message: result.message,
                retryable: Boolean(result.retryable),
                details: result.details ?? {},
              },
              requestId: options.requestId,
              receivedAt: options.receivedAt,
            },
          };
        }
        return {
          statusCode: 201,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(select(result), options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(
      res,
      execution.response.statusCode,
      execution.response.body,
      execution.response.requestId ?? options.requestId,
      execution.response.contentType,
    );
  } catch (error) {
    sendUnexpectedError(res, error, options);
  }
  return true;
}

export async function handleLogisticsRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  if (pathname !== '/api/logistics' && !pathname.startsWith('/api/logistics/')) return false;
  const method = String(req.method ?? 'GET').toUpperCase();

  if (pathname === '/api/logistics/routes' && method === 'GET') {
    return executeRead(req, res, options, {
      permission: options.PERMISSIONS.coreLogisticsRouteRead,
      operation: (requestContext) => listDeliveryRoutes(options.getPool(), {
        requestContext,
        active: parseBoolean(url.searchParams.get('active')),
        limit: parseInteger(url.searchParams.get('limit'), 200, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      }),
      select: (result) => result.routes,
    });
  }

  if (pathname === '/api/logistics/routes' && method === 'POST') {
    return executeMasterMutation(req, res, options, {
      permission: options.PERMISSIONS.coreLogisticsRouteManage,
      route: pathname,
      operation: ({ requestContext, payload }) => createDeliveryRoute({
        adapter: options.getPool(), requestContext, payload,
      }),
      select: (result) => result.delivery_route,
    });
  }

  if (pathname === '/api/logistics/vehicles' && method === 'GET') {
    return executeRead(req, res, options, {
      permission: options.PERMISSIONS.coreVehicleRead,
      operation: (requestContext) => listVehicles(options.getPool(), {
        requestContext,
        active: parseBoolean(url.searchParams.get('active')),
        limit: parseInteger(url.searchParams.get('limit'), 200, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      }),
      select: (result) => result.vehicles,
    });
  }

  if (pathname === '/api/logistics/vehicles' && method === 'POST') {
    return executeMasterMutation(req, res, options, {
      permission: options.PERMISSIONS.coreVehicleManage,
      route: pathname,
      operation: ({ requestContext, payload }) => createVehicle({
        adapter: options.getPool(), requestContext, payload,
      }),
      select: (result) => result.vehicle,
    });
  }

  if (pathname === '/api/logistics/driver-employees' && method === 'GET') {
    return executeRead(req, res, options, {
      permission: options.PERMISSIONS.coreDriverProfileRead,
      operation: (requestContext) => listDriverEmployees(options.getPool(), {
        requestContext,
        limit: parseInteger(url.searchParams.get('limit'), 1000, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      }),
      select: (result) => result.employees,
    });
  }

  if (pathname === '/api/logistics/drivers' && method === 'GET') {
    return executeRead(req, res, options, {
      permission: options.PERMISSIONS.coreDriverProfileRead,
      operation: (requestContext) => listDriverProfiles(options.getPool(), {
        requestContext,
        active: parseBoolean(url.searchParams.get('active')),
        limit: parseInteger(url.searchParams.get('limit'), 200, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      }),
      select: (result) => result.drivers,
    });
  }

  if (pathname === '/api/logistics/drivers' && method === 'POST') {
    return executeMasterMutation(req, res, options, {
      permission: options.PERMISSIONS.coreDriverProfileManage,
      route: pathname,
      operation: ({ requestContext, payload }) => createDriverProfile({
        adapter: options.getPool(), requestContext, payload,
      }),
      select: (result) => result.driver_profile,
    });
  }

  if (pathname === '/api/logistics/eligible-delivery-orders' && method === 'GET') {
    return executeRead(req, res, options, {
      permission: options.PERMISSIONS.coreDeliveryTripRead,
      operation: (requestContext) => listEligibleDeliveryOrders(options.getPool(), {
        requestContext,
        warehouseId: url.searchParams.get('warehouseId'),
        limit: parseInteger(url.searchParams.get('limit'), 500, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      }),
      select: (result) => result.deliveryOrders,
    });
  }

  if (pathname === '/api/logistics/trips' && method === 'GET') {
    return executeRead(req, res, options, {
      permission: options.PERMISSIONS.coreDeliveryTripRead,
      operation: (requestContext) => listDeliveryTrips(options.getPool(), {
        requestContext,
        status: !url.searchParams.get('status') || url.searchParams.get('status') === 'all'
          ? null
          : url.searchParams.get('status'),
        limit: parseInteger(url.searchParams.get('limit'), 200, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      }),
      select: (result) => result.trips,
    });
  }

  if (pathname === '/api/logistics/trips' && method === 'POST') {
    return executeBusinessMutation(req, res, options, {
      permission: options.PERMISSIONS.coreDeliveryTripCreate,
      operation: ({ requestContext, payload, idempotencyKey }) => createDeliveryTrip({
        adapter: options.getPool(), requestContext, payload, idempotencyKey,
      }),
    });
  }

  const detailMatch = pathname.match(/^\/api\/logistics\/trips\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    return executeRead(req, res, options, {
      permission: options.PERMISSIONS.coreDeliveryTripRead,
      operation: (requestContext) => getDeliveryTrip(options.getPool(), {
        requestContext, tripId: detailMatch[1],
      }),
      select: (result) => result.trip,
    });
  }

  if (detailMatch && method === 'PUT') {
    return executeBusinessMutation(req, res, options, {
      permission: options.PERMISSIONS.coreDeliveryTripPlan,
      operation: ({ requestContext, payload, idempotencyKey }) => updateDeliveryTrip({
        adapter: options.getPool(), requestContext, tripId: detailMatch[1], payload, idempotencyKey,
      }),
      statusCode: 200,
    });
  }

  const actionMatch = pathname.match(/^\/api\/logistics\/trips\/([^/]+)\/(assign|unassign|reorder|plan|reopen|lock)$/);
  if (actionMatch && method === 'POST') {
    const [, tripId, action] = actionMatch;
    const actions = {
      assign: {
        permission: options.PERMISSIONS.coreDeliveryTripAssign,
        operation: assignDeliveryOrders,
      },
      unassign: {
        permission: options.PERMISSIONS.coreDeliveryTripAssign,
        operation: unassignDeliveryOrder,
      },
      reorder: {
        permission: options.PERMISSIONS.coreDeliveryTripAssign,
        operation: reorderTripStops,
      },
      plan: {
        permission: options.PERMISSIONS.coreDeliveryTripPlan,
        operation: planDeliveryTrip,
      },
      reopen: {
        permission: options.PERMISSIONS.coreDeliveryTripPlan,
        operation: reopenDeliveryTrip,
      },
      lock: {
        permission: options.PERMISSIONS.coreDeliveryTripLock,
        operation: lockDeliveryTrip,
      },
    };
    const selected = actions[action];
    return executeBusinessMutation(req, res, options, {
      permission: selected.permission,
      operation: ({ requestContext, payload, idempotencyKey }) => selected.operation({
        adapter: options.getPool(), requestContext, tripId, payload, idempotencyKey,
      }),
      statusCode: 200,
    });
  }

  sendError(
    res,
    apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405),
    options.requestId,
    options.receivedAt,
  );
  return true;
}
