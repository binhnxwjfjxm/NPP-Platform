import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { readJsonBody } from '../idempotency.js';
import {
  withAuditOutboxTransaction,
  buildAuditRecord,
  insertAuditRecord,
  buildOutboxEvent,
  insertOutboxEvent,
} from '../audit-outbox.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import * as service from '../services/cod-settlement.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('ALREADY') || code.includes('MISMATCH') || code.includes('EXCEEDS')
      || code.includes('CONFLICT') || code.includes('REVERSED') || code.includes('EXISTS')) return 409;
  if (code.endsWith('_FAILED')) return 503;
  return 400;
}

function sendServiceError(res, result, options) {
  sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)), options.requestId, options.receivedAt);
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
    authContext: requestContext.authContext ? Object.freeze({ ...requestContext.authContext, scopes }) : requestContext.authContext,
  });
}

async function authenticateAndAuthorize(req, res, options, permission) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = options.createContext({ config: options.config, principal: auth.principal, requestId: options.requestId, receivedAt: options.receivedAt });
  if (!options.authorize(requestContext, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length) return requestContext;
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
    sendError(res, apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  const warehouses = await warehouseRepository.listWarehousesForInstallation(options.getPool(), {
    installationId: requestContext.installationId, active: undefined, limit: 10000, offset: 0,
  });
  const scoped = withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
  if (!scoped.scopes.warehouseIds.length) {
    sendError(res, apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return scoped;
}

async function readPayload(req, res, options) {
  try { return await readJsonBody(req); } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    return null;
  }
}

async function executeMutation(req, res, options, {
  requestContext,
  route,
  payload,
  action,
  resourceType,
  eventType,
  mutate,
}) {
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
            const result = await mutate(client);
            if (!result.ok) return { failed: true, result };
            const entity = result.handover ?? result.collection ?? result.acceptance;
            if (!result.replayed) {
              await insertAuditRecord(client, buildAuditRecord({
                requestContext, action, resourceType, resourceId: entity.id,
                afterData: entity, metadata: { route },
              }));
              await insertOutboxEvent(client, buildOutboxEvent({
                requestContext, aggregateType: resourceType, aggregateId: entity.id,
                eventType: result.acceptance && Number(result.acceptance.differenceAmount ?? 0) !== 0
                  ? 'core.cod.discrepancy_recorded'
                  : eventType, eventVersion: 1, payload: entity, metadata: { route },
              }));
              for (const paymentEvent of result.paymentEvents ?? []) {
                const isAllocation = Object.prototype.hasOwnProperty.call(paymentEvent, 'sourceReceivableDocumentId');
                const paymentResource = isAllocation ? 'accounting.receivable_allocation' : 'accounting.customer_payment';
                await insertAuditRecord(client, buildAuditRecord({
                  requestContext,
                  action: isAllocation ? 'accounting.receivable_allocation.reverse_from_cod' : 'accounting.customer_payment.reverse_from_cod',
                  resourceType: paymentResource,
                  resourceId: paymentEvent.id,
                  afterData: paymentEvent,
                  metadata: { route, codCollectionId: result.collection?.id ?? null },
                }));
                await insertOutboxEvent(client, buildOutboxEvent({
                  requestContext,
                  aggregateType: paymentResource,
                  aggregateId: paymentEvent.id,
                  eventType: isAllocation ? 'core.receivable_allocation.reversed' : 'core.customer_payment.reversed',
                  eventVersion: 1,
                  payload: paymentEvent,
                  metadata: { route, codCollectionId: result.collection?.id ?? null },
                }));
              }
            }
            return { result };
          },
        });
        if (transaction.failed) {
          const result = transaction.result;
          return {
            statusCode: statusFor(result.code), contentType: 'application/json', requestId: options.requestId,
            body: { error: { code: result.code, message: result.message, retryable: Boolean(result.retryable), details: result.details ?? {} }, requestId: options.requestId, receivedAt: options.receivedAt },
          };
        }
        return { statusCode: 200, contentType: 'application/json', requestId: options.requestId, body: createSuccessEnvelope(transaction.result, options.requestId, options.receivedAt) };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch (error) {
    sendError(res, apiError(error?.code ?? 'COD_RECONCILIATION_TRANSACTION_FAILED', 'COD reconciliation transaction failed', {}, true, error?.statusCode ?? 503), options.requestId, options.receivedAt);
  }
}

