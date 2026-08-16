import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  withAuditOutboxTransaction,
  buildAuditRecord,
  insertAuditRecord,
  buildOutboxEvent,
  insertOutboxEvent,
} from '../audit-outbox.js';
import * as service from '../services/cod-settlement.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('ALREADY') || code.includes('MISMATCH') || code.includes('EXCEEDS')
      || code.includes('CONFLICT') || code.includes('REVERSED') || code.includes('EMPTY')) return 409;
  if (code.endsWith('_FAILED')) return 503;
  return 400;
}

function sendServiceError(res, result, options) {
  sendError(res, apiError(
    result.code,
    result.message,
    result.details ?? {},
    Boolean(result.retryable),
    statusFor(result.code),
  ), options.requestId, options.receivedAt);
}

async function authenticateDriver(req, res, options, permission) {
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
    sendError(res, apiError('PERMISSION_DENIED', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return requestContext;
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key
      ? { ok: true, key }
      : { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
}

function sanitizeCodTransactionError(error, { requestId, route, stage }) {
  const raw = typeof error?.message === 'string' ? error.message : 'cod_transaction_failed';
  const message = raw
    .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 240);
  return Object.freeze({
    event: 'cod_transaction_failed',
    requestId,
    route,
    stage,
    name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
    code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    constraint: typeof error?.constraint === 'string' ? error.constraint.slice(0, 160) : null,
    message,
  });
}

function transactionExpectations(result) {
  const count = result?.payment ? 2 : 1;
  return Object.freeze({ expectedAuditCount: count, expectedOutboxCount: count });
}

function codTransactionFailure(error, options) {
  console.error(JSON.stringify(sanitizeCodTransactionError(error, options)));
  return Object.assign(new Error('cod_transaction_failed'), {
    code: 'COD_TRANSACTION_FAILED',
    publicMessage: 'Không thể ghi nhận giao dịch COD lúc này',
    statusCode: 503,
    retryable: true,
  });
}

async function executeMutation(req, res, options, {
  requestContext,
  route,
  payload,
  action,
  eventType,
  mutate,
}) {
  const idempotency = requireIdempotency(req);
  if (!idempotency.ok) {
    sendError(res, apiError(idempotency.code, idempotency.message, {}, false, 400), options.requestId, options.receivedAt);
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
        let transaction;
        try {
          transaction = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const result = await mutate(client, idempotency.key);
              if (!result.ok) return { failed: true, result };
              if (result.replayed) return { result, replayed: true };
              const entity = result.collection ?? result.handover;
              const resourceType = result.collection ? 'accounting.cod_collection' : 'accounting.cod_handover';
              const audit = buildAuditRecord({
                requestContext,
                action,
                resourceType,
                resourceId: entity.id,
                afterData: entity,
                metadata: { route },
              });
              const outbox = buildOutboxEvent({
                requestContext,
                aggregateType: resourceType,
                aggregateId: entity.id,
                eventType: result.handover && Number(result.handover.differenceAmount ?? 0) !== 0
                  ? 'core.cod.discrepancy_recorded'
                  : eventType,
                eventVersion: 1,
                payload: entity,
                metadata: { route },
              });
              await insertAuditRecord(client, audit);
              await insertOutboxEvent(client, outbox);
              if (result.payment) {
                await insertAuditRecord(client, buildAuditRecord({
                  requestContext,
                  action: 'accounting.customer_payment.create_from_cod',
                  resourceType: 'accounting.customer_payment',
                  resourceId: result.payment.id,
                  afterData: result.payment,
                  metadata: { codCollectionId: entity.id, route },
                }));
                await insertOutboxEvent(client, buildOutboxEvent({
                  requestContext,
                  aggregateType: 'accounting.customer_payment',
                  aggregateId: result.payment.id,
                  eventType: 'core.customer_payment.posted',
                  eventVersion: 1,
                  payload: result.payment,
                  metadata: { codCollectionId: entity.id, route },
                }));
              }
              return {
                result,
                eventId: outbox.eventId,
                ...transactionExpectations(result),
              };
            },
          });
        } catch (error) {
          throw codTransactionFailure(error, {
            requestId: options.requestId,
            route,
            stage: 'audit-outbox-transaction',
          });
        }
        if (transaction.failed) {
          const result = transaction.result;
          return {
            statusCode: statusFor(result.code),
            contentType: 'application/json',
            requestId: options.requestId,
            body: { error: { code: result.code, message: result.message, retryable: Boolean(result.retryable), details: result.details ?? {} }, requestId: options.requestId, receivedAt: options.receivedAt },
          };
        }
        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(transaction.result, options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch (error) {
    console.error(JSON.stringify(sanitizeCodTransactionError(error, {
      requestId: options.requestId,
      route,
      stage: 'idempotency-execution',
    })));
    sendError(res, apiError('COD_TRANSACTION_FAILED', 'Không thể ghi nhận giao dịch COD lúc này', {}, true, 503), options.requestId, options.receivedAt);
  }
}

export async function handleCodDriverRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  const custodyPath = pathname === '/api/logistics/driver/cod-custody';
  if (!custodyPath && !pathname.startsWith('/api/logistics/driver/trips/')) return false;
  const method = String(req.method ?? 'GET').toUpperCase();

  if (custodyPath && method === 'GET') {
    const requestContext = await authenticateDriver(req, res, options, options.PERMISSIONS.coreCodCollectionRead);
    if (!requestContext) return true;
    const result = await service.listDriverCodCustodyTripIds(options.getPool(), { requestContext });
    if (!result.ok) sendServiceError(res, result, options);
    else sendSuccess(res, { tripIds: result.tripIds }, options.requestId, options.receivedAt);
    return true;
  }

  const overviewMatch = pathname.match(/^\/api\/logistics\/driver\/trips\/([^/]+)\/cod$/);
  if (overviewMatch && method === 'GET') {
    const requestContext = await authenticateDriver(req, res, options, options.PERMISSIONS.coreCodCollectionRead);
    if (!requestContext) return true;
    const result = await service.getDriverCodOverview(options.getPool(), { requestContext, tripId: overviewMatch[1] });
    if (!result.ok) sendServiceError(res, result, options);
    else sendSuccess(res, { trip: result.trip, assignments: result.assignments, handovers: result.handovers }, options.requestId, options.receivedAt);
    return true;
  }

  const collectionMatch = pathname.match(/^\/api\/logistics\/driver\/trips\/([^/]+)\/assignments\/([^/]+)\/cod-collections$/);
  if (collectionMatch && method === 'POST') {
    const requestContext = await authenticateDriver(req, res, options, options.PERMISSIONS.coreCodCollectionRecord);
    if (!requestContext) return true;
    let payload;
    try { payload = await readJsonBody(req); } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
      return true;
    }
    await executeMutation(req, res, options, {
      requestContext,
      route: pathname,
      payload,
      action: 'logistics.cod_collection.record',
      eventType: 'core.cod.collection_recorded',
      mutate: (client, idempotencyKey) => service.recordCodCollection(client, {
        requestContext,
        tripId: collectionMatch[1],
        assignmentId: collectionMatch[2],
        payload,
        idempotencyKey,
      }),
    });
    return true;
  }

  const handoverMatch = pathname.match(/^\/api\/logistics\/driver\/trips\/([^/]+)\/cod-handovers$/);
  if (handoverMatch && method === 'POST') {
    const requestContext = await authenticateDriver(req, res, options, options.PERMISSIONS.coreCodHandoverCreate);
    if (!requestContext) return true;
    let payload;
    try { payload = await readJsonBody(req); } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
      return true;
    }
    await executeMutation(req, res, options, {
      requestContext,
      route: pathname,
      payload,
      action: 'logistics.cod_handover.record',
      eventType: 'core.cod.handover_recorded',
      mutate: (client, idempotencyKey) => service.createCodHandover(client, {
        requestContext,
        tripId: handoverMatch[1],
        payload,
        idempotencyKey,
      }),
    });
    return true;
  }

  return false;
}

export const codDriverInternals = Object.freeze({
  sanitizeCodTransactionError,
  transactionExpectations,
});
