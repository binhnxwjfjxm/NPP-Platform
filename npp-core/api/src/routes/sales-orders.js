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
import * as service from '../services/sales-order.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code.endsWith('_FORBIDDEN') || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND') || code === 'SALES_ORDER_NOT_FOUND') return 404;
  if (code === 'DOCUMENT_NUMBER_SERIES_UNAVAILABLE') return 503;
  if (code.includes('CONFLICT') || code.includes('DUPLICATE') || code.includes('LOCKED')
    || code.includes('IDEMPOTENCY') || code === 'INVALID_STATUS_TRANSITION'
    || code === 'AMENDMENT_DRAFT_EXISTS' || code === 'SALES_ORDER_HAS_EXECUTION_FACTS') return 409;
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
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) return requestContext;
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) return requestContext;
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
  const context = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(context, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return ensureWarehouseScopes(options.getPool(), context);
}

function eventTypeFor(action) {
  return {
    create: 'sales.sales_order.created',
    update_draft: 'sales.sales_order.draft_updated',
    confirm: 'sales.sales_order.confirmed',
    create_amendment: 'sales.sales_order.amendment_created',
    update_amendment: 'sales.sales_order.amendment_updated',
    confirm_amendment: 'sales.sales_order.amendment_confirmed',
    cancel: 'sales.sales_order.cancelled',
  }[action];
}

async function auditMutation(client, { requestContext, action, result, beforeData }) {
  const order = result.salesOrder;
  const metadata = {
    number: order.number,
    status: order.status,
    currentVersionNumber: order.currentVersionNumber,
    customerId: order.customerId,
    warehouseId: order.warehouseId,
    collectionPolicy: order.collectionPolicy,
  };
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action,
    resourceType: 'sales_order',
    resourceId: order.id,
    beforeData: beforeData ?? null,
    afterData: order,
    metadata,
  }));
  const outbox = buildOutboxEvent({
    requestContext,
    aggregateType: 'sales.sales_order',
    aggregateId: order.id,
    eventType: eventTypeFor(action),
    eventVersion: Number(order.currentVersionNumber),
    payload: order,
    metadata,
  });
  await insertOutboxEvent(client, outbox);
  return outbox.eventId;
}

async function executeIdempotentMutation(req, res, options, {
  requestContext, route, payload, action, statusCode = 200, mutate,
}) {
  const key = requireIdempotency(req);
  if (!key.ok) {
    sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
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
        const transaction = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const before = payload?.id
              ? await service.getSalesOrder(client, { requestContext, id: payload.id })
              : null;
            const result = await mutate(client, key.key);
            if (!result.ok) return { failed: true, result };
            await auditMutation(client, {
              requestContext,
              action,
              result,
              beforeData: before?.ok ? before.salesOrder : null,
            });
            return { salesOrder: result.salesOrder };
          },
        });
        if (transaction.failed) {
          const result = transaction.result;
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
          body: createSuccessEnvelope(transaction.salesOrder, options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body,
      execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('SALES_ORDER_TRANSACTION_FAILED', 'Sales Order transaction failed', {}, true, 503), options.requestId, options.receivedAt);
  }
}

async function executeDraftUpdate(res, options, { requestContext, action, mutate }) {
  try {
    const transaction = await withAuditOutboxTransaction({
      adapter: options.getPool(),
      mutate: async (client) => {
        const before = await service.getSalesOrder(client, { requestContext, id: mutate.id });
        const result = await mutate.run(client);
        if (!result.ok) return { failed: true, result };
        await auditMutation(client, {
          requestContext,
          action,
          result,
          beforeData: before.ok ? before.salesOrder : null,
        });
        return { salesOrder: result.salesOrder };
      },
    });
    if (transaction.failed) return sendServiceError(res, transaction.result, options);
    sendSuccess(res, transaction.salesOrder, options.requestId, options.receivedAt);
  } catch {
    sendError(res, apiError('SALES_ORDER_TRANSACTION_FAILED', 'Sales Order transaction failed', {}, true, 503), options.requestId, options.receivedAt);
  }
}