function parseInteger(value, fallback, min, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw Object.assign(new Error('invalid_query'), { code: 'INVALID_QUERY_PARAMETER', publicMessage: `Query parameter must be between ${min} and ${max}`, statusCode: 400 });
  }
  return parsed;
}

export async function handleCodReconciliationRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  if (pathname !== '/api/cod-reconciliation' && !pathname.startsWith('/api/cod-reconciliation/')) return false;
  const method = String(req.method ?? 'GET').toUpperCase();
  try {
    if (pathname === '/api/cod-reconciliation' && method === 'GET') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCodReconciliationRead);
      if (!requestContext) return true;
      const result = await service.listCodHandovers(options.getPool(), {
        requestContext,
        status: url.searchParams.get('status'),
        limit: parseInteger(url.searchParams.get('limit'), 100, 1, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.handovers, options.requestId, options.receivedAt);
      return true;
    }

    const detail = pathname.match(/^\/api\/cod-reconciliation\/([^/]+)$/);
    if (detail && method === 'GET') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCodReconciliationRead);
      if (!requestContext) return true;
      const result = await service.getCodHandover(options.getPool(), { requestContext, handoverId: detail[1] });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.handover, options.requestId, options.receivedAt);
      return true;
    }

    const accept = pathname.match(/^\/api\/cod-reconciliation\/([^/]+)\/accept$/);
    if (accept && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCodReconciliationAccept);
      if (!requestContext) return true;
      const payload = await readPayload(req, res, options);
      if (payload === null) return true;
      await executeMutation(req, res, options, {
        requestContext, route: pathname, payload,
        action: 'accounting.cod_reconciliation.accept', resourceType: 'accounting.cod_handover',
        eventType: 'core.cod.reconciled',
        mutate: (client) => service.acceptCodHandover(client, {
          requestContext, handoverId: accept[1], payload,
          idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
        }),
      });
      return true;
    }

    const collectionReverse = pathname.match(/^\/api\/cod-reconciliation\/collections\/([^/]+)\/reverse$/);
    if (collectionReverse && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCodAdjustmentCreate);
      if (!requestContext) return true;
      const payload = await readPayload(req, res, options);
      if (payload === null) return true;
      await executeMutation(req, res, options, {
        requestContext, route: pathname, payload,
        action: 'accounting.cod_collection.reverse', resourceType: 'accounting.cod_collection',
        eventType: 'core.cod.collection_reversed',
        mutate: (client) => service.reverseCodCollection(client, { requestContext, collectionId: collectionReverse[1], payload }),
      });
      return true;
    }

    const handoverReverse = pathname.match(/^\/api\/cod-reconciliation\/handovers\/([^/]+)\/reverse$/);
    if (handoverReverse && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCodAdjustmentCreate);
      if (!requestContext) return true;
      const payload = await readPayload(req, res, options);
      if (payload === null) return true;
      await executeMutation(req, res, options, {
        requestContext, route: pathname, payload,
        action: 'accounting.cod_handover.reverse', resourceType: 'accounting.cod_handover',
        eventType: 'core.cod.handover_reversed',
        mutate: (client) => service.reverseCodHandover(client, { requestContext, handoverId: handoverReverse[1], payload }),
      });
      return true;
    }

    const acceptanceReverse = pathname.match(/^\/api\/cod-reconciliation\/acceptances\/([^/]+)\/reverse$/);
    if (acceptanceReverse && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCodAdjustmentCreate);
      if (!requestContext) return true;
      const payload = await readPayload(req, res, options);
      if (payload === null) return true;
      await executeMutation(req, res, options, {
        requestContext, route: pathname, payload,
        action: 'accounting.cod_acceptance.reverse', resourceType: 'accounting.cod_acceptance',
        eventType: 'core.cod.acceptance_reversed',
        mutate: (client) => service.reverseCodAcceptance(client, { requestContext, acceptanceId: acceptanceReverse[1], payload }),
      });
      return true;
    }
  } catch (error) {
    sendError(res, apiError(error?.code ?? 'COD_RECONCILIATION_REQUEST_FAILED', error?.publicMessage ?? 'COD reconciliation request failed', {}, false, error?.statusCode ?? 500), options.requestId, options.receivedAt);
    return true;
  }
  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
