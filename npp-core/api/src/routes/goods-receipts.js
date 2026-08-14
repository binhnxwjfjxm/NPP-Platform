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
import * as goodsReceiptService from '../services/goods-receipt.js';
import * as goodsReceiptTrackingService from '../services/goods-receipt-tracking.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED' || code.endsWith('PERMISSION_REQUIRED')) return 403;
  if (code.endsWith('_NOT_FOUND') || code === 'PURCHASE_ORDER_NOT_FOUND') return 404;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('DUPLICATE')
    || code.includes('IDEMPOTENCY')
    || code.endsWith('LOCKED')
    || code === 'GOODS_RECEIPT_SUPPLIER_RETURN_BLOCKED'
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
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
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
  const scopedContext = await ensureWarehouseScopes(options.getPool(), requestContext);
  if (!Array.isArray(scopedContext.scopes?.warehouseIds) || scopedContext.scopes.warehouseIds.length === 0) {
    sendError(
      res,
      apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return scopedContext;
}

function eventTypeFor(action) {
  return {
    create: 'purchasing.goods_receipt.created',
    update: 'purchasing.goods_receipt.updated',
    post: 'purchasing.goods_receipt.posted',
    reverse: 'purchasing.goods_receipt.reversed',
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
            const goodsReceipt = result.goodsReceipt;
            const metadata = {
              status: goodsReceipt.status,
              number: goodsReceipt.documentNumber,
              purchaseOrderId: goodsReceipt.purchaseOrderId,
              warehouseId: goodsReceipt.warehouseId,
              revision: goodsReceipt.revision,
            };
            await insertAuditRecord(client, buildAuditRecord({
              requestContext,
              action,
              resourceType: 'goods_receipt',
              resourceId: goodsReceipt.id,
              beforeData: result.beforeData ?? null,
              afterData: goodsReceipt,
              metadata,
            }));
            const outboxEvent = buildOutboxEvent({
              requestContext,
              aggregateType: 'purchasing.goods_receipt',
              aggregateId: goodsReceipt.id,
              eventType: eventTypeFor(action),
              eventVersion: 1,
              payload: goodsReceipt,
              metadata,
            });
            await insertOutboxEvent(client, outboxEvent);
            return { goodsReceipt, eventId: outboxEvent.eventId };
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
          body: createSuccessEnvelope(transactionResult.goodsReceipt, options.requestId, options.receivedAt),
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
      apiError('GOODS_RECEIPT_TRANSACTION_FAILED', 'Goods receipt transaction failed', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}

async function handleList(req, res, options, requestContext) {
  const url = new URL(`http://localhost${req.url}`);
  try {
    const result = await goodsReceiptService.listGoodsReceipts(options.getPool(), {
      requestContext,
      search: url.searchParams.get('search'),
      status: url.searchParams.get('status'),
      purchaseOrderId: url.searchParams.get('purchaseOrderId'),
      warehouseId: url.searchParams.get('warehouseId'),
      limit: parseInteger(url.searchParams.get('limit'), 100, 1000),
      offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
    });
    if (!result.ok) return sendServiceError(res, result, options);
    sendSuccess(res, result.goodsReceipts, options.requestId, options.receivedAt);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
  }
}

async function handleGet(res, options, requestContext, id) {
  const result = await goodsReceiptService.getGoodsReceipt(options.getPool(), { requestContext, id });
  if (!result.ok) return sendServiceError(res, result, options);
  sendSuccess(res, result.goodsReceipt, options.requestId, options.receivedAt);
}

async function handleTrackingRequirements(req, res, options, requestContext) {
  const url = new URL(`http://localhost${req.url}`);
  const result = await goodsReceiptTrackingService.getPurchaseOrderTrackingRequirements(options.getPool(), {
    requestContext,
    purchaseOrderId: url.searchParams.get('purchaseOrderId'),
  });
  if (!result.ok) return sendServiceError(res, result, options);
  sendSuccess(res, result.requirements, options.requestId, options.receivedAt);
}

export async function handleGoodsReceiptRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== '/api/goods-receipts' && !pathname.startsWith('/api/goods-receipts/')) return false;
  const method = String(req.method || 'GET').toUpperCase();

  if (pathname === '/api/goods-receipts' && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreGoodsReceiptRead);
    if (!requestContext) return true;
    await handleList(req, res, options, requestContext);
    return true;
  }

  if (pathname === '/api/goods-receipts' && method === 'POST') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreGoodsReceiptCreate);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext,
      route: '/api/goods-receipts',
      payload,
      action: 'create',
      statusCode: 201,
      mutate: (client) => goodsReceiptService.createGoodsReceipt(client, { requestContext, payload }),
    });
    return true;
  }

  if (pathname === '/api/goods-receipts/tracking-requirements' && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreGoodsReceiptRead);
    if (!requestContext) return true;
    await handleTrackingRequirements(req, res, options, requestContext);
    return true;
  }

  const actionMatch = pathname.match(/^\/api\/goods-receipts\/([^/]+)\/(post|reverse)$/);
  if (actionMatch && method === 'POST') {
    const [, id, action] = actionMatch;
    const permission = {
      post: options.PERMISSIONS.coreGoodsReceiptPost,
      reverse: options.PERMISSIONS.coreGoodsReceiptReverse,
    }[action];
    const requestContext = await authenticateAndAuthorize(req, res, options, permission);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext,
      route: `/api/goods-receipts/${id}/${action}`,
      payload,
      action,
      mutate: (client, idempotencyKey) => {
        if (action === 'post') return goodsReceiptService.postGoodsReceipt(client, {
          requestContext,
          id,
          payload,
          idempotencyKey,
        });
        return goodsReceiptService.reverseGoodsReceipt(client, {
          requestContext,
          id,
          payload,
          idempotencyKey,
        });
      },
    });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/goods-receipts\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreGoodsReceiptRead);
    if (!requestContext) return true;
    await handleGet(res, options, requestContext, detailMatch[1]);
    return true;
  }
  if (detailMatch && method === 'PATCH') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreGoodsReceiptUpdate);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext,
      route: `/api/goods-receipts/${detailMatch[1]}`,
      payload,
      action: 'update',
      mutate: (client) => goodsReceiptService.updateGoodsReceipt(client, {
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
