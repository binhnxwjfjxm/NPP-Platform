import { createRequestId, normalizeRequestId } from '@npp/shared-utils';
import { createErrorEnvelope, createSuccessEnvelope } from '@npp/contracts';

export function withRequestContext(req, res, handler) {
  const requestId = normalizeRequestId(req.headers['x-request-id']);
  const receivedAt = new Date().toISOString();

  req.requestId = requestId;
  req.receivedAt = receivedAt;

  return handler(req, res);
}

export function sendJson(res, statusCode, payload, requestId) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'cache-control': 'no-store',
    'x-request-id': requestId,
  });
  res.end(JSON.stringify(payload));
}

export function sendSuccess(res, data, requestId, receivedAt) {
  sendJson(res, 200, createSuccessEnvelope(data, requestId, receivedAt), requestId);
}

export function sendError(res, error, requestId, receivedAt) {
  const headers = {
    'cache-control': 'no-store',
    'x-request-id': requestId,
  };
  if (error.statusCode === 401) {
    headers['www-authenticate'] = 'Bearer';
  }

  res.writeHead(error.statusCode ?? 500, {
    'Content-Type': 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(createErrorEnvelope(error, requestId, receivedAt)));
}
