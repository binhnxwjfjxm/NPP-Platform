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
import * as receiptService from '../services/inventory-transfer-receipt.js';

const PERMISSIONS = Object.freeze({
  read: 'core.inventory-transfer.read',
  receive: 'core.inventory-transfer.receive',
  damageApprove: 'core.inventory-transfer.damage-approve',
  resolve: 'core.inventory-transfer.resolve',
  reverse: 'core.inventory-transfer.reverse',
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
    || code.includes('ALREADY')
    || code.includes('BLOCKS')
    || code.includes('DOWNSTREAM')
    || code.includes('EXCEEDS')
    || code.endsWith('LOCKED')
    || code.endsWith('CLOSED')
    || code.endsWith('REVERSED')
    || code === 'TRANSFER_NOT_DISPATCHED'
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

function mutationData(result) {
  if (result.receipt) return Object.freeze({ transfer: result.transfer, receipt: result.receipt });
  return Object.freeze({
    transfer: result.transfer,
    shortClosure: result.shortClosure,
    resolution: result.resolution,
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
        const transaction = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const result = await mutate(client, keyResult.key);
            if (!result.ok) return { result, failed: true };
            const data = mutationData(result);
            const resourceId = result.receipt?.id ?? result.shortClosure?.id ?? result.transfer.id;
            const metadata = {
              inventoryTransferId: result.transfer.id,
              inventoryTransferReceiptId: result.receipt?.id ?? null,
              inventoryMovementId: result.receipt?.inventoryMovementId ?? null,
              shortClosureId: result.shortClosure?.id ?? null,
            };
            const audit = buildAuditRecord({
              requestContext,
              action,
              resourceType: result.receipt ? 'inventory_transfer_receipt' : 'inventory_transfer_resolution',
              resourceId,
              beforeData: null,
              afterData: data,
              metadata,
            });
            const event = buildOutboxEvent({
              requestContext,
              aggregateType: 'inventory.transfer',
              aggregateId: result.transfer.id,
              eventType,
              eventVersion: 1,
              payload: data,
              metadata,
            });
            await insertAuditRecord(client, audit);
            await insertOutboxEvent(client, event);
            return { data, eventId: event.eventId };
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
                retryable: Boolean(result.retryable),
                details: result.details ?? {},
              },
              requestId: options.requestId,
              receivedAt: options.receivedAt,
            },
          };
        }
        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(transaction.data, options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('INVENTORY_TRANSFER_RECEIPT_TRANSACTION_FAILED', 'Transfer receipt transaction failed', {}, true, 503), options.requestId, options.receivedAt);
  }
}

export async function handleInventoryTransferReceiptRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const method = String(req.method || 'GET').toUpperCase();
  const listMatch = pathname.match(/^\/api\/inventory\/transfers\/([^/]+)\/receipts$/);
  const damageMatch = pathname.match(/^\/api\/inventory\/transfers\/([^/]+)\/receipts\/([^/]+)\/approve-damage$/);
  const reverseMatch = pathname.match(/^\/api\/inventory\/transfers\/([^/]+)\/receipts\/([^/]+)\/reverse$/);
  const closeShortMatch = pathname.match(/^\/api\/inventory\/transfers\/([^/]+)\/close-short$/);
  if (!listMatch && !damageMatch && !reverseMatch && !closeShortMatch) return false;

  if (listMatch && method === 'GET') {
    const context = await authenticateAndAuthorize(req, res, options, PERMISSIONS.read);
    if (!context) return true;
    const result = await receiptService.listTransferReceipts(options.getPool(), {
      requestContext: context,
      transferId: listMatch[1],
    });
    if (!result.ok) return sendServiceError(res, result, options) ?? true;
    sendSuccess(res, {
      transfer: result.transfer,
      receipts: result.receipts,
      resolution: result.resolution,
      shortClosure: result.shortClosure,
    }, options.requestId, options.receivedAt);
    return true;
  }

  if (listMatch && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, PERMISSIONS.receive);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeMutation(req, res, options, {
      requestContext: context,
      route: `/api/inventory/transfers/${listMatch[1]}/receipts`,
      payload,
      action: 'inventory.transfer.receive',
      eventType: 'inventory.transfer.received',
      mutate: (client, idempotencyKey) => receiptService.createTransferReceipt(client, {
        requestContext: context,
        transferId: listMatch[1],
        payload,
        idempotencyKey,
      }),
    });
    return true;
  }

  if (damageMatch && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, PERMISSIONS.damageApprove);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeMutation(req, res, options, {
      requestContext: context,
      route: `/api/inventory/transfers/${damageMatch[1]}/receipts/${damageMatch[2]}/approve-damage`,
      payload,
      action: 'inventory.transfer.damage_approve',
      eventType: 'inventory.transfer.damage.approved',
      mutate: (client) => receiptService.approveTransferReceiptDamage(client, {
        requestContext: context,
        transferId: damageMatch[1],
        receiptId: damageMatch[2],
        payload,
      }),
    });
    return true;
  }

  if (reverseMatch && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, PERMISSIONS.reverse);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeMutation(req, res, options, {
      requestContext: context,
      route: `/api/inventory/transfers/${reverseMatch[1]}/receipts/${reverseMatch[2]}/reverse`,
      payload,
      action: 'inventory.transfer.receipt_reverse',
      eventType: 'inventory.transfer.receipt.reversed',
      mutate: (client, idempotencyKey) => receiptService.reverseTransferReceipt(client, {
        requestContext: context,
        transferId: reverseMatch[1],
        receiptId: reverseMatch[2],
        payload,
        idempotencyKey,
      }),
    });
    return true;
  }

  if (closeShortMatch && method === 'POST') {
    const context = await authenticateAndAuthorize(req, res, options, PERMISSIONS.resolve);
    if (!context) return true;
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeMutation(req, res, options, {
      requestContext: context,
      route: `/api/inventory/transfers/${closeShortMatch[1]}/close-short`,
      payload,
      action: 'inventory.transfer.close_short',
      eventType: 'inventory.transfer.short.closed',
      mutate: (client) => receiptService.closeTransferShortage(client, {
        requestContext: context,
        transferId: closeShortMatch[1],
        payload,
      }),
    });
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
