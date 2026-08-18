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
import * as stocktakeService from '../services/inventory-stocktake.js';

const PERMISSIONS = Object.freeze({
  read: 'core.stocktake.read',
  create: 'core.stocktake.create',
  count: 'core.stocktake.count',
  submit: 'core.stocktake.submit',
  approve: 'core.stocktake.approve',
  post: 'core.stocktake.post',
  cancel: 'core.stocktake.cancel',
  reverse: 'core.stocktake.reverse',
});

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED' || code.endsWith('PERMISSION_REQUIRED')) return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('IDEMPOTENCY')
    || code.includes('SCOPE_CHANGED')
    || code.includes('SELF_APPROVAL')
    || code === 'INVALID_STATUS_TRANSITION'
  ) return 409;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(
    res,
    apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)),
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

async function readPayload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(error.code, error.publicMessage, {}, false, error.statusCode),
      context.requestId,
      context.receivedAt,
    );
    return null;
  }
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must use 1-128 safe characters',
    };
  }
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
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) {
    return requestContext;
  }
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) return requestContext;
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
  if (!Array.isArray(scoped.scopes?.warehouseIds) || scoped.scopes.warehouseIds.length === 0) {
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

function eventTypeFor(action) {
  return {
    create: 'inventory.stocktake.created',
    count: 'inventory.stocktake.counted',
    submit: 'inventory.stocktake.submitted',
    recount: 'inventory.stocktake.recount_required',
    approve: 'inventory.stocktake.approved',
    post: 'inventory.stocktake.posted',
    cancel: 'inventory.stocktake.cancelled',
    reverse: 'inventory.stocktake.reversed',
  }[action];
}

async function executeIdempotentMutation(req, res, options, {
  requestContext,
  route,
  payload,
  action,
  statusCode = 200,
  mutate,
}) {
  const keyResult = requireIdempotency(req);
  if (!keyResult.ok) {
    sendError(
      res,
      apiError(keyResult.code, keyResult.message, {}, false, 400),
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
      payload,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const result = await mutate(client, keyResult.key);
            if (!result.ok) return { result, failed: true };
            const stocktake = result.stocktake;
            const metadata = {
              status: stocktake.status,
              stocktakeNumber: stocktake.stocktakeNumber,
              warehouseId: stocktake.warehouseId,
              currentRound: stocktake.currentRound,
              revision: stocktake.revision,
              inventoryMovementId: stocktake.inventoryMovementId,
              reversalMovementId: stocktake.reversalMovementId,
            };
            await insertAuditRecord(client, buildAuditRecord({
              requestContext,
              action,
              resourceType: 'inventory_stocktake',
              resourceId: stocktake.id,
              beforeData: result.beforeData ?? null,
              afterData: stocktake,
              metadata,
            }));
            const outboxEvent = buildOutboxEvent({
              requestContext,
              aggregateType: 'inventory.stocktake',
              aggregateId: stocktake.id,
              eventType: eventTypeFor(action),
              eventVersion: 1,
              payload: stocktake,
              metadata,
            });
            await insertOutboxEvent(client, outboxEvent);
            return { stocktake, eventId: outboxEvent.eventId };
          },
        });

        if (transactionResult.failed) {
          const result = transactionResult.result;
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
          statusCode,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(transactionResult.stocktake, {
            requestId: options.requestId,
            receivedAt: options.receivedAt,
          }),
        };
      },
    });

    sendJson(res, execution.response.statusCode, execution.response.body, {
      'content-type': execution.response.contentType,
      'x-request-id': execution.response.requestId,
      ...(execution.replayed ? { 'idempotent-replay': 'true' } : {}),
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'inventory_stocktake_operation_failed',
      requestId: options.requestId,
      action,
      errorName: error?.name ?? null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }));
    sendError(
      res,
      apiError('STOCKTAKE_OPERATION_FAILED', 'Không thể hoàn tất thao tác kiểm kê kho.', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}

export async function handleInventoryStocktakeRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  if (pathname !== '/api/inventory/stocktakes'
      && !pathname.startsWith('/api/inventory/stocktakes/')) {
    return false;
  }

  if (req.method === 'GET' && pathname === '/api/inventory/stocktakes') {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.read);
    if (!requestContext) return true;
    try {
      const status = url.searchParams.get('status')?.trim() || null;
      const limit = parseInteger(url.searchParams.get('limit'), 100, 500);
      const offset = parseInteger(url.searchParams.get('offset'), 0, 100000);
      const result = await stocktakeService.listStocktakes(options.getPool(), {
        requestContext,
        status,
        limit,
        offset,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.stocktakes, options.requestId, options.receivedAt);
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
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/inventory/stocktakes') {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.create);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext,
      route: 'POST /api/inventory/stocktakes',
      payload,
      action: 'create',
      statusCode: 201,
      mutate: (client) => stocktakeService.createStocktake(client, { requestContext, payload }),
    });
    return true;
  }

  const detailMatch = /^\/api\/inventory\/stocktakes\/([0-9a-f-]+)$/i.exec(pathname);
  if (req.method === 'GET' && detailMatch) {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.read);
    if (!requestContext) return true;
    const result = await stocktakeService.getStocktake(options.getPool(), {
      requestContext,
      stocktakeId: detailMatch[1],
      revealExpected: true,
    });
    if (!result.ok) sendServiceError(res, result, options);
    else sendSuccess(res, result.stocktake, options.requestId, options.receivedAt);
    return true;
  }

  const actionMatch = /^\/api\/inventory\/stocktakes\/([0-9a-f-]+)\/(count|submit|recount|approve|post|cancel|reverse)$/i.exec(pathname);
  if (req.method === 'POST' && actionMatch) {
    const stocktakeId = actionMatch[1];
    const action = actionMatch[2].toLowerCase();
    const permission = {
      count: PERMISSIONS.count,
      submit: PERMISSIONS.submit,
      recount: PERMISSIONS.approve,
      approve: PERMISSIONS.approve,
      post: PERMISSIONS.post,
      cancel: PERMISSIONS.cancel,
      reverse: PERMISSIONS.reverse,
    }[action];
    const requestContext = await authenticateAndAuthorize(req, res, options, permission);
    if (!requestContext) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;

    const mutations = {
      count: (client, key) => stocktakeService.countStocktake(client, {
        requestContext, stocktakeId, payload, idempotencyKey: key,
      }),
      submit: (client, key) => stocktakeService.submitStocktake(client, {
        requestContext, stocktakeId, payload, idempotencyKey: key,
      }),
      recount: (client, key) => stocktakeService.requestRecount(client, {
        requestContext, stocktakeId, payload, idempotencyKey: key,
      }),
      approve: (client, key) => stocktakeService.approveStocktake(client, {
        requestContext, stocktakeId, payload, idempotencyKey: key,
      }),
      post: (client, key) => stocktakeService.postStocktake(client, {
        requestContext, stocktakeId, payload, idempotencyKey: key,
      }),
      cancel: (client, key) => stocktakeService.cancelStocktake(client, {
        requestContext, stocktakeId, payload, idempotencyKey: key,
      }),
      reverse: (client, key) => stocktakeService.reverseStocktake(client, {
        requestContext, stocktakeId, payload, idempotencyKey: key,
      }),
    };

    await executeIdempotentMutation(req, res, options, {
      requestContext,
      route: `POST /api/inventory/stocktakes/:id/${action}`,
      payload: { stocktakeId, ...payload },
      action,
      mutate: mutations[action],
    });
    return true;
  }

  return false;
}
