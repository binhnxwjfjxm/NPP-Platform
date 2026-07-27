import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as customerService from '../services/customer.js';

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function parseBooleanParam(value) {
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
    code: 'INVALID_QUERY_PARAMETER',
    publicMessage: 'Query parameter must be true or false',
    statusCode: 400,
  });
}

function parsePositiveIntParam(value, defaultValue, maxValue) {
  if (value === null) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxValue) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Query parameter must be an integer between 0 and ${maxValue}`,
      statusCode: 400,
    });
  }
  return parsed;
}

function requireIdempotencyKey(req, requestId, receivedAt) {
  const rawKey = req.headers['idempotency-key'];
  if (rawKey === undefined || rawKey === null) {
    return {
      statusCode: 400,
      body: createErrorEnvelope(
        { code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required', statusCode: 400 },
        requestId,
        receivedAt,
      ),
    };
  }
  try {
    normalizeIdempotencyKey(rawKey);
    return null;
  } catch (error) {
    return {
      statusCode: 400,
      body: createErrorEnvelope(
        { code: error.code, message: 'Idempotency-Key must be 1-128 characters and contain only letters, numbers, dots, underscores, or hyphens', statusCode: error.statusCode },
        requestId,
        receivedAt,
      ),
    };
  }
}

function createErrorEnvelope(error, requestId, receivedAt) {
  return {
    error,
    requestId,
    receivedAt,
  };
}

function serviceStatus(result) {
  if (result.code === 'NOT_FOUND') return 404;
  if (result.code === 'DUPLICATE_CODE' || result.code === 'CONFLICT') return 409;
  return 400;
}

async function handleGetCustomers(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const url = new URL(`http://localhost${req.url}`);
  let active, limit, offset;
  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    if (error.statusCode) {
      sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
      return;
    }
    sendError(res, createError('INTERNAL_ERROR', 'Failed to parse query parameters', {}, true, 500), requestId, receivedAt);
    return;
  }

  const pool = getPool();
  try {
    const result = await customerService.listCustomers(pool, {
      installationId: requestContext.installationId,
      active,
      limit,
      offset,
    });

    sendSuccess(res, result.customers, requestId, receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list customers', {}, true, 500), requestId, receivedAt);
  }
}

async function handlePostCustomers(req, res, { requestContext, idempotencyStore, getPool, executeRequestWithIdempotency, requestId, receivedAt }) {
  const missingKey = requireIdempotencyKey(req, requestId, receivedAt);
  if (missingKey) {
    sendError(res, createError(missingKey.body.error?.code ?? 'MISSING_IDEMPOTENCY_KEY', missingKey.body.error?.message ?? 'Idempotency-Key header is required', {}, false, 400), requestId, receivedAt);
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    const executionResult = await executeRequestWithIdempotency({
      idempotencyStore,
      req,
      requestContext,
      requestId,
      receivedAt,
      route: '/api/customers',
      payload,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: pool,
          mutate: async (client) => {
            const serviceResult = await customerService.createCustomer(client, {
              installationId: requestContext.installationId,
              payload,
              createdBy: requestContext.actorId,
            });

            if (!serviceResult.ok) {
              return { skipAudit: true, serviceResult };
            }

            const customer = serviceResult.customer;
            const auditRecord = buildAuditRecord({
              requestContext,
              action: 'create',
              resourceType: 'customer',
              resourceId: customer.id,
              afterData: customer,
              metadata: { code: customer.code },
            });
            await insertAuditRecord(client, auditRecord);
            return { customer };
          },
        });

        if (transactionResult?.skipAudit) {
          const serviceResult = transactionResult.serviceResult;
          return {
            statusCode: serviceStatus(serviceResult),
            contentType: 'application/json',
            requestId,
            body: createErrorEnvelope({
              code: serviceResult.code,
              message: serviceResult.message,
              details: {},
              retryable: serviceResult.retryable ?? false,
            }, requestId, receivedAt),
          };
        }

        const customer = transactionResult.customer;
        return {
          statusCode: 201,
          contentType: 'application/json',
          requestId,
          body: createSuccessEnvelope(customer, requestId, receivedAt),
        };
      },
    });

    res.setHeader('Cache-Control', 'no-store');
    sendJson(
      res,
      executionResult.response.statusCode,
      executionResult.response.body,
      executionResult.response.requestId ?? requestId,
      executionResult.response.contentType,
    );
  } catch {
    sendError(res, createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503), requestId, receivedAt);
  }
}

