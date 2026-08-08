import { createErrorEnvelope, createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as service from '../services/customer-portal.js';

const ORDER_PATH = /^\/api\/customer-portal\/orders\/([0-9a-f-]{36})$/i;
const CANCEL_PATH = /^\/api\/customer-portal\/orders\/([0-9a-f-]{36})\/cancel$/i;
const STATIC_PATHS = new Set([
  '/api/customer-portal/me',
  '/api/customer-portal/addresses',
  '/api/customer-portal/catalog',
  '/api/customer-portal/orders',
]);
const RETRYABLE_ERROR_CODES = new Set(['40001', '40P01', '57P01', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code, fallback = 400) {
  if (code === 'CUSTOMER_PORTAL_AUTH_REQUIRED' || code.includes('TOKEN_')) return 401;
  if (code.includes('MEMBERSHIP') || code.endsWith('_FORBIDDEN') || code === 'DELIVERY_ADDRESS_NOT_FOUND') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code === 'INVALID_IDEMPOTENCY_KEY' || code === 'MISSING_IDEMPOTENCY_KEY') return 400;
  if (code.includes('CONFLICT') || code.includes('DUPLICATE') || code.includes('IDEMPOTENCY') || code === 'INVALID_STATUS_TRANSITION' || code === 'SALES_ORDER_HAS_EXECUTION_FACTS') return 409;
  if (code.includes('UNAVAILABLE') || code.includes('NOT_CONFIGURED')) return 503;
  return fallback;
}

function isKnownPath(pathname) {
  return STATIC_PATHS.has(pathname) || ORDER_PATH.test(pathname) || CANCEL_PATH.test(pathname);
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(result.code, result.message ?? 'Yêu cầu Customer Portal không thành công.', result.details ?? {}, Boolean(result.retryable), result.statusCode ?? statusFor(result.code)),
    options.requestId,
    options.receivedAt,
  );
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    return null;
  }
}

function idempotencyKey(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key ? { ok: true, key } : { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key is invalid' };
  }
}

async function authenticatePortal(req, res, options) {
  const auth = await options.customerPortalAuth.authenticate(req);
  if (!auth.ok) {
    if (auth.statusCode === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError(auth.code, auth.statusCode === 503 ? 'Customer Portal authentication is unavailable.' : 'Authorization required.', {}, auth.statusCode === 503, auth.statusCode), options.requestId, options.receivedAt);
    return null;
  }
  const membershipResult = await service.resolvePortalMembership(options.getPool(), {
    installationId: options.config.installationId,
    subject: auth.subject,
  });
  if (!membershipResult.ok) {
    sendServiceError(res, membershipResult, options);
    return null;
  }
  const requestContext = service.createPortalRequestContext(
    options.createContext,
    options.config,
    membershipResult.membership,
    { requestId: options.requestId, receivedAt: options.receivedAt },
  );
  req.requestContext = requestContext;
  return Object.freeze({ requestContext, membership: membershipResult.membership, claims: auth.claims });
}

async function auditMutation(client, { requestContext, action, eventType, order }) {
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action,
    resourceType: 'sales_order',
    resourceId: order.id,
    afterData: order,
    metadata: { source: 'CUSTOMER_PORTAL' },
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'sales_order',
    aggregateId: order.id,
    eventType,
    eventVersion: 1,
    payload: order,
    metadata: { source: 'CUSTOMER_PORTAL' },
  }));
}

function rollbackBusinessFailure(result) {
  return Object.freeze({ ...result, failed: true });
}

function auditedBusinessSuccess(result) {
  return Object.freeze({ ...result, expectedAuditCount: 1, expectedOutboxCount: 1 });
}

function idempotentSuccess(data, options, statusCode = 200) {
  return { statusCode, contentType: 'application/json', requestId: options.requestId, body: createSuccessEnvelope(data, options.requestId, options.receivedAt) };
}

function idempotentFailure(result, options) {
  const error = apiError(result.code, result.message ?? 'Yêu cầu Customer Portal không thành công.', result.details ?? {}, Boolean(result.retryable), result.statusCode ?? statusFor(result.code));
  return { statusCode: error.statusCode, contentType: 'application/json', requestId: options.requestId, body: createErrorEnvelope(error, options.requestId, options.receivedAt) };
}

function parseCatalogQuery(url) {
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  return {
    search: (url.searchParams.get('search') ?? '').slice(0, 256),
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 50,
    offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
  };
}

