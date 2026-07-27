import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as service from '../services/document-numbering.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(result) {
  if (result.code === 'NOT_FOUND') return 404;
  if (['DUPLICATE_CODE', 'CONFLICT', 'FORMAT_LOCKED', 'SERIES_INACTIVE',
    'SEQUENCE_OVERFLOW', 'DOCUMENT_NUMBER_CONFLICT', 'IMMUTABLE_IDENTITY'].includes(result.code)) return 409;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(res, apiError(result.code, result.message, {}, Boolean(result.retryable), statusFor(result)), context.requestId, context.receivedAt);
}

async function readPayload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return null;
  }
}

function parseBoolean(value) {
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
    code: 'INVALID_QUERY_PARAMETER', publicMessage: 'Query parameter must be true or false', statusCode: 400,
  });
}

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER', publicMessage: `Query parameter must be an integer between 0 and ${max}`, statusCode: 400,
    });
  }
  return parsed;
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch (error) {
    return { ok: false, code: error.code ?? 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
}

async function idempotentMutation(req, res, context, {
  route,
  body,
  mutate,
  resourceType,
  entityKey,
  action,
  metadata = () => ({}),
}) {
  const idempotency = requireIdempotency(req);
  if (!idempotency.ok) {
    sendError(res, apiError(idempotency.code, idempotency.message, {}, false, 400), context.requestId, context.receivedAt);
    return;
  }
  try {
    const execution = await context.executeRequestWithIdempotency({
      idempotencyStore: context.idempotencyStore,
      req,
      requestContext: context.requestContext,
      requestId: context.requestId,
      receivedAt: context.receivedAt,
      route,
      payload: body,
      onProcess: async () => {
        const tx = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const result = await mutate(client, idempotency.key);
            if (!result.ok) return { failed: result, skipAudit: true };
            const entity = result[entityKey];
            if (!result.replayed) {
              await insertAuditRecord(client, buildAuditRecord({
                requestContext: context.requestContext,
                action,
                resourceType,
                resourceId: entity.id,
                afterData: entity,
                metadata: metadata(entity, result),
              }));
            }
            return { entity: { ...entity, replayed: Boolean(result.replayed) }, replayed: Boolean(result.replayed) };
          },
        });
        if (tx.failed) {
          return {
            statusCode: statusFor(tx.failed),
            contentType: 'application/json',
            requestId: context.requestId,
            body: { error: { code: tx.failed.code, message: tx.failed.message, retryable: Boolean(tx.failed.retryable), details: {} }, requestId: context.requestId, receivedAt: context.receivedAt },
          };
        }
        return {
          statusCode: tx.replayed ? 200 : 201,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(tx.entity, context.requestId, context.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? context.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('DOCUMENT_NUMBERING_STORAGE_UNAVAILABLE', 'Document numbering is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function patchSeries(req, res, context, seriesId) {
  const body = await readPayload(req, res, context);
  if (body === null) return;
  try {
    const tx = await withAuditOutboxTransaction({
      adapter: context.getPool(),
      mutate: async (client) => {
        const result = await service.updateDocumentNumberSeries(client, {
          installationId: context.requestContext.installationId,
          id: seriesId,
          payload: body,
          updatedBy: context.requestContext.actorId,
        });
        if (!result.ok) return { failed: result, skipAudit: true };
        await insertAuditRecord(client, buildAuditRecord({
          requestContext: context.requestContext,
          action: 'update',
          resourceType: 'document_number_series',
          resourceId: result.series.id,
          beforeData: result.beforeData,
          afterData: result.series,
          metadata: { code: result.series.code, documentType: result.series.document_type },
        }));
        return { series: result.series };
      },
    });
    if (tx.failed) return sendServiceError(res, tx.failed, context);
    sendSuccess(res, tx.series, context.requestId, context.receivedAt);
  } catch {
    sendError(res, apiError('DOCUMENT_NUMBERING_STORAGE_UNAVAILABLE', 'Document numbering is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function handleSeriesCollection(req, res, context, pathname, method) {
  if (pathname !== '/api/document-number-series') return false;
  if (method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    try {
      const result = await service.listDocumentNumberSeries(context.getPool(), {
        installationId: context.requestContext.installationId,
        search: url.searchParams.get('search'),
        active: parseBoolean(url.searchParams.get('active')),
        documentType: url.searchParams.get('documentType'),
        limit: parseInteger(url.searchParams.get('limit'), 200, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 10000),
      });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result.series, context.requestId, context.receivedAt);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (method === 'POST') {
    const body = await readPayload(req, res, context);
    if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: pathname,
      body,
      mutate: (client) => service.createDocumentNumberSeries(client, {
        installationId: context.requestContext.installationId,
        payload: body,
        createdBy: context.requestContext.actorId,
      }),
      resourceType: 'document_number_series',
      entityKey: 'series',
      action: 'create',
      metadata: (entity) => ({ code: entity.code, documentType: entity.document_type }),
    });
    return true;
  }
  return false;
}

async function handleSeriesDetail(req, res, context, pathname, method) {
  const match = pathname.match(/^\/api\/document-number-series\/([^/]+)$/);
  if (!match) return false;
  if (method === 'GET') {
    try {
      const result = await service.getDocumentNumberSeries(context.getPool(), {
        installationId: context.requestContext.installationId,
        id: match[1],
      });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result.series, context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('DOCUMENT_NUMBERING_STORAGE_UNAVAILABLE', 'Document numbering is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (method === 'PATCH') {
    await patchSeries(req, res, context, match[1]);
    return true;
  }
  return false;
}

async function handleAllocations(req, res, context, pathname, method) {
  const listMatch = pathname.match(/^\/api\/document-number-series\/([^/]+)\/allocations$/);
  if (listMatch && method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    try {
      const result = await service.listDocumentNumberAllocations(context.getPool(), {
        installationId: context.requestContext.installationId,
        seriesId: listMatch[1],
        periodKey: url.searchParams.get('periodKey'),
        limit: parseInteger(url.searchParams.get('limit'), 200, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 10000),
      });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, { allocations: result.allocations, counters: result.counters }, context.requestId, context.receivedAt);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    }
    return true;
  }
  const allocateMatch = pathname.match(/^\/api\/document-number-series\/([^/]+)\/allocate$/);
  if (allocateMatch && method === 'POST') {
    const body = await readPayload(req, res, context);
    if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: pathname,
      body,
      mutate: (client, idempotencyKey) => service.allocateDocumentNumber(client, {
        installationId: context.requestContext.installationId,
        seriesId: allocateMatch[1],
        idempotencyKey,
        payload: body,
        actorId: context.requestContext.actorId,
        requestId: context.requestId,
        sourceApp: context.requestContext.sourceApp,
      }),
      resourceType: 'document_number_allocation',
      entityKey: 'allocation',
      action: 'allocate',
      metadata: (entity, result) => ({
        seriesCode: entity.series_code,
        documentType: entity.document_type,
        documentNumber: entity.document_number,
        replayed: Boolean(result.replayed),
      }),
    });
    return true;
  }
  return false;
}

export async function handleDocumentNumberingRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (!(pathname === '/api/document-number-series' || pathname.startsWith('/api/document-number-series/'))) return false;
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  const method = String(req.method || 'GET').toUpperCase();
  const permission = options.authorize(
    requestContext,
    method === 'GET' ? options.PERMISSIONS.coreDocumentNumberRead : options.PERMISSIONS.coreDocumentNumberWrite,
  );
  if (!permission.ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  const context = { ...options, requestContext };
  if (await handleSeriesCollection(req, res, context, pathname, method)) return true;
  if (await handleSeriesDetail(req, res, context, pathname, method)) return true;
  if (await handleAllocations(req, res, context, pathname, method)) return true;
  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
