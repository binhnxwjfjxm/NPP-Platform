import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import * as purchaseOrderService from '../services/purchase-order.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND') || code === 'PURCHASE_ORDER_NOT_FOUND') return 404;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('DUPLICATE')
    || code.includes('IDEMPOTENCY')
    || code === 'PURCHASE_ORDER_LOCKED'
    || code === 'INVALID_STATUS_TRANSITION'
  ) return 409;
  if (code === 'DOCUMENT_NUMBER_SERIES_UNAVAILABLE') return 503;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(
    res,
    apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)),
    context.requestId,
    context.receivedAt,
  );
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

async function readPayload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(error.code, error.publicMessage, {}, false, error.statusCode),
      context.requestId,
      context.receivedAt,
    );
    return null;
  }
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
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
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
  if (!options.authorize(requestContext, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return ensureWarehouseScopes(options.getPool(), requestContext);
}

function eventTypeFor(action) {
  return {
    create: 'purchasing.purchase_order.created',
    update: 'purchasing.purchase_order.updated',
    submit: 'purchasing.purchase_order.submitted',
    approve: 'purchasing.purchase_order.approved',
    cancel: 'purchasing.purchase_order.cancelled',
  }[action];
}

async function executeIdempotentMutation(req, res, options, {
  requestContext,
  route,
  payload,
  action,
  statusCode = 200,
  mutate,
}) {
  const keyResult = requireIdempotency(req);
  if (!keyResult.ok) {
    sendError(res, apiError(keyResult.code, keyResult.message, {}, false, 400), options.requestId, options.receivedAt);
    return;
  }

  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route,
      payload,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const result = await mutate(client, keyResult.key);
            if (!result.ok) return { result, failed: true };
            const purchaseOrder = result.purchaseOrder;
            const metadata = {
              status: purchaseOrder.status,
              number: purchaseOrder.number,
              supplierId: purchaseOrder.supplierId,
              warehouseId: purchaseOrder.warehouseId,
              revision: purchaseOrder.revision,
            };
            await insertAuditRecord(client, buildAuditRecord({
              requestContext,
              action,
              resourceType: 'purchase_order',
              resourceId: purchaseOrder.id,
              beforeData: result.beforeData ?? null,
              afterData: purchaseOrder,
              metadata,
            }));
            const outboxEvent = buildOutboxEvent({
              requestContext,
              aggregateType: 'purchasing.purchase_order',
              aggregateId: purchaseOrder.id,
              eventType: eventTypeFor(action),
              eventVersion: 1,
              payload: purchaseOrder,
              metadata,
            });
            await insertOutboxEvent(client, outboxEvent);
            return { purchaseOrder, eventId: outboxEvent.eventId };
          },
        });

        if (transactionResult.failed) {
          const result = transactionResult.result;
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
          statusCode,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(transactionResult.purchaseOrder, options.requestId, options.receivedAt),
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
  } catch {
    sendError(
      res,
      apiError('PURCHASE_ORDER_TRANSACTION_FAILED', 'Purchase order transaction failed', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}

async function handleList(req, res, options, requestContext) {
  const url = new URL(`http://localhost${req.url}`);
  try {
    const status = url.searchParams.get('status');
    const result = await purchaseOrderService.listPurchaseOrders(options.getPool(), {
      requestContext,
      search: url.searchParams.get('search'),
      status: !status || status === 'all' ? null : status,
      supplierId: url.searchParams.get('supplierId'),
      warehouseId: url.searchParams.get('warehouseId'),
      limit: parseInteger(url.searchParams.get('limit'), 100, 1000),
      offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
    });
    if (!result.ok) return sendServiceError(res, result, options);
    sendSuccess(res, result.purchaseOrders, options.requestId, options.receivedAt);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
  }
}

async function handleSkuSearch(req, res, options, requestContext) {
  const url = new URL(`http://localhost${req.url}`);
  try {
    const result = await purchaseOrderService.searchPurchaseOrderSkuOptions(options.getPool(), {
      requestContext,
      search: url.searchParams.get('search') ?? '',
      limit: parseInteger(url.searchParams.get('limit'), 20, 50),
      offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
    });
    if (!result.ok) return sendServiceError(res, result, options);
    sendSuccess(res, result.skuOptions, options.requestId, options.receivedAt);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
  }
}

async function handleSkuResolve(req, res, options, requestContext) {
  const payload = await readPayload(req, res, options);
  if (payload === null) return;
  const result = await purchaseOrderService.resolvePurchaseOrderSkuIdentifiers(options.getPool(), {
    requestContext,
    identifiers: payload?.identifiers,
  });
  if (!result.ok) return sendServiceError(res, result, options);
  sendSuccess(res, result.resolutions, options.requestId, options.receivedAt);
}

async function handleGet(res, options, requestContext, id) {
  const result = await purchaseOrderService.getPurchaseOrder(options.getPool(), { requestContext, id });
  if (!result.ok) return sendServiceError(res, result, options);
  sendSuccess(res, result.purchaseOrder, options.requestId, options.receivedAt);
}

export async function handlePurchaseOrderRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== '/api/purchase-orders' && !pathname.startsWith('/api/purchase-orders/')) return false;
  const method = String(req.method || 'GET').toUpperCase();

  if (pathname === '/api/purchase-orders/sku-search' && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePurchaseOrderRead);
    if (!requestContext) return true;
    await handleSkuSearch(req, res, options, requestContext);
    return true;
  }

  if (pathname === '/api/purchase-orders/sku-resolve' && method === 'POST') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePurchaseOrderRead);
    if (!requestContext) return true;
    await handleSkuResolve(req, res, options, requestContext);
    return true;
  }

  if (pathname === '/api/purchase-orders' && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePurchaseOrderRead);
    if (!requestContext) return true;
    await handleList(req, res, options, requestContext);
    return true;
  }

  if (pathname === '/api/purchase-orders' && method === 'POST') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePurchaseOrderCreate);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext,
      route: '/api/purchase-orders',
      payload,
      action: 'create',
      statusCode: 201,
      mutate: (client) => purchaseOrderService.createPurchaseOrder(client, { requestContext, payload }),
    });
    return true;
  }

  const actionMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)\/(submit|approve|cancel)$/);
  if (actionMatch && method === 'POST') {
    const [, id, action] = actionMatch;
    const permission = {
      submit: options.PERMISSIONS.corePurchaseOrderSubmit,
      approve: options.PERMISSIONS.corePurchaseOrderApprove,
      cancel: options.PERMISSIONS.corePurchaseOrderCancel,
    }[action];
    const requestContext = await authenticateAndAuthorize(req, res, options, permission);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext,
      route: `/api/purchase-orders/${id}/${action}`,
      payload,
      action,
      mutate: (client, idempotencyKey) => {
        if (action === 'submit') return purchaseOrderService.submitPurchaseOrder(client, { requestContext, id, payload });
        if (action === 'approve') return purchaseOrderService.approvePurchaseOrder(client, { requestContext, id, payload, idempotencyKey });
        return purchaseOrderService.cancelPurchaseOrder(client, { requestContext, id, payload });
      },
    });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePurchaseOrderRead);
    if (!requestContext) return true;
    await handleGet(res, options, requestContext, detailMatch[1]);
    return true;
  }
  if (detailMatch && method === 'PATCH') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePurchaseOrderUpdate);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext,
      route: `/api/purchase-orders/${detailMatch[1]}`,
      payload,
      action: 'update',
      mutate: (client) => purchaseOrderService.updatePurchaseOrder(client, {
        requestContext,
        id: detailMatch[1],
        payload,
      }),
    });
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
