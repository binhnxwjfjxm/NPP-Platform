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
import * as service from '../services/supplier-purchase-price.js';
import { canReadPurchaseOrderPrice } from '../services/purchase-order-pricing.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('DUPLICATE')) return 409;
  return 400;
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)),
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
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch {
    return { ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
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
  return requestContext;
}

async function executeCreate(req, res, options, requestContext, payload) {
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
      route: '/api/supplier-purchase-prices',
      payload,
      onProcess: async () => {
        const result = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const created = await service.createSupplierPurchasePrice(client, { requestContext, payload });
            if (!created.ok) return { failed: true, result: created };
            const metadata = {
              supplierId: created.price.supplierId,
              variantId: created.price.variantId,
              unitId: created.price.unitId,
              currencyCode: created.price.currencyCode,
            };
            await insertAuditRecord(client, buildAuditRecord({
              requestContext,
              action: 'create',
              resourceType: 'supplier_purchase_price',
              resourceId: created.price.id,
              afterData: created.price,
              metadata,
            }));
            const event = buildOutboxEvent({
              requestContext,
              aggregateType: 'purchasing.supplier_purchase_price',
              aggregateId: created.price.id,
              eventType: 'purchasing.supplier_purchase_price.created',
              eventVersion: 1,
              payload: created.price,
              metadata,
            });
            await insertOutboxEvent(client, event);
            return { price: created.price, eventId: event.eventId };
          },
        });
        if (result.failed) {
          return {
            statusCode: statusFor(result.result.code),
            contentType: 'application/json',
            requestId: options.requestId,
            body: {
              error: {
                code: result.result.code,
                message: result.result.message,
                retryable: Boolean(result.result.retryable),
                details: result.result.details ?? {},
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
          body: createSuccessEnvelope(result.price, options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('SUPPLIER_PURCHASE_PRICE_TRANSACTION_FAILED', 'Không lưu được giá mua nhà cung cấp.', {}, true, 503), options.requestId, options.receivedAt);
  }
}

async function executeUpdate(res, options, requestContext, id, payload) {
  try {
    const result = await withAuditOutboxTransaction({
      adapter: options.getPool(),
      mutate: async (client) => {
        const updated = await service.updateSupplierPurchasePrice(client, { requestContext, id, payload });
        if (!updated.ok) return { failed: true, result: updated };
        const metadata = {
          supplierId: updated.price.supplierId,
          variantId: updated.price.variantId,
          unitId: updated.price.unitId,
          currencyCode: updated.price.currencyCode,
        };
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'update',
          resourceType: 'supplier_purchase_price',
          resourceId: updated.price.id,
          beforeData: updated.beforeData,
          afterData: updated.price,
          metadata,
        }));
        const event = buildOutboxEvent({
          requestContext,
          aggregateType: 'purchasing.supplier_purchase_price',
          aggregateId: updated.price.id,
          eventType: 'purchasing.supplier_purchase_price.updated',
          eventVersion: 1,
          payload: updated.price,
          metadata,
        });
        await insertOutboxEvent(client, event);
        return { price: updated.price, eventId: event.eventId };
      },
    });
    if (result.failed) return sendServiceError(res, result.result, options);
    sendSuccess(res, result.price, options.requestId, options.receivedAt);
  } catch {
    sendError(res, apiError('SUPPLIER_PURCHASE_PRICE_TRANSACTION_FAILED', 'Không cập nhật được giá mua nhà cung cấp.', {}, true, 503), options.requestId, options.receivedAt);
  }
}

export async function handleSupplierPurchasePriceRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== '/api/supplier-purchase-prices' && !pathname.startsWith('/api/supplier-purchase-prices/')) return false;
  const method = String(req.method || 'GET').toUpperCase();

  if (pathname === '/api/supplier-purchase-prices/resolve' && method === 'POST') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePurchaseOrderRead);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const result = await service.resolveSupplierPurchasePrice(options.getPool(), {
      installationId: requestContext.installationId,
      ...payload,
    });
    if (!result.ok) return sendServiceError(res, result, options) ?? true;
    const data = canReadPurchaseOrderPrice(requestContext)
      ? { status: result.status, price: result.price }
      : { status: result.status };
    sendSuccess(res, data, options.requestId, options.receivedAt);
    return true;
  }

  if (pathname === '/api/supplier-purchase-prices' && method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSupplierPurchasePriceRead);
    if (!requestContext) return true;
    const url = new URL(`http://localhost${req.url}`);
    const active = url.searchParams.get('active');
    const result = await service.listSupplierPurchasePrices(options.getPool(), {
      installationId: requestContext.installationId,
      supplierId: url.searchParams.get('supplierId'),
      variantId: url.searchParams.get('variantId'),
      active: active === null ? undefined : active === 'true',
      limit: url.searchParams.get('limit'),
      offset: url.searchParams.get('offset'),
    });
    if (!result.ok) return sendServiceError(res, result, options) ?? true;
    sendSuccess(res, result.prices, options.requestId, options.receivedAt);
    return true;
  }

  if (pathname === '/api/supplier-purchase-prices' && method === 'POST') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSupplierPurchasePriceManage);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeCreate(req, res, options, requestContext, payload);
    return true;
  }

  const detail = pathname.match(/^\/api\/supplier-purchase-prices\/([^/]+)$/);
  if (detail && method === 'PATCH') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSupplierPurchasePriceManage);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeUpdate(res, options, requestContext, detail[1], payload);
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
