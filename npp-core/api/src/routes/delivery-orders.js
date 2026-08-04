import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import {
  executeCancelDeliveryOrder,
  executeConfirmDeliveryOrder,
  executeCreateDeliveryOrder,
  getDeliveryOrder,
  listDeliveryOrderEligibility,
  listDeliveryOrders,
} from '../services/sales-delivery-orders.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code === 'DOCUMENT_NUMBER_SERIES_UNAVAILABLE' || code === 'DELIVERY_ORDER_TRANSACTION_FAILED') return 503;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('DUPLICATE')
    || code.includes('IDEMPOTENCY')
    || code === 'INVALID_STATUS_TRANSITION'
    || code === 'PACKED_ALLOCATION_NOT_ELIGIBLE'
  ) return 409;
  return 400;
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
  const name = typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error';
  const code = typeof error?.code === 'string' ? error.code.slice(0, 80) : null;
  const message = typeof error?.message === 'string'
    ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 240)
    : 'Unknown Delivery Order error';
  return { event: 'delivery_order_unexpected_error', requestId, name, code, message };
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
    apiError(
      'DELIVERY_ORDER_QUERY_FAILED',
      'Delivery Order data is temporarily unavailable',
      {},
      true,
      503,
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

async function executeMutation(req, res, options, { permission, operation }) {
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
    sendUnexpectedError(res, error, options);
  }
  return true;
}

export async function handleDeliveryOrderRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== '/api/delivery-orders' && !pathname.startsWith('/api/delivery-orders/')) return false;
  const method = String(req.method ?? 'GET').toUpperCase();

  if (pathname === '/api/delivery-orders/eligibility' && method === 'GET') {
    try {
      const requestContext = await authenticateAndAuthorize(
        req,
        res,
        options,
        options.PERMISSIONS.coreDeliveryOrderRead,
      );
      if (!requestContext) return true;
      const url = new URL(`http://localhost${req.url}`);
      const result = await listDeliveryOrderEligibility(options.getPool(), {
        requestContext,
        salesOrderId: url.searchParams.get('salesOrderId'),
        limit: parseInteger(url.searchParams.get('limit'), 500, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result.eligibility, options);
    } catch (error) {
      sendUnexpectedError(res, error, options);
    }
    return true;
  }

  if (pathname === '/api/delivery-orders' && method === 'GET') {
    try {
      const requestContext = await authenticateAndAuthorize(
        req,
        res,
        options,
        options.PERMISSIONS.coreDeliveryOrderRead,
      );
      if (!requestContext) return true;
      const url = new URL(`http://localhost${req.url}`);
      const status = url.searchParams.get('status');
      const result = await listDeliveryOrders(options.getPool(), {
        requestContext,
        status: !status || status === 'all' ? null : status,
        salesOrderId: url.searchParams.get('salesOrderId'),
        limit: parseInteger(url.searchParams.get('limit'), 200, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result.deliveryOrders, options);
    } catch (error) {
      sendUnexpectedError(res, error, options);
    }
    return true;
  }

  if (pathname === '/api/delivery-orders' && method === 'POST') {
    return executeMutation(req, res, options, {
      permission: options.PERMISSIONS.coreDeliveryOrderCreate,
      operation: ({ requestContext, payload, idempotencyKey }) => executeCreateDeliveryOrder({
        adapter: options.getPool(),
        requestContext,
        payload,
        idempotencyKey,
      }),
    });
  }

  const transitionMatch = pathname.match(/^\/api\/delivery-orders\/([^/]+)\/(confirm|cancel)$/);
  if (transitionMatch && method === 'POST') {
    const [, deliveryOrderId, action] = transitionMatch;
    const confirm = action === 'confirm';
    return executeMutation(req, res, options, {
      permission: confirm
        ? options.PERMISSIONS.coreDeliveryOrderConfirm
        : options.PERMISSIONS.coreDeliveryOrderCancel,
      operation: ({ requestContext, payload, idempotencyKey }) => (confirm
        ? executeConfirmDeliveryOrder({
            adapter: options.getPool(),
            requestContext,
            deliveryOrderId,
            payload,
            idempotencyKey,
          })
        : executeCancelDeliveryOrder({
            adapter: options.getPool(),
            requestContext,
            deliveryOrderId,
            payload,
            idempotencyKey,
          })),
    });
  }

  const detailMatch = pathname.match(/^\/api\/delivery-orders\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    try {
      const requestContext = await authenticateAndAuthorize(
        req,
        res,
        options,
        options.PERMISSIONS.coreDeliveryOrderRead,
      );
      if (!requestContext) return true;
      const result = await getDeliveryOrder(options.getPool(), {
        requestContext,
        deliveryOrderId: detailMatch[1],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result.deliveryOrder, options);
    } catch (error) {
      sendUnexpectedError(res, error, options);
    }
    return true;
  }

  sendError(
    res,
    apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405),
    options.requestId,
    options.receivedAt,
  );
  return true;
}
