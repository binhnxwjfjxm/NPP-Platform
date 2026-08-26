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
import * as entryService from '../services/sales-order-entry.js';
import * as searchPreviewService from '../services/sales-order-search-preview.js';
import * as manualStockIssueService from '../services/sales-manual-stock-issue.js';
import * as pickupStockIssueService from '../services/sales-pickup-stock-issue.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code.endsWith('_FORBIDDEN') || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND') || code === 'SALES_ORDER_NOT_FOUND') return 404;
  if (code === 'DOCUMENT_NUMBER_SERIES_UNAVAILABLE') return 503;
  if (
    code.includes('CONFLICT')
    || code.includes('DUPLICATE')
    || code.includes('LOCKED')
    || code.includes('IDEMPOTENCY')
    || code === 'INVALID_STATUS_TRANSITION'
    || code === 'AMENDMENT_DRAFT_EXISTS'
    || code === 'SALES_ORDER_HAS_EXECUTION_FACTS'
    || code === 'MANUAL_DELIVERY_EDIT_NOT_AVAILABLE'
  ) return 409;
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
    if (!key) {
      return {
        ok: false,
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required',
      };
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
      apiError('FORBIDDEN', 'Permission denied', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
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
    manual_quick_edit: 'sales.sales_order.manual_quick_edited',
    pickup_quick_edit: 'sales.sales_order.pickup_quick_edited',
    manual_stock_issue: 'sales.sales_order.manual_stock_issued',
    pickup_stock_issue: 'sales.sales_order.pickup_stock_issued',
    cancel: 'sales.sales_order.cancelled',
    close_execution: 'sales.sales_order.execution_closed',
  }[action];
}

