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
import * as transferService from '../services/inventory-transfer.js';

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
    || code.endsWith('LOCKED')
    || code === 'INVALID_STATUS_TRANSITION'
  ) return 409;
  if (code === 'DOCUMENT_NUMBER_SERIES_UNAVAILABLE') return 503;
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
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return null;
  }
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must use 1-128 safe characters' };
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
    authContext: requestContext.authContext ? Object.freeze({ ...requestContext.authContext, scopes }) : requestContext.authContext,
  });
}

async function ensureWarehouseScopes(client, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) return requestContext;
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
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const context = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(context, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  const scoped = await ensureWarehouseScopes(options.getPool(), context);
  if (!Array.isArray(scoped.scopes?.warehouseIds) || scoped.scopes.warehouseIds.length === 0) {
    sendError(res, apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return scoped;
}

function eventTypeFor(action) {
  return {
    create: 'inventory.transfer.created',
    update: 'inventory.transfer.updated',
    approve: 'inventory.transfer.approved',
    dispatch: 'inventory.transfer.dispatched',
    cancel: 'inventory.transfer.cancelled',
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
    sendError(res, apiError(keyResult.code, keyResult.message, {}, false, 400), options.requestId, options.receivedAt);
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
            const transfer = result.transfer;
            const metadata = {
              status: transfer.status,
              number: transfer.documentNumber,
              sourceWarehouseId: transfer.sourceWarehouseId,
              destinationWarehouseId: transfer.destinationWarehouseId,
              revision: transfer.revision,
              inventoryMovementId: transfer.inventoryMovementId,
            };
            await insertAuditRecord(client, buildAuditRecord({
              requestContext,
              action,
              resourceType: 'inventory_transfer',
              resourceId: transfer.id,
              beforeData: result.beforeData ?? null,
              afterData: transfer,
              metadata,
            }));
            const outboxEvent = buildOutboxEvent({
              requestContext,
              aggregateType: 'inventory.transfer',
              aggregateId: transfer.id,
              eventType: eventTypeFor(action),
              eventVersion: 1,
              payload: transfer,
              metadata,
            });
            await insertOutboxEvent(client, outboxEvent);
            return { transfer, eventId: outboxEvent.eventId };
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
                retryable: Boolean(result.retryable),
                details: result.details ?? {},
              },
              requestId: options.requestId,
              receivedAt: options.receivedAt,
            },
          };
        }
        return {
          statusCode,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(transactionResult.transfer, options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('INVENTORY_TRANSFER_TRANSACTION_FAILED', 'Transfer transaction failed', {}, true, 503), options.requestId, options.receivedAt);
  }
}

async function handleList(req, res, options, requestContext) {
  const url = new URL(`http://localhost${req.url}`);
  try {
    const result = await transferService.listInventoryTransfers(options.getPool(), {
      requestContext,
      search: url.searchParams.get('search'),
      status: url.searchParams.get('status'),
      limit: parseInteger(url.searchParams.get('limit'), 100, 1000),
      offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
    });
    if (!result.ok) return sendServiceError(res, result, options);
    sendSuccess(res, result.transfers, options.requestId, options.receivedAt);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
  }
}

async function handleInTransit(req, res, options, requestContext) {
  const url = new URL(`http://localhost${req.url}`);
  try {
    const result = await transferService.listInventoryTransferInTransit(options.getPool(), {
      requestContext,
      limit: parseInteger(url.searchParams.get('limit'), 500, 2000),
      offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
    });
    if (!result.ok) return sendServiceError(res, result, options);
    sendSuccess(res, result.inTransit, options.requestId, options.receivedAt);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
  }
}

export async function handleInventoryTransferRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== '/api/inventory/transfers' && !pathname.startsWith('/api/inventory/transfers/')) return false;
  const method = String(req.method || 'GET').toUpperCase();

  if (pathname === '/api/inventory/transfers' && method === 'GET') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryTransferRead);
    if (!context) return true;
    await handleList(req, res, options, context);
    return true;
  }
  if (pathname === '/api/inventory/transfers/in-transit' && method === 'GET') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryTransferRead);
    if (!context) return true;
    await handleInTransit(req, res, options, context);
    return true;
  }
  if (pathname === '/api/inventory/transfers' && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryTransferCreate);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: '/api/inventory/transfers',
      payload,
      action: 'create',
      statusCode: 201,
      mutate: (client) => transferService.createInventoryTransfer(client, { requestContext: context, payload }),
    });
    return true;
  }

  const actionMatch = pathname.match(/^\/api\/inventory\/transfers\/([^/]+)\/(approve|dispatch|cancel)$/);
  if (actionMatch && method === 'POST') {
    const [, id, action] = actionMatch;
    const permission = {
      approve: options.PERMISSIONS.coreInventoryTransferApprove,
      dispatch: options.PERMISSIONS.coreInventoryTransferDispatch,
      cancel: options.PERMISSIONS.coreInventoryTransferCancel,
    }[action];
    const context = await authenticateAndAuthorize(req, res, options, permission);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/inventory/transfers/${id}/${action}`,
      payload,
      action,
      mutate: (client, idempotencyKey) => {
        if (action === 'approve') return transferService.approveInventoryTransfer(client, { requestContext: context, id, payload, idempotencyKey });
        if (action === 'dispatch') return transferService.dispatchInventoryTransfer(client, { requestContext: context, id, payload, idempotencyKey });
        return transferService.cancelInventoryTransfer(client, { requestContext: context, id, payload });
      },
    });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/inventory\/transfers\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryTransferRead);
    if (!context) return true;
    const result = await transferService.getInventoryTransfer(options.getPool(), { requestContext: context, id: detailMatch[1] });
    if (!result.ok) return sendServiceError(res, result, options);
    sendSuccess(res, result.transfer, options.requestId, options.receivedAt);
    return true;
  }
  if (detailMatch && method === 'PATCH') {
    const context = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreInventoryTransferUpdate);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeIdempotentMutation(req, res, options, {
      requestContext: context,
      route: `/api/inventory/transfers/${detailMatch[1]}`,
      payload,
      action: 'update',
      mutate: (client) => transferService.updateInventoryTransfer(client, { requestContext: context, id: detailMatch[1], payload }),
    });
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
