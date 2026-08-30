import { createIdempotencyKey, createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as customerBulkService from '../services/customer-bulk.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function sendServiceError(res, result, context) {
  sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), 400), context.requestId, context.receivedAt);
}

async function payload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return null;
  }
}

function requireIdempotency(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined || raw === null) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  try {
    normalizeIdempotencyKey(raw);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key không hợp lệ' };
  }
}

async function executeBulkMutation(req, res, context, { route, body, mutate, resourceType, action }) {
  const key = requireIdempotency(req);
  if (!key.ok) {
    sendError(res, apiError(key.code, key.message, {}, false, 400), context.requestId, context.receivedAt);
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
        const result = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const serviceResult = await mutate(client);
            if (!serviceResult.ok) return { failed: serviceResult };
            const summary = {
              created: serviceResult.created ?? 0,
              updated: serviceResult.updated ?? 0,
              skipped: serviceResult.skipped ?? 0,
              unchanged: serviceResult.unchanged ?? 0,
            };
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action,
              resourceType,
              resourceId: context.requestId,
              afterData: summary,
              metadata: summary,
            }));
            return { entity: serviceResult };
          },
        });
        if (result.failed) {
          return {
            statusCode: 400,
            contentType: 'application/json',
            requestId: context.requestId,
            body: { error: { code: result.failed.code, message: result.failed.message, retryable: false, details: result.failed.details ?? {} }, requestId: context.requestId, receivedAt: context.receivedAt },
          };
        }
        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(result.entity, context.requestId, context.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? context.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('CUSTOMER_BULK_STORAGE_UNAVAILABLE', 'Dữ liệu khách hàng tạm thời không sẵn sàng', {}, true, 503), context.requestId, context.receivedAt);
  }
}

export async function handleCustomerBulkRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const method = String(req.method || 'GET').toUpperCase();
  const isBulkPath = pathname === '/api/customers/identify'
    || pathname === '/api/customers/import'
    || pathname === '/api/customers/bulk-update';
  if (!isBulkPath) return false;

  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = options.createContext({ config: options.config, principal: auth.principal, requestId: options.requestId, receivedAt: options.receivedAt });
  const isReadOperation = pathname === '/api/customers/identify' && method === 'POST';
  const permission = options.authorize(requestContext, isReadOperation ? options.PERMISSIONS.coreCustomerRead : options.PERMISSIONS.coreCustomerWrite);
  if (!permission.ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  const context = { ...options, requestContext };
  const methodAllowed = (pathname === '/api/customers/identify' && method === 'POST')
    || (pathname === '/api/customers/import' && method === 'POST')
    || (pathname === '/api/customers/bulk-update' && method === 'PATCH');
  if (!methodAllowed) {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), context.requestId, context.receivedAt);
    return true;
  }
  const body = await payload(req, res, context);
  if (body === null) return true;

  if (pathname === '/api/customers/identify' && method === 'POST') {
    try {
      const result = await customerBulkService.identifyCustomers(context.getPool(), { installationId: requestContext.installationId, payload: body });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result, context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('CUSTOMER_BULK_STORAGE_UNAVAILABLE', 'Dữ liệu khách hàng tạm thời không sẵn sàng', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }

  if (pathname === '/api/customers/import' && method === 'POST') {
    if (body.dryRun === true) {
      try {
        const result = await customerBulkService.importCustomers(context.getPool(), { installationId: requestContext.installationId, payload: body, createdBy: requestContext.actorId });
        if (!result.ok) return sendServiceError(res, result, context), true;
        sendSuccess(res, { ...result, operationKey: createIdempotencyKey('customer-import') }, context.requestId, context.receivedAt);
      } catch {
        sendError(res, apiError('CUSTOMER_BULK_STORAGE_UNAVAILABLE', 'Dữ liệu khách hàng tạm thời không sẵn sàng', {}, true, 503), context.requestId, context.receivedAt);
      }
      return true;
    }
    await executeBulkMutation(req, res, context, {
      route: pathname,
      body,
      mutate: (client) => customerBulkService.importCustomers(client, { installationId: requestContext.installationId, payload: body, createdBy: requestContext.actorId }),
      resourceType: 'customer_import',
      action: 'import',
    });
    return true;
  }

  if (pathname === '/api/customers/bulk-update' && method === 'PATCH') {
    if (body.dryRun === true) {
      try {
        const result = await customerBulkService.bulkUpdateCustomers(context.getPool(), { installationId: requestContext.installationId, payload: body, updatedBy: requestContext.actorId });
        if (!result.ok) return sendServiceError(res, result, context), true;
        sendSuccess(res, { ...result, operationKey: createIdempotencyKey('customer-bulk-update') }, context.requestId, context.receivedAt);
      } catch {
        sendError(res, apiError('CUSTOMER_BULK_STORAGE_UNAVAILABLE', 'Dữ liệu khách hàng tạm thời không sẵn sàng', {}, true, 503), context.requestId, context.receivedAt);
      }
      return true;
    }
    await executeBulkMutation(req, res, context, {
      route: pathname,
      body,
      mutate: (client) => customerBulkService.bulkUpdateCustomers(client, { installationId: requestContext.installationId, payload: body, updatedBy: requestContext.actorId }),
      resourceType: 'customer_bulk_update',
      action: 'bulk_update',
    });
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), context.requestId, context.receivedAt);
  return true;
}