async function writeAuditOutbox(client, { requestContext, action, result, beforeData }) {
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
  requestContext,
  route,
  payload,
  action,
  resourceId = null,
  statusCode = 200,
  mutate,
}) {
  const keyResult = requireIdempotency(req);
  if (!keyResult.ok) {
    sendError(
      res,
      apiError(keyResult.code, keyResult.message, {}, false, 400),
      options.requestId,
      options.receivedAt,
    );
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
            const before = resourceId
              ? await service.getSalesOrder(client, { requestContext, id: resourceId })
              : null;
            const result = await mutate(client, keyResult.key);
            if (!result.ok) return { failed: true, result };
            const eventId = await writeAuditOutbox(client, {
              requestContext,
              action,
              result,
              beforeData: before?.ok ? before.salesOrder : null,
            });
            return { salesOrder: result.salesOrder, eventId };
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
    sendJson(
      res,
      execution.response.statusCode,
      execution.response.body,
      execution.response.requestId ?? options.requestId,
      execution.response.contentType,
    );
  } catch (error) {
    console.error(JSON.stringify(sanitizedUnexpectedError(error, {
      requestId: options.requestId,
      action,
      resourceId,
      route,
    })));
    sendError(
      res,
      apiError('SALES_ORDER_TRANSACTION_FAILED', 'Sales Order transaction failed', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}

function sanitizedUnexpectedError(error, { requestId, action, resourceId, route }) {
  const rawMessage = typeof error?.message === 'string'
    ? error.message
    : 'Unknown Sales Order error';
  return Object.freeze({
    event: 'sales_order_unexpected_error',
    requestId,
    action,
    salesOrderId: resourceId,
    route,
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    constraint: typeof error?.constraint === 'string' ? error.constraint.slice(0, 160) : null,
    message: rawMessage
      .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
      .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 240),
  });
}

export async function handleSalesOrderRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== '/api/sales-orders' && !pathname.startsWith('/api/sales-orders/')) return false;
  const method = String(req.method || 'GET').toUpperCase();

  if (pathname === '/api/sales-orders/entry-settings' && method === 'GET') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderRead,
    );
    if (!context) return true;
    try {
      const result = await entryService.getSalesOrderEntrySettings(options.getPool(), {
        requestContext: context,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.settings, options.requestId, options.receivedAt);
    } catch {
      sendError(
        res,
        apiError('SALES_ORDER_ENTRY_SETTINGS_UNAVAILABLE', 'Không tải được cấu hình lập đơn', {}, true, 503),
        options.requestId,
        options.receivedAt,
      );
    }
    return true;
  }

  if (pathname === '/api/sales-orders/sku-search' && method === 'GET') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderRead,
    );
    if (!context) return true;
    const url = new URL(`http://localhost${req.url}`);
    try {
      const result = await searchPreviewService.searchSalesOrderSkuOptions(options.getPool(), {
        requestContext: context,
        search: url.searchParams.get('search') ?? '',
        warehouseId: url.searchParams.get('warehouseId'),
        salesChannelId: url.searchParams.get('salesChannelId'),
        customerId: url.searchParams.get('customerId'),
        pricingAt: url.searchParams.get('pricingAt'),
        limit: parseInteger(url.searchParams.get('limit'), 20, 50),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.skuOptions, options.requestId, options.receivedAt);
    } catch (error) {
      sendError(
        res,
        apiError(error.code, error.publicMessage, {}, false, error.statusCode),
        options.requestId,
        options.receivedAt,
      );
    }
    return true;
  }

  if (pathname === '/api/sales-orders' && method === 'GET') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderRead,
    );
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
      sendError(
        res,
        apiError(error.code, error.publicMessage, {}, false, error.statusCode),
        options.requestId,
        options.receivedAt,
      );
    }
    return true;
  }

  if (pathname === '/api/sales-orders' && method === 'POST') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderCreate,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: '/api/sales-orders',
      payload,
      action: 'create',
      statusCode: 201,
      mutate: async (client) => {
        const normalized = await entryService.normalizeSalesOrderEntryPayload(client, {
          requestContext: context,
          payload,
        });
        if (!normalized.ok) return normalized;
        return service.createSalesOrder(client, {
          requestContext: context,
          payload: normalized.payload,
        });
      },
    });
    return true;
  }

  const amendmentDraftMatch = pathname.match(
    /^\/api\/sales-orders\/([^/]+)\/amendments\/(\d+)\/draft$/,
  );
  if (amendmentDraftMatch && method === 'PUT') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderAmend,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const [, id, version] = amendmentDraftMatch;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/amendments/${version}/draft`,
      payload: { ...payload, id, version },
      action: 'update_amendment',
      resourceId: id,
      mutate: async (client) => {
        const normalized = await entryService.normalizeSalesOrderEntryPayload(client, {
          requestContext: context,
          payload,
          salesOrderId: id,
        });
        if (!normalized.ok) return normalized;
        return service.updateSalesOrderDraft(client, {
          requestContext: context,
          id,
          versionNumber: Number(version),
          payload: normalized.payload,
        });
      },
    });
    return true;
  }

  const amendmentConfirmMatch = pathname.match(
    /^\/api\/sales-orders\/([^/]+)\/amendments\/(\d+)\/confirm$/,
  );
  if (amendmentConfirmMatch && method === 'POST') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderAmend,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const [, id, version] = amendmentConfirmMatch;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/amendments/${version}/confirm`,
      payload: { ...payload, id, version },
      action: 'confirm_amendment',
      resourceId: id,
      mutate: (client, key) => service.confirmSalesOrder(client, {
        requestContext: context,
        id,
        versionNumber: Number(version),
        idempotencyKey: key,
      }),
    });
    return true;
  }

  const itemMatch = pathname.match(
    /^\/api\/sales-orders\/([^/]+)(?:\/(draft|confirm|amendments|manual-edit|pickup-edit|issue-stock|cancel|close-execution))?$/,
  );
  if (!itemMatch) {
    sendError(
      res,
      apiError('NOT_FOUND', 'Route not found', {}, false, 404),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  const [, id, action] = itemMatch;

  if (!action && method === 'GET') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderRead,
    );
    if (!context) return true;
    const result = await service.getSalesOrder(options.getPool(), {
      requestContext: context,
      id,
    });
    if (!result.ok) sendServiceError(res, result, options);
    else sendSuccess(res, result.salesOrder, options.requestId, options.receivedAt);
    return true;
  }

  if (action === 'draft' && method === 'PUT') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderUpdateDraft,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/draft`,
      payload: { ...payload, id },
      action: 'update_draft',
      resourceId: id,
      mutate: async (client) => {
        const normalized = await entryService.normalizeSalesOrderEntryPayload(client, {
          requestContext: context,
          payload,
          salesOrderId: id,
        });
        if (!normalized.ok) return normalized;
        return service.updateSalesOrderDraft(client, {
          requestContext: context,
          id,
          versionNumber: 1,
          payload: normalized.payload,
        });
      },
    });
    return true;
  }

  if (action === 'confirm' && method === 'POST') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderConfirm,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/confirm`,
      payload: { ...payload, id },
      action: 'confirm',
      resourceId: id,
      mutate: (client, key) => service.confirmSalesOrder(client, {
        requestContext: context,
        id,
        versionNumber: 1,
        idempotencyKey: key,
      }),
    });
    return true;
  }

  if (action === 'amendments' && method === 'POST') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderAmend,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/amendments`,
      payload: { ...payload, id },
      action: 'create_amendment',
      resourceId: id,
      statusCode: 201,
      mutate: (client) => service.createSalesOrderAmendment(client, {
        requestContext: context,
        id,
        payload,
      }),
    });
    return true;
  }

  if (action === 'manual-edit' && method === 'PUT') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderAmend,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/manual-edit`,
      payload: { ...payload, id },
      action: 'manual_quick_edit',
      resourceId: id,
      mutate: async (client, key) => {
        const normalized = await entryService.normalizeSalesOrderEntryPayload(client, {
          requestContext: context,
          payload,
          salesOrderId: id,
        });
        if (!normalized.ok) return normalized;
        return service.quickEditManualSalesOrder(client, {
          requestContext: context,
          id,
          payload: normalized.payload,
          idempotencyKey: key,
        });
      },
    });
    return true;
  }

  if (action === 'pickup-edit' && method === 'PUT') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderAmend,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/pickup-edit`,
      payload: { ...payload, id },
      action: 'pickup_quick_edit',
      resourceId: id,
      mutate: async (client, key) => {
        const normalized = await entryService.normalizeSalesOrderEntryPayload(client, {
          requestContext: context,
          payload,
          salesOrderId: id,
        });
        if (!normalized.ok) return normalized;
        return service.quickEditPickupSalesOrder(client, {
          requestContext: context,
          id,
          payload: normalized.payload,
          idempotencyKey: key,
        });
      },
    });
    return true;
  }

  if (action === 'issue-stock' && method === 'POST') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreDeliveryOrderIssueInventory,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const pickup = String(payload?.mode ?? '').trim().toUpperCase() === 'PICKUP';
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/issue-stock`,
      payload: { ...payload, id },
      action: pickup ? 'pickup_stock_issue' : 'manual_stock_issue',
      resourceId: id,
      mutate: (client, key) => (pickup
        ? pickupStockIssueService.issuePickupSalesOrderStock(client, {
            requestContext: context,
            id,
            expectedRevision: payload.expectedRevision,
            idempotencyKey: key,
          })
        : manualStockIssueService.issueManualSalesOrderStock(client, {
        requestContext: context,
        id,
        expectedRevision: payload.expectedRevision,
        idempotencyKey: key,
        })),
    });
    return true;
  }

  if (action === 'cancel' && method === 'POST') {
    const context = await authenticateAndAuthorize(
      req,
      res,
      options,
      options.PERMISSIONS.coreSalesOrderCancel,
    );
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/cancel`,
      payload: { ...payload, id },
      action: 'cancel',
      resourceId: id,
      mutate: (client, key) => service.cancelSalesOrder(client, {
        requestContext: context,
        id,
        payload,
        idempotencyKey: key,
      }),
    });
    return true;
  }

  if (action === 'close-execution' && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSalesOrderCancel);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/sales-orders/${id}/close-execution`,
      payload: { ...payload, id },
      action: 'close_execution',
      resourceId: id,
      mutate: (client, key) => service.closeSalesOrderAfterExecution(client, {
        requestContext: context, id, payload, idempotencyKey: key,
      }),
    });
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

export const salesOrderRouteInternals = Object.freeze({
  sanitizedUnexpectedError,
});
