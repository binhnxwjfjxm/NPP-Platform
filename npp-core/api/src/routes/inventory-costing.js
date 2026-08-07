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
import * as service from '../services/inventory-costing.js';

const PERMISSIONS = Object.freeze({
  read: 'core.inventory-cost.read',
  rebuild: 'core.inventory-cost.rebuild',
  reconcile: 'core.inventory-cost.reconcile',
});

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('IDEMPOTENCY')) return 409;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(
    res,
    apiError(
      result.code,
      result.message,
      result.details ?? {},
      Boolean(result.retryable),
      statusFor(result.code),
    ),
    context.requestId,
    context.receivedAt,
  );
}

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Query parameter must be an integer between 0 and ${max}`,
      statusCode: 400,
    });
  }
  return parsed;
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
      && requestContext.scopes.warehouseIds.length > 0) {
    return requestContext;
  }
  if (!Array.isArray(requestContext.roles)
      || !requestContext.roles.includes('bootstrap')) return requestContext;
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(
    requestContext,
    warehouses.map((warehouse) => warehouse.id),
  );
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
      apiError(
        'WAREHOUSE_SCOPE_DENIED',
        'At least one authorized warehouse is required',
        {},
        false,
        403,
      ),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return scoped;
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(
        error.code,
        error.publicMessage,
        {},
        false,
        error.statusCode,
      ),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key
      ? { ok: true, key }
      : {
        ok: false,
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required',
      };
  } catch {
    return {
      ok: false,
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must use 1-128 safe characters',
    };
  }
}

async function rebuild(req, res, options, requestContext, payload) {
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
      route: 'POST /api/inventory/costing/rebuild',
      payload,
      onProcess: async () => {
        const transaction = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const result = await service.rebuildCosting(client, {
              requestContext,
              idempotencyKey: idempotency.key,
              payload,
            });
            if (!result.ok) return { failed: true, result };
            if (!result.replayed) {
              const audit = buildAuditRecord({
                requestContext,
                action: 'inventory.costing.rebuild',
                resourceType: 'inventory_cost_rebuild_run',
                resourceId: result.run.id,
                afterData: result,
                metadata: {
                  methodVersion: result.run.methodVersion,
                  warehouseIds: result.run.warehouseIds,
                  anomalyCount: result.run.anomalyCount,
                },
              });
              const event = buildOutboxEvent({
                requestContext,
                aggregateType: 'inventory.costing',
                aggregateId: result.run.id,
                eventType: 'inventory.costing.rebuilt',
                eventVersion: 1,
                payload: {
                  run: result.run,
                  anomalyCount: result.anomalyCount,
                },
                metadata: {
                  methodVersion: result.run.methodVersion,
                },
              });
              await insertAuditRecord(client, audit);
              await insertOutboxEvent(client, event);
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
      apiError(
        'INVENTORY_COSTING_REBUILD_FAILED',
        'Inventory costing rebuild failed',
        {},
        true,
        503,
      ),
      options.requestId,
      options.receivedAt,
    );
  }
}

export async function handleInventoryCostingRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  if (pathname !== '/api/inventory/costing'
      && !pathname.startsWith('/api/inventory/costing/')) return false;

  if (req.method === 'POST' && pathname === '/api/inventory/costing/rebuild') {
    const requestContext = await authenticateAndAuthorize(
      req,
      res,
      options,
      PERMISSIONS.rebuild,
    );
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await rebuild(req, res, options, requestContext, payload);
    return true;
  }

  const readPermission = pathname === '/api/inventory/costing/reconciliation'
    ? PERMISSIONS.reconcile
    : PERMISSIONS.read;
  const requestContext = await authenticateAndAuthorize(
    req,
    res,
    options,
    readPermission,
  );
  if (!requestContext) return true;

  try {
    const limit = parseInteger(url.searchParams.get('limit'), 200, 1000);
    const offset = parseInteger(url.searchParams.get('offset'), 0, 100000);
    let result;
    if (req.method === 'GET' && pathname === '/api/inventory/costing/balances') {
      result = await service.listBalances(options.getPool(), {
        requestContext,
        status: url.searchParams.get('status')?.trim().toUpperCase() || null,
        limit,
        offset,
      });
      if (result.ok) sendSuccess(
        res,
        result.balances,
        options.requestId,
        options.receivedAt,
      );
    } else if (req.method === 'GET' && pathname === '/api/inventory/costing/facts') {
      result = await service.listFacts(options.getPool(), {
        requestContext,
        runId: url.searchParams.get('runId')?.trim() || null,
        movementId: url.searchParams.get('movementId')?.trim() || null,
        status: url.searchParams.get('status')?.trim().toUpperCase() || null,
        limit,
        offset,
      });
      if (result.ok) sendSuccess(
        res,
        result.facts,
        options.requestId,
        options.receivedAt,
      );
    } else if (req.method === 'GET' && pathname === '/api/inventory/costing/anomalies') {
      result = await service.listAnomalies(options.getPool(), {
        requestContext,
        runId: url.searchParams.get('runId')?.trim() || null,
        code: url.searchParams.get('code')?.trim() || null,
        limit,
        offset,
      });
      if (result.ok) sendSuccess(
        res,
        result.anomalies,
        options.requestId,
        options.receivedAt,
      );
    } else if (req.method === 'GET'
        && pathname === '/api/inventory/costing/reconciliation') {
      result = await service.listReconciliation(options.getPool(), {
        requestContext,
        status: url.searchParams.get('status')?.trim().toUpperCase() || null,
        limit,
        offset,
      });
      if (result.ok) sendSuccess(
        res,
        result.reconciliation,
        options.requestId,
        options.receivedAt,
      );
    } else if (req.method === 'GET' && pathname === '/api/inventory/costing/run') {
      result = await service.getLatestRun(options.getPool(), { requestContext });
      if (result.ok) sendSuccess(
        res,
        result.run,
        options.requestId,
        options.receivedAt,
      );
    } else {
      return false;
    }
    if (!result.ok) sendServiceError(res, result, options);
    return true;
  } catch (error) {
    sendError(
      res,
      apiError(
        error.code ?? 'INVALID_QUERY_PARAMETER',
        error.publicMessage ?? 'Invalid query parameter',
        {},
        false,
        error.statusCode ?? 400,
      ),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }
}
