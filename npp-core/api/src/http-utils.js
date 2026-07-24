import { createRequestId } from '@npp/shared-utils';
import { createErrorEnvelope, createSuccessEnvelope } from '@npp/contracts';

export function withRequestContext(req, res, handler) {
  const requestId = req.headers['x-request-id'] || createRequestId('req');
  const receivedAt = new Date().toISOString();

  req.requestId = requestId;
  req.receivedAt = receivedAt;

  return handler(req, res);
}

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function sendSuccess(res, data, requestId, receivedAt) {
  sendJson(res, 200, createSuccessEnvelope(data, requestId, receivedAt));
}

export function sendError(res, error, requestId, receivedAt) {
  sendJson(res, error.statusCode ?? 500, createErrorEnvelope(error, requestId, receivedAt));
}
