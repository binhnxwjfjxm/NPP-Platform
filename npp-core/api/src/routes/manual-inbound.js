import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  getManualInbound,
  listManualInbounds,
  postManualInbound,
  reverseManualInbound,
} from '../services/manual-inbound.js';
import {
  listManualInboundLocationOptions,
  listManualInboundWarehouseOptions,
  previewManualInbound,
  validateManualInboundPostInventoryPolicy,
} from '../services/manual-inbound-preparation.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(result) {
  if (result.code === 'PERMISSION_DENIED' || result.code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (result.code === 'MANUAL_INBOUND_NOT_FOUND') return 404;
  if (result.retryable) return 503;
  return result.statusCode ?? 400;
}

function writeSuccess(res, data, options, statusCode = 200) {
  sendJson(res, statusCode, createSuccessEnvelope(data, options.requestId, options.receivedAt), options.requestId);
}

async function contextFor(req, res, options) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  return options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
}

function readIdempotencyKey(req) {
  try {
    return normalizeIdempotencyKey(req.headers['idempotency-key']);
  } catch {
    return null;
  }
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(
        error?.code ?? 'INVALID_JSON_BODY',
        error?.publicMessage ?? 'Dữ liệu gửi lên không hợp lệ.',
        {},
        false,
        error?.statusCode ?? 400,
      ),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

export async function handleManualInboundRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/api/inventory/manual-inbounds'
      && !url.pathname.startsWith('/api/inventory/manual-inbounds/')) return false;
  const requestContext = await contextFor(req, res, options);
  if (!requestContext) return true;
  const method = String(req.method ?? 'GET').toUpperCase();

  try {
    if (url.pathname === '/api/inventory/manual-inbounds/operator/warehouses' && method === 'GET') {
      const result = await listManualInboundWarehouseOptions(options.getPool(), { requestContext });
      if (!result.ok) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, result.retryable, statusFor(result)), options.requestId, options.receivedAt);
        return true;
      }
      writeSuccess(res, result.warehouses, options);
      return true;
    }

    if (url.pathname === '/api/inventory/manual-inbounds/operator/locations' && method === 'GET') {
      const result = await listManualInboundLocationOptions(options.getPool(), {
        requestContext,
        warehouseId: url.searchParams.get('warehouseId'),
      });
      if (!result.ok) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, result.retryable, statusFor(result)), options.requestId, options.receivedAt);
        return true;
      }
      writeSuccess(res, { warehouse: result.warehouse, locations: result.locations }, options);
      return true;
    }

    if (url.pathname === '/api/inventory/manual-inbounds/operator/preview' && method === 'POST') {
      const payload = await readPayload(req, res, options);
      if (payload === null) return true;
      const result = await previewManualInbound(options.getPool(), { requestContext, payload });
      if (!result.ok) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, result.retryable, statusFor(result)), options.requestId, options.receivedAt);
        return true;
      }
      writeSuccess(res, result.preview, options);
      return true;
    }

    if (url.pathname === '/api/inventory/manual-inbounds' && method === 'GET') {
      const result = await listManualInbounds(options.getPool(), {
        requestContext,
        limit: url.searchParams.get('limit') ?? 100,
        offset: url.searchParams.get('offset') ?? 0,
      });
      if (!result.ok) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, result.retryable, statusFor(result)), options.requestId, options.receivedAt);
        return true;
      }
      writeSuccess(res, result.documents, options);
      return true;
    }

    if (url.pathname === '/api/inventory/manual-inbounds' && method === 'POST') {
      const idempotencyKey = readIdempotencyKey(req);
      if (!idempotencyKey) {
        sendError(res, apiError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key không hợp lệ.', {}, false, 400), options.requestId, options.receivedAt);
        return true;
      }
      const payload = await readPayload(req, res, options);
      if (payload === null) return true;
      const policy = await validateManualInboundPostInventoryPolicy(options.getPool(), {
        requestContext,
        rows: payload?.rows,
      });
      if (!policy.ok) {
        sendError(res, apiError(policy.code, policy.message, policy.details ?? {}, policy.retryable, statusFor(policy)), options.requestId, options.receivedAt);
        return true;
      }
      const result = await postManualInbound({
        adapter: options.getPool(),
        requestContext,
        idempotencyKey,
        payload,
      });
      if (!result.ok) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, result.retryable, statusFor(result)), options.requestId, options.receivedAt);
        return true;
      }
      writeSuccess(res, { document: result.document, movement: result.movement, replayed: result.replayed }, options, result.replayed ? 200 : 201);
      return true;
    }

    const reverseMatch = /^\/api\/inventory\/manual-inbounds\/([^/]+)\/reverse$/.exec(url.pathname);
    if (reverseMatch && method === 'POST') {
      const idempotencyKey = readIdempotencyKey(req);
      if (!idempotencyKey) {
        sendError(res, apiError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key không hợp lệ.', {}, false, 400), options.requestId, options.receivedAt);
        return true;
      }
      const payload = await readPayload(req, res, options);
      if (payload === null) return true;
      const result = await reverseManualInbound({
        adapter: options.getPool(),
        requestContext,
        idempotencyKey,
        id: reverseMatch[1],
        payload,
      });
      if (!result.ok) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, result.retryable, statusFor(result)), options.requestId, options.receivedAt);
        return true;
      }
      writeSuccess(res, { document: result.document, movement: result.movement, replayed: result.replayed }, options);
      return true;
    }

    const detailMatch = /^\/api\/inventory\/manual-inbounds\/([^/]+)$/.exec(url.pathname);
    if (detailMatch && method === 'GET') {
      const result = await getManualInbound(options.getPool(), { requestContext, id: detailMatch[1] });
      if (!result.ok) {
        sendError(res, apiError(result.code, result.message, result.details ?? {}, result.retryable, statusFor(result)), options.requestId, options.receivedAt);
        return true;
      }
      writeSuccess(res, result.document, options);
      return true;
    }

    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'manual_inbound_route_failed',
      requestId: options.requestId,
      errorName: error?.name ?? null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }));
    sendError(res, apiError('MANUAL_INBOUND_UNAVAILABLE', 'Nhập kho thủ công tạm thời chưa khả dụng.', {}, true, 503), options.requestId, options.receivedAt);
    return true;
  }
}
