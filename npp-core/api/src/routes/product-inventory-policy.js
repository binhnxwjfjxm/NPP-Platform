import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as service from '../services/product-inventory-policy.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(result) {
  if (result.code === 'PRODUCT_NOT_FOUND') return 404;
  if (['DOMAIN_CONFLICT', 'STALE_VERSION'].includes(result.code)) return 409;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(
    res,
    apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result)),
    context.requestId,
    context.receivedAt,
  );
}

function requireIdempotency(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined || raw === null) {
    return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  }
  try {
    normalizeIdempotencyKey(raw);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
}

async function authorize(req, res, options, permissionKey) {
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
  if (!options.authorize(requestContext, permissionKey).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return requestContext;
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(error.code ?? 'INVALID_INPUT', error.publicMessage ?? 'Nội dung yêu cầu không hợp lệ', {}, false, error.statusCode ?? 400),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

async function updatePolicy(req, res, options, requestContext, productId, payload) {
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
      route: `/api/products/${productId}/inventory-policy`,
      payload,
      onProcess: async () => {
        const result = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const serviceResult = await service.updateProductInventoryPolicy(client, {
              installationId: requestContext.installationId,
              id: productId,
              payload,
              updatedBy: requestContext.actorId,
            });
            if (!serviceResult.ok) return { failed: serviceResult };
            if (serviceResult.changed !== false) {
              await insertAuditRecord(client, buildAuditRecord({
                requestContext,
                action: 'update',
                resourceType: 'product_inventory_policy',
                resourceId: serviceResult.product.id,
                beforeData: serviceResult.beforeData ?? null,
                afterData: serviceResult.product,
                metadata: {
                  code: serviceResult.product.code,
                  isInventoryManaged: serviceResult.product.isInventoryManaged,
                },
              }));
            }
            return { product: serviceResult.product };
          },
        });
        if (result.failed) {
          return {
            statusCode: statusFor(result.failed),
            contentType: 'application/json',
            requestId: options.requestId,
            body: {
              error: {
                code: result.failed.code,
                message: result.failed.message,
                retryable: Boolean(result.failed.retryable),
                details: result.failed.details ?? {},
              },
              requestId: options.requestId,
              receivedAt: options.receivedAt,
            },
          };
        }
        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(result.product, options.requestId, options.receivedAt),
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
    sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Dữ liệu sản phẩm tạm thời chưa sẵn sàng', {}, true, 503), options.requestId, options.receivedAt);
  }
}

export async function handleProductInventoryPolicyRoutes(req, res, options) {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  const collection = pathname === '/api/products/inventory-policies';
  const detail = pathname.match(/^\/api\/products\/([^/]+)\/inventory-policy$/);
  if (!collection && !detail) return false;

  const method = String(req.method ?? 'GET').toUpperCase();
  const permission = method === 'GET' ? options.PERMISSIONS.coreProductRead : options.PERMISSIONS.coreProductWrite;
  const requestContext = await authorize(req, res, options, permission);
  if (!requestContext) return true;

  if (collection && method === 'GET') {
    try {
      const result = await service.listProductInventoryPolicies(options.getPool(), {
        installationId: requestContext.installationId,
      });
      sendSuccess(res, result.products, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Dữ liệu sản phẩm tạm thời chưa sẵn sàng', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (detail && method === 'GET') {
    try {
      const result = await service.getProductInventoryPolicy(options.getPool(), {
        installationId: requestContext.installationId,
        id: detail[1],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.product, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Dữ liệu sản phẩm tạm thời chưa sẵn sàng', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (detail && method === 'PATCH') {
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await updatePolicy(req, res, options, requestContext, detail[1], payload);
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức yêu cầu không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
