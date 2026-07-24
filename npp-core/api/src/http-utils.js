import { resolveRequestId } from '@npp/shared-utils';
import { createErrorEnvelope, createSuccessEnvelope } from '@npp/contracts';

export function withRequestContext(req, res, handler) {
  const requestId = resolveRequestId(req.headers['x-request-id'], 'req');
  const receivedAt = new Date().toISOString();

  req.requestId = requestId;
  req.receivedAt = receivedAt;

  return handler(req, res);
}

export function sendJson(res, statusCode, payload, requestId, contentType = 'application/json') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'x-request-id': requestId,
  });
  res.end(JSON.stringify(payload));
}

export function sendNoContent(res, statusCode, requestId) {
  res.writeHead(statusCode, { 'x-request-id': requestId });
  res.end();
}

export function sendSuccess(res, data, requestId, receivedAt) {
  sendJson(res, 200, createSuccessEnvelope(data, requestId, receivedAt), requestId);
}

export function sendError(res, error, requestId, receivedAt) {
  sendJson(res, error.statusCode ?? 500, createErrorEnvelope(error, requestId, receivedAt), requestId);
}
