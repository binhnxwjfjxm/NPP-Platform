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
import * as service from '../services/inventory-costing-periods.js';

const PERMISSIONS = Object.freeze({
  read: 'core.inventory-cost.read',
  reconcile: 'core.inventory-cost.reconcile',
  rebuild: 'core.inventory-cost.rebuild',
  periodManage: 'core.inventory-cost.rebuild',
  adjust: 'core.inventory-cost.rebuild',
});

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('IDEMPOTENCY') || code.includes('CLOSED') || code.includes('DISCREPANC')) return 409;
  return 400;
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
  if (Array.isArray(requestContext.scopes?.warehouseIds)
      && requestContext.scopes.warehouseIds.length > 0) return requestContext;
  if (!Array.isArray(requestContext.roles)
      || !requestContext.roles.includes('bootstrap')) return requestContext;
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
    sendError(
      res,
      apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  const context = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(context, permission).ok) {
    sendError(
      res,
      apiError('FORBIDDEN', 'Permission denied', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  const scoped = await ensureWarehouseScopes(options.getPool(), context);
  if (!Array.isArray(scoped.scopes?.warehouseIds)
      || scoped.scopes.warehouseIds.length === 0) {
    sendError(
      res,
      apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return scoped;
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key
      ? { ok: true, key }
      : { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  } catch {
    return { ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
}

async function payload(req, res, options) {
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

async function mutation(req, res, options, requestContext, {
  route,
  body,
  action,
  eventType,
  resourceType,
  mutate,
}) {
  const idempotency = requireIdempotency(req);
  if (!idempotency.ok) {
    sendError(
      res,
      apiError(idempotency.code, idempotency.message, {}, false, 400),
      options.requestId,
      options.receivedAt,
    );
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
      payload: body,
      onProcess: async () => {
        const transaction = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const result = await mutate(client, idempotency.key);
            if (!result.ok) return { failed: true, result };
            if (!result.replayed) {
              const resourceId = result.run?.id ?? result.period?.id ?? result.events?.[0]?.id ?? 'costing';
              await insertAuditRecord(client, buildAuditRecord({
                requestContext,
                action,
                resourceType,
                resourceId,
                afterData: result,
                metadata: { idempotencyKey: idempotency.key },
              }));
              const outboxPayload = result.run
                ? {
                  run: result.run,
                  anomalyCount: result.anomalyCount ?? 0,
                  discrepancyCount: result.discrepancyCount ?? 0,
                }
                : result;
              await insertOutboxEvent(client, buildOutboxEvent({
                requestContext,
                aggregateType: resourceType,
                aggregateId: resourceId,
                eventType,
                eventVersion: 1,
                payload: outboxPayload,
              }));
            }
            return result;
          },
        });
        if (transaction.failed) {
          const result = transaction.result;
          return {
            statusCode: statusFor(result.code),
            contentType: 'application/json',
            requestId: options.requestId,
            body: {
              error: {
                code: result.code,
                message: result.message,
                details: result.details ?? {},
                retryable: Boolean(result.retryable),
              },
              requestId: options.requestId,
            },
          };
        }
        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(transaction, {
            requestId: options.requestId,
            receivedAt: options.receivedAt,
          }),
        };
      },
    });
    sendJson(res, execution.statusCode, execution.body, {
      'content-type': execution.contentType,
      'x-request-id': execution.requestId,
      ...(execution.replayed ? { 'idempotent-replay': 'true' } : {}),
    });
  } catch {
    sendError(
      res,
      apiError('INVENTORY_COSTING_MUTATION_FAILED', 'Inventory costing mutation failed', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}

export async function handleInventoryCostingPeriodRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const known = new Set([
    '/api/inventory/costing/rebuild',
    '/api/inventory/costing/periods',
    '/api/inventory/costing/periods/open',
    '/api/inventory/costing/periods/close',
    '/api/inventory/costing/adjustments',
    '/api/inventory/costing/discrepancies',
  ]);
  if (!known.has(pathname)) return false;

  if (req.method === 'GET' && pathname === '/api/inventory/costing/periods') {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.read);
    if (!requestContext) return true;
    const result = await service.listPeriods(options.getPool(), requestContext);
    if (result.ok) sendSuccess(res, result.periods, options.requestId, options.receivedAt);
    return true;
  }
  if (req.method === 'GET' && pathname === '/api/inventory/costing/adjustments') {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.read);
    if (!requestContext) return true;
    const result = await service.listAdjustmentEvents(options.getPool(), requestContext);
    if (result.ok) sendSuccess(res, result.events, options.requestId, options.receivedAt);
    else sendError(res, apiError(result.code, result.message, result.details, result.retryable, statusFor(result.code)), options.requestId, options.receivedAt);
    return true;
  }
  if (req.method === 'GET' && pathname === '/api/inventory/costing/discrepancies') {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.reconcile);
    if (!requestContext) return true;
    const result = await service.listDiscrepancies(options.getPool(), requestContext);
    if (result.ok) sendSuccess(res, result.discrepancies, options.requestId, options.receivedAt);
    else sendError(res, apiError(result.code, result.message, result.details, result.retryable, statusFor(result.code)), options.requestId, options.receivedAt);
    return true;
  }

  if (req.method === 'POST') {
    const permission = pathname === '/api/inventory/costing/adjustments'
      ? PERMISSIONS.adjust
      : pathname === '/api/inventory/costing/rebuild'
        ? PERMISSIONS.rebuild
        : PERMISSIONS.periodManage;
    const requestContext = await authenticateAndAuthorize(req, res, options, permission);
    if (!requestContext) return true;
    const body = await payload(req, res, options);
    if (body === null) return true;
    if (pathname === '/api/inventory/costing/rebuild') {
      await mutation(req, res, options, requestContext, {
        route: 'POST /api/inventory/costing/rebuild',
        body,
        action: 'inventory.costing.rebuild',
        eventType: 'inventory.costing.rebuilt',
        resourceType: 'inventory_cost_rebuild_run',
        mutate: (client, idempotencyKey) => service.rebuildOpenCosting(client, {
          requestContext,
          idempotencyKey,
          payload: body,
        }),
      });
      return true;
    }
    if (pathname === '/api/inventory/costing/periods/open') {
      await mutation(req, res, options, requestContext, {
        route: 'POST /api/inventory/costing/periods/open',
        body,
        action: 'inventory.costing.period.open',
        eventType: 'inventory.costing.period.opened',
        resourceType: 'inventory_costing_period',
        mutate: (client) => service.openPeriod(client, {
          requestContext,
          periodStart: body.periodStart,
        }),
      });
      return true;
    }
    if (pathname === '/api/inventory/costing/periods/close') {
      await mutation(req, res, options, requestContext, {
        route: 'POST /api/inventory/costing/periods/close',
        body,
        action: 'inventory.costing.period.close',
        eventType: 'inventory.costing.period.closed',
        resourceType: 'inventory_costing_period',
        mutate: (client, idempotencyKey) => service.closePeriod(client, {
          requestContext,
          periodStart: body.periodStart,
          idempotencyKey,
        }),
      });
      return true;
    }
    if (pathname === '/api/inventory/costing/adjustments') {
      await mutation(req, res, options, requestContext, {
        route: 'POST /api/inventory/costing/adjustments',
        body,
        action: 'inventory.costing.adjustment.create',
        eventType: 'inventory.costing.adjustment.created',
        resourceType: 'inventory_cost_adjustment_event',
        mutate: (client, idempotencyKey) => service.createAdjustmentEvents(client, {
          requestContext,
          idempotencyKey,
          payload: body,
        }),
      });
      return true;
    }
  }
  return false;
}
