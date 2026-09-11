import { createSuccessEnvelope, isValidIdempotencyKey } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { PERMISSIONS } from '../access/permissions.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import * as service from '../services/warehouse-location-mode.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('IDEMPOTENCY')
    || code.includes('STALE')
    || code.includes('RESERVATION')
    || code.includes('NEGATIVE_STOCK')
    || code.includes('UNRESOLVED')
    || code === 'LOCATION_MANAGEMENT_MODE_UNCHANGED'
  ) return 409;
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

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Tham số phải là số nguyên từ 0 đến ${max}.`,
      statusCode: 400,
    });
  }
  return parsed;
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(error.code ?? 'INVALID_INPUT', error.publicMessage ?? 'Dữ liệu gửi lên không hợp lệ.', {}, false, error.statusCode ?? 400),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Cần Idempotency-Key cho thao tác này.' };
    if (!isValidIdempotencyKey(key)) {
      return { ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key không hợp lệ.' };
    }
    return { ok: true, key };
  } catch {
    return { ok: false, code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key không hợp lệ.' };
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
    sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập để tiếp tục.', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const context = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(context, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  const scoped = await ensureWarehouseScopes(options.getPool(), context);
  if (!Array.isArray(scoped.scopes?.warehouseIds) || scoped.scopes.warehouseIds.length === 0) {
    sendError(res, apiError('WAREHOUSE_SCOPE_DENIED', 'Bạn chưa được cấp phạm vi kho.', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return scoped;
}

function hasWarehouseScope(requestContext, warehouseId) {
  return Array.isArray(requestContext.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function runMetadata(run) {
  return {
    warehouseId: run.warehouseId,
    fromMode: run.fromMode,
    targetMode: run.targetMode,
    affectedSkuCount: run.affectedSkuCount,
    affectedScopeCount: run.affectedScopeCount,
    issueMovementId: run.issueMovementId,
    receiptMovementId: run.receiptMovementId,
  };
}

async function executeConvert(req, res, options, {
  requestContext,
  warehouseId,
  payload,
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
      route: 'POST /api/inventory/warehouses/:warehouseId/location-mode/convert',
      payload: { warehouseId, ...payload },
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const result = await service.convertWarehouseLocationMode(client, {
              requestContext,
              warehouseId,
              payload,
              idempotencyKey: keyResult.key,
            });
            if (!result.ok) return { result, failed: true };
            if (result.replayed) return { run: result.run, replayed: true };

            const metadata = runMetadata(result.run);
            await insertAuditRecord(client, buildAuditRecord({
              requestContext,
              action: 'warehouse.location_mode.convert',
              resourceType: 'warehouse_location_mode_run',
              resourceId: result.run.id,
              beforeData: {
                warehouseId,
                locationManagementMode: result.run.fromMode,
              },
              afterData: {
                warehouseId,
                locationManagementMode: result.run.targetMode,
                runId: result.run.id,
              },
              metadata,
            }));
            const outboxEvent = buildOutboxEvent({
              requestContext,
              aggregateType: 'inventory.warehouse_location_mode',
              aggregateId: warehouseId,
              eventType: 'inventory.warehouse_location_mode.completed',
              eventVersion: 1,
              payload: result.run,
              metadata,
            });
            await insertOutboxEvent(client, outboxEvent);
            return { run: result.run, eventId: outboxEvent.eventId };
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
          statusCode: 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(transactionResult.run, options.requestId, options.receivedAt),
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
      event: 'warehouse_location_mode_conversion_failed',
      requestId: options.requestId,
      errorName: error?.name ?? null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }));
    sendError(
      res,
      apiError('WAREHOUSE_LOCATION_MODE_OPERATION_FAILED', 'Không thể chuyển chế độ quản lý vị trí của kho.', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}

export async function handleWarehouseLocationModeRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  const previewMatch = /^\/api\/inventory\/warehouses\/([0-9a-f-]+)\/location-mode\/preview$/i.exec(pathname);
  const convertMatch = /^\/api\/inventory\/warehouses\/([0-9a-f-]+)\/location-mode\/convert$/i.exec(pathname);
  const runsMatch = /^\/api\/inventory\/warehouses\/([0-9a-f-]+)\/location-mode\/runs$/i.exec(pathname);
  const runDetailMatch = /^\/api\/inventory\/location-mode-runs\/([0-9a-f-]+)$/i.exec(pathname);

  if (!previewMatch && !convertMatch && !runsMatch && !runDetailMatch) return false;

  if (req.method === 'GET' && previewMatch) {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.coreWarehouseWrite);
    if (!requestContext) return true;
    const warehouseId = previewMatch[1];
    if (!hasWarehouseScope(requestContext, warehouseId)) {
      sendServiceError(res, { code: 'WAREHOUSE_SCOPE_DENIED', message: 'Kho nằm ngoài phạm vi được cấp quyền.' }, options);
      return true;
    }
    const result = await service.previewWarehouseLocationMode(options.getPool(), {
      requestContext,
      warehouseId,
      targetMode: url.searchParams.get('targetMode'),
      destinationLocationId: url.searchParams.get('destinationLocationId'),
    });
    if (!result.ok) sendServiceError(res, result, options);
    else sendSuccess(res, result.preview, options.requestId, options.receivedAt);
    return true;
  }

  if (req.method === 'POST' && convertMatch) {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.coreWarehouseWrite);
    if (!requestContext) return true;
    const warehouseId = convertMatch[1];
    if (!hasWarehouseScope(requestContext, warehouseId)) {
      sendServiceError(res, { code: 'WAREHOUSE_SCOPE_DENIED', message: 'Kho nằm ngoài phạm vi được cấp quyền.' }, options);
      return true;
    }
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeConvert(req, res, options, { requestContext, warehouseId, payload });
    return true;
  }

  if (req.method === 'GET' && runsMatch) {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.coreWarehouseWrite);
    if (!requestContext) return true;
    const warehouseId = runsMatch[1];
    if (!hasWarehouseScope(requestContext, warehouseId)) {
      sendServiceError(res, { code: 'WAREHOUSE_SCOPE_DENIED', message: 'Kho nằm ngoài phạm vi được cấp quyền.' }, options);
      return true;
    }
    try {
      const result = await service.listWarehouseLocationModeRuns(options.getPool(), {
        requestContext,
        warehouseId,
        limit: parseInteger(url.searchParams.get('limit'), 100, 500),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.runs, options.requestId, options.receivedAt);
    } catch (error) {
      sendError(
        res,
        apiError(error.code ?? 'INVALID_QUERY_PARAMETER', error.publicMessage ?? 'Tham số không hợp lệ.', {}, false, error.statusCode ?? 400),
        options.requestId,
        options.receivedAt,
      );
    }
    return true;
  }

  if (req.method === 'GET' && runDetailMatch) {
    const requestContext = await authenticateAndAuthorize(req, res, options, PERMISSIONS.coreWarehouseWrite);
    if (!requestContext) return true;
    const result = await service.getWarehouseLocationModeRun(options.getPool(), {
      requestContext,
      runId: runDetailMatch[1],
    });
    if (!result.ok) sendServiceError(res, result, options);
    else sendSuccess(res, result.run, options.requestId, options.receivedAt);
    return true;
  }

  sendError(
    res,
    apiError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.', {}, false, 405),
    options.requestId,
    options.receivedAt,
  );
  return true;
}