async function handleGetCustomerById(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const parsed = parseUrl(req.url.split('?')[0]);
  if (!parsed || !parsed.id) {
    sendError(res, createError('NOT_FOUND', 'Customer not found', {}, false, 404), requestId, receivedAt);
    return;
  }

  const pool = getPool();
  try {
    const result = await customerService.getCustomer(pool, { installationId: requestContext.installationId, id: parsed.id });
    if (!result.ok) {
      sendError(res, createError('NOT_FOUND', 'Customer not found', {}, false, 404), requestId, receivedAt);
      return;
    }

    sendSuccess(res, result.customer, requestId, receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch customer', {}, true, 500), requestId, receivedAt);
  }
}

async function handlePatchCustomerById(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const parsed = parseUrl(req.url.split('?')[0]);
  if (!parsed || !parsed.id) {
    sendError(res, createError('NOT_FOUND', 'Customer not found', {}, false, 404), requestId, receivedAt);
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
    return;
  }

  const expectedUpdatedAtError = requireExpectedUpdatedAt(payload);
  if (expectedUpdatedAtError) {
    sendError(res, createError(expectedUpdatedAtError.error.code, expectedUpdatedAtError.error.message, {}, false, expectedUpdatedAtError.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    const result = await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        if (typeof payload.isActive === 'boolean') {
          const statusResult = await customerService.updateCustomerStatus(client, {
            id: parsed.id,
            installationId: requestContext.installationId,
            isActive: payload.isActive,
            updatedBy: requestContext.actorId,
            expectedUpdatedAt: payload.expectedUpdatedAt,
          });

          if (!statusResult.ok) {
            throw Object.assign(new Error('CUSTOMER_STATUS_UPDATE_FAILED'), { serviceResult: statusResult });
          }

          const auditRecord = buildAuditRecord({
            requestContext,
            action: payload.isActive ? 'activate' : 'deactivate',
            resourceType: 'customer',
            resourceId: statusResult.customer.id,
            beforeData: statusResult.beforeData || null,
            afterData: statusResult.customer,
            metadata: { code: statusResult.customer.code },
          });

          await insertAuditRecord(client, auditRecord);
          return { customer: statusResult.customer };
        }

        const updateResult = await customerService.updateCustomer(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          payload,
          updatedBy: requestContext.actorId,
        });

        if (!updateResult.ok) {
          throw Object.assign(new Error('CUSTOMER_UPDATE_FAILED'), { serviceResult: updateResult });
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: 'update',
          resourceType: 'customer',
          resourceId: updateResult.customer.id,
          beforeData: updateResult.beforeData || null,
          afterData: updateResult.customer,
          metadata: { code: updateResult.customer.code },
        });

        await insertAuditRecord(client, auditRecord);
        return { customer: updateResult.customer };
      },
    });

    sendSuccess(res, result.customer, requestId, receivedAt);
  } catch (error) {
    if (error?.serviceResult) {
      const result = error.serviceResult;
      const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
      sendError(res, createError(result.code, result.message, {}, result.retryable ?? false, statusCode), requestId, receivedAt);
      return;
    }

    sendError(res, createError('INTERNAL_ERROR', 'Failed to update customer', {}, true, 500), requestId, receivedAt);
  }
}

function parseUrl(pathname) {
  const match = pathname.match(/^\/api\/customers(?:\/([^/]+))?$/);
  if (!match) return null;
  return { id: match[1] };
}

function requireExpectedUpdatedAt(payload) {
  if (!payload || typeof payload.expectedUpdatedAt !== 'string' || !payload.expectedUpdatedAt.trim()) {
    return {
      statusCode: 400,
      error: {
        code: 'MISSING_EXPECTED_UPDATED_AT',
        message: 'expectedUpdatedAt is required for patch operations',
        statusCode: 400,
      },
    };
  }
  return null;
}

export async function handleCustomerRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (!pathname.startsWith('/api/customers')) {
    return false;
  }

  const authResult = options.authenticate(req, options.config);
  if (!authResult.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, createError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }

  const requestContext = options.createContext({
    config: options.config,
    principal: authResult.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });

  const method = String(req.method || 'GET').toUpperCase();
  const requiredPermission = method === 'GET'
    ? options.PERMISSIONS.coreCustomerRead
    : options.PERMISSIONS.coreCustomerWrite;
  const authCheck = options.authorize(requestContext, requiredPermission);
  if (!authCheck.ok) {
    sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  if (pathname === '/api/customers' && method === 'GET') {
    await handleGetCustomers(req, res, { ...options, requestContext });
    return true;
  }

  if (pathname === '/api/customers' && method === 'POST') {
    await handlePostCustomers(req, res, { ...options, requestContext });
    return true;
  }

  if (/^\/api\/customers\/[^/]+$/.test(pathname) && method === 'GET') {
    await handleGetCustomerById(req, res, { ...options, requestContext });
    return true;
  }

  if (/^\/api\/customers\/[^/]+$/.test(pathname) && method === 'PATCH') {
    await handlePatchCustomerById(req, res, { ...options, requestContext });
    return true;
  }

  sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
