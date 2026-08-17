import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import { getSalesOrder } from '../services/sales-order.js';
import {
  completeManualSalesOrder,
  settleManualSalesOrder,
} from '../services/sales-manual-completion.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code === 'SALES_ORDER_NOT_FOUND') return 404;
  if (
    code.includes('CONFLICT')
    || code.includes('ALREADY')
    || code.includes('IDEMPOTENCY')
  ) return 409;
  if (code.endsWith('_UNAVAILABLE')) return 503;
  return 400;
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)),
    options.requestId,
    options.receivedAt,
  );
}

function withWarehouseScopes(requestContext, scopedWarehouseIds) {
  const scopes = Object.freeze({
    branchIds: Object.freeze([...(requestContext.scopes?.branchIds ?? [])]),
    warehouseIds: Object.freeze(scopedWarehouseIds),
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
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
    return requestContext;
  }
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
      apiError('UNAUTHORIZED', 'Cần đăng nhập để thực hiện thao tác này', {}, false, 401),
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
      apiError('FORBIDDEN', 'Tài khoản chưa được cấp quyền thực hiện thao tác này', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return ensureWarehouseScopes(options.getPool(), context);
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key
      ? { ok: true, key }
      : { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Thiếu khóa chống ghi trùng' };
  } catch {
    return { ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'Khóa chống ghi trùng không hợp lệ' };
  }
}

async function readPayload(req, res, options) {
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

async function writeSalesOrderAuditOutbox(client, { requestContext, before, after, action }) {
  const eventType = action === 'complete'
    ? 'sales.sales_order.manual_completed'
    : 'sales.sales_order.manual_settled';
  const auditAction = action === 'complete'
    ? 'manual_complete'
    : 'manual_settlement';
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: auditAction,
    resourceType: 'sales_order',
    resourceId: after.id,
    beforeData: before,
    afterData: after,
    metadata: {
      number: after.number,
      status: after.status,
      settlementStatus: after.settlementStatus,
      warehouseId: after.warehouseId,
    },
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'sales.sales_order',
    aggregateId: after.id,
    eventType,
    eventVersion: Number(after.currentVersionNumber),
    payload: after,
    metadata: { settlementStatus: after.settlementStatus },
  }));
}

async function executeMutation(req, res, options, {
  requestContext,
  id,
  action,
  payload,
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
      route: `/api/manual-sales-orders/${id}/${action}`,
      payload: { ...payload, id },
      onProcess: async () => {
        const transaction = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const beforeResult = await getSalesOrder(client, { requestContext, id });
            if (!beforeResult.ok) return { failed: true, result: beforeResult };
            const result = await mutate(client, keyResult.key);
            if (!result.ok) return { failed: true, result };
            const afterResult = await getSalesOrder(client, { requestContext, id });
            if (!afterResult.ok) return { failed: true, result: afterResult };
            await writeSalesOrderAuditOutbox(client, {
              requestContext,
              before: beforeResult.salesOrder,
              after: afterResult.salesOrder,
              action,
            });
            return { failed: false, result: afterResult };
          },
        });
        const result = transaction.result;
        if (!result.ok) {
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
            },
          };
        }
        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(result.salesOrder, options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(
      res,
      execution.response.statusCode,
      execution.response.body,
      execution.response.requestId ?? options.requestId,
      execution.response.contentType,
    );
  } catch {
    sendError(
      res,
      apiError('MANUAL_ORDER_TRANSACTION_UNAVAILABLE', 'Thao tác tạm thời chưa thực hiện được', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}

export async function handleManualSalesOrderRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/manual-sales-orders/')) return false;
  const match = url.pathname.match(/^\/api\/manual-sales-orders\/([^/]+)\/(complete|settlement)$/);
  if (!match) {
    sendError(res, apiError('NOT_FOUND', 'Không tìm thấy chức năng yêu cầu', {}, false, 404), options.requestId, options.receivedAt);
    return true;
  }
  if (req.method !== 'POST') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức yêu cầu không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  const [, id, action] = match;
  const permission = action === 'complete'
    ? options.PERMISSIONS.coreSalesOrderConfirm
    : options.PERMISSIONS.coreCustomerPaymentCreate;
  const context = await authenticateAndAuthorize(req, res, options, permission);
  if (!context) return true;
  const payload = await readPayload(req, res, options);
  if (payload === null) return true;

  await executeMutation(req, res, options, {
    requestContext: context,
    id,
    action,
    payload,
    mutate: action === 'complete'
      ? (client) => completeManualSalesOrder(client, {
          requestContext: context,
          id,
          expectedRevision: payload.expectedRevision,
        })
      : (client, key) => settleManualSalesOrder(client, {
          requestContext: context,
          id,
          expectedRevision: payload.expectedRevision,
          payload,
          idempotencyKey: key,
        }),
  });
  return true;
}