function unexpectedMutationError(error, operation, options) {
  const code = typeof error?.code === 'string' ? error.code : null;
  const retryable = error?.retryable === true || (code ? RETRYABLE_ERROR_CODES.has(code) : false);
  console.error(JSON.stringify({
    event: 'customer_portal_mutation_error',
    operation,
    requestId: options.requestId,
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error ?? 'unknown'),
      code,
    },
  }));
  return apiError(
    operation === 'create' ? 'CUSTOMER_PORTAL_ORDER_CREATE_FAILED' : 'CUSTOMER_PORTAL_ORDER_CANCEL_FAILED',
    operation === 'create' ? 'Không thể tạo đơn hàng.' : 'Không thể hủy đơn hàng.',
    {},
    retryable,
    retryable ? 503 : 500,
  );
}

export async function handleCustomerPortalRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/customer-portal')) return false;
  const portal = await authenticatePortal(req, res, options);
  if (!portal) return true;
  const { requestContext, membership } = portal;
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET' && url.pathname === '/api/customer-portal/me') {
    sendSuccess(res, { profile: service.portalProfile(membership) }, options.requestId, options.receivedAt);
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/customer-portal/addresses') {
    const result = await service.listPortalAddresses(options.getPool(), { requestContext, membership });
    result.ok ? sendSuccess(res, { addresses: result.addresses }, options.requestId, options.receivedAt) : sendServiceError(res, result, options);
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/customer-portal/catalog') {
    const result = await service.listPortalCatalog(options.getPool(), { requestContext, membership, ...parseCatalogQuery(url) });
    result.ok ? sendSuccess(res, { items: result.items, limit: result.limit, offset: result.offset, hasMore: result.hasMore }, options.requestId, options.receivedAt) : sendServiceError(res, result, options);
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/customer-portal/orders') {
    const result = await service.listPortalOrders(options.getPool(), { requestContext, membership });
    result.ok ? sendSuccess(res, { orders: result.orders }, options.requestId, options.receivedAt) : sendServiceError(res, result, options);
    return true;
  }

  const orderMatch = ORDER_PATH.exec(url.pathname);
  if (req.method === 'GET' && orderMatch) {
    const result = await service.getPortalOrder(options.getPool(), { requestContext, membership, orderId: orderMatch[1] });
    result.ok ? sendSuccess(res, { order: result.order }, options.requestId, options.receivedAt) : sendServiceError(res, result, options);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/customer-portal/orders') {
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const key = idempotencyKey(req);
    if (!key.ok) {
      sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: '/api/customer-portal/orders',
        payload,
        onProcess: async () => {
          const result = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const created = await service.createPortalOrder(client, { requestContext, membership, idempotencyKey: key.key, payload });
              if (!created.ok) return rollbackBusinessFailure(created);
              await auditMutation(client, { requestContext, action: 'customer_portal_create', eventType: 'sales.sales_order.customer_portal_created', order: created.order });
              return auditedBusinessSuccess(created);
            },
          });
          if (!result.ok) return idempotentFailure(result, options);
          return idempotentSuccess({ order: result.order }, options, 201);
        },
      });
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch (error) {
      sendError(res, unexpectedMutationError(error, 'create', options), options.requestId, options.receivedAt);
    }
    return true;
  }

  const cancelMatch = CANCEL_PATH.exec(url.pathname);
  if (req.method === 'POST' && cancelMatch) {
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const key = idempotencyKey(req);
    if (!key.ok) {
      sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: `/api/customer-portal/orders/${cancelMatch[1]}/cancel`,
        payload,
        onProcess: async () => {
          const result = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const cancelled = await service.cancelPortalOrder(client, { requestContext, membership, orderId: cancelMatch[1] });
              if (!cancelled.ok) return rollbackBusinessFailure(cancelled);
              await auditMutation(client, { requestContext, action: 'customer_portal_cancel', eventType: 'sales.sales_order.customer_portal_cancelled', order: cancelled.order });
              return auditedBusinessSuccess(cancelled);
            },
          });
          if (!result.ok) return idempotentFailure(result, options);
          return idempotentSuccess({ order: result.order }, options);
        },
      });
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch (error) {
      sendError(res, unexpectedMutationError(error, 'cancel', options), options.requestId, options.receivedAt);
    }
    return true;
  }

  const knownPath = isKnownPath(url.pathname);
  sendError(
    res,
    apiError(knownPath ? 'METHOD_NOT_ALLOWED' : 'CUSTOMER_PORTAL_ROUTE_NOT_FOUND', knownPath ? 'Method not allowed' : 'Route not found', {}, false, knownPath ? 405 : 404),
    options.requestId,
    options.receivedAt,
  );
  return true;
}