export async function handleSalesOrderRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== '/api/sales-orders' && !pathname.startsWith('/api/sales-orders/')) return false;
  const method = String(req.method || 'GET').toUpperCase();

  if (pathname === '/api/sales-orders' && method === 'GET') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderRead);
    if (!context) return true;
    const url = new URL(`http://localhost${req.url}`);
    try {
      const status = url.searchParams.get('status');
      const result = await service.listSalesOrders(options.getPool(), {
        requestContext: context,
        status: !status || status === 'all' ? null : status,
        customerId: url.searchParams.get('customerId'),
        warehouseId: url.searchParams.get('warehouseId'),
        search: url.searchParams.get('search'),
        limit: parseInteger(url.searchParams.get('limit'), 100, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.salesOrders, options.requestId, options.receivedAt);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (pathname === '/api/sales-orders' && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderCreate);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: '/api/sales-orders',
      payload,
      action: 'create',
      statusCode: 201,
      mutate: (client) => service.createSalesOrder(client, { requestContext: context, payload }),
    });
    return true;
  }

  const amendmentDraftMatch = pathname.match(/^\/api\/sales-orders\/([^/]+)\/amendments\/(\d+)\/draft$/);
  if (amendmentDraftMatch && method === 'PUT') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderAmend);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const [, id, version] = amendmentDraftMatch;
    await executeDraftUpdate(res, options, {
      requestContext: context,
      action: 'update_amendment',
      mutate: {
        id,
        run: (client) => service.updateSalesOrderDraft(client, { requestContext: context, id, versionNumber: Number(version), payload }),
      },
    });
    return true;
  }

  const amendmentConfirmMatch = pathname.match(/^\/api\/sales-orders\/([^/]+)\/amendments\/(\d+)\/confirm$/);
  if (amendmentConfirmMatch && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderAmend);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const [, id, version] = amendmentConfirmMatch;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/amendments/${version}/confirm`,
      payload: { ...payload, id, version },
      action: 'confirm_amendment',
      mutate: (client, key) => service.confirmSalesOrder(client, { requestContext: context, id, versionNumber: Number(version), idempotencyKey: key }),
    });
    return true;
  }

  const itemMatch = pathname.match(/^\/api\/sales-orders\/([^/]+)(?:\/(draft|confirm|amendments|cancel))?$/);
  if (!itemMatch) {
    sendError(res, apiError('NOT_FOUND', 'Route not found', {}, false, 404), options.requestId, options.receivedAt);
    return true;
  }
  const [, id, action] = itemMatch;

  if (!action && method === 'GET') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderRead);
    if (!context) return true;
    const result = await service.getSalesOrder(options.getPool(), { requestContext: context, id });
    if (!result.ok) sendServiceError(res, result, options);
    else sendSuccess(res, result.salesOrder, options.requestId, options.receivedAt);
    return true;
  }

  if (action === 'draft' && method === 'PUT') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderUpdateDraft);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeDraftUpdate(res, options, {
      requestContext: context,
      action: 'update_draft',
      mutate: {
        id,
        run: (client) => service.updateSalesOrderDraft(client, { requestContext: context, id, versionNumber: 1, payload }),
      },
    });
    return true;
  }

  if (action === 'confirm' && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderConfirm);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/confirm`,
      payload: { ...payload, id },
      action: 'confirm',
      mutate: (client, key) => service.confirmSalesOrder(client, { requestContext: context, id, versionNumber: 1, idempotencyKey: key }),
    });
    return true;
  }

  if (action === 'amendments' && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderAmend);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/amendments`,
      payload: { ...payload, id },
      action: 'create_amendment',
      statusCode: 201,
      mutate: (client) => service.createSalesOrderAmendment(client, { requestContext: context, id, payload }),
    });
    return true;
  }

  if (action === 'cancel' && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderCancel);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/cancel`,
      payload: { ...payload, id },
      action: 'cancel',
      mutate: (client) => service.cancelSalesOrder(client, { requestContext: context, id, payload }),
    });
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
